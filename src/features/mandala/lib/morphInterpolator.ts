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
    const r = parseInt(clean[0] + clean[0], 16) || 0;
    const g = parseInt(clean[1] + clean[1], 16) || 0;
    const b = parseInt(clean[2] + clean[2], 16) || 0;
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
  if (points.length === 0) return [];
  if (points.length === 1) {
    return Array.from({ length: safeCount }, () => ({ x: points[0].x, y: points[0].y }));
  }

  const cumulative: number[] = [0];
  let totalLen = 0;
  for (let i = 1; i < points.length; i++) {
    const segLen = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    totalLen += segLen;
    cumulative.push(totalLen);
  }

  if (totalLen < 1e-6) {
    return Array.from({ length: safeCount }, () => ({ x: points[0].x, y: points[0].y }));
  }

  const out: Point[] = [];
  let segIdx = 0;
  for (let i = 0; i < safeCount; i++) {
    const targetDist = (i / (safeCount - 1)) * totalLen;
    while (segIdx < cumulative.length - 2 && cumulative[segIdx + 1] < targetDist) {
      segIdx += 1;
    }
    const segStart = cumulative[segIdx];
    const segEnd = cumulative[segIdx + 1];
    const span = segEnd - segStart;
    const localT = span > 1e-6 ? clamp((targetDist - segStart) / span, 0, 1) : 0;
    const a = points[segIdx];
    const b = points[segIdx + 1];
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

  const eased = t * t * (3 - 2 * t);
  const maxLen = Math.min(
    MORPH_LIMITS.maxPreviewStrokes,
    Math.max(fromStrokes.length, toStrokes.length)
  );
  const out: WedgeStroke[] = [];

  for (let i = 0; i < maxLen; i++) {
    const rawFrom = fromStrokes[i];
    const rawTo = toStrokes[i];

    const src =
      rawFrom ??
      buildCollapsedStroke(
        rawTo ? computeStrokeCentroid(rawTo, center) : center,
        rawTo!,
        pointsPerStroke
      );
    const dst =
      rawTo ??
      buildCollapsedStroke(
        rawFrom ? computeStrokeCentroid(rawFrom, center) : center,
        rawFrom!,
        pointsPerStroke
      );

    const ptsA = resamplePolylineUniform(src.points, pointsPerStroke);
    const ptsB = resamplePolylineUniform(dst.points, pointsPerStroke);
    const count = Math.min(ptsA.length, ptsB.length);
    if (count === 0) continue;

    const morphedPts: Point[] = new Array(count);
    for (let k = 0; k < count; k++) {
      morphedPts[k] = {
        x: lerp(ptsA[k].x, ptsB[k].x, eased),
        y: lerp(ptsA[k].y, ptsB[k].y, eased),
      };
    }

    out.push({
      id: `morph_${i}`,
      points: morphedPts,
      stroke: interpolateHexColor(src.stroke, dst.stroke, eased),
      strokeWidth: Number(lerp(src.strokeWidth, dst.strokeWidth, eased).toFixed(2)),
      dash: eased < 0.5 ? src.dash : dst.dash,
      opacity: Number(clamp(lerp(src.opacity, dst.opacity, eased), 0, 1).toFixed(3)),
    });
  }

  return out;
}
