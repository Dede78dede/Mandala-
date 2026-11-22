/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tier L1 — Bounded O(1) LRU Symmetry Geometry Cache.
 * Caches expanded symmetric stroke arrays across repaints, eraser hit-tests, and exports
 * within strict entry-count and byte budgets.
 */

import { registerManagedCache } from '../../../shared/lib/memoCache.ts';
import { MEMORY_TIER_LIMITS } from '../model/constants.ts';
import { STRATEGY_REGISTRY } from '../strategies/symmetry.ts';
import type {
  Point,
  SymmetryParams,
  WedgeStroke,
} from '../model/types.ts';

export interface LruCacheStats {
  readonly entries: number;
  readonly bytesUsed: number;
  readonly maxEntries: number;
  readonly maxBytes: number;
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
  readonly hitRate: number;
}

interface CacheEntry {
  readonly value: readonly WedgeStroke[];
  readonly estimatedBytes: number;
}

const BYTES_PER_POINT = 32;
const BYTES_PER_STROKE_OVERHEAD = 96;

export function estimateExpandedStrokesBytes(strokes: readonly WedgeStroke[]): number {
  let total = 0;
  for (const s of strokes) {
    total += BYTES_PER_STROKE_OVERHEAD + s.points.length * BYTES_PER_POINT;
  }
  return total;
}

export function symmetrySignature(params: SymmetryParams, center: Point): string {
  const strategy = STRATEGY_REGISTRY[params.strategyId];
  return strategy
    ? strategy.buildCacheSignature(params, center)
    : `${params.strategyId}|${params.order}|${center.x}:${center.y}`;
}

export function buildSymmetryCacheKey(
  wedge: WedgeStroke,
  params: SymmetryParams,
  center: Point
): string {
  const firstPt = wedge.points[0];
  const lastPt = wedge.points[wedge.points.length - 1];
  const anchorSig = firstPt && lastPt
    ? `${firstPt.x.toFixed(1)},${firstPt.y.toFixed(1)}-${lastPt.x.toFixed(1)},${lastPt.y.toFixed(1)}`
    : 'empty';
  return `${wedge.id}|${wedge.points.length}|${wedge.stroke}|${wedge.strokeWidth}|${anchorSig}|${symmetrySignature(params, center)}`;
}

export class SymmetryLruCache {
  private readonly store = new Map<string, CacheEntry>();
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private currentBytes: number = 0;
  private hits: number = 0;
  private misses: number = 0;
  private evictions: number = 0;

  constructor(
    maxEntries: number = MEMORY_TIER_LIMITS.l1MaxEntries,
    maxBytes: number = MEMORY_TIER_LIMITS.l1MaxBytes
  ) {
    this.maxEntries = Math.max(1, maxEntries);
    this.maxBytes = Math.max(1024, maxBytes);
  }

  get(key: string): readonly WedgeStroke[] | undefined {
    const existing = this.store.get(key);
    if (!existing) {
      this.misses += 1;
      return undefined;
    }
    // Promote to most-recently-used via O(1) delete+set in Map insertion order
    this.store.delete(key);
    this.store.set(key, existing);
    this.hits += 1;
    return existing.value;
  }

  set(key: string, value: readonly WedgeStroke[]): void {
    const estimatedBytes = estimateExpandedStrokesBytes(value);
    if (estimatedBytes > this.maxBytes) {
      return;
    }

    const existing = this.store.get(key);
    if (existing) {
      this.currentBytes -= existing.estimatedBytes;
      this.store.delete(key);
    }

    this.store.set(key, { value, estimatedBytes });
    this.currentBytes += estimatedBytes;
    this.evictIfNeeded();
  }

  clear(): number {
    const count = this.store.size;
    this.store.clear();
    this.currentBytes = 0;
    return count;
  }

  trimToRatio(ratio: number): number {
    const targetEntries = Math.max(0, Math.floor(this.store.size * Math.max(0, Math.min(1, ratio))));
    let removed = 0;
    while (this.store.size > targetEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey === undefined) break;
      const oldest = this.store.get(oldestKey);
      this.store.delete(oldestKey);
      if (oldest) {
        this.currentBytes -= oldest.estimatedBytes;
      }
      this.evictions += 1;
      removed += 1;
    }
    return removed;
  }

  getStats(): LruCacheStats {
    const totalLookups = this.hits + this.misses;
    return {
      entries: this.store.size,
      bytesUsed: this.currentBytes,
      maxEntries: this.maxEntries,
      maxBytes: this.maxBytes,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      hitRate: totalLookups > 0 ? this.hits / totalLookups : 0,
    };
  }

  private evictIfNeeded(): void {
    while (
      this.store.size > this.maxEntries ||
      this.currentBytes > this.maxBytes
    ) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey === undefined) break;
      const oldest = this.store.get(oldestKey);
      this.store.delete(oldestKey);
      if (oldest) {
        this.currentBytes -= oldest.estimatedBytes;
      }
      this.evictions += 1;
    }
  }
}

export const SHARED_SYMMETRY_CACHE = new SymmetryLruCache();

registerManagedCache({
  name: 'L1_SYMMETRY_CACHE',
  clear: () => SHARED_SYMMETRY_CACHE.clear(),
  trimToRatio: (ratio) => SHARED_SYMMETRY_CACHE.trimToRatio(ratio),
  getEntryCount: () => SHARED_SYMMETRY_CACHE.getStats().entries,
});
