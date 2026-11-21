/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { withOffscreenCanvas, withTimedScope } from '../../../shared/lib/contextManager.ts';
import { createCachedJsGeometryEngine } from '../engine/geometryEngine.ts';
import {
  LOGICAL_CENTER,
  MANDALA_LIMITS,
  MEMORY_TIER_LIMITS,
} from '../model/constants.ts';
import {
  MemoryPressureLevel,
  MirrorMode,
  PaletteId,
  SymmetryStrategyKind,
  type MandalaDocument,
  type Point,
  type WedgeStroke,
} from '../model/types.ts';
import {
  SymmetryLruCache,
  buildSymmetryCacheKey,
} from './geometryCache.ts';
import {
  buildSceneMemoryReport,
  classifyMemoryPressure,
  estimateWedgeHeapBytes,
  partitionHotColdWedges,
} from './memoryBudget.ts';
import { TypedPointBuffer } from './pointBuffer.ts';
import {
  IndexedDbSwapAdapter,
  createInMemorySwapAdapter,
} from './swapStorage.ts';

function makeWedge(id: string, pointCount: number, seed: number = 0): WedgeStroke {
  const points: Point[] = [];
  for (let i = 0; i < pointCount; i++) {
    points.push({
      x: 400 + i * 2 + seed,
      y: 400 - i + seed * 0.5,
      pressure: 0.25 + ((i % 4) * 0.2),
    });
  }
  return {
    id,
    points,
    stroke: '#38bdf8',
    strokeWidth: 3.5,
    dash: null,
    opacity: 0.95,
  };
}

test('L0 TypedPointBuffer grows exponentially, computes average pressure, and pools on reset', () => {
  const buf = new TypedPointBuffer(16);
  assert.equal(buf.capacityPoints, 16);
  assert.equal(buf.averagePressure(), 0.5);

  for (let i = 0; i < 40; i++) {
    buf.push(100 + i, 200 - i, i % 2 === 0 ? 0.2 : 0.8);
  }

  assert.equal(buf.length, 40);
  assert.ok(buf.capacityPoints >= 40);
  assert.equal(buf.byteLength, buf.capacityPoints * MEMORY_TIER_LIMITS.l0PointStride * 4);
  assert.ok(Math.abs(buf.averagePressure() - 0.5) < 1e-5);

  const visited: number[] = [];
  buf.forEach((x, _y, _p, index) => {
    if (index < 3) visited.push(Math.round(x));
  });
  assert.deepEqual(visited, [100, 101, 102]);

  const materialized = buf.toPoints();
  assert.equal(materialized.length, 40);
  assert.equal(materialized[0]?.x, 100);
  assert.ok(Math.abs((materialized[1]?.pressure ?? 0) - 0.8) < 1e-5);

  const pooledCapacityBeforeReset = buf.capacityPoints;
  buf.reset();
  assert.equal(buf.length, 0);
  assert.equal(buf.capacityPoints, pooledCapacityBeforeReset);
});

test('L0 TypedPointBuffer releases oversized array when exceeding l0MaxPooledPoints', () => {
  const buf = new TypedPointBuffer(32);
  const exceedCount = MEMORY_TIER_LIMITS.l0MaxPooledPoints + 100;
  for (let i = 0; i < exceedCount; i++) {
    buf.push(i, i, 0.5);
  }
  assert.ok(buf.capacityPoints > MEMORY_TIER_LIMITS.l0MaxPooledPoints);

  buf.reset();
  assert.equal(buf.length, 0);
  assert.equal(buf.capacityPoints, 32);
});

test('L1 SymmetryLruCache enforces maxEntries and promotes MRU entries on get', () => {
  const cache = new SymmetryLruCache(2, 1024 * 1024);
  const params = {
    strategyId: SymmetryStrategyKind.Radial as const,
    order: 8,
  };
  const w1 = makeWedge('w1', 5, 1);
  const w2 = makeWedge('w2', 5, 2);
  const w3 = makeWedge('w3', 5, 3);

  const k1 = buildSymmetryCacheKey(w1, params, LOGICAL_CENTER);
  const k2 = buildSymmetryCacheKey(w2, params, LOGICAL_CENTER);
  const k3 = buildSymmetryCacheKey(w3, params, LOGICAL_CENTER);

  cache.set(k1, [w1]);
  cache.set(k2, [w2]);

  // Access k1 so k2 becomes the oldest (LRU) entry
  const hit1 = cache.get(k1);
  assert.equal(hit1?.[0]?.id, 'w1');

  // Insert k3 -> should evict k2, keeping k1 and k3
  cache.set(k3, [w3]);

  assert.equal(cache.get(k2), undefined);
  assert.equal(cache.get(k1)?.[0]?.id, 'w1');
  assert.equal(cache.get(k3)?.[0]?.id, 'w3');

  const stats = cache.getStats();
  assert.equal(stats.entries, 2);
  assert.equal(stats.evictions, 1);
  assert.equal(stats.hits, 3);
  assert.equal(stats.misses, 1);
});

