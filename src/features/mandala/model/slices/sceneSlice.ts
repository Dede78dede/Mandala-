/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StateCreator } from 'zustand';
import {
  DiagnosticSeverity,
  DiagnosticSource,
  DomainErrorCode,
  reportDiagnostic,
} from '../../../../shared/lib/diagnostics.ts';
import { playHapticTone } from '../../../../shared/lib/hapticAudio.ts';
import { err, ok } from '../../../../shared/lib/result.ts';
import {
  LOGICAL_CENTER,
  MANDALA_LIMITS,
  POLAR_LIMITS,
  RESOURCE_GUARD_LIMITS,
} from '../constants.ts';
import { MANDALA_MESSAGES } from '../messages.ts';
import { resolvePaletteById } from '../palettes.ts';
import { parseMandalaDocumentJSON, resolveDocumentToActiveWedges } from '../schemas.ts';
import {
  ExecutionRoutingMode,
  HapticTone,
  HistoryCommandPrefix,
  SymmetryStrategyKind,
  type HistoryCommand,
  type SymmetryParams,
} from '../types.ts';
import {
  STRATEGY_REGISTRY,
  describeSymmetryParams,
  generateBaseFractalStrokesWithMetrics,
} from '../../strategies/symmetry.ts';
import { estimateLSystemComplexity, resolveLSystemPreset } from '../../lib/lsystem.ts';
import { generatePolarHarmonicStrokes, resolvePolarGenerator } from '../../lib/polarGenerators.ts';
import { findWedgesIntersectingEraser } from '../../lib/erasure.ts';
import { evaluateWorkloadAdmission } from '../../lib/resourceGuard.ts';
import {
  executeAndRecordCommand,
  initialWorkspaceSeed,
  nextCommandId,
  persistStateSnapshot,
  scheduleAnnouncement,
} from './storeHelpers.ts';
import type { MandalaStore, SceneSlice } from './storeTypes.ts';

