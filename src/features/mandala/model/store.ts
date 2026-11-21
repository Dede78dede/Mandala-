/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Zustand Store with Slice Pattern, Anti-Saturation Guardrails & Cache/Settings Reset:
 * Slices: sceneSlice, paletteSlice, toolSlice, securitySlice.
 * - Pre-flight Over-Memory / Over-CPU workload admission gate
 * - Auto-trim anti-saturation safeguards on undo/redo & L1/memo caches
 * - First-class `flushCaches`, `resetSettings`, and `resetWorkspaceAll` actions
 */

import { create, StateCreator } from 'zustand';
import { flushAllApplicationCaches } from '../../../shared/lib/cacheService.ts';
import { playHapticTone } from '../../../shared/lib/hapticAudio.ts';
import type { Result } from '../../../shared/lib/result.ts';
import { ok, err } from '../../../shared/lib/result.ts';
import {
  CAMERA_LIMITS,
  KALEIDOSCOPE_LIMITS,
  KINETIC_LIMITS,
  LOGICAL_CANVAS_SIZE,
  LOGICAL_CENTER,
  MANDALA_LIMITS,
  POLAR_LIMITS,
  RESOURCE_GUARD_LIMITS,
  STAMP_LIMITS,
  WORLD_SPACE_LIMITS,
} from './constants.ts';
import {
  ExecutionRoutingMode,
  HapticTone,
  HistoryCommandPrefix,
  KineticMode,
  LSystemPresetId,
  LensProfile,
  LensTextureQuality,
  MemoryPressureLevel,
  MorphSlotId,
  MorphTargetKind,
  PolarGeneratorId,
  StampArchetypeId,
  SymmetryStrategyKind,
  ToolId,
  type CameraTransform,
  type FlushCacheReport,
  type HistoryCommand,
  type LensConfig,
  type MandalaDocument,
  type MorphSlotSnapshot,
  type Palette,
  type Point,
  type PolarGenerationParams,
  type SymmetryParams,
  type ToolType,
  type WedgeStroke,
} from './types.ts';
import {
  PALETTES,
  resolvePaletteById,
  resolveStrokeStylePreset,
} from './palettes.ts';
import {
  parseMandalaDocumentJSON,
  resolveDocumentToActiveWedges,
} from './schemas.ts';
import { describeSymmetryParams, generateFractalStrokesWithMetrics } from '../strategies/symmetry.ts';
import { resolveLSystemPreset } from '../lib/lsystem.ts';
import { generatePolarHarmonicStrokes, resolvePolarGenerator } from '../lib/polarGenerators.ts';
import { findWedgesIntersectingEraser } from '../lib/erasure.ts';
import {
  clearSavedSessionStorage,
  loadDocumentFromStorage,
  saveDocumentToStorage,
} from '../lib/persistence.ts';
import {
  enforceAntiSaturationSafeguards,
  evaluateWorkloadAdmission,
} from '../lib/resourceGuard.ts';
import {
  clampCameraPan,
  DEFAULT_CAMERA_TRANSFORM,
  zoomCameraAtScreenPoint,
} from '../lib/viewportCamera.ts';
import {
  DEFAULT_LENS_CONFIG,
  normalizeLensConfig,
} from '../lib/lensProjection.ts';

export interface SceneSlice {
  wedges: WedgeStroke[];
  sceneVersion: number;
  symmetryParams: SymmetryParams;
  undoStack: HistoryCommand[];
  redoStack: HistoryCommand[];
  liveAnnouncement: string;
  persistenceWarning: string | null;
  commitStroke: (stroke: WedgeStroke) => void;
  commitStampStrokes: (strokes: WedgeStroke[], archetypeLabel: string) => void;
  eraseAtPoint: (pt: Point, radius: number) => number;
  commitFractalGeneration: (
    presetId: LSystemPresetId,
    generations: number,
    angle: number,
    step: number
  ) => void;
  commitFractalGenerationSmart: (
    presetId: LSystemPresetId,
    generations: number,
    angle: number,
    step: number
  ) => Promise<{ usedWasmWorker: boolean; segmentCount: number }>;
  commitPolarGeneration: (
    params: Omit<PolarGenerationParams, 'strokeColor' | 'strokeWidth' | 'dash'>
  ) => number;
  undo: () => void;
  redo: () => void;
  clearCanvas: () => void;
  setSymmetryOrder: (order: number) => void;
  setStrategy: (params: SymmetryParams) => void;
  announceLiveMessage: (message: string) => void;
  importDocumentJSON: (jsonText: string) => Result<MandalaDocument, string>;
  dismissPersistenceWarning: () => void;
}

