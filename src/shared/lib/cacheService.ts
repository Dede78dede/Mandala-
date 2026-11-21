/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Application Cache Flush & Reclamation Service.
 * Unifies cleanup across L0 typed buffers, L1 geometry LRU, bounded memoizers,
 * offscreen render snapshots, L3 IndexedDB cold batches, and Workbox CacheStorage.
 */

import { ok, type Result } from './result.ts';
import { flushAllRegisteredCaches } from './memoCache.ts';
import type { FlushCacheReport } from '../../features/mandala/model/types.ts';
import { SHARED_SYMMETRY_CACHE } from '../../features/mandala/memory/geometryCache.ts';
import { IndexedDbSwapAdapter, type SwapStoragePort } from '../../features/mandala/memory/swapStorage.ts';
import { resetCpuTelemetry } from '../../features/mandala/lib/resourceGuard.ts';

type BufferReclaimHook = () => number;
type RenderSnapshotClearHook = () => number;
type GpuTextureReclaimHook = () => number;

const BUFFER_RECLAIMERS = new Set<BufferReclaimHook>();
const RENDER_SNAPSHOT_CLEARERS = new Set<RenderSnapshotClearHook>();
const GPU_TEXTURE_RECLAIMERS = new Set<GpuTextureReclaimHook>();

export function registerBufferReclaimer(hook: BufferReclaimHook): () => void {
  BUFFER_RECLAIMERS.add(hook);
  return () => {
    BUFFER_RECLAIMERS.delete(hook);
  };
}

export function registerRenderSnapshotClearer(hook: RenderSnapshotClearHook): () => void {
  RENDER_SNAPSHOT_CLEARERS.add(hook);
  return () => {
    RENDER_SNAPSHOT_CLEARERS.delete(hook);
  };
}

export function registerGpuTextureReclaimer(hook: GpuTextureReclaimHook): () => void {
  GPU_TEXTURE_RECLAIMERS.add(hook);
  return () => {
    GPU_TEXTURE_RECLAIMERS.delete(hook);
  };
}

export async function flushAllApplicationCaches(
  swapPort: SwapStoragePort = IndexedDbSwapAdapter
): Promise<Result<FlushCacheReport, string>> {
  const l1Before = SHARED_SYMMETRY_CACHE.getStats();
  const l1EntriesCleared = l1Before.entries;
  let estimatedBytesFreed = l1Before.bytesUsed;

  for (const reclaim of BUFFER_RECLAIMERS) {
    estimatedBytesFreed += reclaim();
  }

  let renderSnapshotsCleared = 0;
  for (const clearSnapshot of RENDER_SNAPSHOT_CLEARERS) {
    renderSnapshotsCleared += clearSnapshot();
  }

  let gpuTexturesCleared = 0;
  for (const reclaimGpu of GPU_TEXTURE_RECLAIMERS) {
    const freed = reclaimGpu();
    if (freed > 0) {
      gpuTexturesCleared += 1;
      estimatedBytesFreed += freed;
    }
  }

  const { entriesFreed } = flushAllRegisteredCaches();
  const memoEntriesCleared = Math.max(0, entriesFreed - l1EntriesCleared);

  let coldBatchesCleared = 0;
  const coldRes = await swapPort.clearAllColdBatches();
  if (coldRes.ok) {
    coldBatchesCleared = coldRes.value;
  }

  let browserCachesDeleted = 0;
  if (typeof caches !== 'undefined' && typeof caches.keys === 'function') {
    try {
      const keys = await caches.keys();
      for (const k of keys) {
        const deleted = await caches.delete(k);
        if (deleted) browserCachesDeleted += 1;
      }
    } catch {
      // CacheStorage restricted or unavailable in current origin
    }
  }

  resetCpuTelemetry();

  return ok({
    l1EntriesCleared,
    memoEntriesCleared,
    renderSnapshotsCleared,
    gpuTexturesCleared,
    browserCachesDeleted,
    coldBatchesCleared,
    estimatedBytesFreed,
    flushedAt: new Date().toISOString(),
  });
}
