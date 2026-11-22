/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Crash & Hang Regression Guards:
 * 1) Sandboxed iframe SecurityError on localStorage getter/methods
 * 2) L-System base-only commit (no N^2 duplication) & pre-flight segment rejection
 * 3) PreparedMorphPlan parity and adaptive stroke cap
 * 4) SVG live-preview downsampling bound
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAMERA_LIMITS,
  LOGICAL_CENTER,
  MANDALA_LIMITS,
  MORPH_LIMITS,
  RESOURCE_GUARD_LIMITS,
  STORAGE_KEY_V1,
} from '../model/constants.ts';
import {
  LSystemPresetId,
  MirrorMode,
  SymmetryStrategyKind,
  type WedgeStroke,
} from '../model/types.ts';
import {
  buildMandalaDocument,
  clearSavedSessionStorage,
  hydrateInitialWorkspaceFromStorage,
  loadDocumentFromStorage,
} from './persistence.ts';
import { estimateLSystemComplexity } from './lsystem.ts';
import {
  interpolatePreparedMorph,
  interpolateStrokeScene,
  prepareMorphPlan,
} from './morphInterpolator.ts';
import { estimateExpandedSvgPrimitives, sampleWedgesForPreview } from './svgExport.ts';
import { useMandalaStore } from '../model/store.ts';

test('Sandbox SecurityError on window.localStorage getter never crashes boot or clear', async () => {
  const originalWindow = (globalThis as { window?: unknown }).window;
  const mockWindow = {};
  Object.defineProperty(mockWindow, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('SecurityError: The operation is insecure.');
    },
  });
  (globalThis as { window?: unknown }).window = mockWindow;

  try {
    const loaded = loadDocumentFromStorage();
    assert.equal(loaded.doc, null);
    assert.equal(loaded.warning, null);
    await clearSavedSessionStorage();
  } finally {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  }
});

test('Store commits 1x base fractal polylines (no N^2 duplication) and blocks Gen 6 pre-flight', async () => {
  const store = useMandalaStore.getState();
  await store.resetWorkspaceAll();
  store.setSymmetryOrder(9);

  // SacredFlower Gen 5 at N=9 -> 3,125 base segments * 9 = 28,125 <= 35,000 (allowed)
  store.commitFractalGeneration(LSystemPresetId.SacredFlower, 5, 36, 20);
  const afterG5 = useMandalaStore.getState();
  assert.equal(afterG5.guardAlert, null);
  assert.ok(afterG5.wedges.length > 0);
  // Base-only storage means wedges.length equals 1x base polylines (~1,875-1,960), NOT 9x (~17,000+)
  assert.ok(
    afterG5.wedges.length < 2500,
    `Expected 1x base fractal polylines (<2500), got ${afterG5.wedges.length}`
  );

  // SacredFlower Gen 6 at N=9 -> 15,625 * 9 = 140,625 > 35,000 (rejected pre-flight)
  const preComplexity = estimateLSystemComplexity('F', { F: 'F[+F]F[-F][F]' }, 6);
  assert.ok(preComplexity.moveSegments * 9 > RESOURCE_GUARD_LIMITS.maxFractalSegmentsAllowed);

  const beforeLen = afterG5.wedges.length;
  store.commitFractalGeneration(LSystemPresetId.SacredFlower, 6, 36, 20);
  const afterG6 = useMandalaStore.getState();
  assert.equal(afterG6.wedges.length, beforeLen);
  assert.ok(typeof afterG6.guardAlert === 'string' && afterG6.guardAlert.length > 0);

  await store.resetWorkspaceAll();
});

test('PreparedMorphPlan matches interpolateStrokeScene and honors adaptive stroke cap', () => {
  const mkStroke = (id: string, xOffset: number): WedgeStroke => ({
    id,
    points: [
      { x: 400 + xOffset, y: 260 },
      { x: 420 + xOffset, y: 310 },
      { x: 440 + xOffset, y: 280 },
    ],
    stroke: '#38bdf8',
    strokeWidth: 3,
    dash: null,
    opacity: 0.9,
  });

  const from = Array.from({ length: 120 }, (_, i) => mkStroke(`f_${i}`, i));
  const to = Array.from({ length: 120 }, (_, i) => mkStroke(`t_${i}`, i + 15));

  const fullPlan = prepareMorphPlan(from, to, LOGICAL_CENTER, MORPH_LIMITS.resampledPointCount, 120);
  const viaPlan = interpolatePreparedMorph(fullPlan, 0.42);
  const viaDirect = interpolateStrokeScene(from, to, 0.42);
  assert.equal(viaPlan.length, viaDirect.length);
  assert.ok(viaPlan[0] && viaDirect[0]);
  assert.deepEqual(viaPlan[0].points, viaDirect[0].points);
  assert.equal(viaPlan[0].stroke, viaDirect[0].stroke);

  const cappedPlan = prepareMorphPlan(from, to, LOGICAL_CENTER, MORPH_LIMITS.resampledPointCount, 60);
  const capped = interpolatePreparedMorph(cappedPlan, 0.5);
  assert.equal(capped.length, 60);
});

