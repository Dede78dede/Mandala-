/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Canonical Domain Types & Standard TypeScript Enums for Mandala Studio.
 * Zero `any`, zero magic strings.
 */

export { LOGICAL_CANVAS_SIZE, LOGICAL_CENTER } from './constants.ts';

export enum ToolId {
  Brush = 'brush',
  Point = 'point',
  Stamp = 'stamp',
  Eraser = 'eraser',
}

export enum SymmetryStrategyKind {
  Radial = 'radial',
  MirrorRadial = 'mirror-radial',
  Fractal = 'fractal',
}

export enum MirrorMode {
  Reflect = 'reflect',
  Alternate = 'alternate',
}

export enum StrokeStyleId {
  Solid = 'solid',
  Dashed = 'dashed',
  Dotted = 'dotted',
}

export enum LSystemPresetId {
  SacredFlower = 'sacredFlower',
  KochSnowflake = 'kochSnowflake',
  SierpinskiArrowhead = 'sierpinskiArrowhead',
  DragonCurve = 'dragonCurve',
}

export enum PaletteId {
  OkabeIto = 'okabe-ito',
  SacredGold = 'sacred-gold',
  CyberZen = 'cyber-zen',
  Monochrome = 'monochrome',
}

export enum SvgSerializationMode {
  Auto = 'auto',
  Absolute = 'absolute',
  DefsUse = 'defs-use',
}

export enum PngExportResolution {
  Standard1K = 1024,
  Hd2K = 2048,
  Ultra4K = 4096,
}

export enum HubTabId {
  Phase1 = 'phase1',
  Benchmark = 'benchmark',
  Scaffold = 'scaffold',
  Touch = 'touch',
  Twa = 'twa',
  Memory = 'memory',
}

export enum MemoryTier {
  L0TypedBuffer = 'L0_TYPED_BUFFER',
  L1GeometryCache = 'L1_LRU_CACHE',
  L2ActiveHeap = 'L2_ACTIVE_HEAP',
  L3IndexedDbSwap = 'L3_IDB_SWAP',
}

export enum MemoryPressureLevel {
  Normal = 'normal',
  Elevated = 'elevated',
  Critical = 'critical',
}

export enum SymmetryErrorCode {
  InvalidOrder = 'INVALID_ORDER',
  DegenerateInput = 'DEGENERATE_INPUT',
  UnknownStrategy = 'UNKNOWN_STRATEGY',
}

export enum HapticTone {
  Click = 'click',
  Harmonic = 'harmonic',
}

export enum HistoryCommandPrefix {
  Stroke = 'cmd_stroke',
  Stamp = 'cmd_stamp',
  Erase = 'cmd_erase',
  Fractal = 'cmd_fractal',
  Polar = 'cmd_polar',
  Clear = 'cmd_clear',
}

export enum AdrPhase {
  Phase1 = 'Fase 1',
  Phase2 = 'Fase 2',
  Phase3 = 'Fase 3',
  Phase4 = 'Fase 4',
  Phase5 = 'Fase 5',
}

export enum ComplexityMetric {
  Points = 'points',
  Segments = 'segments',
}

export enum ExportFormat {
  Png = 'PNG',
  Svg = 'SVG',
  Json = 'JSON',
}

export enum AdrStatus {
  Ratified = 'Ratificato',
  Monitoring = 'In Monitoraggio',
}

export enum BenchmarkComplexityLabel {
  Low = 'Bassa (5 pt)',
  Medium = 'Media (25 pt)',
  High = 'Alta (50 pt)',
}

export enum GateVerdict {
  OptimalJs = 'JS Ottimale (<=10ms)',
  GreyZone = 'Zona Grigia (10-50ms)',
  WasmCandidate = 'Candidato WASM/NDK (>=50ms)',
}

export enum ExecutionRoutingMode {
  AutoGate = 'auto-gate',
  ForceJs = 'force-js',
  ForceWasmWorker = 'force-wasm-worker',
}

export enum WasmWorkerStatus {
  Idle = 'idle',
  Initializing = 'initializing',
  Ready = 'ready',
  FallbackJs = 'fallback-js',
  Error = 'error',
}

export enum WorkerMsgType {
  Init = 'INIT',
  Ready = 'READY',
  Expand = 'EXPAND',
  Expanded = 'EXPANDED',
  ExpandLSystem = 'EXPAND_LSYSTEM',
  LSystemExpanded = 'LSYSTEM_EXPANDED',
  Error = 'ERROR',
  InjectPanic = 'INJECT_PANIC',
}

export enum CpuLoadState {
  Nominal = 'nominal',
  Elevated = 'elevated',
  Protected = 'protected',
}

