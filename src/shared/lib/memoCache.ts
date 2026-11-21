/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Smart Bounded LRU Memoizer & Global Cache Registry (DRY / Anti-Saturation).
 * Prevents unbounded heap growth via strict entry limits and optional TTL,
 * and registers every cache in a central registry for O(1) flushing or trimming.
 */

export interface BoundedMemoizerStats {
  readonly name: string;
  readonly entries: number;
  readonly maxEntries: number;
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
}

export interface ManagedCache {
  readonly name: string;
  clear(): number;
  trimToRatio(ratio: number): number;
  getEntryCount(): number;
}

export interface MemoizedFunction<Args extends readonly unknown[], R> {
  (...args: Args): R;
  clear(): void;
  trimToRatio(ratio: number): number;
  getStats(): BoundedMemoizerStats;
}

const MANAGED_CACHE_REGISTRY = new Set<ManagedCache>();

export function registerManagedCache(cache: ManagedCache): () => void {
  MANAGED_CACHE_REGISTRY.add(cache);
  return () => {
    MANAGED_CACHE_REGISTRY.delete(cache);
  };
}

/**
 * Flushes every registered cache/memoizer across the application, returning freed entry count.
 */
export function flushAllRegisteredCaches(): { cachesCleared: number; entriesFreed: number } {
  let cachesCleared = 0;
  let entriesFreed = 0;
  for (const cache of MANAGED_CACHE_REGISTRY) {
    entriesFreed += cache.clear();
    cachesCleared += 1;
  }
  return { cachesCleared, entriesFreed };
}

/**
 * Trims all registered caches proportionally (0..1) during Elevated/Critical memory pressure.
 */
export function trimAllRegisteredCaches(keepRatio: number): number {
  const clamped = Math.max(0, Math.min(1, keepRatio));
  let trimmed = 0;
  for (const cache of MANAGED_CACHE_REGISTRY) {
    trimmed += cache.trimToRatio(clamped);
  }
  return trimmed;
}

export function getRegisteredCachesSummary(): readonly { name: string; entries: number }[] {
  return Array.from(MANAGED_CACHE_REGISTRY, (c) => ({
    name: c.name,
    entries: c.getEntryCount(),
  }));
}

interface MemoSlot<R> {
  readonly value: R;
  readonly createdAt: number;
}

export interface BoundedMemoizerOptions {
  readonly name: string;
  readonly maxEntries: number;
  readonly ttlMs?: number;
}

/**
 * Wraps a pure computation in an O(1) bounded LRU memoizer registered for global cache flush.
 */
export function createBoundedMemoizer<Args extends readonly unknown[], R>(
  fn: (...args: Args) => R,
  keyFn: (...args: Args) => string,
  options: BoundedMemoizerOptions
): MemoizedFunction<Args, R> {
  const maxEntries = Math.max(1, options.maxEntries);
  const ttlMs = options.ttlMs ?? 0;
  const map = new Map<string, MemoSlot<R>>();
  let hits = 0;
  let misses = 0;
  let evictions = 0;

  const clear = (): number => {
    const count = map.size;
    map.clear();
    return count;
  };

  const trimToRatio = (ratio: number): number => {
    const targetSize = Math.max(0, Math.floor(map.size * ratio));
    let removed = 0;
    while (map.size > targetSize) {
      const oldestKey = map.keys().next().value;
      if (oldestKey === undefined) break;
      map.delete(oldestKey);
      removed += 1;
    }
    return removed;
  };

  registerManagedCache({
    name: options.name,
    clear,
    trimToRatio,
    getEntryCount: () => map.size,
  });

  const wrapped = ((...args: Args): R => {
    const key = keyFn(...args);
    const now = Date.now();
    const existing = map.get(key);

    if (existing !== undefined) {
      const expired = ttlMs > 0 && now - existing.createdAt > ttlMs;
      if (!expired) {
        map.delete(key);
        map.set(key, existing);
        hits += 1;
        return existing.value;
      }
      map.delete(key);
    }

    misses += 1;
    const computed = fn(...args);
    map.set(key, { value: computed, createdAt: now });

    while (map.size > maxEntries) {
      const oldestKey = map.keys().next().value;
      if (oldestKey === undefined) break;
      map.delete(oldestKey);
      evictions += 1;
    }

    return computed;
  }) as MemoizedFunction<Args, R>;

  wrapped.clear = () => {
    clear();
  };
  wrapped.trimToRatio = trimToRatio;
  wrapped.getStats = () => ({
    name: options.name,
    entries: map.size,
    maxEntries,
    hits,
    misses,
    evictions,
  });

  return wrapped;
}
