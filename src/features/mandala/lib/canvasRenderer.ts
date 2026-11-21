/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure Canvas 2D Stroke & Layer Renderer (Single Source of Truth + Context Managers + Smart Bitmap Memoization).
 * - Caches committed scene rasterization on a reusable offscreen backing canvas for O(1) repaints
 * - Registers snapshot release hook with `cacheService` for deterministic Flush Cache cleanup
 * - Records live CPU render duration telemetry for the anti-saturation/CPU guard
 */

import { registerRenderSnapshotClearer } from '../../../shared/lib/cacheService.ts';
import { withCanvasState, withOffscreenCanvas } from '../../../shared/lib/contextManager.ts';
import {
  CANVAS_THEME,
  LOGICAL_CANVAS_SIZE,
  LOGICAL_CENTER,
  MANDALA_LIMITS,
} from '../model/constants.ts';
import {
  KineticMode,
  MirrorMode,
  SymmetryStrategyKind,
  type CameraTransform,
  type Point,
  type SymmetryParams,
  type WedgeStroke,
} from '../model/types.ts';
import { JsGeometryEngine } from '../engine/geometryEngine.ts';
import { blitPixelBufferToCanvas } from '../engine/pixelBufferEscapeHatch.ts';
import { symmetrySignature } from '../memory/geometryCache.ts';
import type { TypedPointBuffer } from '../memory/pointBuffer.ts';
import { recordCpuRenderSample } from './resourceGuard.ts';
import {
  applyCameraTransformToContext,
  computeCameraVisibleWorldBounds,
  cullStrokesToWorldBounds,
  DEFAULT_CAMERA_TRANSFORM,
} from './viewportCamera.ts';
import {
  computeBandAngleRad,
  computeBreathingScale,
  computeStrokeReplaySlice,
  partitionWedgesIntoRadialBands,
} from './kineticMandala.ts';
import { interpolateStrokeScene } from './morphInterpolator.ts';