test('L1 SymmetryLruCache enforces byte budget and engine bypasses ephemeral preview IDs', () => {
  const tightCache = new SymmetryLruCache(100, 3500);
  const engine = createCachedJsGeometryEngine(tightCache);
  const params = {
    strategyId: SymmetryStrategyKind.MirrorRadial as const,
    order: 8,
    mirrorMode: MirrorMode.Reflect,
  };

  // Ephemeral preview stroke must NOT enter L1 cache
  const preview = makeWedge('preview', 10);
  const previewRes = engine.expandStroke(preview, params);
  assert.equal(previewRes.ok, true);
  assert.equal(tightCache.getStats().entries, 0);
  assert.equal(tightCache.getStats().hits, 0);
  assert.equal(tightCache.getStats().misses, 0);

  // Committed stroke (16 strokes * (96 + 3*32) = 3072 bytes <= 3500) caches and hits
  const committed1 = makeWedge('committed-1', 3);
  const r1 = engine.expandStroke(committed1, params);
  const r2 = engine.expandStroke(committed1, params);
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  assert.equal(tightCache.getStats().misses, 1);
  assert.equal(tightCache.getStats().hits, 1);
  assert.equal(tightCache.getStats().hitRate, 0.5);

  // Second 3072-byte stroke forces byte-budget eviction of committed-1
  const committed2 = makeWedge('committed-2', 3);
  const r3 = engine.expandStroke(committed2, params);
  assert.equal(r3.ok, true);
  assert.equal(tightCache.getStats().entries, 1);
  assert.equal(tightCache.getStats().evictions, 1);

  // Oversized single entry (> maxBytes) is skipped without crashing or evicting existing
  const oversized = makeWedge('oversized-1', 30);
  assert.equal(engine.expandStroke(oversized, params).ok, true);
  assert.equal(tightCache.getStats().entries, 1);
});

test('L2 memoryBudget classifies pressure levels and partitions hot vs cold wedges', () => {
  assert.equal(classifyMemoryPressure(512), MemoryPressureLevel.Normal);
  assert.equal(
    classifyMemoryPressure(MEMORY_TIER_LIMITS.l2ElevatedBytes),
    MemoryPressureLevel.Elevated
  );
  assert.equal(
    classifyMemoryPressure(MEMORY_TIER_LIMITS.l2CriticalBytes),
    MemoryPressureLevel.Critical
  );

  const wedges = Array.from({ length: 12 }, (_, idx) => makeWedge(`w-${idx}`, 8));
  const allHot = partitionHotColdWedges(wedges, 20);
  assert.equal(allHot.hotWedges.length, 12);
  assert.equal(allHot.coldSwapCandidates.length, 0);

  const split = partitionHotColdWedges(wedges, 5);
  assert.equal(split.coldSwapCandidates.length, 7);
  assert.equal(split.hotWedges.length, 5);
  assert.equal(split.coldSwapCandidates[0]?.id, 'w-0');
  assert.equal(split.hotWedges[0]?.id, 'w-7');

  const cache = new SymmetryLruCache();
  const report = buildSceneMemoryReport({
    wedges,
    historyDepth: 12,
    l0BufferBytes: 3072,
    l1CacheStats: cache.getStats(),
  });
  assert.equal(report.l2WedgeHeapBytes, estimateWedgeHeapBytes(wedges));
  assert.equal(report.totalEstimatedBytes, 3072 + report.l2WedgeHeapBytes);
  assert.equal(report.pressureLevel, MemoryPressureLevel.Normal);
});

test('L3 SwapStoragePort round-trips documents and cold batches cleanly', async () => {
  const swap = createInMemorySwapAdapter();
  const emptyDoc = await swap.loadActiveDocument();
  assert.equal(emptyDoc.ok, true);
  if (emptyDoc.ok) {
    assert.equal(emptyDoc.value, null);
  }

  const doc: MandalaDocument = {
    schemaVersion: 1,
    title: 'Mandala Swap Test',
    symmetryParams: {
      strategyId: SymmetryStrategyKind.Radial,
      order: MANDALA_LIMITS.defaultOrder,
    },
    wedges: [makeWedge('w-swap-1', 6)],
    paletteId: PaletteId.OkabeIto,
    activeColour: '#38bdf8',
    activeStrokeWidth: 3.5,
    activeDash: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  const saveRes = await swap.saveActiveDocument(doc);
  assert.equal(saveRes.ok, true);

  const loaded = await swap.loadActiveDocument();
  assert.equal(loaded.ok, true);
  if (loaded.ok) {
    assert.equal(loaded.value?.title, 'Mandala Swap Test');
    assert.equal(loaded.value?.wedges.length, 1);
  }

  const batchWedges = [makeWedge('cold-1', 4), makeWedge('cold-2', 4)];
  assert.equal((await swap.swapOutColdBatch('batch-0', batchWedges)).ok, true);

  const restored = await swap.restoreColdBatch('batch-0');
  assert.equal(restored.ok, true);
  if (restored.ok) {
    assert.equal(restored.value?.wedges.length, 2);
    assert.equal(restored.value?.wedges[1]?.id, 'cold-2');
  }

  assert.equal((await swap.purgeColdBatch('batch-0')).ok, true);
  const afterPurge = await swap.restoreColdBatch('batch-0');
  assert.equal(afterPurge.ok, true);
  if (afterPurge.ok) {
    assert.equal(afterPurge.value, null);
  }

  // IndexedDB adapter returns clean Err when running outside browser environment
  const idbRes = await IndexedDbSwapAdapter.loadActiveDocument();
  assert.equal(idbRes.ok, false);
});

test('Context Managers measure timed scopes and fail gracefully without DOM', () => {
  const scoped = withTimedScope(() => {
    let acc = 0;
    for (let i = 0; i < 1000; i++) acc += i;
    return acc;
  });
  assert.equal(scoped.result, 499500);
  assert.ok(scoped.durationMs >= 0);

  const offscreenRes = withOffscreenCanvas(256, 256, () => 'unreachable');
  assert.equal(offscreenRes.ok, false);
});
