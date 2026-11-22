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
  DiagnosticSeverity,
  DiagnosticSource,
  DomainErrorCode,
  reportDiagnostic,
} from '../../../shared/lib/diagnostics.ts';
import {
  CAMERA_LIMITS,
  MANDALA_LIMITS,
  RESOURCE_GUARD_LIMITS,
  STORAGE_KEY_V1,
  WORLD_SPACE_LIMITS,
} from '../model/constants.ts';
import { MANDALA_MESSAGES } from '../model/messages.ts';
import { DEFAULT_PALETTE, PALETTES, resolvePaletteById } from '../model/palettes.ts';
import {
  SymmetryStrategyKind,
  type CameraTransform,
  type MandalaDocument,
  type Palette,
  type SymmetryParams,
  type WedgeStroke,
} from '../model/types.ts';
import {
  migrateDocumentV1ToV2,
  parseMandalaDocumentJSON,
  resolveDocumentToActiveWedges,
} from '../model/schemas.ts';
import { IndexedDbSwapAdapter } from '../memory/swapStorage.ts';
import { estimateWedgeHeapBytes } from '../memory/memoryBudget.ts';
import { evaluateWorkloadAdmission } from './resourceGuard.ts';
import { clampCameraPan, DEFAULT_CAMERA_TRANSFORM } from './viewportCamera.ts';

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

export interface HydratedWorkspaceSeed {
  readonly wedges: WedgeStroke[];
  readonly symmetryParams: SymmetryParams;
  readonly activePalette: Palette;
  readonly activeColor: string;
  readonly strokeWidth: number;
  readonly activeDash: number[] | null;
  readonly camera: CameraTransform;
  readonly worldRadius: number;
  readonly warning: string | null;
}

const DEFAULT_HYDRATED_SYMMETRY: SymmetryParams = {
  strategyId: SymmetryStrategyKind.Radial,
  order: MANDALA_LIMITS.defaultOrder,
};

const MAX_LOCAL_STORAGE_RAW_CHARS = Math.round(
  RESOURCE_GUARD_LIMITS.maxLocalStorageJsonBytes * 1.1
);

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

function getSafeLocalStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage ?? null;
  } catch (e) {
    reportDiagnostic({
      severity: DiagnosticSeverity.Info,
      source: DiagnosticSource.Storage,
      code: DomainErrorCode.StorageAccessDenied,
      message: MANDALA_MESSAGES.persistence.storageReadWarning,
      cause: e,
    });
    return null;
  }
}

function removeSavedKeySafely(storage: Storage): void {
  try {
    storage.removeItem(STORAGE_KEY_V1);
  } catch (e) {
    reportDiagnostic({
      severity: DiagnosticSeverity.Info,
      source: DiagnosticSource.Storage,
      code: DomainErrorCode.StorageAccessDenied,
      message: MANDALA_MESSAGES.persistence.storageReadWarning,
      cause: e,
    });
  }
}

function isIndexedDbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