export interface PaletteSlice {
  activePalette: Palette;
  activeColor: string;
  strokeWidth: number;
  activeDash: number[] | null;
  selectPalette: (palette: Palette) => void;
  setActiveColor: (color: string) => void;
  setStrokeWidth: (width: number) => void;
  setActiveDash: (dash: number[] | null) => void;
}

export interface ToolSlice {
  activeTool: ToolType;
  activeStampArchetype: StampArchetypeId;
  stampScale: number;
  showGuides: boolean;
  pressureEnabled: boolean;
  soundEnabled: boolean;
  routingMode: ExecutionRoutingMode;
  forceEscapeHatch: boolean;
  setActiveTool: (tool: ToolType) => void;
  setActiveStampArchetype: (archetype: StampArchetypeId) => void;
  setStampScale: (scale: number) => void;
  setShowGuides: (show: boolean) => void;
  setPressureEnabled: (enabled: boolean) => void;
  setSoundEnabled: (enabled: boolean) => void;
  setRoutingMode: (mode: ExecutionRoutingMode) => void;
  setForceEscapeHatch: (enabled: boolean) => void;
}

export interface SecuritySlice {
  autoProtectEnabled: boolean;
  guardAlert: string | null;
  lastMaintenanceMessage: string | null;
  lastCacheFlushReport: FlushCacheReport | null;
  setAutoProtectEnabled: (enabled: boolean) => void;
  dismissGuardAlert: () => void;
  dismissMaintenanceMessage: () => void;
  flushCaches: () => Promise<FlushCacheReport>;
  resetSettings: () => void;
  resetWorkspaceAll: () => Promise<void>;
}

export interface ViewportSlice {
  camera: CameraTransform;
  worldRadius: number;
  isPanToolActive: boolean;
  setZoom: (zoom: number, displaySize?: number) => void;
  zoomAtScreenPoint: (
    targetZoom: number,
    anchorScreenPt: Point,
    displaySize: number,
    viewportWidth?: number,
    viewportHeight?: number
  ) => void;
  panByScreenDelta: (dxScreen: number, dyScreen: number, displaySize: number) => void;
  setWorldRadius: (radius: number) => void;
  setIsPanToolActive: (active: boolean) => void;
  resetViewport: () => void;
}

export interface LensSlice {
  lens: LensConfig;
  setLensEnabled: (enabled: boolean) => void;
  setLensProfile: (profile: LensProfile) => void;
  setLensCurvature: (curvature: number) => void;
  setLensRefractiveIndex: (ior: number) => void;
  setLensFresnel: (fresnel: number) => void;
  setLensTilt: (tiltX: number, tiltY: number) => void;
  setLensTextureQuality: (quality: LensTextureQuality) => void;
  setLensAnimating: (animating: boolean) => void;
  setLensBreatheAmplitude: (amplitude: number) => void;
  setLensHueShiftSpeed: (speed: number) => void;
  setKaleidoscopeFolds: (folds: number) => void;
  setKaleidoscopeTwist: (twist: number) => void;
  setHasCustomTexture: (hasCustomTexture: boolean) => void;
  resetLensTilt: () => void;
  exitLensForDrawing: () => void;
}

export interface KineticSlice {
  kineticMode: KineticMode;
  kineticPlaying: boolean;
  kineticSpeed: number;
  replayProgress: number;
  concentricBreathing: number;
  morphSlotA: MorphSlotSnapshot | null;
  morphSlotB: MorphSlotSnapshot | null;
  morphTargetKind: MorphTargetKind;
  morphTargetPolarPreset: PolarGeneratorId;
  morphProgress: number;
  enterKineticMode: (mode: Exclude<KineticMode, KineticMode.Off>) => void;
  exitKineticMode: () => void;
  setKineticPlaying: (playing: boolean) => void;
  setKineticSpeed: (speed: number) => void;
  setReplayProgress: (progress: number) => void;
  setConcentricBreathing: (amplitude: number) => void;
  captureMorphSlot: (slot: MorphSlotId) => void;
  clearMorphSlot: (slot: MorphSlotId) => void;
  setMorphTargetKind: (kind: MorphTargetKind) => void;
  setMorphTargetPolarPreset: (preset: PolarGeneratorId) => void;
  setMorphProgress: (progress: number) => void;
}

export type MandalaStore = SceneSlice &
  PaletteSlice &
  ToolSlice &
  SecuritySlice &
  ViewportSlice &
  LensSlice &
  KineticSlice;

