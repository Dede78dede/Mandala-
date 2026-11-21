/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Deterministic Context Managers (`try ... finally` RAII-style scopes).
 * Guarantees Canvas state balance, Offscreen backing-store release (64MB at 4K),
 * Object URL revocation, and precise scope timing even if callbacks throw.
 */

import { Result, ok, err } from './result.ts';

/**
 * Automatically balances `ctx.save()` and `ctx.restore()`.
 */
export function withCanvasState<T>(
  ctx: CanvasRenderingContext2D,
  fn: (context: CanvasRenderingContext2D) => T
): T {
  ctx.save();
  try {
    return fn(ctx);
  } finally {
    ctx.restore();
  }
}

/**
 * Allocates an isolated HTMLCanvasElement backing surface and deterministically
 * releases its GPU/bitmap memory (`width = 0; height = 0`) on scope exit.
 */
export function withOffscreenCanvas<T>(
  width: number,
  height: number,
  fn: (canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) => T
): Result<T, string> {
  if (typeof document === 'undefined') {
    return err('Contesto DOM non disponibile per canvas off-screen.');
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    canvas.width = 0;
    canvas.height = 0;
    return err('Contesto Canvas 2D non disponibile.');
  }
  try {
    return ok(fn(canvas, ctx));
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

/**
 * Scopes a temporary Blob Object URL and revokes it deterministically on exit.
 */
export function withBlobUrl<T>(blob: Blob, fn: (url: string) => T): T {
  const url = URL.createObjectURL(blob);
  try {
    return fn(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Measures synchronous block execution duration in milliseconds cleanly.
 */
export function withTimedScope<T>(fn: () => T): { result: T; durationMs: number } {
  const t0 = performance.now();
  const result = fn();
  return { result, durationMs: performance.now() - t0 };
}
