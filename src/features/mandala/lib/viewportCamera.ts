/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase A — 2D Viewport Camera Transforms, Inverse-Zoom Input Decimation & AABB Frustum Culling.
 * Keeps backing canvas VRAM constant (viewport-sized) while enabling 0.25x-8x zoom
 * and free panning across the expanded world coordinate space.
 */

import {
  CAMERA_LIMITS,
  LOGICAL_CANVAS_SIZE,
  LOGICAL_CENTER,
  WORLD_SPACE_LIMITS,
} from '../model/constants.ts';
import type {
  CameraTransform,
  Point,
  WedgeStroke,
  WorldBounds,
} from '../model/types.ts';

export const DEFAULT_CAMERA_TRANSFORM: CameraTransform = {
  zoom: CAMERA_LIMITS.defaultZoom,
  panX: 0,
  panY: 0,
};

export function clampCameraZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return CAMERA_LIMITS.defaultZoom;
  return Math.min(CAMERA_LIMITS.maxZoom, Math.max(CAMERA_LIMITS.minZoom, zoom));
}

export function clampCameraPan(
  pan: number,
  worldRadius: number = WORLD_SPACE_LIMITS.extendedRadius
): number {
  if (!Number.isFinite(pan)) return 0;
  const maxPan = worldRadius * CAMERA_LIMITS.maxPanFactor;
  return Math.min(maxPan, Math.max(-maxPan, pan));
}

export function normalizeCameraTransform(
  camera: CameraTransform,
  worldRadius: number = WORLD_SPACE_LIMITS.extendedRadius
): CameraTransform {
  return {
    zoom: clampCameraZoom(camera.zoom),
    panX: clampCameraPan(camera.panX, worldRadius),
    panY: clampCameraPan(camera.panY, worldRadius),
  };
}

/**
 * World-to-screen CSS pixel scale factor.
 */
export function computeWorldToScreenScale(
  camera: CameraTransform,
  displaySize: number
): number {
  const safeSize = Math.max(1, displaySize);
  return (safeSize / LOGICAL_CANVAS_SIZE) * clampCameraZoom(camera.zoom);
}

/**
 * Maps a canonical world point (centered around LOGICAL_CENTER) to viewport-local CSS coordinates [0, displaySize].
 */
export function worldToScreenPoint(
  worldPt: Point,
  camera: CameraTransform,
  displaySize: number,
  viewportWidth: number = displaySize,
  viewportHeight: number = displaySize
): Point {
  const scale = computeWorldToScreenScale(camera, displaySize);
  return {
    x: (worldPt.x - LOGICAL_CENTER.x - camera.panX) * scale + viewportWidth / 2,
    y: (worldPt.y - LOGICAL_CENTER.y - camera.panY) * scale + viewportHeight / 2,
    ...(worldPt.pressure !== undefined ? { pressure: worldPt.pressure } : {}),
  };
}

/**
 * Exact analytical inverse mapping viewport-local CSS coordinates -> world coordinates.
 */
export function screenToWorldPoint(
  screenPt: Point,
  camera: CameraTransform,
  displaySize: number,
  viewportWidth: number = displaySize,
  viewportHeight: number = displaySize
): Point {
  const scale = computeWorldToScreenScale(camera, displaySize);
  return {
    x: LOGICAL_CENTER.x + camera.panX + (screenPt.x - viewportWidth / 2) / scale,
    y: LOGICAL_CENTER.y + camera.panY + (screenPt.y - viewportHeight / 2) / scale,
    ...(screenPt.pressure !== undefined ? { pressure: screenPt.pressure } : {}),
  };
}

/**
 * Computes a new CameraTransform zoomed to `targetZoom` while anchoring the world point
 * currently under `anchorScreenPt` fixed on screen.
 */
export function zoomCameraAtScreenPoint(
  camera: CameraTransform,
  targetZoom: number,
  anchorScreenPt: Point,
  displaySize: number,
  worldRadius: number = WORLD_SPACE_LIMITS.extendedRadius,
  viewportWidth: number = displaySize,
  viewportHeight: number = displaySize
): CameraTransform {
  const clampedZoom = clampCameraZoom(targetZoom);
  const worldBefore = screenToWorldPoint(
    anchorScreenPt,
    camera,
    displaySize,
    viewportWidth,
    viewportHeight
  );
  const nextScale = (Math.max(1, displaySize) / LOGICAL_CANVAS_SIZE) * clampedZoom;

  const nextPanX =
    worldBefore.x - LOGICAL_CENTER.x - (anchorScreenPt.x - viewportWidth / 2) / nextScale;
  const nextPanY =
    worldBefore.y - LOGICAL_CENTER.y - (anchorScreenPt.y - viewportHeight / 2) / nextScale;

  return {
    zoom: clampedZoom,
    panX: clampCameraPan(nextPanX, worldRadius),
    panY: clampCameraPan(nextPanY, worldRadius),
  };
}