interface CommittedSnapshotEntry {
  key: string;
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

let cachedSceneSnapshot: CommittedSnapshotEntry | null = null;

export function clearCommittedSceneSnapshot(): number {
  if (!cachedSceneSnapshot) return 0;
  cachedSceneSnapshot.canvas.width = 0;
  cachedSceneSnapshot.canvas.height = 0;
  cachedSceneSnapshot = null;
  return 1;
}

registerRenderSnapshotClearer(clearCommittedSceneSnapshot);

function buildRenderSnapshotKey(
  wedges: readonly WedgeStroke[],
  params: SymmetryParams,
  width: number,
  height: number,
  forceEscapeHatch: boolean,
  sceneVersion?: number,
  camera: CameraTransform = DEFAULT_CAMERA_TRANSFORM
): string {
  const ver =
    sceneVersion !== undefined
      ? String(sceneVersion)
      : `${wedges.length}:${wedges[0]?.id ?? 'none'}:${wedges[wedges.length - 1]?.id ?? 'none'}`;
  const camSig = `${camera.zoom.toFixed(3)}:${camera.panX.toFixed(1)}:${camera.panY.toFixed(1)}`;
  return `${ver}|${symmetrySignature(params, LOGICAL_CENTER)}|${width}x${height}|${camSig}|eh=${forceEscapeHatch ? 1 : 0}`;
}

/**
 * Draws a single stroke (quadratic Bezier smoothing or single-point circle stamp)
 * onto a Canvas 2D context inside a Context-Managed `save/restore` scope.
 */
export function drawStrokeOnContext(
  ctx: CanvasRenderingContext2D,
  stroke: WedgeStroke,
  coordScale: number = 1
): void {
  if (stroke.points.length === 0) return;

  withCanvasState(ctx, (c) => {
    c.globalAlpha = stroke.opacity;

    if (stroke.points.length === 1) {
      const pt = stroke.points[0];
      c.fillStyle = stroke.stroke;
      c.beginPath();
      c.arc(
        pt.x * coordScale,
        pt.y * coordScale,
        Math.max(1.5, (stroke.strokeWidth * coordScale) / 2),
        0,
        Math.PI * 2
      );
      c.fill();
      return;
    }

    c.beginPath();
    c.strokeStyle = stroke.stroke;
    c.lineWidth = stroke.strokeWidth * coordScale;
    c.lineCap = 'round';
    c.lineJoin = 'round';

    if (stroke.dash && stroke.dash.length > 0) {
      c.setLineDash(
        coordScale === 1 ? stroke.dash : stroke.dash.map((segment) => segment * coordScale)
      );
    } else {
      c.setLineDash([]);
    }

    c.moveTo(stroke.points[0].x * coordScale, stroke.points[0].y * coordScale);
    for (let i = 1; i < stroke.points.length - 1; i++) {
      const xc = ((stroke.points[i].x + stroke.points[i + 1].x) / 2) * coordScale;
      const yc = ((stroke.points[i].y + stroke.points[i + 1].y) / 2) * coordScale;
      c.quadraticCurveTo(
        stroke.points[i].x * coordScale,
        stroke.points[i].y * coordScale,
        xc,
        yc
      );
    }

    const last = stroke.points[stroke.points.length - 1];
    c.lineTo(last.x * coordScale, last.y * coordScale);
    c.stroke();
  });
}

/**
 * Zero-allocation Layer 2 active preview renderer reading directly from L0 TypedPointBuffer.
 * Accepts optional CameraTransform for Phase A Pan/Zoom interactive drawing.
 */
export function renderTypedBufferPreview(
  ctx: CanvasRenderingContext2D,
  buffer: TypedPointBuffer,
  symmetryParams: SymmetryParams,
  color: string,
  strokeWidth: number,
  dash: readonly number[] | null,
  scaleFactor: number,
  camera?: CameraTransform,
  displaySize?: number,
  dpr: number = 1,
  viewportWidth?: number,
  viewportHeight?: number
): void {
  const count = buffer.length;
  if (count < 2) return;

  withCanvasState(ctx, (c) => {
    if (camera && displaySize !== undefined) {
      applyCameraTransformToContext(
        c,
        camera,
        displaySize,
        dpr,
        viewportWidth ?? displaySize,
        viewportHeight ?? displaySize
      );
    } else {
      c.scale(scaleFactor, scaleFactor);
    }
    c.globalAlpha = MANDALA_LIMITS.previewOpacity;
    c.strokeStyle = color;
    c.lineWidth = strokeWidth;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.setLineDash(dash ? [...dash] : []);

    const order = symmetryParams.order;
    const step = (2 * Math.PI) / order;
    const isMirror = symmetryParams.strategyId === SymmetryStrategyKind.MirrorRadial;
    const isAlternate =
      isMirror && symmetryParams.mirrorMode === MirrorMode.Alternate;
    const cx = LOGICAL_CENTER.x;
    const cy = LOGICAL_CENTER.y;

    const strokeTransformedPath = (
      cos: number,
      sin: number,
      reflectCos: number | null,
      reflectSin: number | null
    ) => {
      c.beginPath();
      let prevX = 0;
      let prevY = 0;
      buffer.forEach((px, py, _pr, idx) => {
        const dx = px - cx;
        const dy = py - cy;
        const rx = cx + (dx * cos - dy * sin);
        const ry = cy + (dx * sin + dy * cos);

        let tx = rx;
        let ty = ry;
        if (reflectCos !== null && reflectSin !== null) {
          const rdx = rx - cx;
          const rdy = ry - cy;
          tx = cx + (rdx * reflectCos + rdy * reflectSin);
          ty = cy + (rdx * reflectSin - rdy * reflectCos);
        }

        if (idx === 0) {
          c.moveTo(tx, ty);
        } else if (idx < count - 1) {
          const midX = (prevX + tx) / 2;
          const midY = (prevY + ty) / 2;
          c.quadraticCurveTo(prevX, prevY, midX, midY);
        } else {
          c.lineTo(tx, ty);
        }
        prevX = tx;
        prevY = ty;
      });
      c.stroke();
    };

    for (let i = 0; i < order; i++) {
      const baseAngle = i * step;
      const cos = Math.cos(baseAngle);
      const sin = Math.sin(baseAngle);
      strokeTransformedPath(cos, sin, null, null);

      if (isMirror) {
        const mirrorAxis = baseAngle + (isAlternate && i % 2 === 1 ? step / 4 : 0);
        strokeTransformedPath(cos, sin, Math.cos(2 * mirrorAxis), Math.sin(2 * mirrorAxis));
      }
    }
  });
}

export function clearCanvasSurface(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): void {
  withCanvasState(ctx, (c) => {
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, width, height);
  });
}