test('sampleWedgesForPreview keeps heavy MirrorRadial scenes under expanded primitive cap', () => {
  const wedges: WedgeStroke[] = Array.from({ length: 600 }, (_, i) => ({
    id: `w_${i}`,
    points: [
      { x: 400, y: 200 },
      { x: 430, y: 240 },
    ],
    stroke: '#38bdf8',
    strokeWidth: 2,
    dash: null,
    opacity: 1,
  }));
  const mirror24 = {
    strategyId: SymmetryStrategyKind.MirrorRadial,
    order: 24,
    mirrorMode: MirrorMode.Reflect,
  } as const;

  const sampled = sampleWedgesForPreview(
    wedges,
    mirror24,
    RESOURCE_GUARD_LIMITS.svgLivePreviewMaxExpandedPrimitives
  );
  const expandedCount = estimateExpandedSvgPrimitives(sampled, mirror24);
  assert.ok(sampled.length < wedges.length);
  assert.ok(expandedCount <= RESOURCE_GUARD_LIMITS.svgLivePreviewMaxExpandedPrimitives);
});

test('loadDocumentFromStorage quarantines oversized localStorage JSON before Zod parse', () => {
  const originalWindow = (globalThis as { window?: unknown }).window;
  const backing = new Map<string, string>();
  const oversizedPayload = 'x'.repeat(
    Math.ceil(RESOURCE_GUARD_LIMITS.maxLocalStorageJsonBytes * 1.15)
  );
  backing.set(STORAGE_KEY_V1, oversizedPayload);

  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => {
        backing.set(k, v);
      },
      removeItem: (k: string) => {
        backing.delete(k);
      },
    },
  };

  try {
    const loaded = loadDocumentFromStorage();
    assert.equal(loaded.doc, null);
    assert.ok(typeof loaded.warning === 'string' && loaded.warning.length > 0);
    assert.equal(backing.has(STORAGE_KEY_V1), false);
  } finally {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  }
});

test('hydrateInitialWorkspaceFromStorage rejects over-budget stored session and clamps valid extremes', () => {
  const heavyWedges: WedgeStroke[] = Array.from({ length: 5000 }, (_, i) => ({
    id: `heavy_${i}`,
    points: [
      { x: 400, y: 200 },
      { x: 420, y: 240 },
    ],
    stroke: '#38bdf8',
    strokeWidth: 2,
    dash: null,
    opacity: 0.9,
  }));

  const overBudgetDoc = buildMandalaDocument({
    wedges: heavyWedges,
    symmetryParams: {
      strategyId: SymmetryStrategyKind.MirrorRadial,
      order: 24,
      mirrorMode: MirrorMode.Reflect,
    },
    paletteId: 'okabe-ito',
    activeColour: '#56B4E9',
    activeStrokeWidth: 3.5,
    activeDash: null,
  });

  let quarantined = false;
  const rejectedSeed = hydrateInitialWorkspaceFromStorage(
    { doc: overBudgetDoc, warning: null },
    () => {
      quarantined = true;
    }
  );
  assert.equal(quarantined, true);
  assert.equal(rejectedSeed.wedges.length, 0);
  assert.ok(typeof rejectedSeed.warning === 'string' && rejectedSeed.warning.length > 0);

  const safeDoc = buildMandalaDocument({
    wedges: heavyWedges.slice(0, 10),
    symmetryParams: { strategyId: SymmetryStrategyKind.Radial, order: 8 },
    paletteId: 'okabe-ito',
    activeColour: '#56B4E9',
    activeStrokeWidth: MANDALA_LIMITS.schemaDocMaxStrokeWidth,
    activeDash: null,
    camera: { zoom: CAMERA_LIMITS.maxZoom, panX: 999999, panY: -999999 },
  });

  const acceptedSeed = hydrateInitialWorkspaceFromStorage({ doc: safeDoc, warning: null });
  assert.equal(acceptedSeed.wedges.length, 10);
  assert.equal(acceptedSeed.strokeWidth, MANDALA_LIMITS.maxStrokeWidth);
  assert.ok(Math.abs(acceptedSeed.camera.panX) < 5000);
  assert.ok(Math.abs(acceptedSeed.camera.panY) < 5000);
});
