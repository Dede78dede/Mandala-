/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  DiagnosticSeverity,
  DiagnosticSource,
  DomainErrorCode,
  reportDiagnostic,
} from '../../../../shared/lib/diagnostics.ts';
import { MANDALA_LIMITS } from '../constants.ts';
import { MANDALA_MESSAGES } from '../messages.ts';
import {
  HistoryCommandPrefix,
  MemoryPressureLevel,
  SymmetryStrategyKind,
  type HistoryCommand,
  type SymmetryParams,
} from '../types.ts';
import {
  clearSavedSessionStorage,
  hydrateInitialWorkspaceFromStorage,
  loadDocumentFromStorage,
  saveDocumentToStorage,
} from '../../lib/persistence.ts';
import { enforceAntiSaturationSafeguards } from '../../lib/resourceGuard.ts';
import type { MandalaStore } from './storeTypes.ts';

let announcementTimer: ReturnType<typeof setTimeout> | null = null;
let commandSeq = 0;

export function nextCommandId(prefix: HistoryCommandPrefix): string {
  commandSeq += 1;
  return `${prefix}_${commandSeq}`;
}

export function scheduleAnnouncement(
  set: (fn: (s: MandalaStore) => Partial<MandalaStore>) => void,
  msg: string
): void {
  if (announcementTimer) clearTimeout(announcementTimer);
  announcementTimer = setTimeout(() => {
    set(() => ({ liveAnnouncement: msg }));
  }, MANDALA_LIMITS.announcementDebounceMs);
}

export function persistStateSnapshot(state: MandalaStore): void {
  saveDocumentToStorage({
    symmetryParams: state.symmetryParams,
    wedges: state.wedges,
    paletteId: state.activePalette.id,
    activeColour: state.activeColor,
    activeStrokeWidth: state.strokeWidth,
    activeDash: state.activeDash,
    worldRadius: state.worldRadius,
    camera: state.camera,
  });
}

export function executeAndRecordCommand(
  set: (fn: (s: MandalaStore) => Partial<MandalaStore>) => void,
  get: () => MandalaStore,
  cmd: HistoryCommand
): void {
  cmd.do();
  set((s) => {
    let nextUndo = [...s.undoStack, cmd];
    if (nextUndo.length > MANDALA_LIMITS.maxHistoryCommands) {
      nextUndo.shift();
    }
    let nextRedo: HistoryCommand[] = [];
    let guardNotice = s.guardAlert;

    if (s.autoProtectEnabled) {
      const guarded = enforceAntiSaturationSafeguards({
        wedges: s.wedges,
        undoStack: nextUndo,
        redoStack: nextRedo,
      });
      nextUndo = guarded.undoStack;
      nextRedo = guarded.redoStack;
      if (
        guarded.pressure === MemoryPressureLevel.Critical &&
        (guarded.trimmedHistoryCount > 0 || guarded.trimmedCacheEntries > 0)
      ) {
        guardNotice = `Anti-saturazione attiva: ottimizzati ${guarded.trimmedCacheEntries} slot cache e ${guarded.trimmedHistoryCount} stati cronologia.`;
      }
    }

    return {
      sceneVersion: s.sceneVersion + 1,
      undoStack: nextUndo,
      redoStack: nextRedo,
      guardAlert: guardNotice,
    };
  });
  persistStateSnapshot(get());
}

export const initialWorkspaceSeed = hydrateInitialWorkspaceFromStorage(
  loadDocumentFromStorage(),
  () => {
    void clearSavedSessionStorage().catch((reason: unknown) => {
      reportDiagnostic({
        severity: DiagnosticSeverity.Warning,
        source: DiagnosticSource.Storage,
        code: DomainErrorCode.StorageWriteFailed,
        message: MANDALA_MESSAGES.persistence.hydrateErrorFallback,
        cause: reason,
      });
    });
  }
);

export const DEFAULT_SYMMETRY_PARAMS: SymmetryParams = {
  strategyId: SymmetryStrategyKind.Radial,
  order: MANDALA_LIMITS.defaultOrder,
};