/**
 * Layer 2 real-time symmetric preview for Botanical Stamp placement (anchor + drag angle/scale).
 */
export function renderStampPreview(
  ctx: CanvasRenderingContext2D,
  stampStrokes: readonly WedgeStroke[],
  symmetryParams: SymmetryParams,
  camera: CameraTransform,
  displaySize: number,
  dpr: number = 1,
  viewportWidth: number = displaySize,
  viewportHeight: number = displaySize
): void {
  if (stampStrokes.length === 0) return;
  const expanded = JsGeometryEngine.expandScene(stampStrokes, symmetryParams, LOGICAL_CENTER);
  if (!expanded.ok || expanded.value.length === 0) return;

  withCanvasState(ctx, (c) => {
    applyCameraTransformToContext(
      c,
      camera,
      displaySize,
      dpr,
      viewportWidth,
      viewportHeight
    );
    for (const s of expanded.value) {
      drawStrokeOnContext(
        c,
        {
          ...s,
          opacity: Math.min(s.opacity, MANDALA_LIMITS.previewOpacity),
        },
        1
      );
    }
  });
}

/**
 * Phase A Camera-Aware World Scene Renderer with AABB Spatial Frustum Culling
 * and O(1) Offscreen Snapshot Bitmap Blit.
 */
export function renderWorldSceneOnContext(
  ctx: CanvasRenderingContext2D,
  wedges: readonly WedgeStroke[],
  symmetryParams: SymmetryParams,
  camera: CameraTransform,
  displaySize: number,
  dpr: number,
  forceEscapeHatch: boolean = false,
  sceneVersion?: number,
  viewportWidth: number = displaySize,
  viewportHeight: number = displaySize
): void {
  const t0 = performance.now();
  const targetW = ctx.canvas.width;
  const targetH = ctx.canvas.height;

  if (wedges.length === 0 || targetW <= 0 || targetH <= 0) {
    clearCommittedSceneSnapshot();
    recordCpuRenderSample(performance.now() - t0);
    return;
  }

  const snapshotKey = buildRenderSnapshotKey(
    wedges,
    symmetryParams,
    targetW,
    targetH,
    forceEscapeHatch,
    sceneVersion,
    camera
  );

  if (
    cachedSceneSnapshot &&
    cachedSceneSnapshot.key === snapshotKey &&
    cachedSceneSnapshot.width === targetW &&
    cachedSceneSnapshot.height === targetH
  ) {
    withCanvasState(ctx, (c) => {
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.drawImage(cachedSceneSnapshot!.canvas, 0, 0);
    });
    recordCpuRenderSample(performance.now() - t0);
    return;
  }

  if (forceEscapeHatch) {
    blitPixelBufferToCanvas(ctx, wedges, symmetryParams, targetW, targetH);
    recordCpuRenderSample(performance.now() - t0);
    return;
  }

  const visibleBounds = computeCameraVisibleWorldBounds(
    camera,
    displaySize,
    32,
    viewportWidth,
    viewportHeight
  );

  if (typeof document !== 'undefined') {
    if (!cachedSceneSnapshot) {
      cachedSceneSnapshot = {
        key: '',
        canvas: document.createElement('canvas'),
        width: 0,
        height: 0,
      };
    }
    const snapCanvas = cachedSceneSnapshot.canvas;
    if (snapCanvas.width !== targetW || snapCanvas.height !== targetH) {
      snapCanvas.width = targetW;
      snapCanvas.height = targetH;
    }
    const snapCtx = snapCanvas.getContext('2d');
    if (snapCtx) {
      snapCtx.setTransform(1, 0, 0, 1, 0, 0);
      snapCtx.clearRect(0, 0, targetW, targetH);
      withCanvasState(snapCtx, (c) => {
        applyCameraTransformToContext(
          c,
          camera,
          displaySize,
          dpr,
          viewportWidth,
          viewportHeight
        );
        const expanded = JsGeometryEngine.expandScene(wedges, symmetryParams, LOGICAL_CENTER);
        if (expanded.ok) {
          const culled = cullStrokesToWorldBounds(expanded.value, visibleBounds);
          for (const s of culled) {
            drawStrokeOnContext(c, s, 1);
          }
        }
      });
      cachedSceneSnapshot.key = snapshotKey;
      cachedSceneSnapshot.width = targetW;
      cachedSceneSnapshot.height = targetH;

      withCanvasState(ctx, (c) => {
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.drawImage(snapCanvas, 0, 0);
      });
      recordCpuRenderSample(performance.now() - t0);
      return;
    }
  }

  withCanvasState(ctx, (c) => {
    applyCameraTransformToContext(
      c,
      camera,
      displaySize,
      dpr,
      viewportWidth,
      viewportHeight
    );
    const expanded = JsGeometryEngine.expandScene(wedges, symmetryParams, LOGICAL_CENTER);
    if (expanded.ok) {
      const culled = cullStrokesToWorldBounds(expanded.value, visibleBounds);
      for (const s of culled) {
        drawStrokeOnContext(c, s, 1);
      }
    }
  });
  recordCpuRenderSample(performance.now() - t0);
}

