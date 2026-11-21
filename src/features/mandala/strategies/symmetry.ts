/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SymmetryStrategy Interface, Implementations, and Data-Driven Registry
 * (MANDALA-PH1 §3.5, MANDALA-PH4 §4.1, MANDALA-PH6 §7.1–7.2).
 *
 * Orchestrator dispatch uses STRATEGY_REGISTRY lookup without strategy-specific if-branches.
 */

import { Result, ok, err, assertNever } from '../../../shared/lib/result.ts';
import {
  LOGICAL_CENTER,
  MANDALA_LIMITS,
  STRATEGY_COMPLEXITY_THRESHOLDS,
} from '../model/constants.ts';
import {
  ComplexityMetric,
  MirrorMode,
  SymmetryErrorCode,
  SymmetryStrategyKind,
  type Point,
  type SymmetryError,
  type SymmetryParams,
  type SymmetryStrategyId,
  type WedgeStroke,
} from '../model/types.ts';
import { resolveLSystemPreset, expandLSystem, interpretTurtle } from '../lib/lsystem.ts';

export interface SymmetryStrategy {
  readonly id: SymmetryStrategyId;
  readonly label: string;
  readonly minWedgeComplexity: number;
  readonly complexityMetric: ComplexityMetric;
  expansionMultiplier(order: number): number;
  expand(
    wedge: WedgeStroke,
    params: SymmetryParams,
    center?: Point
  ): Result<WedgeStroke[], SymmetryError>;
}

/**
 * Rotates a 2D point around `center` by `angleRad` radians.
 */
export function rotatePoint(pt: Point, angleRad: number, center: Point): Point {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const dx = pt.x - center.x;
  const dy = pt.y - center.y;
  return {
    x: center.x + (dx * cos - dy * sin),
    y: center.y + (dx * sin + dy * cos),
    pressure: pt.pressure,
  };
}

/**
 * Reflects a 2D point across an axis passing through `center` at `axisAngleRad`.
 */
export function reflectPoint(pt: Point, axisAngleRad: number, center: Point): Point {
  const dx = pt.x - center.x;
  const dy = pt.y - center.y;
  const cos2 = Math.cos(2 * axisAngleRad);
  const sin2 = Math.sin(2 * axisAngleRad);
  return {
    x: center.x + (dx * cos2 + dy * sin2),
    y: center.y + (dx * sin2 - dy * cos2),
    pressure: pt.pressure,
  };
}

/**
 * Pure Radial Expansion helper.
 */
export function expandRadial(
  stroke: WedgeStroke,
  order: number,
  center: Point = LOGICAL_CENTER
): WedgeStroke[] {
  if (order < 1 || !Number.isFinite(order)) return [stroke];
  if (stroke.points.length === 0) return [];

  const step = (2 * Math.PI) / order;
  const result: WedgeStroke[] = new Array<WedgeStroke>(order);

  for (let i = 0; i < order; i++) {
    if (i === 0) {
      result[0] = stroke;
      continue;
    }
    const angle = i * step;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const transformedPoints: Point[] = stroke.points.map((p) => {
      const dx = p.x - center.x;
      const dy = p.y - center.y;
      return {
        x: center.x + (dx * cos - dy * sin),
        y: center.y + (dx * sin + dy * cos),
        pressure: p.pressure,
      };
    });

    result[i] = {
      ...stroke,
      id: `${stroke.id}_r${i}`,
      points: transformedPoints,
    };
  }

  return result;
}

/**
 * Mirror-Radial Expansion helper: generates 2N strokes with bilateral or alternating reflection.
 */
export function expandMirrorRadial(
  stroke: WedgeStroke,
  order: number,
  mode: MirrorMode,
  center: Point = LOGICAL_CENTER
): WedgeStroke[] {
  if (order < 1 || !Number.isFinite(order)) return [stroke];
  if (stroke.points.length === 0) return [];

  const step = (2 * Math.PI) / order;
  const result: WedgeStroke[] = [];

  for (let i = 0; i < order; i++) {
    const baseAngle = i * step;
    const rotatedPoints =
      i === 0 ? stroke.points : stroke.points.map((p) => rotatePoint(p, baseAngle, center));

    result.push({
      ...stroke,
      id: `${stroke.id}_m${i}_a`,
      points: rotatedPoints,
    });

    const mirrorAxis = baseAngle + (mode === MirrorMode.Alternate && i % 2 === 1 ? step / 4 : 0);
    const reflectedPoints = rotatedPoints.map((p) => reflectPoint(p, mirrorAxis, center));

    result.push({
      ...stroke,
      id: `${stroke.id}_m${i}_b`,
      points: reflectedPoints,
    });
  }

  return result;
}

function validateOrder(order: number): SymmetryError | null {
  if (order < 1 || order > MANDALA_LIMITS.maxOrder || !Number.isInteger(order)) {
    return {
      code: SymmetryErrorCode.InvalidOrder,
      message: `Ordine simmetria non valido: ${order}`,
    };
  }
  return null;
}

export const RadialStrategy: SymmetryStrategy = {
  id: SymmetryStrategyKind.Radial,
  label: 'Radiale Pura',
  minWedgeComplexity: STRATEGY_COMPLEXITY_THRESHOLDS.radialPoints,
  complexityMetric: ComplexityMetric.Points,
  expansionMultiplier(order) {
    return Math.max(1, order);
  },
  expand(wedge, params, center = LOGICAL_CENTER) {
    const orderError = validateOrder(params.order);
    if (orderError) return err(orderError);
    if (wedge.points.length === 0) return ok([]);
    return ok(expandRadial(wedge, params.order, center));
  },
};

