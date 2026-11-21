/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Anti-Saturation, Over-Memory & Over-CPU Security Guardrails (PEP-compliant clean module).
 * - Workload Admission Gate before heavy strokes / fractals / JSON imports
 * - Rolling CPU frame-budget EWMA tracker (Nominal / Elevated / Protected)
 * - Deterministic Anti-Saturation planner trimming undo/redo & L1/memo caches under pressure
 */

import { ok, err, type Result } from '../../../shared/lib/result.ts';
import { trimAllRegisteredCaches } from '../../../shared/lib/memoCache.ts';
import { RESOURCE_GUARD_LIMITS } from '../model/constants.ts';
import {
  CpuLoadState,
  MemoryPressureLevel,
  ResourceGuardErrorCode,
  type HistoryCommand,
  type ResourceHealthSnapshot,
  type SymmetryParams,
  type WedgeStroke,
} from '../model/types.ts';
import { STRATEGY_REGISTRY } from '../strategies/symmetry.ts';
import { SHARED_SYMMETRY_CACHE } from '../memory/geometryCache.ts';
import { classifyMemoryPressure, estimateWedgeHeapBytes } from '../memory/memoryBudget.ts';

export interface WorkloadAdmissionError {
  readonly code: ResourceGuardErrorCode;
  readonly message: string;
}

export interface CpuTelemetryState {
  readonly lastRenderMs: number;
  readonly emaRenderMs: number;
  readonly peakRenderMs: number;
  readonly cpuLoadState: CpuLoadState;
}

let lastRenderMs = 0;
let emaRenderMs = 0;
let peakRenderMs = 0;

export function countPointsInWedges(wedges: readonly WedgeStroke[]): number {
  let total = 0;
  for (const w of wedges) {
    total += w.points.length;
  }
  return total;
}

export function classifyCpuLoadState(lastMs: number, emaMs: number): CpuLoadState {
  if (
    emaMs >= RESOURCE_GUARD_LIMITS.cpuCircuitBreakerMs ||
    lastMs >= RESOURCE_GUARD_LIMITS.cpuCircuitBreakerMs * 1.5
  ) {
    return CpuLoadState.Protected;
  }
  if (emaMs > RESOURCE_GUARD_LIMITS.cpuFrameBudgetMs) {
    return CpuLoadState.Elevated;
  }
  return CpuLoadState.Nominal;
}

export function recordCpuRenderSample(durationMs: number): CpuTelemetryState {
  const safeMs = Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : 0;
  lastRenderMs = safeMs;
  emaRenderMs = emaRenderMs === 0 ? safeMs : emaRenderMs * 0.75 + safeMs * 0.25;
  peakRenderMs = Math.max(peakRenderMs, safeMs);
  return getCpuTelemetry();
}

export function getCpuTelemetry(): CpuTelemetryState {
  return {
    lastRenderMs: Number(lastRenderMs.toFixed(2)),
    emaRenderMs: Number(emaRenderMs.toFixed(2)),
    peakRenderMs: Number(peakRenderMs.toFixed(2)),
    cpuLoadState: classifyCpuLoadState(lastRenderMs, emaRenderMs),
  };
}

export function resetCpuTelemetry(): void {
  lastRenderMs = 0;
  emaRenderMs = 0;
  peakRenderMs = 0;
}

/**
 * Pre-flight Security Gate preventing Over-Memory or Over-CPU workloads before mutation.
 */
export function evaluateWorkloadAdmission(params: {
  readonly currentWedges: readonly WedgeStroke[];
  readonly incomingWedges: readonly WedgeStroke[];
  readonly symmetryParams: SymmetryParams;
}): Result<void, WorkloadAdmissionError> {
  const nextWedgeCount = params.currentWedges.length + params.incomingWedges.length;
  if (nextWedgeCount > RESOURCE_GUARD_LIMITS.maxSceneWedges) {
    return err({
      code: ResourceGuardErrorCode.OverSceneWedges,
      message: `Limite sicurezza CPU/Scena raggiunto: ${nextWedgeCount} tratti superano il tetto massimo di ${RESOURCE_GUARD_LIMITS.maxSceneWedges}. Esegui Flush Cache o pulisci la tela.`,
    });
  }

  const totalPoints =
    countPointsInWedges(params.currentWedges) + countPointsInWedges(params.incomingWedges);
  if (totalPoints > RESOURCE_GUARD_LIMITS.maxScenePoints) {
    return err({
      code: ResourceGuardErrorCode.OverMemoryPoints,
      message: `Protezione Anti Over-Memory: ${totalPoints.toLocaleString()} punti superano il limite sicuro di ${RESOURCE_GUARD_LIMITS.maxScenePoints.toLocaleString()} punti.`,
    });
  }

  const estimatedBytes =
    estimateWedgeHeapBytes(params.currentWedges) + estimateWedgeHeapBytes(params.incomingWedges);
  if (estimatedBytes > RESOURCE_GUARD_LIMITS.l2HardMaxBytes) {
    return err({
      code: ResourceGuardErrorCode.OverMemoryHeap,
      message: `Protezione Anti Over-Memory: stima heap ${(estimatedBytes / (1024 * 1024)).toFixed(1)} MB oltre la soglia di ${(RESOURCE_GUARD_LIMITS.l2HardMaxBytes / (1024 * 1024)).toFixed(0)} MB.`,
    });
  }

  const strategy = STRATEGY_REGISTRY[params.symmetryParams.strategyId];
  const multiplier = strategy
    ? strategy.expansionMultiplier(params.symmetryParams.order)
    : params.symmetryParams.order;
  const expandedPrimitives = nextWedgeCount * multiplier;

  if (expandedPrimitives > RESOURCE_GUARD_LIMITS.maxExpandedPrimitivesPerFrame) {
    return err({
      code: ResourceGuardErrorCode.OverCpuPrimitives,
      message: `Protezione Anti Over-CPU: ${expandedPrimitives.toLocaleString()} primitive simmetriche superano il budget massimo di ${RESOURCE_GUARD_LIMITS.maxExpandedPrimitivesPerFrame.toLocaleString()} per frame.`,
    });
  }

  return ok(undefined);
}

