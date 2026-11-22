/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure Uniform Arc-Length Polyline Resampler & Kinetic Morph Interpolator.
 * Zero external dependencies (`flubber`-free): linear piecewise arc-length resampling
 * paired with smoothstep color, width, and opacity interpolation for Canvas 2D 60fps morphing.
 */

import { LOGICAL_CENTER, MORPH_LIMITS } from '../model/constants.ts';
import type { Point, WedgeStroke } from '../model/types.ts';

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

interface RgbaColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

function parseHexColor(hex: string): RgbaColor {
  const clean = hex.trim().replace('#', '');
  if (clean.length === 3) {
    const c0 = clean[0] ?? '0';
    const c1 = clean[1] ?? '0';
    const c2 = clean[2] ?? '0';
    const r = parseInt(c0 + c0, 16) || 0;
    const g = parseInt(c1 + c1, 16) || 0;
    const b = parseInt(c2 + c2, 16) || 0;
    return { r, g, b, a: 1 };
  }
  if (clean.length === 6) {
    const r = parseInt(clean.slice(0, 2), 16) || 0;
    const g = parseInt(clean.slice(2, 4), 16) || 0;
    const b = parseInt(clean.slice(4, 6), 16) || 0;
    return { r, g, b, a: 1 };
  }
  return { r: 56, g: 189, b: 248, a: 1 };
}

function toHexByte(n: number): string {
  return Math.round(clamp(n, 0, 255))
    .toString(16)
    .padStart(2, '0');
}

export function interpolateHexColor(hexA: string, hexB: string, t: number): string {
  const u = clamp(t, 0, 1);
  if (u <= 0) return hexA;
  if (u >= 1) return hexB;
  const a = parseHexColor(hexA);
  const b = parseHexColor(hexB);
  return `#${toHexByte(lerp(a.r, b.r, u))}${toHexByte(lerp(a.g, b.g, u))}${toHexByte(lerp(a.b, b.b, u))}`;
}

export function computeStrokeCentroid(
  stroke: WedgeStroke,
  fallbackCenter: Point = LOGICAL_CENTER
): Point {
  if (stroke.points.length === 0) return fallbackCenter;
  let sx = 0;
  let sy = 0;
  for (const pt of stroke.points) {
    sx += pt.x;
    sy += pt.y;
  }
  return {
    x: sx / stroke.points.length,
    y: sy / stroke.points.length,
  };
}

/**
 * Resamples any polyline uniformly along cumulative arc length to `targetCount` vertices.
 */
export function resamplePolylineUniform(
  points: readonly Point[],
  targetCount: number = MORPH_LIMITS.resampledPointCount
): Point[] {
  const safeCount = Math.max(2, Math.round(targetCount));
  const firstPt = points[0];
  if (!firstPt) return [];
  if (points.length === 1) {
    return Array.from({ length: safeCount }, () => ({ x: firstPt.x, y: firstPt.y }));
  }

  const cumulative: number[] = [0];
  let totalLen = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    if (!prev || !curr) continue;
    const segLen = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    totalLen += segLen;
    cumulative.push(totalLen);
  }

  if (totalLen < 1e-6) {
    return Array.from({ length: safeCount }, () => ({ x: firstPt.x, y: firstPt.y }));
  }

  const out: Point[] = [];
  let segIdx = 0;
  for (let i = 0; i < safeCount; i++) {
    const targetDist = (i / (safeCount - 1)) * totalLen;
    while (segIdx < cumulative.length - 2 && (cumulative[segIdx + 1] ?? 0) < targetDist) {
      segIdx += 1;
    }
    const segStart = cumulative[segIdx] ?? 0;
    const segEnd = cumulative[segIdx + 1] ?? segStart;
    const span = segEnd - segStart;
    const localT = span > 1e-6 ? clamp((targetDist - segStart) / span, 0, 1) : 0;
    const a = points[segIdx] ?? firstPt;
    const b = points[segIdx + 1] ?? a;
    out.push({
      x: lerp(a.x, b.x, localT),
      y: lerp(a.y, b.y, localT),
    });
  }
  return out;
}

function buildCollapsedStroke(centroid: Point, template: WedgeStroke, pointCount: number): WedgeStroke {
  return {
    ...template,
    points: Array.from({ length: pointCount }, () => ({ x: centroid.x, y: centroid.y })),
    opacity: 0,
  };
}

export interface PreparedMorphPair {
  readonly index: number;
  readonly fromPoints: readonly Point[];
  readonly toPoints: readonly Point[];
  readonly fromColor: RgbaColor;
  readonly toColor: RgbaColor;
  readonly fromWidth: number;
  readonly toWidth: number;
  readonly fromDash: number[] | null;
  readonly toDash: number[] | null;
  readonly fromOpacity: number;
  readonly toOpacity: number;
}

export interface PreparedMorphPlan {
  readonly fromStrokes: readonly WedgeStroke[];
  readonly toStrokes: readonly WedgeStroke[];
  readonly pairs: readonly PreparedMorphPair[];
}

function buildMorphStrokeList(
  strokes: readonly WedgeStroke[],
  maxCount: number
): readonly WedgeStroke[] {
  if (strokes.length <= maxCount) return strokes;
  const sampled: WedgeStroke[] = [];
  const step = strokes.length / maxCount;
  for (let i = 0; i < maxCount; i++) {
    const idx = Math.min(strokes.length - 1, Math.floor(i * step));
    const item = strokes[idx];
    if (item) sampled.push(item);
  }
  return sampled;
}