/**
 * Legacy-compatible entrypoint rendering standard 1:1 scene onto Canvas 2D.
 */
export function renderExpandedWedgesOnContext(
  ctx: CanvasRenderingContext2D,
  wedges: readonly WedgeStroke[],
  symmetryParams: SymmetryParams,
  scaleFactor: number,
  forceEscapeHatch: boolean = false,
  sceneVersion?: number
): void {
  const displayPx = Math.max(1, LOGICAL_CANVAS_SIZE * scaleFactor);
  renderWorldSceneOnContext(
    ctx,
    wedges,
    symmetryParams,
    DEFAULT_CAMERA_TRANSFORM,
    displayPx,
    1,
    forceEscapeHatch,
    sceneVersion
  );
}

export interface KineticMorphRenderOptions {
  readonly fromStrokes: readonly WedgeStroke[];
  readonly toStrokes: readonly WedgeStroke[];
  readonly morphProgress: number;
}

/**
 * Renders Kinetic Zen, Time-Lapse Stroke Replay, & Kinetic Morphing onto Canvas 2D without touching React state per frame.
 */
export function renderKineticWorldSceneOnContext(
  ctx: CanvasRenderingContext2D,
  wedges: readonly WedgeStroke[],
  symmetryParams: SymmetryParams,
  camera: CameraTransform,
  displaySize: number,
  dpr: number,
  viewportWidth: number,
  viewportHeight: number,
  kineticMode: KineticMode,
  timeSec: number,
  kineticSpeed: number,
  replayProgress: number,
  concentricBreathing: number,
  morphOptions?: KineticMorphRenderOptions
): void {
  const t0 = performance.now();
  const hasMorphGeometry =
    kineticMode === KineticMode.Morph &&
    Boolean(morphOptions && (morphOptions.fromStrokes.length > 0 || morphOptions.toStrokes.length > 0));

  if ((wedges.length === 0 && !hasMorphGeometry) || ctx.canvas.width <= 0 || ctx.canvas.height <= 0) {
    recordCpuRenderSample(performance.now() - t0);
    return;
  }

  let activeWedges: readonly WedgeStroke[];
  if (kineticMode === KineticMode.StrokeReplay) {
    activeWedges = computeStrokeReplaySlice(wedges, replayProgress).strokes;
  } else if (kineticMode === KineticMode.Morph && morphOptions) {
    activeWedges = interpolateStrokeScene(
      morphOptions.fromStrokes,
      morphOptions.toStrokes,
      morphOptions.morphProgress,
      LOGICAL_CENTER
    );
  } else {
    activeWedges = wedges;
  }

  if (activeWedges.length === 0) {
    recordCpuRenderSample(performance.now() - t0);
    return;
  }

  const expanded = JsGeometryEngine.expandScene(activeWedges, symmetryParams, LOGICAL_CENTER);
  if (!expanded.ok || expanded.value.length === 0) {
    recordCpuRenderSample(performance.now() - t0);
    return;
  }

  withCanvasState(ctx, (c) => {
    applyCameraTransformToContext(
      c,
      camera,
      displaySize,
      dpr,
      viewportWidth,
      viewportHeight
    );

    if (kineticMode === KineticMode.ConcentricRings) {
      const bands = partitionWedgesIntoRadialBands(expanded.value, LOGICAL_CENTER);
      const breatheScale = computeBreathingScale(timeSec, concentricBreathing);
      for (const band of bands) {
        if (band.strokes.length === 0) continue;
        const angleRad = computeBandAngleRad(band.bandIndex, timeSec, kineticSpeed);
        withCanvasState(c, (bandCtx) => {
          bandCtx.translate(LOGICAL_CENTER.x, LOGICAL_CENTER.y);
          bandCtx.rotate(angleRad);
          bandCtx.scale(breatheScale, breatheScale);
          bandCtx.translate(-LOGICAL_CENTER.x, -LOGICAL_CENTER.y);
          for (const s of band.strokes) {
            drawStrokeOnContext(bandCtx, s, 1);
          }
        });
      }
    } else {
      const visibleBounds = computeCameraVisibleWorldBounds(
        camera,
        displaySize,
        32,
        viewportWidth,
        viewportHeight
      );
      const culled = cullStrokesToWorldBounds(expanded.value, visibleBounds);
      for (const s of culled) {
        drawStrokeOnContext(c, s, 1);
      }
    }
  });

  recordCpuRenderSample(performance.now() - t0);
}

