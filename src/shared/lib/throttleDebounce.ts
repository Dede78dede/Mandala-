/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure Typed Debounce, Throttle & Idle Scheduling Helpers.
 * Keeps heavy serialization, accessibility mirroring, and background swaps off the 240Hz hot path.
 */

export interface DebouncedController<Args extends readonly unknown[]> {
  schedule(...args: Args): void;
  flush(): void;
  cancel(): void;
  isPending(): boolean;
}

export function createDebouncedTask<Args extends readonly unknown[]>(
  task: (...args: Args) => void,
  delayMs: number
): DebouncedController<Args> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: Args | null = null;

  const cancel = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    lastArgs = null;
  };

  const flush = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (lastArgs !== null) {
      const args = lastArgs;
      lastArgs = null;
      task(...args);
    }
  };

  const schedule = (...args: Args): void => {
    lastArgs = args;
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      if (lastArgs !== null) {
        const nextArgs = lastArgs;
        lastArgs = null;
        task(...nextArgs);
      }
    }, delayMs);
  };

  return {
    schedule,
    flush,
    cancel,
    isPending: () => timer !== null,
  };
}

export function createThrottledTask<Args extends readonly unknown[]>(
  task: (...args: Args) => void,
  intervalMs: number
): DebouncedController<Args> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastExecTime = 0;
  let pendingArgs: Args | null = null;

  const cancel = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    pendingArgs = null;
  };

  const flush = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (pendingArgs !== null) {
      const args = pendingArgs;
      pendingArgs = null;
      lastExecTime = Date.now();
      task(...args);
    }
  };

  const schedule = (...args: Args): void => {
    const now = Date.now();
    const remaining = intervalMs - (now - lastExecTime);

    if (remaining <= 0) {
      cancel();
      lastExecTime = now;
      task(...args);
      return;
    }

    pendingArgs = args;
    if (timer === null) {
      timer = setTimeout(() => {
        timer = null;
        flush();
      }, remaining);
    }
  };

  return {
    schedule,
    flush,
    cancel,
    isPending: () => timer !== null,
  };
}

/**
 * Runs non-critical work during browser idle frames with a bounded timeout fallback.
 */
export function scheduleIdleTask(task: () => void, timeoutMs: number = 300): () => void {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(task, { timeout: timeoutMs });
    return () => {
      window.cancelIdleCallback(id);
    };
  }
  const timerId = setTimeout(task, Math.min(timeoutMs, 32));
  return () => {
    clearTimeout(timerId);
  };
}
