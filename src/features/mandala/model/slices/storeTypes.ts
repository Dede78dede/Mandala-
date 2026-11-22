/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Result } from '../../../../shared/lib/result.ts';
import type {
  CameraTransform,
  ExecutionRoutingMode,
  FlushCacheReport,
  HistoryCommand,
  KineticMode,
  LSystemPresetId,
  LensConfig,
  LensProfile,
  LensTextureQuality,
  MandalaDocument,
  MorphSlotId,
  MorphSlotSnapshot,
  MorphTargetKind,
  Palette,
  Point,
  PolarGenerationParams,
  PolarGeneratorId,
  StampArchetypeId,
  SymmetryParams,
  ToolType,
  WedgeStroke,
} from '../types.ts';

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
