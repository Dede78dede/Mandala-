/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Canonical Domain Constants & Configuration Limits (Zero Magic Numbers/Strings).
 */

export const LOGICAL_CANVAS_SIZE = 800;

export const LOGICAL_CENTER = {
  x: LOGICAL_CANVAS_SIZE / 2,
  y: LOGICAL_CANVAS_SIZE / 2,
} as const;

export const STORAGE_KEY_V1 = 'mandala_studio_doc_v1' as const;

export const SVG_DEFAULT_EXPORT_SIZE = 1200;

export const MANDALA_LIMITS = {
  minOrder: 3,
  maxOrder: 48,
  defaultOrder: 8,
  minStrokeWidth: 1,
  maxStrokeWidth: 24,
  defaultStrokeWidth: 3.5,
  schemaMaxStrokeWidth: 100,
  schemaDocMaxStrokeWidth: 50,
  defaultOpacity: 0.95,
  previewOpacity: 0.9,
  maxHistoryCommands: 50,
  announcementDebounceMs: 300,
  parametricMirrorThrottleMs: 500,
  eraserMinRadius: 10,
  eraserRadiusMultiplier: 2.5,
  maxLSystemGenerations: 5,
  lSystemCapGenerations: 6,
  fractalPerfWarningGenerations: 5,
  escapeHatchStrokeThreshold: 2000,
  wasmGateOptimalMs: 10,
  wasmGateCandidateMs: 50,
} as const;

export const STRATEGY_COMPLEXITY_THRESHOLDS = {
  radialPoints: 400,
  mirrorRadialPoints: 320,
  fractalSegments: 500,
} as const;

export const CANVAS_THEME = {
  backgroundHex: '#090d16',
  transparentBackground: 'none',
  guideStrokeHex: '#38bdf8',
  eraserReticleHex: '#fb7185',
  eraserFillRgba: 'rgba(251, 113, 133, 0.14)',
  crosshairBrushHex: '#38bdf8',
  crosshairEraserHex: '#fb7185',
  guideRingRatios: [0.2, 0.4, 0.6, 0.8, 0.96] as const,
} as const;

export const MEMORY_TIER_LIMITS = {
  l0PointStride: 3, // [x, y, pressure] Float32
  l0InitialCapacityPoints: 256,
  l0MaxPooledPoints: 16384,
  l1MaxEntries: 512,
  l1MaxBytes: 4 * 1024 * 1024, // 4 MiB geometry LRU budget
  l2HotWedgeLimit: 600,
  l2ElevatedBytes: 2 * 1024 * 1024,
  l2CriticalBytes: 8 * 1024 * 1024,
} as const;

export const IDB_SWAP_CONFIG = {
  dbName: 'mandala_studio_swap_v1',
  dbVersion: 1,
  documentStore: 'documents',
  coldWedgeStore: 'cold_wedges',
  activeDocKey: 'active_session_v1',
} as const;

export const WASM_CONFIG = {
  binaryUrl: '/wasm/mandala_symmetry.wasm',
  sizeBudgetBytes: 200 * 1024,
  parityTolerance: 1e-12,
  adoptionSpeedupRatio: 1.2,
  escapeHatchMaxRasterMs: 16.6,
} as const;

export function isWasmSymmetryFlagEnabled(): boolean {
  const envVal = (import.meta as { env?: Record<string, string | undefined> }).env
    ?.VITE_ENABLE_WASM_SYMMETRY;
  return envVal === 'true' || envVal === '1';
}

export const RESOURCE_GUARD_LIMITS = {
  maxSceneWedges: 20_000,
  maxScenePoints: 120_000,
  maxExpandedPrimitivesPerFrame: 60_000,
  maxFractalSegmentsAllowed: 35_000,
  maxHistoryCommandsUnderPressure: 15,
  l2HardMaxBytes: 16 * 1024 * 1024, // 16 MiB anti-over-memory ceiling
  cpuFrameBudgetMs: 16.6,
  cpuCircuitBreakerMs: 45,
  pointerMinDistanceSq: 1.5, // Input decimation threshold (logical px^2)
  persistenceDebounceMs: 250,
  maxLocalStorageJsonBytes: 1_500_000, // Offload pure L3 IndexedDB swap above ~1.5MB
  svgPreviewMemoMaxWedges: 1_200,
  svgPreviewMemoMaxExpandedPrimitives: 2_400,
  svgLivePreviewMaxExpandedPrimitives: 240,
  renderSnapshotMaxEntries: 4,
} as const;

export const WORLD_ORIGIN = {
  x: 0,
  y: 0,
} as const;

export const WORLD_SPACE_LIMITS = {
  baseRadius: LOGICAL_CANVAS_SIZE / 2,
  extendedRadius: 1_200,
  maxGuideRings: 8,
} as const;

export const CAMERA_LIMITS = {
  minZoom: 0.25,
  maxZoom: 8.0,
  defaultZoom: 1.0,
  wheelZoomFactor: 1.12,
  buttonZoomFactor: 1.25,
  maxPanFactor: 1.15,
} as const;