/**
 * Renders the supersampled source canvas (1024 / 2048 / 4096 px) uploaded into WebGL2 Lens texture.
 */
export function renderSupersampledLensSourceCanvas(
  targetCanvas: HTMLCanvasElement,
  wedges: readonly WedgeStroke[],
  symmetryParams: SymmetryParams,
  camera: CameraTransform,
  textureSizePx: number,
  includeGuidesBackground: boolean = false
): void {
  const safeRes = Math.min(4096, Math.max(512, Math.round(textureSizePx)));
  if (targetCanvas.width !== safeRes || targetCanvas.height !== safeRes) {
    targetCanvas.width = safeRes;
    targetCanvas.height = safeRes;
  }

  const ctx = targetCanvas.getContext('2d');
  if (!ctx) return;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, safeRes, safeRes);

  if (includeGuidesBackground) {
    ctx.fillStyle = CANVAS_THEME.backgroundHex;
    ctx.fillRect(0, 0, safeRes, safeRes);
  }

  if (wedges.length === 0) return;

  const visibleBounds = computeCameraVisibleWorldBounds(camera, safeRes, 64);
  withCanvasState(ctx, (c) => {
    applyCameraTransformToContext(c, camera, safeRes, 1);
    const expanded = JsGeometryEngine.expandScene(wedges, symmetryParams, LOGICAL_CENTER);
    if (expanded.ok) {
      const culled = cullStrokesToWorldBounds(expanded.value, visibleBounds);
      for (const s of culled) {
        drawStrokeOnContext(c, s, 1);
      }
    }
  });
}

export function renderEraserReticle(
  ctx: CanvasRenderingContext2D,
  point: Point,
  radius: number
): void {
  withCanvasState(ctx, (c) => {
    c.strokeStyle = CANVAS_THEME.eraserReticleHex;
    c.fillStyle = CANVAS_THEME.eraserFillRgba;
    c.lineWidth = 1.6;
    c.setLineDash([4, 4]);
    c.beginPath();
    c.arc(point.x, point.y, radius, 0, Math.PI * 2);
    c.fill();
    c.stroke();
  });
}