export const MirrorRadialStrategy: SymmetryStrategy = {
  id: SymmetryStrategyKind.MirrorRadial,
  label: 'Radiale Speculare',
  minWedgeComplexity: STRATEGY_COMPLEXITY_THRESHOLDS.mirrorRadialPoints,
  complexityMetric: ComplexityMetric.Points,
  expansionMultiplier(order) {
    return Math.max(1, order) * 2;
  },
  expand(wedge, params, center = LOGICAL_CENTER) {
    const orderError = validateOrder(params.order);
    if (orderError) return err(orderError);
    if (wedge.points.length === 0) return ok([]);
    const mode =
      params.strategyId === SymmetryStrategyKind.MirrorRadial
        ? params.mirrorMode
        : MirrorMode.Reflect;
    return ok(expandMirrorRadial(wedge, params.order, mode, center));
  },
};

/**
 * FractalStrategy delegates radial expansion to RadialStrategy (MANDALA-PH6 §7.2)
 * and evaluates WASM eligibility against L-system segment count.
 */
export const FractalStrategy: SymmetryStrategy = {
  id: SymmetryStrategyKind.Fractal,
  label: 'Frattale L-System',
  minWedgeComplexity: STRATEGY_COMPLEXITY_THRESHOLDS.fractalSegments,
  complexityMetric: ComplexityMetric.Segments,
  expansionMultiplier(order) {
    return RadialStrategy.expansionMultiplier(order);
  },
  expand(wedge, params, center = LOGICAL_CENTER) {
    return RadialStrategy.expand(wedge, params, center);
  },
};

export const STRATEGY_REGISTRY: Readonly<Record<SymmetryStrategyId, SymmetryStrategy>> = {
  [SymmetryStrategyKind.Radial]: RadialStrategy,
  [SymmetryStrategyKind.MirrorRadial]: MirrorRadialStrategy,
  [SymmetryStrategyKind.Fractal]: FractalStrategy,
};

/**
 * Data-driven orchestrator dispatch: zero strategy-specific `if` branches.
 */
export function expandStrokeWithStrategy(
  wedge: WedgeStroke,
  params: SymmetryParams,
  center: Point = LOGICAL_CENTER,
  registry: Readonly<Record<string, SymmetryStrategy>> = STRATEGY_REGISTRY
): Result<WedgeStroke[], SymmetryError> {
  const strategy = registry[params.strategyId];
  if (!strategy) {
    return err({
      code: SymmetryErrorCode.UnknownStrategy,
      message: 'Strategia di simmetria sconosciuta',
    });
  }
  return strategy.expand(wedge, params, center);
}

export interface FractalGenerationMetrics {
  readonly strokes: WedgeStroke[];
  readonly baseSegmentCount: number;
  readonly expandedSegmentCount: number;
}

/**
 * Generate procedural L-System fractal strokes and expand via RadialStrategy delegation.
 */
export function generateFractalStrokesWithMetrics(
  params: Extract<SymmetryParams, { strategyId: SymmetryStrategyKind.Fractal }>,
  center: Point,
  color: string,
  strokeWidth: number
): FractalGenerationMetrics {
  const preset = resolveLSystemPreset(params.preset);
  const expandedStr = expandLSystem(preset.axiom, preset.rules, params.generations);
  const polylines = interpretTurtle(expandedStr, params.stepLength, params.angle, center);

  let baseSegmentCount = 0;
  for (const poly of polylines) {
    baseSegmentCount += Math.max(0, poly.length - 1);
  }

  const baseStrokes: WedgeStroke[] = polylines.map((pts, idx) => ({
    id: `fractal_${preset.id}_${Date.now()}_${idx}`,
    points: pts,
    stroke: color,
    strokeWidth,
    dash: null,
    opacity: MANDALA_LIMITS.defaultOpacity,
  }));

  const expandedStrokes: WedgeStroke[] = [];
  for (const s of baseStrokes) {
    const res = RadialStrategy.expand(s, params, center);
    if (res.ok) {
      expandedStrokes.push(...res.value);
    }
  }

  return {
    strokes: expandedStrokes,
    baseSegmentCount,
    expandedSegmentCount: baseSegmentCount * RadialStrategy.expansionMultiplier(params.order),
  };
}

export function generateFractalStrokes(
  params: Extract<SymmetryParams, { strategyId: SymmetryStrategyKind.Fractal }>,
  center: Point,
  color: string,
  strokeWidth: number
): WedgeStroke[] {
  return generateFractalStrokesWithMetrics(params, center, color, strokeWidth).strokes;
}

export function describeSymmetryParams(params: SymmetryParams): string {
  switch (params.strategyId) {
    case SymmetryStrategyKind.Radial:
      return `simmetria radiale pura a ${params.order} ordini`;
    case SymmetryStrategyKind.MirrorRadial:
      return `simmetria speculare (${params.mirrorMode === MirrorMode.Alternate ? 'alternata' : 'bilaterale'}) a ${params.order} ordini`;
    case SymmetryStrategyKind.Fractal:
      return `simmetria frattale L-System (${params.preset}, ${params.generations} gen.) a ${params.order} ordini`;
    default:
      return assertNever(params);
  }
}

