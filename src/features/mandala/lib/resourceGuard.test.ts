/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBoundedMemoizer,
  flushAllRegisteredCaches,
} from '../../../shared/lib/memoCache.ts';
import {
  flushAllApplicationCaches,
  registerBufferReclaimer,
} from '../../../shared/lib/cacheService.ts';
import { RESOURCE_GUARD_LIMITS } from '../model/constants.ts';
import {
  CpuLoadState,
  MemoryPressureLevel,
  ResourceGuardErrorCode,
  SymmetryStrategyKind,
  type Point,
  type WedgeStroke,
} from '../model/types.ts';
import { TypedPointBuffer } from '../memory/pointBuffer.ts';
import { SHARED_SYMMETRY_CACHE } from '../memory/geometryCache.ts';
import { createInMemorySwapAdapter } from '../memory/swapStorage.ts';
import { renderSceneToPixelBuffer } from '../engine/pixelBufferEscapeHatch.ts';
import {
  enforceAntiSaturationSafeguards,
  evaluateWorkloadAdmission,
  getResourceHealthSnapshot,
  recordCpuRenderSample,
  resetCpuTelemetry,
} from './resourceGuard.ts';

function makeHeavyWedge(id: string, pointCount: number): WedgeStroke {
  const points: Point[] = [];
  for (let i = 0; i < pointCount; i++) {
    points.push({ x: 300 + (i % 100), y: 300 + (i % 80), pressure: 0.5 });
  }
  return {
    id,
    points,
    stroke: '#38bdf8',
    strokeWidth: 3,
    dash: null,
    opacity: 0.95,
  };
}

test('Bounded LRU memoizer limits entries, tracks hits/misses, and clears on global flush', () => {
  let calls = 0;
  const memoSquare = createBoundedMemoizer(
    (n: number) => {
      calls += 1;
      return n * n;
    },
    (n) => String(n),
    { name: 'test_square', maxEntries: 2 }
  );

  assert.equal(memoSquare(3), 9);
  assert.equal(memoSquare(3), 9);
  assert.equal(calls, 1);

  assert.equal(memoSquare(4), 16);
  assert.equal(memoSquare(5), 25); // evicts 3
  assert.equal(memoSquare.getStats().evictions, 1);

  const flushed = flushAllRegisteredCaches();
  assert.ok(flushed.entriesFreed >= 2);
  assert.equal(memoSquare.getStats().entries, 0);
});

test('TypedPointBuffer decimates micro-jitter via pushIfMoved and frees heap on reclaim()', () => {
  const buf = new TypedPointBuffer(16);
  assert.equal(buf.pushIfMoved(100, 100, 0.5, 4), true);
  assert.equal(buf.pushIfMoved(100.5, 100.5, 0.5, 4), false); // distance^2 = 0.5 < 4
  assert.equal(buf.pushIfMoved(105, 100, 0.5, 4), true); // distance^2 = 25 >= 4
  assert.equal(buf.length, 2);

  for (let i = 0; i < 64; i++) {
    buf.push(110 + i * 3, 120, 0.5);
  }
  assert.ok(buf.capacityPoints >= 64);

  const freed = buf.reclaim();
  assert.ok(freed > 0);
  assert.equal(buf.length, 0);
  assert.equal(buf.capacityPoints, 16);
});

test('Workload Admission Gate blocks Over-Memory and Over-CPU workloads deterministically', () => {
  const baseParams = { strategyId: SymmetryStrategyKind.Radial as const, order: 8 };

  const safeRes = evaluateWorkloadAdmission({
    currentWedges: [makeHeavyWedge('ok1', 20)],
    incomingWedges: [makeHeavyWedge('ok2', 20)],
    symmetryParams: baseParams,
  });
  assert.equal(safeRes.ok, true);

  const overPointsRes = evaluateWorkloadAdmission({
    currentWedges: [makeHeavyWedge('huge1', RESOURCE_GUARD_LIMITS.maxScenePoints)],
    incomingWedges: [makeHeavyWedge('huge2', 10)],
    symmetryParams: baseParams,
  });
  assert.equal(overPointsRes.ok, false);
  if (!overPointsRes.ok) {
    assert.equal(overPointsRes.error.code, ResourceGuardErrorCode.OverMemoryPoints);
  }

  // At order = 48, maxExpandedPrimitivesPerFrame = 60,000 => > 1,250 wedges triggers CPU guard
  const manyWedges = Array.from({ length: 1300 }, (_, i) => makeHeavyWedge(`cpu-${i}`, 2));
  const overCpuRes = evaluateWorkloadAdmission({
    currentWedges: manyWedges,
    incomingWedges: [],
    symmetryParams: { strategyId: SymmetryStrategyKind.Radial, order: 48 },
  });
  assert.equal(overCpuRes.ok, false);
  if (!overCpuRes.ok) {
    assert.equal(overCpuRes.error.code, ResourceGuardErrorCode.OverCpuPrimitives);
  }
});

