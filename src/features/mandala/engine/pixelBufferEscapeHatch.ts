/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 3 Pixel-Buffer Escape Hatch (`render_to_buffer` / ImageData blit) (MANDALA-PH3-WASM-001 §3.2.C).
 * Bypassed for ordinary scenes (<2,000 expanded primitives). When heavy N=48 scenes cross the
 * threshold, rasterizes expanded geometry directly into a flat RGBA `Uint8ClampedArray` pixel buffer
 * and blits to Canvas in O(1) pixels per frame instead of thousands of path tessellations.
 */

import { withCanvasState, withOffscreenCanvas } from '../../../shared/lib/contextManager.ts';
import { JsGeometryEngine } from '../engine/geometryEngine.ts';
import { LOGICAL_CANVAS_SIZE, LOGICAL_CENTER, RESOURCE_GUARD_LIMITS } from '../model/constants.ts';
import type { SymmetryParams, WedgeStroke } from '../model/types.ts';

export interface RgbaColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

export interface PixelBufferSceneOutput {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  readonly expandedPrimitives: number;
  readonly nonTransparentPixels: number;
  readonly renderMs: number;
  readonly cpuBudgetAborted?: boolean;
}

export function parseHexRgba(hex: string, opacity: number): RgbaColor {
  const clean = hex.startsWith('#') ? hex.slice(1) : hex;
  if (clean.length !== 6) {
    return { r: 86, g: 180, b: 233, a: Math.round(opacity * 255) };
  }
  const r = Number.parseInt(clean.slice(0, 2), 16);
  const g = Number.parseInt(clean.slice(2, 4), 16);
  const b = Number.parseInt(clean.slice(4, 6), 16);
  return {
    r: Number.isNaN(r) ? 86 : r,
    g: Number.isNaN(g) ? 180 : g,
    b: Number.isNaN(b) ? 233 : b,
    a: Math.max(0, Math.min(255, Math.round(opacity * 255))),
  };
}

function blendPixel(
  buf: Uint8ClampedArray,
  width: number,
  height: number,
  px: number,
  py: number,
  color: RgbaColor,
  coverage: number
): void {
  if (px < 0 || py < 0 || px >= width || py >= height || coverage <= 0) return;
  const idx = (py * width + px) * 4;
  const srcA = (color.a / 255) * coverage;
  const invA = 1 - srcA;
  const dstA = buf[idx + 3] / 255;
  const outA = srcA + dstA * invA;

  if (outA <= 0) return;
  buf[idx] = Math.round((color.r * srcA + buf[idx] * dstA * invA) / outA);
  buf[idx + 1] = Math.round((color.g * srcA + buf[idx + 1] * dstA * invA) / outA);
  buf[idx + 2] = Math.round((color.b * srcA + buf[idx + 2] * dstA * invA) / outA);
  buf[idx + 3] = Math.round(outA * 255);
}

function rasterizeDisc(
  buf: Uint8ClampedArray,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
  color: RgbaColor
): void {
  const rCeil = Math.ceil(radius + 1);
  const minX = Math.max(0, Math.floor(cx - rCeil));
  const maxX = Math.min(width - 1, Math.ceil(cx + rCeil));
  const minY = Math.max(0, Math.floor(cy - rCeil));
  const maxY = Math.min(height - 1, Math.ceil(cy + rCeil));

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dist = Math.hypot(x - cx, y - cy);
      if (dist <= radius + 0.75) {
        const cov = dist <= radius - 0.5 ? 1 : Math.max(0, Math.min(1, radius + 0.75 - dist));
        blendPixel(buf, width, height, x, y, color, cov);
      }
    }
  }
}

function rasterizeCapsuleSegment(
  buf: Uint8ClampedArray,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number,
  color: RgbaColor
): void {
  const pad = Math.ceil(radius + 1);
  const minX = Math.max(0, Math.floor(Math.min(x0, x1) - pad));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(x0, x1) + pad));
  const minY = Math.max(0, Math.floor(Math.min(y0, y1) - pad));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(y0, y1) + pad));

  const vx = x1 - x0;
  const vy = y1 - y0;
  const lenSq = vx * vx + vy * vy;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      let t = 0;
      if (lenSq > 1e-6) {
        t = Math.max(0, Math.min(1, ((x - x0) * vx + (y - y0) * vy) / lenSq));
      }
      const projX = x0 + t * vx;
      const projY = y0 + t * vy;
      const dist = Math.hypot(x - projX, y - projY);
      if (dist <= radius + 0.75) {
        const cov = dist <= radius - 0.5 ? 1 : Math.max(0, Math.min(1, radius + 0.75 - dist));
        blendPixel(buf, width, height, x, y, color, cov);
      }
    }
  }
}