/**
 * Trims undo/redo history and bounded caches automatically when memory pressure rises.
 */
export function enforceAntiSaturationSafeguards(params: {
  readonly wedges: readonly WedgeStroke[];
  readonly undoStack: readonly HistoryCommand[];
  readonly redoStack: readonly HistoryCommand[];
}): {
  readonly pressure: MemoryPressureLevel;
  readonly undoStack: HistoryCommand[];
  readonly redoStack: HistoryCommand[];
  readonly trimmedHistoryCount: number;
  readonly trimmedCacheEntries: number;
} {
  const heapBytes = estimateWedgeHeapBytes(params.wedges);
  const l1Bytes = SHARED_SYMMETRY_CACHE.getStats().bytesUsed;
  const pressure = classifyMemoryPressure(heapBytes + l1Bytes);

  if (pressure === MemoryPressureLevel.Normal) {
    return {
      pressure,
      undoStack: [...params.undoStack],
      redoStack: [...params.redoStack],
      trimmedHistoryCount: 0,
      trimmedCacheEntries: 0,
    };
  }

  const cap =
    pressure === MemoryPressureLevel.Critical
      ? Math.max(5, Math.floor(RESOURCE_GUARD_LIMITS.maxHistoryCommandsUnderPressure / 2))
      : RESOURCE_GUARD_LIMITS.maxHistoryCommandsUnderPressure;

  const trimmedUndo =
    params.undoStack.length > cap ? params.undoStack.slice(params.undoStack.length - cap) : [...params.undoStack];
  const trimmedRedo = pressure === MemoryPressureLevel.Critical ? [] : params.redoStack.slice(-cap);
  const trimmedHistoryCount =
    params.undoStack.length - trimmedUndo.length + (params.redoStack.length - trimmedRedo.length);

  const keepRatio = pressure === MemoryPressureLevel.Critical ? 0.25 : 0.5;
  const trimmedCacheEntries = trimAllRegisteredCaches(keepRatio);

  return {
    pressure,
    undoStack: trimmedUndo,
    redoStack: trimmedRedo,
    trimmedHistoryCount,
    trimmedCacheEntries,
  };
}

export function getResourceHealthSnapshot(
  wedges: readonly WedgeStroke[],
  symmetryParams: SymmetryParams
): ResourceHealthSnapshot {
  const l1Stats = SHARED_SYMMETRY_CACHE.getStats();
  const l2WedgeHeapBytes = estimateWedgeHeapBytes(wedges);
  const l2PointCount = countPointsInWedges(wedges);
  const totalEstimatedBytes = l1Stats.bytesUsed + l2WedgeHeapBytes;
  const memoryPressure = classifyMemoryPressure(totalEstimatedBytes);

  const strategy = STRATEGY_REGISTRY[symmetryParams.strategyId];
  const multiplier = strategy
    ? strategy.expansionMultiplier(symmetryParams.order)
    : symmetryParams.order;
  const expandedPrimitives = wedges.length * multiplier;

  const cpu = getCpuTelemetry();
  const perfMem =
    typeof performance !== 'undefined' && performance.memory ? performance.memory : undefined;

  const saturationRatio = Math.min(
    1,
    Math.max(
      totalEstimatedBytes / RESOURCE_GUARD_LIMITS.l2HardMaxBytes,
      l2PointCount / RESOURCE_GUARD_LIMITS.maxScenePoints,
      expandedPrimitives / RESOURCE_GUARD_LIMITS.maxExpandedPrimitivesPerFrame
    )
  );

  return {
    l1Entries: l1Stats.entries,
    l1BytesUsed: l1Stats.bytesUsed,
    l2WedgeCount: wedges.length,
    l2PointCount,
    l2WedgeHeapBytes,
    expandedPrimitives,
    memoryPressure,
    cpuLoadState: cpu.cpuLoadState,
    lastRenderMs: cpu.lastRenderMs,
    emaRenderMs: cpu.emaRenderMs,
    peakRenderMs: cpu.peakRenderMs,
    jsHeapUsedMb: perfMem ? Number((perfMem.usedJSHeapSize / (1024 * 1024)).toFixed(1)) : null,
    jsHeapLimitMb: perfMem ? Number((perfMem.jsHeapSizeLimit / (1024 * 1024)).toFixed(0)) : null,
    saturationRatio: Number(saturationRatio.toFixed(3)),
  };
}