test('Anti-saturation auto-safeguard trims history and L1 cache under Elevated/Critical memory pressure', () => {
  SHARED_SYMMETRY_CACHE.clear();
  const filler = makeHeavyWedge('cache-fill', 10);
  SHARED_SYMMETRY_CACHE.set('k1', [filler]);
  SHARED_SYMMETRY_CACHE.set('k2', [filler]);
  SHARED_SYMMETRY_CACHE.set('k3', [filler]);
  SHARED_SYMMETRY_CACHE.set('k4', [filler]);

  // ~70,000 points * 32B > 2 MiB -> Elevated pressure
  const denseWedges = [makeHeavyWedge('dense-l2', 70_000)];
  const fakeUndo = Array.from({ length: 30 }, (_, i) => ({
    id: `u_${i}`,
    label: `Cmd ${i}`,
    do: () => undefined,
    undo: () => undefined,
  }));

  const guarded = enforceAntiSaturationSafeguards({
    wedges: denseWedges,
    undoStack: fakeUndo,
    redoStack: fakeUndo,
  });

  assert.equal(guarded.pressure, MemoryPressureLevel.Elevated);
  assert.equal(guarded.undoStack.length, RESOURCE_GUARD_LIMITS.maxHistoryCommandsUnderPressure);
  assert.ok(guarded.trimmedHistoryCount > 0);
  assert.ok(guarded.trimmedCacheEntries >= 2);
});

test('CPU render telemetry transitions Nominal -> Elevated -> Protected and resets cleanly', () => {
  resetCpuTelemetry();
  let t = recordCpuRenderSample(4);
  assert.equal(t.cpuLoadState, CpuLoadState.Nominal);

  for (let i = 0; i < 6; i++) {
    t = recordCpuRenderSample(25);
  }
  assert.equal(t.cpuLoadState, CpuLoadState.Elevated);

  for (let i = 0; i < 8; i++) {
    t = recordCpuRenderSample(80);
  }
  assert.equal(t.cpuLoadState, CpuLoadState.Protected);

  const snap = getResourceHealthSnapshot([], {
    strategyId: SymmetryStrategyKind.Radial,
    order: 8,
  });
  assert.equal(snap.cpuLoadState, CpuLoadState.Protected);

  resetCpuTelemetry();
  assert.equal(
    getResourceHealthSnapshot([], { strategyId: SymmetryStrategyKind.Radial, order: 8 })
      .cpuLoadState,
    CpuLoadState.Nominal
  );
});

test('flushAllApplicationCaches clears L0 reclaimers, L1 cache, memoizers, and L3 swap batches', async () => {
  const buf = new TypedPointBuffer(16);
  for (let i = 0; i < 64; i++) buf.push(i, i, 0.5);
  const unregister = registerBufferReclaimer(() => buf.reclaim());

  const swap = createInMemorySwapAdapter();
  await swap.swapOutColdBatch('batch-old', [makeHeavyWedge('cold', 4)]);
  SHARED_SYMMETRY_CACHE.set('flush-test', [makeHeavyWedge('l1', 4)]);

  const flushRes = await flushAllApplicationCaches(swap);
  unregister();

  assert.equal(flushRes.ok, true);
  if (flushRes.ok) {
    assert.ok(flushRes.value.l1EntriesCleared >= 1);
    assert.equal(flushRes.value.coldBatchesCleared, 1);
    assert.ok(flushRes.value.estimatedBytesFreed > 0);
  }
  assert.equal(buf.capacityPoints, 16);
  assert.equal(SHARED_SYMMETRY_CACHE.getStats().entries, 0);
});

test('PixelBufferEscapeHatch aborts gracefully when CPU budget is exhausted', () => {
  const manyWedges = Array.from({ length: 120 }, (_, i) => makeHeavyWedge(`pb-${i}`, 6));
  const out = renderSceneToPixelBuffer(
    manyWedges,
    { strategyId: SymmetryStrategyKind.Radial, order: 4 },
    200,
    200,
    0
  );
  assert.equal(out.cpuBudgetAborted, true);
});