export enum ResourceGuardErrorCode {
  OverMemoryPoints = 'OVER_MEMORY_POINTS',
  OverMemoryHeap = 'OVER_MEMORY_HEAP',
  OverSceneWedges = 'OVER_SCENE_WEDGES',
  OverCpuPrimitives = 'OVER_CPU_PRIMITIVES',
}

export enum LensProfile {
  SphericalDome = 'spherical-dome',
  RefractiveGlass = 'refractive-glass',
  PoincareDisk = 'poincare-disk',
  StainedGlass = 'stained-glass',
  Kaleidoscope = 'kaleidoscope',
}

export enum LensTextureQuality {
  Auto2K = 'auto-2k',
  Hd4K = 'hd-4k',
}

export enum KineticMode {
  Off = 'off',
  StrokeReplay = 'stroke-replay',
  ConcentricRings = 'concentric-rings',
  Morph = 'morph',
}

export enum StampArchetypeId {
  Petal = 'petal',
  MultiLotus = 'multi-lotus',
  OrganicBlob = 'organic-blob',
  Starburst = 'starburst',
}

export enum PolarGeneratorId {
  RoseCurve = 'rose-curve',
  Epitrochoid = 'epitrochoid',
  HexagonalCrown = 'hexagonal-crown',
}

export enum ProceduralTabId {
  LSystem = 'l-system',
  PolarHarmonics = 'polar-harmonics',
}

export enum SvgAnimationMode {
  None = 'none',
  ConcentricRings = 'concentric-rings',
  PathDrawing = 'path-drawing',
}

export enum MorphSlotId {
  SlotA = 'slot-a',
  SlotB = 'slot-b',
}

export enum MorphTargetKind {
  UserSlotB = 'user-slot-b',
  PolarPreset = 'polar-preset',
}

export enum MotionPauseReason {
  ReducedMotion = 'reduced-motion',
  TabHidden = 'tab-hidden',
  CpuProtected = 'cpu-protected',
  PausedByUser = 'paused-by-user',
}

export enum CoordinateSpaceOrigin {
  Logical800 = 'logical-800',
  CenteredZero = 'centered-zero',
}

export type HexColor = `#${string}`;

export interface Point {
  x: number;
  y: number;
  pressure?: number;
}

export interface WedgeStroke {
  id: string;
  points: Point[];
  stroke: string;
  strokeWidth: number;
  dash: number[] | null;
  opacity: number;
}

export type SymmetryStrategyId = `${SymmetryStrategyKind}`;

export type SymmetryParams =
  | { strategyId: SymmetryStrategyKind.Radial; order: number }
  | {
      strategyId: SymmetryStrategyKind.MirrorRadial;
      order: number;
      mirrorMode: MirrorMode;
    }
  | {
      strategyId: SymmetryStrategyKind.Fractal;
      preset: LSystemPresetId;
      order: number;
      generations: number;
      angle: number;
      stepLength: number;
    };

export type ToolType = ToolId;

export interface HistoryCommand {
  id: string;
  label: string;
  do: () => void;
  undo: () => void;
}

export interface SvgExportReport {
  svg: string;
  modeUsed: SvgSerializationMode.Absolute | SvgSerializationMode.DefsUse;
  absoluteBytes: number;
  defsUseBytes: number | null;
  selectedBytes: number;
}

export interface StrokeStylePreset {
  id: StrokeStyleId;
  label: string;
  dash: number[] | null;
}

export interface Palette {
  id: PaletteId;
  name: string;
  colours: readonly HexColor[];
  colourblindSafe: boolean;
  description: string;
}

export interface CameraTransform {
  readonly zoom: number;
  readonly panX: number;
  readonly panY: number;
}

export interface WorldBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface LensConfig {
  readonly enabled: boolean;
  readonly profile: LensProfile;
  readonly curvature: number;
  readonly refractiveIndex: number;
  readonly fresnelIntensity: number;
  readonly tiltX: number;
  readonly tiltY: number;
  readonly textureQuality: LensTextureQuality;
  readonly isAnimating?: boolean;
  readonly breatheAmplitude?: number;
  readonly hueShiftSpeed?: number;
  readonly kaleidoscopeFolds?: number;
  readonly kaleidoscopeTwist?: number;
  readonly hasCustomTexture?: boolean;
}

export interface SvgPathDrawingConfig {
  readonly cycleDurationSec: number;
  readonly staggerDelayMs: number;
  readonly loop: boolean;
}

export interface StampPlacementParams {
  readonly archetype: StampArchetypeId;
  readonly anchor: Point;
  readonly radius: number;
  readonly angleRad: number;
  readonly strokeColor: string;
  readonly strokeWidth: number;
  readonly dash: number[] | null;
}