let announcementTimer: ReturnType<typeof setTimeout> | null = null;
let commandSeq = 0;

function nextCommandId(prefix: HistoryCommandPrefix): string {
  commandSeq += 1;
  return `${prefix}_${commandSeq}`;
}

function scheduleAnnouncement(
  set: (fn: (s: MandalaStore) => Partial<MandalaStore>) => void,
  msg: string
): void {
  if (announcementTimer) clearTimeout(announcementTimer);
  announcementTimer = setTimeout(() => {
    set(() => ({ liveAnnouncement: msg }));
  }, MANDALA_LIMITS.announcementDebounceMs);
}

function persistStateSnapshot(state: MandalaStore): void {
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

function executeAndRecordCommand(
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

const initialSaved = loadDocumentFromStorage();
const initialResolvedDoc = initialSaved.doc
  ? resolveDocumentToActiveWedges(initialSaved.doc)
  : null;
const initialPalette = initialSaved.doc
  ? resolvePaletteById(initialSaved.doc.paletteId)
  : PALETTES[0];
const initialWedges = initialResolvedDoc?.wedges ?? [];
const initialCamera: CameraTransform =
  initialResolvedDoc?.camera ?? DEFAULT_CAMERA_TRANSFORM;
const initialWorldRadius: number =
  initialResolvedDoc?.worldRadius ?? WORLD_SPACE_LIMITS.extendedRadius;

const DEFAULT_SYMMETRY_PARAMS: SymmetryParams = {
  strategyId: SymmetryStrategyKind.Radial,
  order: MANDALA_LIMITS.defaultOrder,
};

const createSceneSlice: StateCreator<MandalaStore, [], [], SceneSlice> = (set, get) => ({
  wedges: initialWedges,
  sceneVersion: 1,
  symmetryParams: initialSaved.doc?.symmetryParams ?? DEFAULT_SYMMETRY_PARAMS,
  undoStack: [],
  redoStack: [],
  liveAnnouncement: `Mandala Studio pronto. Simmetria ${MANDALA_LIMITS.defaultOrder} ordini.`,
  persistenceWarning: initialSaved.warning,

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
    const fractalMetrics = generateFractalStrokesWithMetrics(
      {
        strategyId: SymmetryStrategyKind.Fractal,
        preset: presetId,
        order: state.symmetryParams.order,
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
      const msg = `Sicurezza Anti Over-CPU: ${fractalMetrics.expandedSegmentCount.toLocaleString()} segmenti frattali superano il limite operativo di ${RESOURCE_GUARD_LIMITS.maxFractalSegmentsAllowed.toLocaleString()}. Riduci generazioni o ordine N.`;
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
      `Geometria sacra frattale generata con ${fractalStrokes.length} segmenti.`
    );
  },

  commitFractalGenerationSmart: async (presetId, generations, angle, step) => {
    const state = get();
    const order = state.symmetryParams.order;
    const preset = resolveLSystemPreset(presetId);
    const shouldTryWasmWorker =
      state.routingMode === ExecutionRoutingMode.ForceWasmWorker ||
      (state.routingMode !== ExecutionRoutingMode.ForceJs &&
        generations >= MANDALA_LIMITS.fractalPerfWarningGenerations);

    if (shouldTryWasmWorker) {
      try {
        const { loadWasmWorkerClient } = await import('../wasm/wasmLoader.ts');
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
          });
          if (workerRes.ok && workerRes.value.strokes.length > 0) {
            if (
              workerRes.value.expandedSegmentCount >
              RESOURCE_GUARD_LIMITS.maxFractalSegmentsAllowed
            ) {
              const msg = `Sicurezza Anti Over-CPU: ${workerRes.value.expandedSegmentCount.toLocaleString()} segmenti frattali superano il limite operativo di ${RESOURCE_GUARD_LIMITS.maxFractalSegmentsAllowed.toLocaleString()}. Riduci generazioni o ordine N.`;
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
              `Frattale L-System generato in WASM Worker (${workerRes.value.computeMs.toFixed(1)} ms, ${fractalStrokes.length} polilinee).`
            );
            return { usedWasmWorker: true, segmentCount: fractalStrokes.length };
          }
        }
      } catch {
        // Transparent JS fallback below
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
    if (state.undoStack.length === 0) return;
    const cmd = state.undoStack[state.undoStack.length - 1];
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
    if (state.redoStack.length === 0) return;
    const cmd = state.redoStack[state.redoStack.length - 1];
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
    scheduleAnnouncement(set, 'Tela ripulita.');
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

const createPaletteSlice: StateCreator<MandalaStore, [], [], PaletteSlice> = (set, get) => ({
  activePalette: initialPalette,
  activeColor: initialSaved.doc?.activeColour ?? initialPalette.colours[2],
  strokeWidth: initialSaved.doc?.activeStrokeWidth ?? MANDALA_LIMITS.defaultStrokeWidth,
  activeDash: initialSaved.doc?.activeDash ?? null,

  selectPalette: (palette) => {
    const nextColor = palette.colours[2] ?? palette.colours[0];
    set(() => ({ activePalette: palette, activeColor: nextColor }));
    const updated = get();
    persistStateSnapshot(updated);
    playHapticTone(updated.soundEnabled, HapticTone.Click);
    scheduleAnnouncement(
      set,
      `Palette attivata: ${palette.name}. ${palette.colourblindSafe ? 'Sicura per daltonismo.' : ''}`
    );
  },

  setActiveColor: (color) => {
    set(() => ({ activeColor: color }));
    persistStateSnapshot(get());
  },

  setStrokeWidth: (width) => {
    set(() => ({ strokeWidth: width }));
    persistStateSnapshot(get());
  },

  setActiveDash: (dash) => {
    set(() => ({ activeDash: dash }));
    const updated = get();
    persistStateSnapshot(updated);
    playHapticTone(updated.soundEnabled, HapticTone.Click);
    scheduleAnnouncement(set, `Stile tratto: ${resolveStrokeStylePreset(dash).label}`);
  },
});

const createToolSlice: StateCreator<MandalaStore, [], [], ToolSlice> = (set, get) => ({
  activeTool: ToolId.Brush,
  activeStampArchetype: StampArchetypeId.Petal,
  stampScale: STAMP_LIMITS.defaultScale,
  showGuides: true,
  pressureEnabled: true,
  soundEnabled: true,
  routingMode: ExecutionRoutingMode.AutoGate,
  forceEscapeHatch: false,

  setActiveTool: (tool) => {
    const state = get();
    const wasLensEnabled = state.lens.enabled;
    const wasKinetic = state.kineticMode !== KineticMode.Off;
    set((s) => ({
      activeTool: tool,
      isPanToolActive: false,
      kineticMode: KineticMode.Off,
      kineticPlaying: false,
      lens: wasLensEnabled ? { ...s.lens, enabled: false, isAnimating: false } : s.lens,
      lastMaintenanceMessage:
        wasLensEnabled || wasKinetic
          ? 'Vista Piana ripristinata per disegnare con precisione.'
          : s.lastMaintenanceMessage,
    }));
  },
  setActiveStampArchetype: (activeStampArchetype) => {
    set(() => ({ activeStampArchetype, activeTool: ToolId.Stamp }));
    playHapticTone(get().soundEnabled, HapticTone.Click);
  },
  setStampScale: (scale) => {
    const clamped = Math.min(STAMP_LIMITS.maxScale, Math.max(STAMP_LIMITS.minScale, scale));
    set(() => ({ stampScale: clamped }));
  },
  setShowGuides: (show) => set(() => ({ showGuides: show })),
  setPressureEnabled: (enabled) => set(() => ({ pressureEnabled: enabled })),
  setSoundEnabled: (enabled) => set(() => ({ soundEnabled: enabled })),
  setRoutingMode: (mode) => set(() => ({ routingMode: mode })),
  setForceEscapeHatch: (enabled) => set(() => ({ forceEscapeHatch: enabled })),
});

const createSecuritySlice: StateCreator<MandalaStore, [], [], SecuritySlice> = (set, get) => ({
  autoProtectEnabled: true,
  guardAlert: null,
  lastMaintenanceMessage: null,
  lastCacheFlushReport: null,

  setAutoProtectEnabled: (enabled) => {
    set(() => ({ autoProtectEnabled: enabled }));
    scheduleAnnouncement(
      set,
      enabled
        ? 'Protezione anti-saturazione memoria e CPU attivata.'
        : 'Protezione anti-saturazione disattivata.'
    );
  },

  dismissGuardAlert: () => set(() => ({ guardAlert: null })),

  dismissMaintenanceMessage: () => set(() => ({ lastMaintenanceMessage: null })),

  flushCaches: async () => {
    const res = await flushAllApplicationCaches();
    const report: FlushCacheReport = res.ok
      ? res.value
      : {
          l1EntriesCleared: 0,
          memoEntriesCleared: 0,
          renderSnapshotsCleared: 0,
          browserCachesDeleted: 0,
          coldBatchesCleared: 0,
          estimatedBytesFreed: 0,
          flushedAt: new Date().toISOString(),
        };

    const kbFreed = (report.estimatedBytesFreed / 1024).toFixed(1);
    const gpuNote =
      report.gpuTexturesCleared && report.gpuTexturesCleared > 0
        ? `, ${report.gpuTexturesCleared} texture GPU`
        : '';
    const msg = `Cache svuotata: ${report.l1EntriesCleared} voci L1, ${report.memoEntriesCleared} memo${gpuNote}, ${report.coldBatchesCleared} batch L3 (${kbFreed} KB liberati).`;
    set((s) => ({
      sceneVersion: s.sceneVersion + 1,
      lastCacheFlushReport: report,
      lastMaintenanceMessage: msg,
      lens: s.lens.hasCustomTexture ? { ...s.lens, hasCustomTexture: false } : s.lens,
      guardAlert: null,
    }));
    playHapticTone(get().soundEnabled, HapticTone.Harmonic);
    scheduleAnnouncement(set, msg);
    return report;
  },

  resetSettings: () => {
    const defaultPalette = PALETTES[0];
    set((s) => ({
      sceneVersion: s.sceneVersion + 1,
      symmetryParams: DEFAULT_SYMMETRY_PARAMS,
      activePalette: defaultPalette,
      activeColor: defaultPalette.colours[2],
      strokeWidth: MANDALA_LIMITS.defaultStrokeWidth,
      activeDash: null,
      activeTool: ToolId.Brush,
      activeStampArchetype: StampArchetypeId.Petal,
      stampScale: STAMP_LIMITS.defaultScale,
      showGuides: true,
      pressureEnabled: true,
      soundEnabled: true,
      routingMode: ExecutionRoutingMode.AutoGate,
      forceEscapeHatch: false,
      autoProtectEnabled: true,
      camera: DEFAULT_CAMERA_TRANSFORM,
      worldRadius: WORLD_SPACE_LIMITS.extendedRadius,
      isPanToolActive: false,
      lens: DEFAULT_LENS_CONFIG,
      kineticMode: KineticMode.Off,
      kineticPlaying: false,
      kineticSpeed: KINETIC_LIMITS.defaultSpeed,
      replayProgress: 1,
      concentricBreathing: KINETIC_LIMITS.defaultBreathing,
      morphProgress: 0,
      morphTargetKind: MorphTargetKind.PolarPreset,
      morphTargetPolarPreset: PolarGeneratorId.RoseCurve,
      guardAlert: null,
      lastMaintenanceMessage: 'Impostazioni, Camera, Lente e Animazioni ripristinate (disegno preservato).',
    }));
    persistStateSnapshot(get());
    playHapticTone(get().soundEnabled, HapticTone.Harmonic);
    scheduleAnnouncement(set, 'Impostazioni ripristinate ai valori predefiniti.');
  },

  resetWorkspaceAll: async () => {
    await clearSavedSessionStorage();
    await flushAllApplicationCaches();
    const defaultPalette = PALETTES[0];
    set((s) => ({
      wedges: [],
      sceneVersion: s.sceneVersion + 1,
      undoStack: [],
      redoStack: [],
      persistenceWarning: null,
      symmetryParams: DEFAULT_SYMMETRY_PARAMS,
      activePalette: defaultPalette,
      activeColor: defaultPalette.colours[2],
      strokeWidth: MANDALA_LIMITS.defaultStrokeWidth,
      activeDash: null,
      activeTool: ToolId.Brush,
      activeStampArchetype: StampArchetypeId.Petal,
      stampScale: STAMP_LIMITS.defaultScale,
      showGuides: true,
      pressureEnabled: true,
      soundEnabled: true,
      routingMode: ExecutionRoutingMode.AutoGate,
      forceEscapeHatch: false,
      autoProtectEnabled: true,
      camera: DEFAULT_CAMERA_TRANSFORM,
      worldRadius: WORLD_SPACE_LIMITS.extendedRadius,
      isPanToolActive: false,
      lens: DEFAULT_LENS_CONFIG,
      kineticMode: KineticMode.Off,
      kineticPlaying: false,
      kineticSpeed: KINETIC_LIMITS.defaultSpeed,
      replayProgress: 1,
      concentricBreathing: KINETIC_LIMITS.defaultBreathing,
      morphSlotA: null,
      morphSlotB: null,
      morphTargetKind: MorphTargetKind.PolarPreset,
      morphTargetPolarPreset: PolarGeneratorId.RoseCurve,
      morphProgress: 0,
      guardAlert: null,
      lastMaintenanceMessage: 'Reset completo eseguito: cache svuotata, impostazioni e tela ripristinate.',
    }));
    scheduleAnnouncement(set, 'Reset completo eseguito.');
  },
});

const createViewportSlice: StateCreator<MandalaStore, [], [], ViewportSlice> = (set, get) => ({
  camera: initialCamera,
  worldRadius: initialWorldRadius,
  isPanToolActive: false,

  setZoom: (zoom, displaySize = 600) => {
    const state = get();
    const centerAnchor = { x: displaySize / 2, y: displaySize / 2 };
    const nextCamera = zoomCameraAtScreenPoint(
      state.camera,
      zoom,
      centerAnchor,
      displaySize,
      state.worldRadius
    );
    set(() => ({ camera: nextCamera }));
    persistStateSnapshot(get());
  },

  zoomAtScreenPoint: (
    targetZoom,
    anchorScreenPt,
    displaySize,
    viewportWidth = displaySize,
    viewportHeight = displaySize
  ) => {
    const state = get();
    const nextCamera = zoomCameraAtScreenPoint(
      state.camera,
      targetZoom,
      anchorScreenPt,
      displaySize,
      state.worldRadius,
      viewportWidth,
      viewportHeight
    );
    set(() => ({ camera: nextCamera }));
  },

  panByScreenDelta: (dxScreen, dyScreen, displaySize) => {
    set((s) => {
      const scale = (Math.max(1, displaySize) / LOGICAL_CANVAS_SIZE) * s.camera.zoom;
      const nextPanX = clampCameraPan(s.camera.panX - dxScreen / scale, s.worldRadius);
      const nextPanY = clampCameraPan(s.camera.panY - dyScreen / scale, s.worldRadius);
      return {
        camera: {
          ...s.camera,
          panX: nextPanX,
          panY: nextPanY,
        },
      };
    });
  },

  setWorldRadius: (radius) => {
    const safeRadius = Math.max(
      WORLD_SPACE_LIMITS.baseRadius,
      Math.min(WORLD_SPACE_LIMITS.extendedRadius * 2, Math.round(radius))
    );
    set(() => ({ worldRadius: safeRadius }));
    persistStateSnapshot(get());
  },

  setIsPanToolActive: (active) => set(() => ({ isPanToolActive: active })),

  resetViewport: () => {
    set(() => ({
      camera: {
        zoom: CAMERA_LIMITS.defaultZoom,
        panX: 0,
        panY: 0,
      },
      isPanToolActive: false,
    }));
    persistStateSnapshot(get());
    scheduleAnnouncement(set, 'Camera reimpostata al 100% al centro.');
  },
});

const createLensSlice: StateCreator<MandalaStore, [], [], LensSlice> = (set, get) => ({
  lens: DEFAULT_LENS_CONFIG,

  setLensEnabled: (enabled) => {
    set((s) => ({
      lens: { ...s.lens, enabled, isAnimating: enabled ? s.lens.isAnimating : false },
      isPanToolActive: enabled ? false : s.isPanToolActive,
      kineticMode: enabled ? KineticMode.Off : s.kineticMode,
      kineticPlaying: enabled ? false : s.kineticPlaying,
      lastMaintenanceMessage: enabled
        ? 'Anteprima Lente Semisferica WebGL2 attiva. Tocca per inclinare o torna in Vista Piana per disegnare.'
        : s.lastMaintenanceMessage,
    }));
    playHapticTone(get().soundEnabled, HapticTone.Harmonic);
    scheduleAnnouncement(
      set,
      enabled
        ? 'Anteprima lente semisferica attivata.'
        : 'Vista piana di disegno attivata.'
    );
  },

  setLensProfile: (profile) => {
    set((s) => ({ lens: normalizeLensConfig({ ...s.lens, profile }) }));
    playHapticTone(get().soundEnabled, HapticTone.Click);
  },

  setLensCurvature: (curvature) => {
    set((s) => ({ lens: normalizeLensConfig({ ...s.lens, curvature }) }));
  },

  setLensRefractiveIndex: (refractiveIndex) => {
    set((s) => ({ lens: normalizeLensConfig({ ...s.lens, refractiveIndex }) }));
  },

  setLensFresnel: (fresnelIntensity) => {
    set((s) => ({ lens: normalizeLensConfig({ ...s.lens, fresnelIntensity }) }));
  },

  setLensTilt: (tiltX, tiltY) => {
    set((s) => ({ lens: normalizeLensConfig({ ...s.lens, tiltX, tiltY }) }));
  },

  setLensTextureQuality: (textureQuality) => {
    set((s) => ({ lens: normalizeLensConfig({ ...s.lens, textureQuality }) }));
    playHapticTone(get().soundEnabled, HapticTone.Click);
  },

  setLensAnimating: (isAnimating) => {
    set((s) => ({ lens: normalizeLensConfig({ ...s.lens, isAnimating }) }));
    playHapticTone(get().soundEnabled, HapticTone.Click);
  },

  setLensBreatheAmplitude: (breatheAmplitude) => {
    set((s) => ({ lens: normalizeLensConfig({ ...s.lens, breatheAmplitude }) }));
  },

  setLensHueShiftSpeed: (hueShiftSpeed) => {
    set((s) => ({ lens: normalizeLensConfig({ ...s.lens, hueShiftSpeed }) }));
  },

  setKaleidoscopeFolds: (folds) => {
    const safeFolds = Math.round(
      Math.min(KALEIDOSCOPE_LIMITS.maxFolds, Math.max(KALEIDOSCOPE_LIMITS.minFolds, folds))
    );
    set((s) => ({ lens: normalizeLensConfig({ ...s.lens, kaleidoscopeFolds: safeFolds }) }));
  },

  setKaleidoscopeTwist: (kaleidoscopeTwist) => {
    set((s) => ({ lens: normalizeLensConfig({ ...s.lens, kaleidoscopeTwist }) }));
  },

  setHasCustomTexture: (hasCustomTexture) => {
    set((s) => ({ lens: normalizeLensConfig({ ...s.lens, hasCustomTexture }) }));
  },

  resetLensTilt: () => {
    set((s) => ({ lens: { ...s.lens, tiltX: 0, tiltY: 0 } }));
  },

  exitLensForDrawing: () => {
    if (!get().lens.enabled) return;
    set((s) => ({
      lens: { ...s.lens, enabled: false, isAnimating: false },
      lastMaintenanceMessage: 'Vista Piana ripristinata per disegnare con precisione.',
    }));
    scheduleAnnouncement(set, 'Ritorno automatico in vista piana per il tratto.');
  },
});

const createKineticSlice: StateCreator<MandalaStore, [], [], KineticSlice> = (set, get) => ({
  kineticMode: KineticMode.Off,
  kineticPlaying: false,
  kineticSpeed: KINETIC_LIMITS.defaultSpeed,
  replayProgress: 1,
  concentricBreathing: KINETIC_LIMITS.defaultBreathing,
  morphSlotA: null,
  morphSlotB: null,
  morphTargetKind: MorphTargetKind.PolarPreset,
  morphTargetPolarPreset: PolarGeneratorId.RoseCurve,
  morphProgress: 0,

  enterKineticMode: (mode) => {
    const current = get();
    const autoSlotA: MorphSlotSnapshot | null =
      mode === KineticMode.Morph && !current.morphSlotA
        ? {
            strokes: current.wedges.map((w) => ({ ...w, points: [...w.points] })),
            label: `Tela Prima (${current.wedges.length})`,
            capturedAtIso: new Date().toISOString(),
          }
        : current.morphSlotA;

    const statusMsg =
      mode === KineticMode.StrokeReplay
        ? 'Replay progressivo attivo: premi Disegna o Esc per tornare alla tela.'
        : mode === KineticMode.Morph
          ? 'Kinetic Morphing attivo: trasforma il Mandala tra Slot A/B e Armoniche Polari.'
          : 'Modalità Zen Concentrica attiva: anelli e respiro in tempo reale.';

    set((s) => ({
      kineticMode: mode,
      kineticPlaying: true,
      replayProgress: mode === KineticMode.StrokeReplay ? 0 : 1,
      morphSlotA: autoSlotA,
      morphProgress: mode === KineticMode.Morph ? 0 : s.morphProgress,
      isPanToolActive: false,
      lens: s.lens.enabled ? { ...s.lens, enabled: false, isAnimating: false } : s.lens,
      lastMaintenanceMessage: statusMsg,
    }));
    playHapticTone(get().soundEnabled, HapticTone.Harmonic);
    scheduleAnnouncement(
      set,
      mode === KineticMode.StrokeReplay
        ? 'Avviato replay progressivo dei tratti.'
        : mode === KineticMode.Morph
          ? 'Avviato morphing cinetico su Canvas 2D.'
          : 'Avviata modalità zen con anelli concentrici.'
    );
  },

  exitKineticMode: () => {
    if (get().kineticMode === KineticMode.Off) return;
    set(() => ({
      kineticMode: KineticMode.Off,
      kineticPlaying: false,
      replayProgress: 1,
    }));
    scheduleAnnouncement(set, 'Ritorno alla modalità di disegno piana.');
  },

  setKineticPlaying: (kineticPlaying) => {
    set((s) => ({
      kineticPlaying,
      replayProgress:
        kineticPlaying && s.kineticMode === KineticMode.StrokeReplay && s.replayProgress >= 0.999
          ? 0
          : s.replayProgress,
    }));
    playHapticTone(get().soundEnabled, HapticTone.Click);
  },

  setKineticSpeed: (speed) => {
    const safeSpeed = Math.max(KINETIC_LIMITS.minSpeed, Math.min(KINETIC_LIMITS.maxSpeed, speed));
    set(() => ({ kineticSpeed: safeSpeed }));
  },

  setReplayProgress: (progress) => {
    const safeProgress = Math.max(0, Math.min(1, progress));
    set(() => ({ replayProgress: safeProgress }));
  },

  setConcentricBreathing: (amplitude) => {
    const safeAmp = Math.max(0, Math.min(KINETIC_LIMITS.maxBreathing, amplitude));
    set(() => ({ concentricBreathing: safeAmp }));
  },

  captureMorphSlot: (slot) => {
    const state = get();
    const snapshot: MorphSlotSnapshot = {
      strokes: state.wedges.map((w) => ({
        ...w,
        points: w.points.map((p) => ({ ...p })),
        dash: w.dash ? [...w.dash] : null,
      })),
      label: `${slot === MorphSlotId.SlotA ? 'Prima A' : 'Dopo B'} (${state.wedges.length})`,
      capturedAtIso: new Date().toISOString(),
    };
    set(() =>
      slot === MorphSlotId.SlotA
        ? { morphSlotA: snapshot }
        : { morphSlotB: snapshot, morphTargetKind: MorphTargetKind.UserSlotB }
    );
    playHapticTone(state.soundEnabled, HapticTone.Click);
    scheduleAnnouncement(
      set,
      `Catturato ${snapshot.label} per il morphing.`
    );
  },

  clearMorphSlot: (slot) => {
    set((s) =>
      slot === MorphSlotId.SlotA
        ? { morphSlotA: null }
        : {
            morphSlotB: null,
            morphTargetKind:
              s.morphTargetKind === MorphTargetKind.UserSlotB
                ? MorphTargetKind.PolarPreset
                : s.morphTargetKind,
          }
    );
  },

  setMorphTargetKind: (morphTargetKind) => set(() => ({ morphTargetKind })),

  setMorphTargetPolarPreset: (morphTargetPolarPreset) =>
    set(() => ({
      morphTargetPolarPreset,
      morphTargetKind: MorphTargetKind.PolarPreset,
    })),

  setMorphProgress: (progress) => {
    const safeProgress = Math.max(0, Math.min(1, progress));
    set(() => ({ morphProgress: safeProgress }));
  },
});

export const useMandalaStore = create<MandalaStore>()((...a) => ({
  ...createSceneSlice(...a),
  ...createPaletteSlice(...a),
  ...createToolSlice(...a),
  ...createSecuritySlice(...a),
  ...createViewportSlice(...a),
  ...createLensSlice(...a),
  ...createKineticSlice(...a),
}));

/**
 * Pure selector helper for parametric accessibility description (Layer 3 derived, never stored).
 */
export function buildParametricDescription(
  symmetryParams: SymmetryParams,
  wedgesCount: number,
  activePalette: Palette,
  activeColor: string,
  strokeWidth: number,
  activeDash: readonly number[] | null
): string {
  const dashName = resolveStrokeStylePreset(activeDash).label.toLowerCase();
  const fractalInfo =
    symmetryParams.strategyId === SymmetryStrategyKind.Fractal
      ? ` Iterazioni frattali: ${symmetryParams.generations}, angolo ${symmetryParams.angle}°, passo ${symmetryParams.stepLength}px.`
      : '';
  return `Mandala con ${describeSymmetryParams(symmetryParams)}.${fractalInfo} ${wedgesCount} tratti memorizzati. Palette attiva: ${activePalette.name} (${activePalette.colourblindSafe ? 'accessibile a daltonismo' : 'standard'}). Colore selezionato: ${activeColor}, stile tratto: ${dashName}, spessore ${strokeWidth}px.`;
}
