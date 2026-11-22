/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure Canvas Pointer Finite State Machine & Coordinate Resolution Helpers.
 * Zero DOM/React side effects so pointer interaction transitions are 100% unit-testable.
 */

import { KineticMode, ToolId, type Point } from '../model/types.ts';

export enum CanvasInteractionMode {
  Idle = 'idle',
  Pinching = 'pinching',
  LensTilting = 'lens-tilting',
  KineticPanning = 'kinetic-panning',
  Panning = 'panning',
  DrawingStroke = 'drawing-stroke',
  Stamping = 'stamping',
  Erasing = 'erasing',
}

export const MAX_CANVAS_BACKING_DPR = 2.5;
export const MAX_CANVAS_BACKING_EDGE_PX = 4096;

export function resolveSafeBackingStoreDpr(width: number, height: number): number {
  const rawDpr =
    typeof window !== 'undefined' && Number.isFinite(window.devicePixelRatio)
      ? window.devicePixelRatio
      : 1;
  const boundedDpr = Math.min(MAX_CANVAS_BACKING_DPR, Math.max(1, rawDpr));
  const safeW = Math.max(1, width);
  const safeH = Math.max(1, height);
  const maxDprForEdge = Math.min(
    MAX_CANVAS_BACKING_EDGE_PX / safeW,
    MAX_CANVAS_BACKING_EDGE_PX / safeH
  );
  return Math.max(0.5, Math.min(boundedDpr, maxDprForEdge));
}

export interface PointerDownTransitionInput {
  readonly activePointerCount: number;
  readonly lensEnabled: boolean;
  readonly kineticMode: KineticMode;
  readonly button: number;
  readonly pointerType: string;
  readonly isPanToolActive: boolean;
  readonly isSpaceHeld: boolean;
  readonly activeTool: ToolId;
}

export function resolvePointerDownMode(
  input: PointerDownTransitionInput
): CanvasInteractionMode {
  if (input.activePointerCount >= 2) {
    return CanvasInteractionMode.Pinching;
  }
  if (input.lensEnabled) {
    return CanvasInteractionMode.LensTilting;
  }
  if (input.kineticMode !== KineticMode.Off) {
    return CanvasInteractionMode.KineticPanning;
  }
  if (input.button === 1 || input.isPanToolActive || input.isSpaceHeld) {
    return CanvasInteractionMode.Panning;
  }
  if (input.button !== 0 && input.pointerType === 'mouse') {
    return CanvasInteractionMode.Idle;
  }

  switch (input.activeTool) {
    case ToolId.Stamp:
      return CanvasInteractionMode.Stamping;
    case ToolId.Eraser:
      return CanvasInteractionMode.Erasing;
    case ToolId.Point:
    case ToolId.Brush:
    default:
      return CanvasInteractionMode.DrawingStroke;
  }
}

export interface PinchMetrics {
  readonly dist: number;
  readonly mid: Point;
}

export function computePinchMetrics(pts: readonly Point[]): PinchMetrics | null {
  const p0 = pts[0];
  const p1 = pts[1];
  if (!p0 || !p1) return null;
  return {
    dist: Math.hypot(p1.x - p0.x, p1.y - p0.y),
    mid: {
      x: (p0.x + p1.x) / 2,
      y: (p0.y + p1.y) / 2,
    },
  };
}
