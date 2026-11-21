/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tier L2 — Active Heap Budget Estimator & Hot/Cold Wedge Partitioner.
 * Quantifies JS heap usage across active wedges + undo/redo command stacks and
 * computes deterministic hot/cold partitions for L3 swap-out.
 */

import { MEMORY_TIER_LIMITS } from '../model/constants.ts';
import {
  MemoryPressureLevel,
  type WedgeStroke,
} from '../model/types.ts';
import { estimateExpandedStrokesBytes, type LruCacheStats } from './geometryCache.ts';

export interface SceneMemoryReport {
  readonly l0BufferBytes: number;
  readonly l1CacheStats: LruCacheStats;
  readonly l2WedgeHeapBytes: number;
  readonly l2HistoryCommands: number;
  readonly totalEstimatedBytes: number;
  readonly pressureLevel: MemoryPressureLevel;
  readonly hotWedgeCount: number;
  readonly coldSwapCandidateCount: number;
}

export interface HotColdPartition {
  readonly hotWedges: readonly WedgeStroke[];
  readonly coldSwapCandidates: readonly WedgeStroke[];
}

export function estimateWedgeHeapBytes(wedges: readonly WedgeStroke[]): number {
  return estimateExpandedStrokesBytes(wedges);
}

export function classifyMemoryPressure(totalBytes: number): MemoryPressureLevel {
  if (totalBytes >= MEMORY_TIER_LIMITS.l2CriticalBytes) {
    return MemoryPressureLevel.Critical;
  }
  if (totalBytes >= MEMORY_TIER_LIMITS.l2ElevatedBytes) {
    return MemoryPressureLevel.Elevated;
  }
  return MemoryPressureLevel.Normal;
}

/**
 * Keeps the most recent `hotLimit` wedges in L2 active memory and flags older slices
 * as deterministic candidates for L3 cold swap / offscreen raster baking.
 */
export function partitionHotColdWedges(
  wedges: readonly WedgeStroke[],
  hotLimit: number = MEMORY_TIER_LIMITS.l2HotWedgeLimit
): HotColdPartition {
  if (wedges.length <= hotLimit) {
    return { hotWedges: wedges, coldSwapCandidates: [] };
  }
  const splitIndex = wedges.length - hotLimit;
  return {
    coldSwapCandidates: wedges.slice(0, splitIndex),
    hotWedges: wedges.slice(splitIndex),
  };
}

export function buildSceneMemoryReport(params: {
  wedges: readonly WedgeStroke[];
  historyDepth: number;
  l0BufferBytes: number;
  l1CacheStats: LruCacheStats;
}): SceneMemoryReport {
  const l2WedgeHeapBytes = estimateWedgeHeapBytes(params.wedges);
  const totalEstimatedBytes =
    params.l0BufferBytes + params.l1CacheStats.bytesUsed + l2WedgeHeapBytes;
  const partition = partitionHotColdWedges(params.wedges);

  return {
    l0BufferBytes: params.l0BufferBytes,
    l1CacheStats: params.l1CacheStats,
    l2WedgeHeapBytes,
    l2HistoryCommands: params.historyDepth,
    totalEstimatedBytes,
    pressureLevel: classifyMemoryPressure(totalEstimatedBytes),
    hotWedgeCount: partition.hotWedges.length,
    coldSwapCandidateCount: partition.coldSwapCandidates.length,
  };
}