export const LENS_LIMITS = {
  minCurvature: 0.0,
  maxCurvature: 1.0,
  defaultCurvature: 0.72,
  minIor: 1.0,
  maxIor: 1.65,
  defaultIor: 1.46,
  minFresnel: 0.0,
  maxFresnel: 1.0,
  defaultFresnel: 0.58,
  minBreathe: 0.0,
  maxBreathe: 0.2,
  defaultBreathe: 0.06,
  minHueSpeed: 0.0,
  maxHueSpeed: 1.0,
  defaultHueSpeed: 0.35,
  maxTilt: 0.35,
  fallbackTexturePx: 1_024,
  standardTexturePx: 2_048,
  hdTexturePx: 4_096,
  maxGpuVramBudgetBytes: 80 * 1024 * 1024,
  poincareClampFactor: 0.94,
} as const;

export const KINETIC_LIMITS = {
  minSpeed: 0.25,
  maxSpeed: 2.5,
  defaultSpeed: 1.0,
  maxBreathing: 0.12,
  defaultBreathing: 0.04,
  replayBaseDurationSec: 8.0,
  morphBaseDurationSec: 5.0,
  innerRingRatio: 0.34,
  midRingRatio: 0.68,
  ringSpeedMultipliers: [0.42, -0.26, 0.14] as const,
} as const;

export const STAMP_LIMITS = {
  minRadius: 16,
  maxRadius: 220,
  defaultRadius: 56,
  minScale: 0.5,
  maxScale: 2.0,
  defaultScale: 1.0,
  petalSampleCount: 28,
  multiLotusLayerCount: 3,
  blobHarmonicCount: 32,
  starburstTipMin: 6,
  starburstTipDefault: 8,
} as const;

export const POLAR_LIMITS = {
  minAmplitudeRadius: 60,
  maxAmplitudeRadius: 360,
  defaultAmplitudeRadius: 220,
  minNumerator: 2,
  maxNumerator: 12,
  defaultNumerator: 5,
  minDenominator: 1,
  maxDenominator: 7,
  defaultDenominator: 3,
  minSampleSteps: 96,
  maxSampleSteps: 280,
  defaultSampleSteps: 180,
  minHexLayers: 2,
  maxHexLayers: 6,
  defaultHexLayers: 3,
} as const;

export const KALEIDOSCOPE_LIMITS = {
  minFolds: 4,
  maxFolds: 24,
  defaultFolds: 12,
  minTwist: -2.0,
  maxTwist: 2.0,
  defaultTwist: 0.35,
  maxUploadFileBytes: 12 * 1024 * 1024,
} as const;

export const SVG_ANIMATION_LIMITS = {
  minCycleDurationSec: 1.5,
  maxCycleDurationSec: 12.0,
  defaultCycleDurationSec: 4.5,
  minStaggerDelayMs: 0,
  maxStaggerDelayMs: 180,
  defaultStaggerDelayMs: 45,
} as const;

export const MORPH_LIMITS = {
  resampledPointCount: 20,
  maxPreviewStrokes: 1500,
  maxExpandedMorphPrimitivesPerFrame: 1_200,
  minAdaptiveMorphStrokes: 24,
} as const;

/**
 * Canonical WASM Linear-Memory ABI Contract synchronized with `scripts/build_wasm.py` (`WasmAbiSpec`).
 */
export const WASM_ABI_SPEC = {
  heapBaseOffsetBytes: 4096,
  initialMemoryPages: 32,
  maxMemoryPages: 512,
  rulesTableBytes: 1024,
  ruleEntryStrideBytes: 8,
  turtleStackMaxDepth: 256,
  turtleStackFrameBytes: 24,
  outMetaBytes: 16,
  pointStrideF64Bytes: 16,
  polyLengthStrideBytes: 4,
  workerInitTimeoutMs: 6_000,
  workerJobTimeoutMs: 15_000,
} as const;

export interface ContrastThemeDefaults {
  readonly darkSwatchHexes: readonly string[];
  readonly lightIndicatorHex: string;
  readonly darkIndicatorHex: string;
}

export const CONTRAST_THEME_DEFAULTS: ContrastThemeDefaults = {
  darkSwatchHexes: ['#000000', '#0F172A'],
  lightIndicatorHex: '#ffffff',
  darkIndicatorHex: '#000000',
};

export const ANDROID_DISTRIBUTION_DEFAULTS = {
  releaseManifestPath: '/releases/update-manifest.json',
  defaultVersionName: '1.0.0',
  defaultVersionCode: 10_000,
  androidPackageId: 'com.mandala.studio',
  twaPackageId: 'com.mandala.studio.twa',
  minSdk: 28,
  targetSdk: 35,
  apkAssetName: 'mandala-studio-universal-release.apk',
  fallbackReleasePageUrl: 'https://github.com/mandala-studio/mandala-studio/releases/latest',
  fallbackApkDownloadUrl:
    'https://github.com/mandala-studio/mandala-studio/releases/latest/download/mandala-studio-universal-release.apk',
  androidDocumentReturnEvent: 'mandala:android-document-return',
  androidUpdateStatusEvent: 'mandala:android-update-status',
} as const;

