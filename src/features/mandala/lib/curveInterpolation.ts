/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Canonical Midpoint Quadratic Bezier Curve Interpolation (SSOT for Canvas 2D, Path2D & SVG).
 * Guarantees visual parity between live Canvas rendering, PNG export, and SVG vector serialization.
 */

import type { Point } from '../model/types.ts';

export interface QuadraticPathSink {
  moveTo(x: number, y: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  lineTo(x: number, y: number): void;
}

/**
 * Traces smoothed quadratic midpoint Bezier segments from a `Point[]` sequence into any
 * `CanvasRenderingContext2D` or `Path2D` sink without intermediate array allocations.
 */
export function traceQuadraticPolylinePoints(
  sink: QuadraticPathSink,
  points: readonly Point[],
  scale: number = 1
): void {
  const count = points.length;
  if (count < 2) return;
  const first = points[0];
  const last = points[count - 1];
  if (!first || !last) return;

  sink.moveTo(first.x * scale, first.y * scale);
  for (let i = 1; i < count - 1; i++) {
    const curr = points[i];
    const next = points[i + 1];
    if (!curr || !next) continue;
    const xc = ((curr.x + next.x) * 0.5) * scale;
    const yc = ((curr.y + next.y) * 0.5) * scale;
    sink.quadraticCurveTo(curr.x * scale, curr.y * scale, xc, yc);
  }
  sink.lineTo(last.x * scale, last.y * scale);
}

/**
 * Zero-GC tracer reading interleaved `[x0, y0, x1, y1, ...]` directly from a flat `Float64Array`.
 */
export function traceQuadraticPolylineFlat(
  sink: QuadraticPathSink,
  coords: Float64Array,
  startFloatIdx: number,
  pointCount: number,
  scale: number = 1
): void {
  if (pointCount < 2) return;
  const firstX = coords[startFloatIdx] ?? 0;
  const firstY = coords[startFloatIdx + 1] ?? 0;
  sink.moveTo(firstX * scale, firstY * scale);

  for (let i = 1; i < pointCount - 1; i++) {
    const currIdx = startFloatIdx + i * 2;
    const nextIdx = currIdx + 2;
    const cx = coords[currIdx] ?? 0;
    const cy = coords[currIdx + 1] ?? 0;
    const nx = coords[nextIdx] ?? cx;
    const ny = coords[nextIdx + 1] ?? cy;
    const xc = ((cx + nx) * 0.5) * scale;
    const yc = ((cy + ny) * 0.5) * scale;
    sink.quadraticCurveTo(cx * scale, cy * scale, xc, yc);
  }

  const lastIdx = startFloatIdx + (pointCount - 1) * 2;
  sink.lineTo((coords[lastIdx] ?? 0) * scale, (coords[lastIdx + 1] ?? 0) * scale);
}

/**
 * Emits SVG `<path d="...">` command string with identical midpoint quadratic Bezier geometry
 * (`M ... Q ... L ...`) matching Canvas 2D rendering.
 */
export function buildSvgQuadraticPathData(
  points: readonly Point[],
  cxOffset: number,
  cyOffset: number,
  scaleX: number,
  scaleY: number
): string {
  const count = points.length;
  if (count < 2) return '';
  const first = points[0];
  const last = points[count - 1];
  if (!first || !last) return '';

  const cmds: string[] = [
    `M ${((first.x - cxOffset) * scaleX).toFixed(2)} ${((first.y - cyOffset) * scaleY).toFixed(2)}`,
  ];

  for (let i = 1; i < count - 1; i++) {
    const curr = points[i];
    const next = points[i + 1];
    if (!curr || !next) continue;
    const cpx = ((curr.x - cxOffset) * scaleX).toFixed(2);
    const cpy = ((curr.y - cyOffset) * scaleY).toFixed(2);
    const xc = ((((curr.x + next.x) * 0.5) - cxOffset) * scaleX).toFixed(2);
    const yc = ((((curr.y + next.y) * 0.5) - cyOffset) * scaleY).toFixed(2);
    cmds.push(`Q ${cpx} ${cpy} ${xc} ${yc}`);
  }

  cmds.push(
    `L ${((last.x - cxOffset) * scaleX).toFixed(2)} ${((last.y - cyOffset) * scaleY).toFixed(2)}`
  );

  return cmds.join(' ');
}
