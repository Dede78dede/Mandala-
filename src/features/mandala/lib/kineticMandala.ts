/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure Kinetic Mandala Algorithms (Time-Lapse Stroke Replay + Concentric Radial Bands).
 * Decoupled from DOM/Canvas/React so geometry transformations and slicing invariants
 * are deterministically verifiable via `node:test`.
 */

import { KINETIC_LIMITS, LOGICAL_CENTER } from '../model/constants.ts';
import type { Point, WedgeStroke } from '../model/types.ts';

export interface RadialBandGroup {
  readonly bandIndex: 0 | 1 | 2;
  readonly label: string;
  readonly speedMultiplier: number;
  readonly strokes: readonly WedgeStroke[];
}

export interface StrokeReplayFrame {
  readonly strokes: readonly WedgeStroke[];
  readonly completedStrokes: number;
  readonly totalStrokes: number;
  readonly clampedProgress: number;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/**
 * Computes normalized radial breathing scale factor `1 + amplitude * sin(timeSec * 1.4)`.
 */
export function computeBreathingScale(timeSec: number, amplitude: number): number {
  const safeAmp = clamp(amplitude, 0, KINETIC_LIMITS.maxBreathing);
  if (safeAmp <= 0) return 1.0;
  return 1.0 + safeAmp * Math.sin(timeSec * 1.4);
}

/**
 * Computes cumulative angular offset (radians) for concentric band index 0..2.
 */
export function computeBandAngleRad(
  bandIndex: 0 | 1 | 2,
  timeSec: number,
  speedScale: number = 1
): number {
  const mult = KINETIC_LIMITS.ringSpeedMultipliers[bandIndex] ?? 0;
  const clampedSpeed = clamp(speedScale, KINETIC_LIMITS.minSpeed, KINETIC_LIMITS.maxSpeed);
  return timeSec * mult * clampedSpeed;
}

/**
 * Computes the average radial distance of a stroke from `center`.
 */
export function measureStrokeAverageRadius(
  stroke: WedgeStroke,
  center: Point = LOGICAL_CENTER
): number {
  if (stroke.points.length === 0) return 0;
  let sum = 0;
  for (const pt of stroke.points) {
    sum += Math.hypot(pt.x - center.x, pt.y - center.y);
  }
  return sum / stroke.points.length;
}

/**
 * Partitions strokes deterministically into 3 concentric radial bands
 * (Inner clockwise, Middle counter-clockwise, Outer slow drift) for Canvas 2D and SVG export.
 */
export function partitionWedgesIntoRadialBands(
  wedges: readonly WedgeStroke[],
  center: Point = LOGICAL_CENTER
): readonly RadialBandGroup[] {
  const inner: WedgeStroke[] = [];
  const mid: WedgeStroke[] = [];
  const outer: WedgeStroke[] = [];

  if (wedges.length > 0) {
    let maxRadius = 1;
    const radii = wedges.map((w) => {
      const r = measureStrokeAverageRadius(w, center);
      if (r > maxRadius) maxRadius = r;
      return r;
    });

    for (let i = 0; i < wedges.length; i++) {
      const ratio = radii[i] / maxRadius;
      if (ratio <= KINETIC_LIMITS.innerRingRatio) {
        inner.push(wedges[i]);
      } else if (ratio <= KINETIC_LIMITS.midRingRatio) {
        mid.push(wedges[i]);
      } else {
        outer.push(wedges[i]);
      }
    }
  }

  return [
    {
      bandIndex: 0,
      label: 'Nucleo Interno',
      speedMultiplier: KINETIC_LIMITS.ringSpeedMultipliers[0],
      strokes: inner,
    },
    {
      bandIndex: 1,
      label: 'Corona Intermedia',
      speedMultiplier: KINETIC_LIMITS.ringSpeedMultipliers[1],
      strokes: mid,
    },
    {
      bandIndex: 2,
      label: 'Orbita Esterna',
      speedMultiplier: KINETIC_LIMITS.ringSpeedMultipliers[2],
      strokes: outer,
    },
  ];
}

/**
 * Deterministically slices chronological `WedgeStroke[]` according to replay progress `t in [0, 1]`
 * so multi-point strokes reveal tip-by-tip without mutating input arrays.
 */
export function computeStrokeReplaySlice(
  wedges: readonly WedgeStroke[],
  progress: number
): StrokeReplayFrame {
  const clamped = clamp(progress, 0, 1);
  if (wedges.length === 0 || clamped <= 0) {
    return {
      strokes: [],
      completedStrokes: 0,
      totalStrokes: wedges.length,
      clampedProgress: clamped,
    };
  }

  if (clamped >= 1) {
    return {
      strokes: wedges,
      completedStrokes: wedges.length,
      totalStrokes: wedges.length,
      clampedProgress: 1,
    };
  }

  // Weight each stroke by point count (minimum 1 unit for single-point stamps)
  let totalWeight = 0;
  const weights: number[] = new Array(wedges.length);
  for (let i = 0; i < wedges.length; i++) {
    const w = Math.max(1, wedges[i].points.length);
    weights[i] = w;
    totalWeight += w;
  }

  const targetBudget = Math.max(1, Math.round(totalWeight * clamped));
  let consumed = 0;
  let completedStrokes = 0;
  const sliced: WedgeStroke[] = [];

  for (let i = 0; i < wedges.length; i++) {
    const stroke = wedges[i];
    const w = weights[i];
    const remaining = targetBudget - consumed;
    if (remaining <= 0) break;

    if (remaining >= w) {
      sliced.push(stroke);
      consumed += w;
      completedStrokes += 1;
    } else {
      const ptCount = Math.max(1, Math.min(stroke.points.length, remaining));
      sliced.push({
        ...stroke,
        points: stroke.points.slice(0, ptCount),
      });
      consumed += ptCount;
      break;
    }
  }

  return {
    strokes: sliced,
    completedStrokes,
    totalStrokes: wedges.length,
    clampedProgress: clamped,
  };
}