export interface PolarGenerationParams {
  readonly generatorId: PolarGeneratorId;
  readonly amplitudeRadius: number;
  readonly numerator: number;
  readonly denominator: number;
  readonly sampleSteps: number;
  readonly strokeColor: string;
  readonly strokeWidth: number;
  readonly dash: number[] | null;
}

export interface MorphSlotSnapshot {
  readonly strokes: readonly WedgeStroke[];
  readonly label: string;
  readonly capturedAtIso: string;
}

export interface LensTextureResolutionPlan {
  readonly textureSizePx: number;
  readonly estimatedVramBytes: number;
  readonly downgraded: boolean;
  readonly label: string;
  readonly reason: string | null;
}

export interface MandalaDocumentV1 {
  schemaVersion: 1;
  title: string;
  symmetryParams: SymmetryParams;
  wedges: WedgeStroke[];
  paletteId: string;
  activeColour: string;
  activeStrokeWidth: number;
  activeDash: number[] | null;
  createdAt: string;
}

export interface MandalaDocumentV2 {
  schemaVersion: 2;
  title: string;
  coordinateOrigin: CoordinateSpaceOrigin;
  worldRadius: number;
  camera?: CameraTransform;
  symmetryParams: SymmetryParams;
  wedges: WedgeStroke[];
  paletteId: string;
  activeColour: string;
  activeStrokeWidth: number;
  activeDash: number[] | null;
  createdAt: string;
}

export type MandalaDocument = MandalaDocumentV1 | MandalaDocumentV2;

export interface SymmetryError {
  code: SymmetryErrorCode;
  message: string;
}

export interface ADRRecord {
  id: string;
  phase: AdrPhase;
  title: string;
  status: AdrStatus;
  decision: string;
  rationale: string;
  revisitCondition: string;
}

export interface BenchmarkCell {
  order: number;
  complexityLabel: BenchmarkComplexityLabel;
  pointCount: number;
  expandedCount: number;
  medianMs: number;
  p95Ms: number;
  gateVerdict: GateVerdict;
}

export interface Phase3BenchmarkCell extends BenchmarkCell {
  wasmMedianMs: number;
  wasmP95Ms: number;
  wasmComputeOnlyMs: number;
  boundaryOverheadMs: number;
  speedupRatio: number;
  adoptedPath: 'JS' | 'WASM' | 'GREY_ZONE_JS' | 'GREY_ZONE_WASM';
}

export interface Phase3BenchmarkReport {
  readonly strategyId: SymmetryStrategyKind.Radial | SymmetryStrategyKind.MirrorRadial;
  readonly noopRoundTripMs: number;
  readonly wasmBinaryBytes: number;
  readonly calibratedMinWedgeComplexity: number | null;
  readonly cells: readonly Phase3BenchmarkCell[];
  readonly generatedAt: string;
}

export interface FractalBenchmarkCell {
  readonly presetId: LSystemPresetId;
  readonly presetName: string;
  readonly generations: number;
  readonly order: number;
  readonly segmentCount: number;
  readonly expandedSegmentCount: number;
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly exceeds50msRule: boolean;
  readonly wasmMedianMs?: number;
  readonly wasmSpeedupRatio?: number;
}

export interface FractalBenchmarkReport {
  readonly order: number;
  readonly calibratedSegmentThreshold: number;
  readonly wasmEscalationRecommended: boolean;
  readonly wasmKernelActive?: boolean;
  readonly cells: readonly FractalBenchmarkCell[];
  readonly generatedAt: string;
}

export interface FlushCacheReport {
  readonly l1EntriesCleared: number;
  readonly memoEntriesCleared: number;
  readonly renderSnapshotsCleared: number;
  readonly gpuTexturesCleared?: number;
  readonly browserCachesDeleted: number;
  readonly coldBatchesCleared: number;
  readonly estimatedBytesFreed: number;
  readonly flushedAt: string;
}

export interface ResourceHealthSnapshot {
  readonly l1Entries: number;
  readonly l1BytesUsed: number;
  readonly l2WedgeCount: number;
  readonly l2PointCount: number;
  readonly l2WedgeHeapBytes: number;
  readonly expandedPrimitives: number;
  readonly memoryPressure: MemoryPressureLevel;
  readonly cpuLoadState: CpuLoadState;
  readonly lastRenderMs: number;
  readonly emaRenderMs: number;
  readonly peakRenderMs: number;
  readonly jsHeapUsedMb: number | null;
  readonly jsHeapLimitMb: number | null;
  readonly saturationRatio: number;
}

