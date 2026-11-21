/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { flushAllApplicationCaches, registerGpuTextureReclaimer } from '../../../shared/lib/cacheService.ts';
import { KALEIDOSCOPE_LIMITS, LENS_LIMITS, LOGICAL_CENTER } from '../model/constants.ts';
import {
  CpuLoadState,
  KineticMode,
  LensProfile,
  LensTextureQuality,
  MemoryPressureLevel,
  MorphSlotId,
  MorphTargetKind,
  PolarGeneratorId,
  StampArchetypeId,
  ToolId,
  type LensConfig,
} from '../model/types.ts';
import { useMandalaStore } from '../model/store.ts';
import { createInMemorySwapAdapter } from '../memory/swapStorage.ts';
import { generateBotanicalStampStrokes } from './proceduralStamps.ts';
import {
  DEFAULT_LENS_CONFIG,
  evaluateOpticalLensSample,
  normalizeLensConfig,
  resolveEffectiveLensTextureSize,
} from './lensProjection.ts';

function makeConfig(overrides: Partial<LensConfig>): LensConfig {
  return { ...DEFAULT_LENS_CONFIG, enabled: true, ...overrides };
}

test('Optical Lens Math: outside disc is rejected cleanly and all profiles clamp source UVs within [-1, 1]', () => {
  const outside = evaluateOpticalLensSample(0.9, 0.9, makeConfig({}));
  assert.equal(outside.insideDisc, false);

  const profiles: LensProfile[] = [
    LensProfile.SphericalDome,
    LensProfile.RefractiveGlass,
    LensProfile.PoincareDisk,
    LensProfile.StainedGlass,
    LensProfile.Kaleidoscope,
  ];

  for (const profile of profiles) {
    const cfg = makeConfig({
      profile,
      curvature: 1.0,
      refractiveIndex: LENS_LIMITS.maxIor,
      fresnelIntensity: 1.0,
      tiltX: LENS_LIMITS.maxTilt,
      tiltY: -LENS_LIMITS.maxTilt,
    });

    const centerSample = evaluateOpticalLensSample(0, 0, { ...cfg, tiltX: 0, tiltY: 0 });
    assert.equal(centerSample.insideDisc, true);
    assert.ok(Math.abs(centerSample.srcU) < 1e-6);
    assert.ok(Math.abs(centerSample.srcV) < 1e-6);
    assert.ok(Math.abs(centerSample.normalZ - 1) < 1e-6);

    for (const r of [0.15, 0.45, 0.75, 0.95]) {
      const sample = evaluateOpticalLensSample(r, 0, cfg);
      assert.equal(sample.insideDisc, true);
      assert.ok(sample.srcU >= -1 && sample.srcU <= 1);
      assert.ok(sample.srcV >= -1 && sample.srcV <= 1);
    }
  }
});

test('Optical Lens Math: normalizeLensConfig clamps animation and kaleidoscope parameters', () => {
  const clamped = normalizeLensConfig(
    makeConfig({
      breatheAmplitude: 99,
      hueShiftSpeed: -5,
      kaleidoscopeFolds: 99,
      kaleidoscopeTwist: -10,
    })
  );
  assert.equal(clamped.breatheAmplitude, LENS_LIMITS.maxBreathe);
  assert.equal(clamped.hueShiftSpeed, LENS_LIMITS.minHueSpeed);
  assert.equal(clamped.kaleidoscopeFolds, KALEIDOSCOPE_LIMITS.maxFolds);
  assert.equal(clamped.kaleidoscopeTwist, KALEIDOSCOPE_LIMITS.minTwist);

  const breathingCfg = makeConfig({
    profile: LensProfile.StainedGlass,
    isAnimating: true,
    breatheAmplitude: 0.1,
  });
  const t0 = evaluateOpticalLensSample(0.5, 0, breathingCfg, 0);
  const tPeak = evaluateOpticalLensSample(0.5, 0, breathingCfg, Math.PI / (2 * 1.35));
  assert.notEqual(t0.srcU, tPeak.srcU);
});

test('Optical Lens Math: Fresnel reflectance increases monotonically toward dome rim', () => {
  const cfg = makeConfig({
    profile: LensProfile.RefractiveGlass,
    curvature: 0.85,
    fresnelIntensity: 0.9,
  });
  const sCenter = evaluateOpticalLensSample(0.0, 0.0, cfg);
  const sMid = evaluateOpticalLensSample(0.5, 0.0, cfg);
  const sRim = evaluateOpticalLensSample(0.92, 0.0, cfg);

  assert.ok(sMid.fresnel > sCenter.fresnel);
  assert.ok(sRim.fresnel > sMid.fresnel);
});

