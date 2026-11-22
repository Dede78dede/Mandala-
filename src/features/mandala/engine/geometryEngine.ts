/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 3 Geometry Compute Engine Port & Tier L1 LRU Integration (MANDALA-PH3-READY).
 * Decouples synchronous JS expansion (backed by L1 SymmetryLruCache) from UI/renderer
 * so Phase 3 can swap in Web Worker / WASM SIMD execution under the PH1-WASM gate.
 */

import { Result, ok, err, assertNever } from '../../../shared/lib/result.ts';
import { LOGICAL_CENTER, MANDALA_LIMITS } from '../model/constants.ts';
import {
  ComplexityMetric,
  ExecutionRoutingMode,
  type Point,
  type SymmetryError,
  type SymmetryParams,
  type WedgeStroke,
} from '../model/types.ts';
import {
  STRATEGY_REGISTRY,
  expandStrokeWithStrategy,
  type SymmetryStrategy,
} from '../strategies/symmetry.ts';
import {
  SHARED_SYMMETRY_CACHE,
  buildSymmetryCacheKey,
  type SymmetryLruCache,
} from '../memory/geometryCache.ts';

export enum ComputeBackend {
  MainThreadJs = 'main-thread-js',
  WebWorkerJs = 'web-worker-js',
  WasmSimd = 'wasm-simd',
}

export interface SceneComputeProfile {
  baseWedgeCount: number;
  estimatedExpandedPrimitives: number;
  estimatedComplexityUnits: number;
  strategyThreshold: number;
  complexityMetric: ComplexityMetric;
  exceedsStrategyThreshold: boolean;
  requiresPixelBufferEscapeHatch: boolean;
  recommendedBackend: ComputeBackend;
}

export interface GeometryEngine {
  readonly backend: ComputeBackend;
  expandStroke(
    wedge: WedgeStroke,
    params: SymmetryParams,
    center?: Point
  ): Result<readonly WedgeStroke[], SymmetryError>;
  expandScene(
    wedges: readonly WedgeStroke[],
    params: SymmetryParams,
    center?: Point
  ): Result<WedgeStroke[], SymmetryError>;
  assessSceneProfile(
    wedges: readonly WedgeStroke[],
    params: SymmetryParams
  ): SceneComputeProfile;
}

function measureWedgesComplexity(
  wedges: readonly WedgeStroke[],
  metric: ComplexityMetric,
  multiplier: number
): number {
  let rawUnits = 0;
  for (const w of wedges) {
    switch (metric) {
      case ComplexityMetric.Points:
        rawUnits += w.points.length;
        break;
      case ComplexityMetric.Segments:
        rawUnits += Math.max(0, w.points.length - 1);
        break;
      default:
        assertNever(metric);
    }
  }
  return rawUnits * multiplier;
}

/**
 * Pure data-driven orchestrator routing assessment (MANDALA-PH4 §2.1.D & §4.1).
 * Zero strategy-specific `if` branches: queries only `strategy.expansionMultiplier`,
 * `strategy.complexityMetric`, and `strategy.minWedgeComplexity` from the registry.
 */