function commitDocumentSnapshot(input: DocumentSnapshotInput): void {
  const doc = buildMandalaDocument({ ...input, title: MANDALA_MESSAGES.workspace.sessionDocTitle });
  const estimatedBytes = estimateWedgeHeapBytes(doc.wedges);
  const storage = getSafeLocalStorage();

  if (
    storage &&
    estimatedBytes <= RESOURCE_GUARD_LIMITS.maxLocalStorageJsonBytes
  ) {
    try {
      const json = JSON.stringify(doc);
      if (json.length <= RESOURCE_GUARD_LIMITS.maxLocalStorageJsonBytes) {
        storage.setItem(STORAGE_KEY_V1, json);
      }
    } catch (e) {
      reportDiagnostic({
        severity: DiagnosticSeverity.Warning,
        source: DiagnosticSource.Storage,
        code: DomainErrorCode.StorageQuotaExceeded,
        message: MANDALA_MESSAGES.persistence.storageQuotaWarning,
        cause: e,
      });
    }
  }

  if (isIndexedDbAvailable()) {
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
  const storage = getSafeLocalStorage();
  if (storage) {
    removeSavedKeySafely(storage);
  }
  if (isIndexedDbAvailable()) {
    await IndexedDbSwapAdapter.clearActiveDocument();
  }
}

export function loadDocumentFromStorage(): {
  doc: MandalaDocument | null;
  warning: string | null;
} {
  const storage = getSafeLocalStorage();
  if (!storage) {
    return { doc: null, warning: null };
  }

  let raw: string | null = null;
  try {
    raw = storage.getItem(STORAGE_KEY_V1);
  } catch (e) {
    reportDiagnostic({
      severity: DiagnosticSeverity.Info,
      source: DiagnosticSource.Storage,
      code: DomainErrorCode.StorageAccessDenied,
      message: MANDALA_MESSAGES.persistence.storageReadWarning,
      cause: e,
    });
    return { doc: null, warning: null };
  }
  if (!raw) return { doc: null, warning: null };

  if (raw.length > MAX_LOCAL_STORAGE_RAW_CHARS) {
    removeSavedKeySafely(storage);
    return {
      doc: null,
      warning: MANDALA_MESSAGES.persistence.oversizedSessionWarning(
        (raw.length / (1024 * 1024)).toFixed(1)
      ),
    };
  }

  const parsed = parseMandalaDocumentJSON(raw);
  if (!parsed.ok) {
    removeSavedKeySafely(storage);
    return { doc: null, warning: parsed.error };
  }
  return { doc: parsed.value, warning: null };
}

function createDefaultWorkspaceSeed(warning: string | null): HydratedWorkspaceSeed {
  const defaultPalette = PALETTES[0] ?? DEFAULT_PALETTE;
  const fallbackColor = defaultPalette.colours[2] ?? defaultPalette.colours[0] ?? '#56B4E9';
  return {
    wedges: [],
    symmetryParams: DEFAULT_HYDRATED_SYMMETRY,
    activePalette: defaultPalette,
    activeColor: fallbackColor,
    strokeWidth: MANDALA_LIMITS.defaultStrokeWidth,
    activeDash: null,
    camera: DEFAULT_CAMERA_TRANSFORM,
    worldRadius: WORLD_SPACE_LIMITS.extendedRadius,
    warning,
  };
}

/**
 * Runs pre-flight workload admission and defensive clamping before module-level store hydration
 * so oversized or legacy heavy sessions never freeze the main thread outside ErrorBoundary.
 */
export function hydrateInitialWorkspaceFromStorage(
  saved: { readonly doc: MandalaDocument | null; readonly warning: string | null },
  onQuarantineOversized?: () => void
): HydratedWorkspaceSeed {
  if (!saved.doc) {
    return createDefaultWorkspaceSeed(saved.warning);
  }

  try {
    const doc = saved.doc;
    const resolved = resolveDocumentToActiveWedges(doc);
    const admission = evaluateWorkloadAdmission({
      currentWedges: [],
      incomingWedges: resolved.wedges,
      symmetryParams: doc.symmetryParams,
    });

    if (!admission.ok) {
      onQuarantineOversized?.();
      return createDefaultWorkspaceSeed(admission.error.message);
    }

    const safeWorldRadius = Math.min(
      WORLD_SPACE_LIMITS.extendedRadius * 2,
      Math.max(WORLD_SPACE_LIMITS.baseRadius, resolved.worldRadius)
    );
    const safeZoom = Math.min(
      CAMERA_LIMITS.maxZoom,
      Math.max(CAMERA_LIMITS.minZoom, resolved.camera.zoom)
    );
    const safeCamera: CameraTransform = {
      zoom: Number.isFinite(safeZoom) ? safeZoom : CAMERA_LIMITS.defaultZoom,
      panX: clampCameraPan(resolved.camera.panX, safeWorldRadius),
      panY: clampCameraPan(resolved.camera.panY, safeWorldRadius),
    };
    const activePalette = resolvePaletteById(doc.paletteId);
    const safeStrokeWidth = Math.min(
      MANDALA_LIMITS.maxStrokeWidth,
      Math.max(MANDALA_LIMITS.minStrokeWidth, doc.activeStrokeWidth)
    );

    return {
      wedges: resolved.wedges,
      symmetryParams: doc.symmetryParams,
      activePalette,
      activeColor: doc.activeColour ?? activePalette.colours[2],
      strokeWidth: Number.isFinite(safeStrokeWidth)
        ? safeStrokeWidth
        : MANDALA_LIMITS.defaultStrokeWidth,
      activeDash: doc.activeDash,
      camera: safeCamera,
      worldRadius: safeWorldRadius,
      warning: saved.warning,
    };
  } catch (e) {
    onQuarantineOversized?.();
    reportDiagnostic({
      severity: DiagnosticSeverity.Warning,
      source: DiagnosticSource.Storage,
      code: DomainErrorCode.ValidationFailed,
      message: MANDALA_MESSAGES.persistence.hydrateErrorFallback,
      cause: e,
    });
    return createDefaultWorkspaceSeed(MANDALA_MESSAGES.persistence.hydrateErrorFallback);
  }
}

export async function recoverDocumentFromIndexedDbSwap(): Promise<MandalaDocument | null> {
  if (!isIndexedDbAvailable()) return null;
  const res = await IndexedDbSwapAdapter.loadActiveDocument();
  return res.ok ? res.value : null;
}