/**
 * Pure software RGBA pixel-buffer renderer (`render_to_buffer` semantic equivalent).
 * Unit-testable in Node without DOM and directly blitted to Canvas via ImageData.
 */
export function renderSceneToPixelBuffer(
  wedges: readonly WedgeStroke[],
  symmetryParams: SymmetryParams,
  width: number,
  height: number,
  maxBudgetMs: number = RESOURCE_GUARD_LIMITS.cpuCircuitBreakerMs * 2
): PixelBufferSceneOutput {
  const t0 = performance.now();
  const data = new Uint8ClampedArray(width * height * 4);
  const expandedRes = JsGeometryEngine.expandScene(wedges, symmetryParams, LOGICAL_CENTER);
  if (!expandedRes.ok || expandedRes.value.length === 0) {
    return {
      data,
      width,
      height,
      expandedPrimitives: 0,
      nonTransparentPixels: 0,
      renderMs: performance.now() - t0,
      cpuBudgetAborted: false,
    };
  }

  const scaleX = width / LOGICAL_CANVAS_SIZE;
  const scaleY = height / LOGICAL_CANVAS_SIZE;
  const scale = Math.min(scaleX, scaleY);
  let cpuBudgetAborted = false;

  for (let sIdx = 0; sIdx < expandedRes.value.length; sIdx++) {
    if (sIdx > 0 && sIdx % 64 === 0 && performance.now() - t0 > maxBudgetMs) {
      cpuBudgetAborted = true;
      break;
    }

    const stroke = expandedRes.value[sIdx];
    if (stroke.points.length === 0) continue;
    const rgba = parseHexRgba(stroke.stroke, stroke.opacity);
    const radius = Math.max(0.9, (stroke.strokeWidth * scale) / 2);

    if (stroke.points.length === 1) {
      rasterizeDisc(
        data,
        width,
        height,
        stroke.points[0].x * scaleX,
        stroke.points[0].y * scaleY,
        radius,
        rgba
      );
      continue;
    }

    for (let i = 0; i < stroke.points.length - 1; i++) {
      const a = stroke.points[i];
      const b = stroke.points[i + 1];
      rasterizeCapsuleSegment(
        data,
        width,
        height,
        a.x * scaleX,
        a.y * scaleY,
        b.x * scaleX,
        b.y * scaleY,
        radius,
        rgba
      );
    }
  }

  let nonTransparentPixels = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 0) nonTransparentPixels += 1;
  }

  return {
    data,
    width,
    height,
    expandedPrimitives: expandedRes.value.length,
    nonTransparentPixels,
    renderMs: performance.now() - t0,
    cpuBudgetAborted,
  };
}

/**
 * Blits a rendered RGBA `Uint8ClampedArray` pixel buffer onto the destination Canvas 2D context
 * using a Context-Managed temporary surface (`width=0; height=0` cleanup).
 */
export function blitPixelBufferToCanvas(
  ctx: CanvasRenderingContext2D,
  wedges: readonly WedgeStroke[],
  symmetryParams: SymmetryParams,
  targetWidth: number,
  targetHeight: number
): PixelBufferSceneOutput {
  const rasterDim = Math.min(LOGICAL_CANVAS_SIZE, Math.max(256, targetWidth));
  const pixelOutput = renderSceneToPixelBuffer(wedges, symmetryParams, rasterDim, rasterDim);

  withOffscreenCanvas(rasterDim, rasterDim, (offCanvas, offCtx) => {
    const imgData = new ImageData(
      new Uint8ClampedArray(pixelOutput.data),
      rasterDim,
      rasterDim
    );
    offCtx.putImageData(imgData, 0, 0);

    withCanvasState(ctx, (c) => {
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.imageSmoothingEnabled = true;
      c.drawImage(offCanvas, 0, 0, targetWidth, targetHeight);
    });
  });

  return pixelOutput;
}