/**
 * Inverse-zoom pointer decimation threshold:
 * Maintains constant screen-space smoothness (`screenDistSq`) whether zoomed to 8x detail or 0.25x overview.
 */
export function computeWorldMinDistSq(
  screenThresholdSq: number,
  zoom: number
): number {
  const safeZoom = clampCameraZoom(zoom);
  return screenThresholdSq / (safeZoom * safeZoom);
}

/**
 * Computes the visible world-space AABB frustum covered by the viewport.
 */
export function computeCameraVisibleWorldBounds(
  camera: CameraTransform,
  displaySize: number,
  marginScreenPx: number = 24,
  viewportWidth: number = displaySize,
  viewportHeight: number = displaySize
): WorldBounds {
  const topLeft = screenToWorldPoint(
    { x: -marginScreenPx, y: -marginScreenPx },
    camera,
    displaySize,
    viewportWidth,
    viewportHeight
  );
  const bottomRight = screenToWorldPoint(
    { x: viewportWidth + marginScreenPx, y: viewportHeight + marginScreenPx },
    camera,
    displaySize,
    viewportWidth,
    viewportHeight
  );
  return {
    minX: Math.min(topLeft.x, bottomRight.x),
    minY: Math.min(topLeft.y, bottomRight.y),
    maxX: Math.max(topLeft.x, bottomRight.x),
    maxY: Math.max(topLeft.y, bottomRight.y),
  };
}

/**
 * Computes the Axis-Aligned Bounding Box (AABB) of a stroke inflated by half strokeWidth.
 */
export function computeStrokeWorldBounds(stroke: WedgeStroke): WorldBounds {
  if (stroke.points.length === 0) {
    return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const pt of stroke.points) {
    if (pt.x < minX) minX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y > maxY) maxY = pt.y;
  }

  const pad = Math.max(2, stroke.strokeWidth / 2 + 2);
  return {
    minX: minX - pad,
    minY: minY - pad,
    maxX: maxX + pad,
    maxY: maxY + pad,
  };
}

export function boundsIntersect(a: WorldBounds, b: WorldBounds): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

/**
 * Filters expanded strokes against the current camera frustum via O(N) AABB culling.
 */
export function cullStrokesToWorldBounds(
  strokes: readonly WedgeStroke[],
  visibleBounds: WorldBounds
): WedgeStroke[] {
  const visible: WedgeStroke[] = [];
  for (const stroke of strokes) {
    if (stroke.points.length === 0) continue;
    const strokeBounds = computeStrokeWorldBounds(stroke);
    if (boundsIntersect(strokeBounds, visibleBounds)) {
      visible.push(stroke);
    }
  }
  return visible;
}

/**
 * Applies the Phase A CameraTransform directly to a Canvas 2D context with devicePixelRatio scaling.
 */
export function applyCameraTransformToContext(
  ctx: CanvasRenderingContext2D,
  camera: CameraTransform,
  displaySize: number,
  dpr: number,
  viewportWidth: number = displaySize,
  viewportHeight: number = displaySize
): number {
  const worldScale = computeWorldToScreenScale(camera, displaySize) * dpr;
  const halfPxX = (viewportWidth * dpr) / 2;
  const halfPxY = (viewportHeight * dpr) / 2;
  ctx.setTransform(
    worldScale,
    0,
    0,
    worldScale,
    halfPxX - (LOGICAL_CENTER.x + camera.panX) * worldScale,
    halfPxY - (LOGICAL_CENTER.y + camera.panY) * worldScale
  );
  return worldScale;
}

/**
 * Measures maximum radial extent of drawn strokes from LOGICAL_CENTER (useful for extended export sizing).
 */
export function measureWedgesMaxRadius(
  wedges: readonly WedgeStroke[],
  center: Point = LOGICAL_CENTER,
  minRadius: number = WORLD_SPACE_LIMITS.baseRadius
): number {
  let maxRadiusSq = minRadius * minRadius;
  for (const w of wedges) {
    const pad = w.strokeWidth / 2;
    for (const pt of w.points) {
      const dx = Math.abs(pt.x - center.x) + pad;
      const dy = Math.abs(pt.y - center.y) + pad;
      const rSq = dx * dx + dy * dy;
      if (rSq > maxRadiusSq) {
        maxRadiusSq = rSq;
      }
    }
  }
  return Math.ceil(Math.sqrt(maxRadiusSq));
}