test('Optical Lens VRAM Planner: defaults to 2048px, auto-downgrades to 1024px under load, and guards HD 4096px', () => {
  const autoNominal = resolveEffectiveLensTextureSize({
    requestedQuality: LensTextureQuality.Auto2K,
    cpuLoadState: CpuLoadState.Nominal,
    memoryPressure: MemoryPressureLevel.Normal,
    maxGpuTextureSize: 4096,
    currentSceneBytes: 512 * 1024,
  });
  assert.equal(autoNominal.textureSizePx, LENS_LIMITS.standardTexturePx);
  assert.equal(autoNominal.downgraded, false);

  const autoDowngraded = resolveEffectiveLensTextureSize({
    requestedQuality: LensTextureQuality.Auto2K,
    cpuLoadState: CpuLoadState.Elevated,
    memoryPressure: MemoryPressureLevel.Normal,
    maxGpuTextureSize: 4096,
    currentSceneBytes: 512 * 1024,
  });
  assert.equal(autoDowngraded.textureSizePx, LENS_LIMITS.fallbackTexturePx);
  assert.equal(autoDowngraded.downgraded, true);

  const hdAllowed = resolveEffectiveLensTextureSize({
    requestedQuality: LensTextureQuality.Hd4K,
    cpuLoadState: CpuLoadState.Nominal,
    memoryPressure: MemoryPressureLevel.Normal,
    maxGpuTextureSize: 4096,
    currentSceneBytes: 1024 * 1024,
  });
  assert.equal(hdAllowed.textureSizePx, LENS_LIMITS.hdTexturePx);
  assert.equal(hdAllowed.downgraded, false);

  const hdBlockedLowGpu = resolveEffectiveLensTextureSize({
    requestedQuality: LensTextureQuality.Hd4K,
    cpuLoadState: CpuLoadState.Nominal,
    memoryPressure: MemoryPressureLevel.Normal,
    maxGpuTextureSize: 2048,
    currentSceneBytes: 1024 * 1024,
  });
  assert.equal(hdBlockedLowGpu.textureSizePx, LENS_LIMITS.standardTexturePx);
  assert.equal(hdBlockedLowGpu.downgraded, true);
  assert.ok(hdBlockedLowGpu.reason && hdBlockedLowGpu.reason.length > 0);
});

test('Store Lens, Stamp, Polar & Kinetic Morph Flow: invariants across actions and resets', () => {
  const store = useMandalaStore.getState();
  store.clearCanvas();

  const stampStrokes = generateBotanicalStampStrokes({
    archetype: StampArchetypeId.MultiLotus,
    anchor: LOGICAL_CENTER,
    radius: 56,
    angleRad: 0,
    strokeColor: '#38bdf8',
    strokeWidth: 4,
    dash: null,
  });
  store.commitStampStrokes(stampStrokes, 'Loto');
  assert.equal(useMandalaStore.getState().wedges.length, stampStrokes.length);

  store.commitPolarGeneration({
    generatorId: PolarGeneratorId.RoseCurve,
    amplitudeRadius: 180,
    numerator: 5,
    denominator: 2,
    sampleSteps: 120,
  });
  assert.ok(useMandalaStore.getState().wedges.length > stampStrokes.length);

  store.setZoom(2.5, 600);
  store.setLensEnabled(true);
  store.setLensProfile(LensProfile.Kaleidoscope);
  store.setKaleidoscopeFolds(99);
  store.setKaleidoscopeTwist(-99);
  store.setHasCustomTexture(true);
  store.setLensAnimating(true);
  const kLens = useMandalaStore.getState().lens;
  assert.equal(kLens.enabled, true);
  assert.equal(kLens.profile, LensProfile.Kaleidoscope);
  assert.equal(kLens.kaleidoscopeFolds, KALEIDOSCOPE_LIMITS.maxFolds);
  assert.equal(kLens.kaleidoscopeTwist, KALEIDOSCOPE_LIMITS.minTwist);
  assert.equal(kLens.hasCustomTexture, true);

  // Entering Kinetic Morph mode turns off Lens and auto-seeds Slot A
  useMandalaStore.getState().enterKineticMode(KineticMode.Morph);
  const morphState = useMandalaStore.getState();
  assert.equal(morphState.kineticMode, KineticMode.Morph);
  assert.equal(morphState.lens.enabled, false);
  assert.ok(morphState.morphSlotA && morphState.morphSlotA.strokes.length > 0);

  morphState.captureMorphSlot(MorphSlotId.SlotB);
  assert.ok(useMandalaStore.getState().morphSlotB);
  assert.equal(useMandalaStore.getState().morphTargetKind, MorphTargetKind.UserSlotB);

  // Selecting drawing tool exits Kinetic/Lens back to Flat View (Preview-only mode)
  useMandalaStore.getState().setActiveTool(ToolId.Stamp);
  assert.equal(useMandalaStore.getState().kineticMode, KineticMode.Off);
  assert.equal(useMandalaStore.getState().lens.enabled, false);

  // Reset Settings restores camera=1.0, kinetic=Off, lens=default & clears custom texture while keeping strokes
  useMandalaStore.getState().setLensEnabled(true);
  useMandalaStore.getState().resetSettings();
  const afterReset = useMandalaStore.getState();
  assert.ok(afterReset.wedges.length > 0);
  assert.equal(afterReset.camera.zoom, 1.0);
  assert.equal(afterReset.kineticMode, KineticMode.Off);
  assert.equal(afterReset.lens.enabled, false);
  assert.equal(afterReset.lens.hasCustomTexture, false);
  assert.equal(afterReset.lens.profile, LensProfile.RefractiveGlass);
});

test('Cache Flush Hook: flushAllApplicationCaches reclaims registered GPU WebGL texture VRAM', async () => {
  let gpuCleared = false;
  const unregisterGpu = registerGpuTextureReclaimer(() => {
    gpuCleared = true;
    return 16 * 1024 * 1024;
  });

  const swap = createInMemorySwapAdapter();
  const res = await flushAllApplicationCaches(swap);
  unregisterGpu();

  assert.equal(gpuCleared, true);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.value.gpuTexturesCleared, 1);
    assert.ok(res.value.estimatedBytesFreed >= 16 * 1024 * 1024);
  }
});