/**
 * Pre-resamples uniform arc-length endpoint pairs once per scene change so the
 * 60fps Canvas 2D rAF loop performs zero per-frame arc-length resampling.
 */
export function prepareMorphPlan(
  fromStrokes: readonly WedgeStroke[],
  toStrokes: readonly WedgeStroke[],
  center: Point = LOGICAL_CENTER,
  pointsPerStroke: number = MORPH_LIMITS.resampledPointCount,
  maxMorphStrokes: number = MORPH_LIMITS.maxPreviewStrokes
): PreparedMorphPlan {
  const safeCap = Math.max(1, Math.min(MORPH_LIMITS.maxPreviewStrokes, Math.round(maxMorphStrokes)));
  const boundedFrom = buildMorphStrokeList(fromStrokes, safeCap);
  const boundedTo = buildMorphStrokeList(toStrokes, safeCap);
  const maxLen = Math.max(boundedFrom.length, boundedTo.length);
  const pairs: PreparedMorphPair[] = [];

  for (let i = 0; i < maxLen; i++) {
    const rawFrom = boundedFrom[i];
    const rawTo = boundedTo[i];

    let src: WedgeStroke;
    let dst: WedgeStroke;
    if (rawFrom && rawTo) {
      src = rawFrom;
      dst = rawTo;
    } else if (rawTo) {
      src = buildCollapsedStroke(computeStrokeCentroid(rawTo, center), rawTo, pointsPerStroke);
      dst = rawTo;
    } else if (rawFrom) {
      src = rawFrom;
      dst = buildCollapsedStroke(computeStrokeCentroid(rawFrom, center), rawFrom, pointsPerStroke);
    } else {
      continue;
    }

    const ptsA = resamplePolylineUniform(src.points, pointsPerStroke);
    const ptsB = resamplePolylineUniform(dst.points, pointsPerStroke);
    const count = Math.min(ptsA.length, ptsB.length);
    if (count === 0) continue;

    pairs.push({
      index: i,
      fromPoints: ptsA.length === count ? ptsA : ptsA.slice(0, count),
      toPoints: ptsB.length === count ? ptsB : ptsB.slice(0, count),
      fromColor: parseHexColor(src.stroke),
      toColor: parseHexColor(dst.stroke),
      fromWidth: src.strokeWidth,
      toWidth: dst.strokeWidth,
      fromDash: src.dash,
      toDash: dst.dash,
      fromOpacity: src.opacity,
      toOpacity: dst.opacity,
    });
  }

  return {
    fromStrokes: boundedFrom,
    toStrokes: boundedTo,
    pairs,
  };
}

/**
 * Evaluates a pre-computed morph plan at normalized progress `t in [0, 1]`.
 */
export function interpolatePreparedMorph(
  plan: PreparedMorphPlan,
  progress: number
): WedgeStroke[] {
  const t = clamp(progress, 0, 1);
  if (plan.fromStrokes.length === 0 && plan.toStrokes.length === 0) return [];
  if (t <= 0) return [...plan.fromStrokes];
  if (t >= 1) return [...plan.toStrokes];

  const eased = t * t * (3 - 2 * t);
  const out: WedgeStroke[] = [];

  for (let i = 0; i < plan.pairs.length; i++) {
    const pair = plan.pairs[i];
    if (!pair) continue;
    const count = pair.fromPoints.length;
    const morphedPts: Point[] = [];
    for (let k = 0; k < count; k++) {
      const a = pair.fromPoints[k];
      const b = pair.toPoints[k];
      if (!a || !b) continue;
      morphedPts.push({
        x: lerp(a.x, b.x, eased),
        y: lerp(a.y, b.y, eased),
      });
    }

    const r = lerp(pair.fromColor.r, pair.toColor.r, eased);
    const g = lerp(pair.fromColor.g, pair.toColor.g, eased);
    const b = lerp(pair.fromColor.b, pair.toColor.b, eased);

    out.push({
      id: `morph_${pair.index}`,
      points: morphedPts,
      stroke: `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`,
      strokeWidth: Number(lerp(pair.fromWidth, pair.toWidth, eased).toFixed(2)),
      dash: eased < 0.5 ? pair.fromDash : pair.toDash,
      opacity: Number(clamp(lerp(pair.fromOpacity, pair.toOpacity, eased), 0, 1).toFixed(3)),
    });
  }

  return out;
}

/**
 * Pure deterministic stroke-scene morph interpolation at normalized progress `t in [0, 1]`.
 */
export function interpolateStrokeScene(
  fromStrokes: readonly WedgeStroke[],
  toStrokes: readonly WedgeStroke[],
  progress: number,
  center: Point = LOGICAL_CENTER,
  pointsPerStroke: number = MORPH_LIMITS.resampledPointCount
): WedgeStroke[] {
  const t = clamp(progress, 0, 1);
  if (fromStrokes.length === 0 && toStrokes.length === 0) return [];
  if (t <= 0) return [...fromStrokes];
  if (t >= 1) return [...toStrokes];

  const plan = prepareMorphPlan(
    fromStrokes,
    toStrokes,
    center,
    pointsPerStroke,
    MORPH_LIMITS.maxPreviewStrokes
  );
  return interpolatePreparedMorph(plan, t);
}