export function renderKeyboardCrosshair(
  ctx: CanvasRenderingContext2D,
  point: Point,
  isEraser: boolean
): void {
  withCanvasState(ctx, (c) => {
    c.strokeStyle = isEraser ? CANVAS_THEME.crosshairEraserHex : CANVAS_THEME.crosshairBrushHex;
    c.lineWidth = 2;
    c.beginPath();
    c.arc(point.x, point.y, 8, 0, Math.PI * 2);
    c.moveTo(point.x - 14, point.y);
    c.lineTo(point.x + 14, point.y);
    c.moveTo(point.x, point.y - 14);
    c.lineTo(point.x, point.y + 14);
    c.stroke();
  });
}

export function computeEraserRadius(strokeWidth: number): number {
  return Math.max(
    MANDALA_LIMITS.eraserMinRadius,
    strokeWidth * MANDALA_LIMITS.eraserRadiusMultiplier
  );
}

/**
 * Renders the Mandala onto an off-screen surface (supports tile-chunked rasterization >= 2048px
 * with AABB spatial culling to bound peak offscreen memory).
 */
export function renderMandalaToPNGDataUrl(
  wedges: readonly WedgeStroke[],
  symmetryParams: SymmetryParams,
  resolutionPx: number,
  includeBackground: boolean,
  worldDiameter: number = LOGICAL_CANVAS_SIZE
): string | null {
  const safeDiameter = Math.max(LOGICAL_CANVAS_SIZE, worldDiameter);
  const res = withOffscreenCanvas(resolutionPx, resolutionPx, (canvas, ctx) => {
    if (includeBackground) {
      ctx.fillStyle = CANVAS_THEME.backgroundHex;
      ctx.fillRect(0, 0, resolutionPx, resolutionPx);
    }

    const scale = resolutionPx / safeDiameter;
    const halfWorld = safeDiameter / 2;
    const expanded = JsGeometryEngine.expandScene(wedges, symmetryParams, LOGICAL_CENTER);
    if (!expanded.ok) {
      return canvas.toDataURL('image/png');
    }

    // Tile-chunked pass for high resolutions (>= 2048px) using AABB culling per 1024px quadrant
    if (resolutionPx >= 2048 && expanded.value.length > 0) {
      const tilePx = 1024;
      const tiles = Math.ceil(resolutionPx / tilePx);
      for (let ty = 0; ty < tiles; ty++) {
        for (let tx = 0; tx < tiles; tx++) {
          const px0 = tx * tilePx;
          const py0 = ty * tilePx;
          const pw = Math.min(tilePx, resolutionPx - px0);
          const ph = Math.min(tilePx, resolutionPx - py0);

          const tileBounds = {
            minX: LOGICAL_CENTER.x - halfWorld + px0 / scale - 16,
            minY: LOGICAL_CENTER.y - halfWorld + py0 / scale - 16,
            maxX: LOGICAL_CENTER.x - halfWorld + (px0 + pw) / scale + 16,
            maxY: LOGICAL_CENTER.y - halfWorld + (py0 + ph) / scale + 16,
          };
          const culled = cullStrokesToWorldBounds(expanded.value, tileBounds);
          if (culled.length === 0) continue;

          withCanvasState(ctx, (c) => {
            c.beginPath();
            c.rect(px0, py0, pw, ph);
            c.clip();
            c.setTransform(
              scale,
              0,
              0,
              scale,
              resolutionPx / 2 - LOGICAL_CENTER.x * scale,
              resolutionPx / 2 - LOGICAL_CENTER.y * scale
            );
            for (const s of culled) {
              drawStrokeOnContext(c, s, 1);
            }
          });
        }
      }
    } else {
      withCanvasState(ctx, (c) => {
        c.setTransform(
          scale,
          0,
          0,
          scale,
          resolutionPx / 2 - LOGICAL_CENTER.x * scale,
          resolutionPx / 2 - LOGICAL_CENTER.y * scale
        );
        for (const s of expanded.value) {
          drawStrokeOnContext(c, s, 1);
        }
      });
    }

    return canvas.toDataURL('image/png');
  });

  return res.ok ? res.value : null;
}