export const createSceneSlice: StateCreator<MandalaStore, [], [], SceneSlice> = (set, get) => ({
  wedges: initialWorkspaceSeed.wedges,
  sceneVersion: 1,
  symmetryParams: initialWorkspaceSeed.symmetryParams,
  undoStack: [],
  redoStack: [],
  liveAnnouncement: `Mandala Studio pronto. Simmetria ${initialWorkspaceSeed.symmetryParams.order} ordini.`,
  persistenceWarning: initialWorkspaceSeed.warning,

  commitStroke: (stroke) => {
    const state = get();
    const admission = evaluateWorkloadAdmission({
      currentWedges: state.wedges,
      incomingWedges: [stroke],
      symmetryParams: state.symmetryParams,
    });
    if (!admission.ok) {
      set(() => ({ guardAlert: admission.error.message }));
      scheduleAnnouncement(set, admission.error.message);
      return;
    }

    const order = state.symmetryParams.order;
    const isPoint = stroke.points.length === 1;
    const label = isPoint ? `Punto (${order} ordini)` : `Tratto (${order} ordini)`;

    const cmd: HistoryCommand = {
      id: nextCommandId(HistoryCommandPrefix.Stroke),
      label,
      do: () => {
        set((s) => ({ wedges: [...s.wedges, stroke] }));
      },
      undo: () => {
        set((s) => ({ wedges: s.wedges.filter((w) => w.id !== stroke.id) }));
      },
    };

    executeAndRecordCommand(set, get, cmd);
    playHapticTone(get().soundEnabled, HapticTone.Click);
  },

  commitStampStrokes: (strokes, archetypeLabel) => {
    if (strokes.length === 0) return;
    const state = get();
    const admission = evaluateWorkloadAdmission({
      currentWedges: state.wedges,
      incomingWedges: strokes,
      symmetryParams: state.symmetryParams,
    });
    if (!admission.ok) {
      set(() => ({ guardAlert: admission.error.message }));
      scheduleAnnouncement(set, admission.error.message);
      return;
    }

    const idSet = new Set(strokes.map((s) => s.id));
    const cmd: HistoryCommand = {
      id: nextCommandId(HistoryCommandPrefix.Stamp),
      label: `Timbro ${archetypeLabel} (${state.symmetryParams.order} ordini)`,
      do: () => {
        set((s) => ({ wedges: [...s.wedges, ...strokes] }));
      },
      undo: () => {
        set((s) => ({ wedges: s.wedges.filter((w) => !idSet.has(w.id)) }));
      },
    };

    executeAndRecordCommand(set, get, cmd);
    playHapticTone(get().soundEnabled, HapticTone.Harmonic);
    scheduleAnnouncement(set, `Applicato timbro botanico ${archetypeLabel}.`);
  },

  eraseAtPoint: (pt, radius) => {
    const state = get();
    const hitIds = findWedgesIntersectingEraser(
      state.wedges,
      pt,
      radius,
      state.symmetryParams,
      LOGICAL_CENTER
    );
    if (hitIds.length === 0) return 0;

    const hitSet = new Set(hitIds);
    const removedWithIndex = state.wedges
      .map((w, index) => ({ w, index }))
      .filter(({ w }) => hitSet.has(w.id));

    const cmd: HistoryCommand = {
      id: nextCommandId(HistoryCommandPrefix.Erase),
      label: `Gomma spicchio (${removedWithIndex.length})`,
      do: () => {
        set((s) => ({
          wedges: s.wedges.filter((w) => !hitSet.has(w.id)),
        }));
      },
      undo: () => {
        set((s) => {
          const restored = [...s.wedges];
          for (const { w, index } of removedWithIndex) {
            if (!restored.some((existing) => existing.id === w.id)) {
              const targetIdx = Math.min(index, restored.length);
              restored.splice(targetIdx, 0, w);
            }
          }
          return { wedges: restored };
        });
      },
    };

    executeAndRecordCommand(set, get, cmd);
    playHapticTone(get().soundEnabled, HapticTone.Click);
    scheduleAnnouncement(
      set,
      `Cancellati ${removedWithIndex.length} tratti simmetrici.`
    );
    return removedWithIndex.length;
  },

  commitFractalGeneration: (presetId, generations, angle, step) => {
    const state = get();
    const order = state.symmetryParams.order;
    const preset = resolveLSystemPreset(presetId);
    const est = estimateLSystemComplexity(preset.axiom, preset.rules, generations);
    const estimatedExpandedSegments = est.moveSegments * order;

    if (estimatedExpandedSegments > RESOURCE_GUARD_LIMITS.maxFractalSegmentsAllowed) {
      const msg = MANDALA_MESSAGES.guards.overFractalSegments(
        estimatedExpandedSegments,
        RESOURCE_GUARD_LIMITS.maxFractalSegmentsAllowed
      );
      set(() => ({ guardAlert: msg }));
      scheduleAnnouncement(set, msg);
      return;
    }

    const activeStrategy = STRATEGY_REGISTRY[state.symmetryParams.strategyId];
    const multiplier = activeStrategy ? activeStrategy.expansionMultiplier(order) : order;
    if (
      state.wedges.length + est.estimatedPolylines > RESOURCE_GUARD_LIMITS.maxSceneWedges ||
      (state.wedges.length + est.estimatedPolylines) * multiplier >
        RESOURCE_GUARD_LIMITS.maxExpandedPrimitivesPerFrame
    ) {
      const msg = 'Protezione Anti Over-CPU: il frattale stimato supera il budget di scene/frame attivo.';
      set(() => ({ guardAlert: msg }));
      scheduleAnnouncement(set, msg);
      return;
    }

    const fractalMetrics = generateBaseFractalStrokesWithMetrics(
      {
        strategyId: SymmetryStrategyKind.Fractal,
        preset: presetId,
        order,
        generations,
        angle,
        stepLength: step,
      },
      LOGICAL_CENTER,
      state.activeColor,
      state.strokeWidth
    );

    if (fractalMetrics.strokes.length === 0) return;

    if (fractalMetrics.expandedSegmentCount > RESOURCE_GUARD_LIMITS.maxFractalSegmentsAllowed) {
      const msg = MANDALA_MESSAGES.guards.overFractalSegments(
        fractalMetrics.expandedSegmentCount,
        RESOURCE_GUARD_LIMITS.maxFractalSegmentsAllowed
      );
      set(() => ({ guardAlert: msg }));
      scheduleAnnouncement(set, msg);
      return;
    }

    const admission = evaluateWorkloadAdmission({
      currentWedges: state.wedges,
      incomingWedges: fractalMetrics.strokes,
      symmetryParams: state.symmetryParams,
    });
    if (!admission.ok) {
      set(() => ({ guardAlert: admission.error.message }));
      scheduleAnnouncement(set, admission.error.message);
      return;
    }

    const fractalStrokes = fractalMetrics.strokes;
    const idSet = new Set(fractalStrokes.map((s) => s.id));
    const cmd: HistoryCommand = {
      id: nextCommandId(HistoryCommandPrefix.Fractal),
      label: `Frattale ${presetId} (${fractalStrokes.length})`,
      do: () => {
        set((s) => ({ wedges: [...s.wedges, ...fractalStrokes] }));
      },
      undo: () => {
        set((s) => ({ wedges: s.wedges.filter((w) => !idSet.has(w.id)) }));
      },
    };

    executeAndRecordCommand(set, get, cmd);
    playHapticTone(get().soundEnabled, HapticTone.Harmonic);
    scheduleAnnouncement(
      set,
      `Geometria sacra frattale generata con ${fractalMetrics.baseSegmentCount} segmenti base.`
    );
  },

  commitFractalGenerationSmart: async (presetId, generations, angle, step) => {
    const state = get();
    const order = state.symmetryParams.order;
    const preset = resolveLSystemPreset(presetId);
    const est = estimateLSystemComplexity(preset.axiom, preset.rules, generations);
    const estimatedExpandedSegments = est.moveSegments * order;

    if (estimatedExpandedSegments > RESOURCE_GUARD_LIMITS.maxFractalSegmentsAllowed) {
      const msg = MANDALA_MESSAGES.guards.overFractalSegments(
        estimatedExpandedSegments,
        RESOURCE_GUARD_LIMITS.maxFractalSegmentsAllowed
      );
      set(() => ({ guardAlert: msg }));
      scheduleAnnouncement(set, msg);
      return { usedWasmWorker: false, segmentCount: 0 };
    }

    const shouldTryWasmWorker =
      state.routingMode === ExecutionRoutingMode.ForceWasmWorker ||
      (state.routingMode !== ExecutionRoutingMode.ForceJs &&
        generations >= MANDALA_LIMITS.fractalPerfWarningGenerations);

    if (shouldTryWasmWorker) {
      try {
        const { loadWasmWorkerClient } = await import('../../wasm/wasmLoader.ts');
        const clientRes = await loadWasmWorkerClient();
        if (clientRes.ok) {
          const workerRes = await clientRes.value.expandLSystemZeroCopy({
            idPrefix: `fractal_${preset.id}_${Date.now()}`,
            axiom: preset.axiom,
            rules: preset.rules,
            generations,
            stepLength: step,
            angleDegrees: angle,
            order,
            color: state.activeColor,
            strokeWidth: state.strokeWidth,
            center: LOGICAL_CENTER,
            baseOnly: true,
          });
          if (workerRes.ok && workerRes.value.strokes.length > 0) {
            if (
              workerRes.value.expandedSegmentCount >
              RESOURCE_GUARD_LIMITS.maxFractalSegmentsAllowed
            ) {
              const msg = MANDALA_MESSAGES.guards.overFractalSegments(
                workerRes.value.expandedSegmentCount,
                RESOURCE_GUARD_LIMITS.maxFractalSegmentsAllowed
              );
              set(() => ({ guardAlert: msg }));
              scheduleAnnouncement(set, msg);
              return { usedWasmWorker: true, segmentCount: 0 };
            }

            const current = get();
            const admission = evaluateWorkloadAdmission({
              currentWedges: current.wedges,
              incomingWedges: workerRes.value.strokes,
              symmetryParams: current.symmetryParams,
            });
            if (!admission.ok) {
              set(() => ({ guardAlert: admission.error.message }));
              scheduleAnnouncement(set, admission.error.message);
              return { usedWasmWorker: true, segmentCount: 0 };
            }

            const fractalStrokes = workerRes.value.strokes;
            const idSet = new Set(fractalStrokes.map((s) => s.id));
            const cmd: HistoryCommand = {
              id: nextCommandId(HistoryCommandPrefix.Fractal),
              label: `Frattale ${presetId} WASM (${fractalStrokes.length})`,
              do: () => {
                set((s) => ({ wedges: [...s.wedges, ...fractalStrokes] }));
              },
              undo: () => {
                set((s) => ({ wedges: s.wedges.filter((w) => !idSet.has(w.id)) }));
              },
            };

            executeAndRecordCommand(set, get, cmd);
            playHapticTone(get().soundEnabled, HapticTone.Harmonic);
            scheduleAnnouncement(
              set,
              MANDALA_MESSAGES.wasmWorker.fractalWasmAnnouncement(
                workerRes.value.computeMs,
                fractalStrokes.length
              )
            );
            return { usedWasmWorker: true, segmentCount: fractalStrokes.length };
          }
        }
      } catch (reason: unknown) {
        reportDiagnostic({
          severity: DiagnosticSeverity.Info,
          source: DiagnosticSource.WasmWorker,
          code: DomainErrorCode.WasmFallbackToJs,
          message: MANDALA_MESSAGES.wasmWorker.fallbackNotice,
          userNotice: MANDALA_MESSAGES.wasmWorker.fallbackNotice,
          cause: reason,
        });
      }
    }

    const beforeLen = get().wedges.length;
    get().commitFractalGeneration(presetId, generations, angle, step);
    const added = Math.max(0, get().wedges.length - beforeLen);
    return { usedWasmWorker: false, segmentCount: added };
  },

  commitPolarGeneration: (params) => {
    const state = get();
    const descriptor = resolvePolarGenerator(params.generatorId);
    const polarStrokes = generatePolarHarmonicStrokes(
      {
        ...params,
        amplitudeRadius: Math.min(
          POLAR_LIMITS.maxAmplitudeRadius,
          Math.max(POLAR_LIMITS.minAmplitudeRadius, params.amplitudeRadius)
        ),
        strokeColor: state.activeColor,
        strokeWidth: state.strokeWidth,
        dash: state.activeDash,
      },
      LOGICAL_CENTER,
      `polar_${params.generatorId}_${Date.now()}`
    );

    if (polarStrokes.length === 0) return 0;

    const admission = evaluateWorkloadAdmission({
      currentWedges: state.wedges,
      incomingWedges: polarStrokes,
      symmetryParams: state.symmetryParams,
    });
    if (!admission.ok) {
      set(() => ({ guardAlert: admission.error.message }));
      scheduleAnnouncement(set, admission.error.message);
      return 0;
    }

    const idSet = new Set(polarStrokes.map((s) => s.id));
    const cmd: HistoryCommand = {
      id: nextCommandId(HistoryCommandPrefix.Polar),
      label: `Armonica ${descriptor.name.split(' ')[0]} (${polarStrokes.length})`,
      do: () => {
        set((s) => ({ wedges: [...s.wedges, ...polarStrokes] }));
      },
      undo: () => {
        set((s) => ({ wedges: s.wedges.filter((w) => !idSet.has(w.id)) }));
      },
    };

    executeAndRecordCommand(set, get, cmd);
    playHapticTone(get().soundEnabled, HapticTone.Harmonic);
    scheduleAnnouncement(
      set,
      `Curva polare ${descriptor.name} generata con ${polarStrokes.length} tracciati.`
    );
    return polarStrokes.length;
  },

  undo: () => {
    const state = get();
    const cmd = state.undoStack[state.undoStack.length - 1];
    if (!cmd) return;
    cmd.undo();
    set((s) => ({
      sceneVersion: s.sceneVersion + 1,
      undoStack: s.undoStack.slice(0, -1),
      redoStack: [...s.redoStack, cmd],
    }));
    persistStateSnapshot(get());
    playHapticTone(get().soundEnabled, HapticTone.Click);
    scheduleAnnouncement(set, `Annullato: ${cmd.label}`);
  },

  redo: () => {
    const state = get();
    const cmd = state.redoStack[state.redoStack.length - 1];
    if (!cmd) return;
    cmd.do();
    set((s) => ({
      sceneVersion: s.sceneVersion + 1,
      redoStack: s.redoStack.slice(0, -1),
      undoStack: [...s.undoStack, cmd],
    }));
    persistStateSnapshot(get());
    playHapticTone(get().soundEnabled, HapticTone.Click);
    scheduleAnnouncement(set, `Ripristinato: ${cmd.label}`);
  },

  clearCanvas: () => {
    const previousWedges = [...get().wedges];
    if (previousWedges.length === 0) return;

    const cmd: HistoryCommand = {
      id: nextCommandId(HistoryCommandPrefix.Clear),
      label: `Pulisci tela (${previousWedges.length} tratti)`,
      do: () => {
        set(() => ({ wedges: [] }));
      },
      undo: () => {
        set(() => ({ wedges: previousWedges }));
      },
    };

    executeAndRecordCommand(set, get, cmd);
    playHapticTone(get().soundEnabled, HapticTone.Harmonic);
    scheduleAnnouncement(set, MANDALA_MESSAGES.workspace.clearCanvasAnnouncement);
  },

  setSymmetryOrder: (order) => {
    const state = get();
    const clamped = Math.min(MANDALA_LIMITS.maxOrder, Math.max(MANDALA_LIMITS.minOrder, order));
    const candidateParams: SymmetryParams = { ...state.symmetryParams, order: clamped };

    const admission = evaluateWorkloadAdmission({
      currentWedges: state.wedges,
      incomingWedges: [],
      symmetryParams: candidateParams,
    });
    if (!admission.ok) {
      set(() => ({ guardAlert: admission.error.message }));
      scheduleAnnouncement(set, admission.error.message);
      return;
    }

    set((s) => ({
      sceneVersion: s.sceneVersion + 1,
      symmetryParams: candidateParams,
      guardAlert: null,
    }));
    const updated = get();
    persistStateSnapshot(updated);
    playHapticTone(updated.soundEnabled, HapticTone.Click);
    scheduleAnnouncement(set, `Simmetria impostata a ${clamped} ordini radiali.`);
  },

  setStrategy: (params) => {
    const state = get();
    const admission = evaluateWorkloadAdmission({
      currentWedges: state.wedges,
      incomingWedges: [],
      symmetryParams: params,
    });
    if (!admission.ok) {
      set(() => ({ guardAlert: admission.error.message }));
      scheduleAnnouncement(set, admission.error.message);
      return;
    }

    set((s) => ({
      sceneVersion: s.sceneVersion + 1,
      symmetryParams: params,
      guardAlert: null,
    }));
    const updated = get();
    persistStateSnapshot(updated);
    playHapticTone(updated.soundEnabled, HapticTone.Harmonic);
    scheduleAnnouncement(set, `Strategia cambiata in: ${describeSymmetryParams(params)}`);
  },

  announceLiveMessage: (message) => {
    scheduleAnnouncement(set, message);
  },

  importDocumentJSON: (jsonText) => {
    const res = parseMandalaDocumentJSON(jsonText);
    if (!res.ok) {
      return err(res.error);
    }
    const doc = res.value;
    const resolved = resolveDocumentToActiveWedges(doc);
    const admission = evaluateWorkloadAdmission({
      currentWedges: [],
      incomingWedges: resolved.wedges,
      symmetryParams: doc.symmetryParams,
    });
    if (!admission.ok) {
      set(() => ({ guardAlert: admission.error.message }));
      return err(admission.error.message);
    }

    const resolvedPalette = resolvePaletteById(doc.paletteId);
    set((s) => ({
      wedges: resolved.wedges,
      worldRadius: resolved.worldRadius,
      camera: resolved.camera,
      sceneVersion: s.sceneVersion + 1,
      symmetryParams: doc.symmetryParams,
      activePalette: resolvedPalette,
      activeColor: doc.activeColour,
      strokeWidth: doc.activeStrokeWidth,
      activeDash: doc.activeDash,
      undoStack: [],
      redoStack: [],
      persistenceWarning: null,
      guardAlert: null,
    }));
    persistStateSnapshot(get());
    scheduleAnnouncement(set, `Documento importato con ${resolved.wedges.length} tratti.`);
    return ok(doc);
  },

  dismissPersistenceWarning: () => set(() => ({ persistenceWarning: null })),
});