export function assessSceneComputeProfile(
  wedges: readonly WedgeStroke[],
  params: SymmetryParams,
  registry: Readonly<Record<string, SymmetryStrategy>> = STRATEGY_REGISTRY,
  routingMode: ExecutionRoutingMode = ExecutionRoutingMode.AutoGate
): SceneComputeProfile {
  const strategy = registry[params.strategyId];
  const multiplier = strategy ? strategy.expansionMultiplier(params.order) : params.order;
  const strategyThreshold = strategy ? strategy.minWedgeComplexity : Infinity;
  const complexityMetric = strategy ? strategy.complexityMetric : ComplexityMetric.Points;

  const estimatedExpandedPrimitives = wedges.length * multiplier;
  const estimatedComplexityUnits = measureWedgesComplexity(wedges, complexityMetric, multiplier);
  const exceedsStrategyThreshold = estimatedComplexityUnits >= strategyThreshold;
  const requiresPixelBufferEscapeHatch =
    estimatedExpandedPrimitives >= MANDALA_LIMITS.escapeHatchStrokeThreshold;

  let recommendedBackend = ComputeBackend.MainThreadJs;
  if (routingMode === ExecutionRoutingMode.ForceWasmWorker) {
    recommendedBackend = ComputeBackend.WasmSimd;
  } else if (routingMode === ExecutionRoutingMode.ForceJs) {
    recommendedBackend = ComputeBackend.MainThreadJs;
  } else if (requiresPixelBufferEscapeHatch) {
    recommendedBackend = ComputeBackend.WebWorkerJs;
  } else if (exceedsStrategyThreshold) {
    recommendedBackend = ComputeBackend.WasmSimd;
  }

  return {
    baseWedgeCount: wedges.length,
    estimatedExpandedPrimitives,
    estimatedComplexityUnits,
    strategyThreshold,
    complexityMetric,
    exceedsStrategyThreshold,
    requiresPixelBufferEscapeHatch,
    recommendedBackend,
  };
}

/**
 * Data-driven dispatch verdict for a single wedge under any strategy registry.
 * Guardrail tested in Phase 4 Task 4.1.D with synthetic strategy fixtures.
 */
export function resolveDispatchBackendForWedge(
  wedge: WedgeStroke,
  strategyId: string,
  order: number,
  registry: Readonly<Record<string, SymmetryStrategy>> = STRATEGY_REGISTRY,
  routingMode: ExecutionRoutingMode = ExecutionRoutingMode.AutoGate
): ComputeBackend {
  if (routingMode === ExecutionRoutingMode.ForceJs) return ComputeBackend.MainThreadJs;
  if (routingMode === ExecutionRoutingMode.ForceWasmWorker) return ComputeBackend.WasmSimd;

  const strategy = registry[strategyId];
  if (!strategy) return ComputeBackend.MainThreadJs;

  const multiplier = strategy.expansionMultiplier(order);
  const complexity = measureWedgesComplexity([wedge], strategy.complexityMetric, multiplier);
  return complexity >= strategy.minWedgeComplexity
    ? ComputeBackend.WasmSimd
    : ComputeBackend.MainThreadJs;
}

const EPHEMERAL_STROKE_PREFIXES: readonly string[] = ['morph_', 'stamp_preview'];

function isEphemeralWedgeId(id: string): boolean {
  return id === 'preview' || EPHEMERAL_STROKE_PREFIXES.some((prefix) => id.startsWith(prefix));
}

export function createCachedJsGeometryEngine(
  cache: SymmetryLruCache = SHARED_SYMMETRY_CACHE
): GeometryEngine {
  return {
    backend: ComputeBackend.MainThreadJs,

    expandStroke(wedge, params, center = LOGICAL_CENTER) {
      if (isEphemeralWedgeId(wedge.id)) {
        return expandStrokeWithStrategy(wedge, params, center);
      }

      const key = buildSymmetryCacheKey(wedge, params, center);
      const cached = cache.get(key);
      if (cached !== undefined) {
        return ok(cached);
      }

      const res = expandStrokeWithStrategy(wedge, params, center);
      if (res.ok) {
        cache.set(key, res.value);
      }
      return res;
    },

    expandScene(wedges, params, center = LOGICAL_CENTER) {
      const out: WedgeStroke[] = [];
      for (const wedge of wedges) {
        const res = this.expandStroke(wedge, params, center);
        if (!res.ok) return err(res.error);
        out.push(...res.value);
      }
      return ok(out);
    },

    assessSceneProfile(wedges, params) {
      return assessSceneComputeProfile(wedges, params);
    },
  };
}

export const JsGeometryEngine: GeometryEngine = createCachedJsGeometryEngine();

