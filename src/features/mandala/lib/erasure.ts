/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Erase-Within-Wedge Topological Hit-Testing (MANDALA-PH2 §3.2.2).
 * Evaluates distance between pointer eraser circle and expanded symmetric strokes
 * in normalized 800x800 coordinates, returning matched base wedge IDs cleanly.
 */

import { LOGICAL_CENTER } from '../model/constants.ts';
import type { Point, SymmetryParams, WedgeStroke } from '../model/types.ts';
import { expandStrokeWithStrategy } from '../strategies/symmetry.ts';

/**
 * Squared minimum distance from point P to segment AB.
 */
export function distSqPointToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const px = p.x - a.x;
    const py = p.y - a.y;
    return px * px + py * py;
  }
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  const rx = p.x - projX;
  const ry = p.y - projY;
  return rx * rx + ry * ry;
}

/**
 * Checks whether a single WedgeStroke intersects the circular eraser at `eraserPt`.
 */
export function strokeIntersectsCircle(
  stroke: WedgeStroke,
  eraserPt: Point,
  eraserRadius: number
): boolean {
  if (stroke.points.length === 0) return false;
  const threshold = eraserRadius + stroke.strokeWidth / 2;
  const thresholdSq = threshold * threshold;

  if (stroke.points.length === 1) {
    const dx = eraserPt.x - stroke.points[0].x;
    const dy = eraserPt.y - stroke.points[0].y;
    return dx * dx + dy * dy <= thresholdSq;
  }

  for (let i = 0; i < stroke.points.length - 1; i++) {
    if (distSqPointToSegment(eraserPt, stroke.points[i], stroke.points[i + 1]) <= thresholdSq) {
      return true;
    }
  }
  return false;
}

/**
 * Finds IDs of all committed base wedges whose symmetric expansion touches `eraserPt`.
 */
export function findWedgesIntersectingEraser(
  wedges: readonly WedgeStroke[],
  eraserPt: Point,
  eraserRadius: number,
  symmetryParams: SymmetryParams,
  center: Point = LOGICAL_CENTER
): string[] {
  const hitIds: string[] = [];

  for (const wedge of wedges) {
    const expanded = expandStrokeWithStrategy(wedge, symmetryParams, center);
    if (!expanded.ok) continue;

    for (const copy of expanded.value) {
      if (strokeIntersectsCircle(copy, eraserPt, eraserRadius)) {
        hitIds.push(wedge.id);
        break;
      }
    }
  }

  return hitIds;
}
