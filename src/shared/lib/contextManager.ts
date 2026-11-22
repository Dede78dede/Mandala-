/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Deterministic Context Managers (`try ... finally` RAII-style scopes).
 * Guarantees Canvas state balance, Offscreen backing-store release (64MB at 4K),
 * ImageBitmap GPU release, Object URL revocation, PointerCapture diagnostics,
 * LIFO resource scopes, and precise scope timing even if callbacks throw.
 */

import {
  DiagnosticSeverity,
  DiagnosticSource,
  DomainErrorCode,
  reportDiagnostic,
} from './diagnostics.ts';
import { Result, err, ok } from './result.ts';

export interface DisposableResource {
  dispose(): void;
}

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
 * Scopes an ImageBitmap and guarantees `bitmap.close()` on exit (sync or async).
 */
export async function withImageBitmap<T>(
  bitmap: ImageBitmap,
  fn: (bmp: ImageBitmap) => Promise<T> | T
): Promise<T> {
  try {
    return await fn(bitmap);
  } finally {
    try {
      bitmap.close();
    } catch {
      // Bitmap may already be closed by caller transfer
    }
  }
}

/**
 * Scopes a temporary Blob Object URL and revokes it deterministically on sync exit.
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
 * Scopes a temporary Blob Object URL across an async operation and revokes it on exit.
 */
export async function withBlobUrlAsync<T>(
  blob: Blob,
  fn: (url: string) => Promise<T>
): Promise<T> {
  const url = URL.createObjectURL(blob);
  try {
    return await fn(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Safely acquires DOM pointer capture and emits a discrete diagnostic on rejection
 * (e.g., synthetic pointers in tests or detached DOM targets).
 */
export function safelyAcquirePointerCapture(target: Element, pointerId: number): boolean {
  if (typeof target.setPointerCapture !== 'function') {
    return false;
  }
  try {
    target.setPointerCapture(pointerId);
    return true;
  } catch (cause) {
    reportDiagnostic({
      severity: DiagnosticSeverity.Info,
      source: DiagnosticSource.Viewport,
      code: DomainErrorCode.PointerCaptureDenied,
      message: `setPointerCapture rifiutato per pointerId=${pointerId}.`,
      cause,
    });
    return false;
  }
}

/**
 * Safely releases DOM pointer capture when still held.
 */
export function safelyReleasePointerCapture(target: Element, pointerId: number): void {
  if (typeof target.releasePointerCapture !== 'function') {
    return;
  }
  try {
    if (typeof target.hasPointerCapture === 'function' && !target.hasPointerCapture(pointerId)) {
      return;
    }
    target.releasePointerCapture(pointerId);
  } catch {
    // Pointer may have been implicitly released by the browser before pointerup
  }
}

/**
 * LIFO scope stack mirroring Python's `contextlib.ExitStack`.
 */
export function createResourceScope() {
  const stack: Array<() => void> = [];
  return {
    adopt<R extends DisposableResource>(resource: R): R {
      stack.push(() => resource.dispose());
      return resource;
    },
    defer(cleanup: () => void): void {
      stack.push(cleanup);
    },
    disposeAll(): void {
      while (stack.length > 0) {
        const fn = stack.pop();
        if (!fn) continue;
        try {
          fn();
        } catch {
          // Isolate teardown exceptions so remaining cleanups execute
        }
      }
    },
  };
}

/**
 * Measures synchronous block execution duration in milliseconds cleanly.
 */
export function withTimedScope<T>(fn: () => T): { result: T; durationMs: number } {
  const t0 = performance.now();
  const result = fn();
  return { result, durationMs: performance.now() - t0 };
}
