/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tier L2/L3 Mandala Document Factory & Non-Blocking Persistence Coordinator:
 * - Debounced + idle-scheduled serialization keeping the 240Hz main thread stall-free
 * - Automatic L3 IndexedDB offload when document size exceeds safe localStorage budget
 */

import { createDebouncedTask, scheduleIdleTask } from '../../../shared/lib/throttleDebounce.ts';
import {
  CAMERA_LIMITS,
  RESOURCE_GUARD_LIMITS,
  STORAGE_KEY_V1,
  WORLD_SPACE_LIMITS,
} from '../model/constants.ts';
import type {
  CameraTransform,
  MandalaDocument,
  SymmetryParams,
  WedgeStroke,
} from '../model/types.ts';
import { migrateDocumentV1ToV2, parseMandalaDocumentJSON } from '../model/schemas.ts';
import { IndexedDbSwapAdapter } from '../memory/swapStorage.ts';
import { estimateWedgeHeapBytes } from '../memory/memoryBudget.ts';

export interface DocumentSnapshotInput {
  title?: string;
  symmetryParams: SymmetryParams;
  wedges: WedgeStroke[];
  paletteId: string;
  activeColour: string;
  activeStrokeWidth: number;
  activeDash: number[] | null;
  worldRadius?: number;
  camera?: CameraTransform;
}

let cancelIdleWrite: (() => void) | null = null;

export function buildMandalaDocument(input: DocumentSnapshotInput): MandalaDocument {
  const baseV1 = {
    schemaVersion: 1 as const,
    title: input.title ?? `Mandala ${input.symmetryParams.order} ordini`,
    symmetryParams: input.symmetryParams,
    wedges: input.wedges,
    paletteId: input.paletteId,
    activeColour: input.activeColour,
    activeStrokeWidth: input.activeStrokeWidth,
    activeDash: input.activeDash,
    createdAt: new Date().toISOString(),
  };

  const migrated = migrateDocumentV1ToV2(baseV1);
  return {
    ...migrated,
    worldRadius: input.worldRadius ?? WORLD_SPACE_LIMITS.extendedRadius,
    camera: input.camera ?? { zoom: CAMERA_LIMITS.defaultZoom, panX: 0, panY: 0 },
  };
}

function commitDocumentSnapshot(input: DocumentSnapshotInput): void {
  const doc = buildMandalaDocument({ ...input, title: 'Mandala Studio Session' });
  const estimatedBytes = estimateWedgeHeapBytes(doc.wedges);

  if (
    typeof window !== 'undefined' &&
    window.localStorage &&
    estimatedBytes <= RESOURCE_GUARD_LIMITS.maxLocalStorageJsonBytes
  ) {
    try {
      const json = JSON.stringify(doc);
      if (json.length <= RESOURCE_GUARD_LIMITS.maxLocalStorageJsonBytes) {
        window.localStorage.setItem(STORAGE_KEY_V1, json);
      }
    } catch {
      // If localStorage hits quota, L3 IndexedDB swap below preserves durability silently
    }
  }

  if (typeof indexedDB !== 'undefined') {
    void IndexedDbSwapAdapter.saveActiveDocument(doc);
  }
}

const debouncedPersistTask = createDebouncedTask((input: DocumentSnapshotInput) => {
  if (cancelIdleWrite) {
    cancelIdleWrite();
    cancelIdleWrite = null;
  }
  cancelIdleWrite = scheduleIdleTask(() => {
    cancelIdleWrite = null;
    commitDocumentSnapshot(input);
  }, RESOURCE_GUARD_LIMITS.persistenceDebounceMs);
}, RESOURCE_GUARD_LIMITS.persistenceDebounceMs);

/**
 * Schedules off-the-hot-path persistence coalesced across rapid strokes and slider drags.
 */
export function saveDocumentToStorage(input: DocumentSnapshotInput): void {
  debouncedPersistTask.schedule(input);
}

export function flushPendingPersistence(): void {
  debouncedPersistTask.flush();
}

export async function clearSavedSessionStorage(): Promise<void> {
  debouncedPersistTask.cancel();
  if (cancelIdleWrite) {
    cancelIdleWrite();
    cancelIdleWrite = null;
  }
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.removeItem(STORAGE_KEY_V1);
    } catch {
      // Ignore storage access errors
    }
  }
  if (typeof indexedDB !== 'undefined') {
    await IndexedDbSwapAdapter.clearActiveDocument();
  }
}

export function loadDocumentFromStorage(): {
  doc: MandalaDocument | null;
  warning: string | null;
} {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { doc: null, warning: null };
  }
  const raw = window.localStorage.getItem(STORAGE_KEY_V1);
  if (!raw) return { doc: null, warning: null };

  const parsed = parseMandalaDocumentJSON(raw);
  if (!parsed.ok) {
    return { doc: null, warning: parsed.error };
  }
  return { doc: parsed.value, warning: null };
}

export async function recoverDocumentFromIndexedDbSwap(): Promise<MandalaDocument | null> {
  const res = await IndexedDbSwapAdapter.loadActiveDocument();
  return res.ok ? res.value : null;
}
