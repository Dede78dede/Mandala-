/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lazy Module-Scope WASM Worker Loader & Capability Client (MANDALA-PH3-WASM-001 Tasks 3.1.D & 3.1.E).
 * Excluded from initial critical execution; instantiated lazily only when requested or triggered
 * by empirical threshold / feature flag. Falls back cleanly to JS on Worker/WASM failure.
 */

import { Result, ok, err } from '../../../shared/lib/result.ts';
import {
  LOGICAL_CENTER,
  MANDALA_LIMITS,
  WASM_CONFIG,
  isWasmSymmetryFlagEnabled,
} from '../model/constants.ts';
import {
  MirrorMode,
  SymmetryStrategyKind,
  WasmWorkerStatus,
  WorkerMsgType,
  type Point,
  type SymmetryParams,
  type WedgeStroke,
} from '../model/types.ts';
import {
  packPointsToFloat64,
  reconstructFractalStrokesFromBuffer,
  reconstructWedgesFromBuffer,
  instantiateMandalaWasm,
  type WasmSymmetryInstance,
} from './wasmSymmetryAdapter.ts';
import type { WorkerInboundMessage, WorkerOutboundMessage } from './workerProtocol.ts';

export { isWasmSymmetryFlagEnabled };

export interface WasmLSystemResult {
  readonly strokes: WedgeStroke[];
  readonly baseSegmentCount: number;
  readonly expandedSegmentCount: number;
  readonly computeMs: number;
  readonly roundTripMs: number;
}

export interface WasmWorkerClient {
  readonly status: WasmWorkerStatus;
  readonly wasmBinaryBytes: number;
  expandWedgeZeroCopy(
    wedge: WedgeStroke,
    params: SymmetryParams,
    center?: Point
  ): Promise<Result<{ strokes: WedgeStroke[]; computeMs: number; roundTripMs: number }, string>>;
  expandLSystemZeroCopy(params: {
    idPrefix: string;
    axiom: string;
    rules: Readonly<Record<string, string>>;
    generations: number;
    stepLength: number;
    angleDegrees: number;
    order: number;
    color: string;
    strokeWidth: number;
    center?: Point;
  }): Promise<Result<WasmLSystemResult, string>>;
  triggerPanicTest(): Promise<Result<void, string>>;
  dispose(): void;
}

let cachedClientPromise: Promise<Result<WasmWorkerClient, string>> | null = null;
let cachedInlineWasmPromise: Promise<Result<WasmSymmetryInstance, string>> | null = null;

/**
 * Lazy-loads the standalone `.wasm` binary directly (used by Benchmark Matrix
 * to compare JS vs raw WASM compute cleanly without worker messaging overhead).
 */
export function loadWasmSymmetryInstance(): Promise<Result<WasmSymmetryInstance, string>> {
  if (!cachedInlineWasmPromise) {
    cachedInlineWasmPromise = (async () => {
      if (typeof fetch === 'undefined') {
        return err('Fetch API non disponibile per caricamento WASM.');
      }
      try {
        const res = await fetch(WASM_CONFIG.binaryUrl);
        return await instantiateMandalaWasm(res);
      } catch (e) {
        return err(e instanceof Error ? e.message : 'Caricamento WASM fallito.');
      }
    })();
  }
  return cachedInlineWasmPromise;
}

/**
 * React 19 `use()`-safe cached module-scope Promise creating and initializing the persistent Worker.
 */
export function loadWasmWorkerClient(): Promise<Result<WasmWorkerClient, string>> {
  if (!cachedClientPromise) {
    cachedClientPromise = createPersistentWorkerClient();
  }
  return cachedClientPromise;
}

export function resetWasmLoaderCache(): void {
  cachedClientPromise = null;
  cachedInlineWasmPromise = null;
}

type PendingJobPayload =
  | {
      kind: 'expand';
      buffer: Float64Array;
      lengths: Uint32Array;
      computeMs: number;
      roundTripMs: number;
    }
  | {
      kind: 'lsystem';
      buffer: Float64Array;
      baseLengths: Uint32Array;
      order: number;
      baseSegmentCount: number;
      expandedSegmentCount: number;
      computeMs: number;
      roundTripMs: number;
    };

async function createPersistentWorkerClient(): Promise<Result<WasmWorkerClient, string>> {
  if (typeof Worker === 'undefined') {
    return err('Web Worker non supportati in questo ambiente (fallback JS attivo).');
  }

  return new Promise<Result<WasmWorkerClient, string>>((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./symmetryWorker.ts', import.meta.url), {
        type: 'module',
      });
    } catch (e) {
      resolve(err(e instanceof Error ? e.message : 'Creazione Web Worker fallita.'));
      return;
    }

    let jobSeq = 0;
    let disposed = false;
    let settledInit = false;

    const pendingJobs = new Map<
      number,
      {
        resolveJob: (res: Result<PendingJobPayload, string>) => void;
        tStart: number;
      }
    >();

    const initTimeout = setTimeout(() => {
      if (!settledInit) {
        settledInit = true;
        worker.terminate();
        resolve(err('Timeout inizializzazione Web Worker WASM.'));
      }
    }, 6000);

    worker.onmessage = (event: MessageEvent<WorkerOutboundMessage>) => {
      const msg = event.data;

      if (msg.type === WorkerMsgType.Ready) {
        if (!settledInit) {
          settledInit = true;
          clearTimeout(initTimeout);

          const client: WasmWorkerClient = {
            status: WasmWorkerStatus.Ready,
            wasmBinaryBytes: msg.wasmBytes,

            async expandWedgeZeroCopy(wedge, params, center = LOGICAL_CENTER) {
              if (disposed) {
                return err('Worker WASM già dismesso.');
              }
              if (params.strategyId === SymmetryStrategyKind.Fractal) {
                return err('Usare expandLSystemZeroCopy per la strategia frattale.');
              }
              const flatPoints = packPointsToFloat64(wedge.points);
              const jobId = ++jobSeq;

              const jobRes = await new Promise<Result<PendingJobPayload, string>>((resolveJob) => {
                pendingJobs.set(jobId, { resolveJob, tStart: performance.now() });
                const payload: WorkerInboundMessage = {
                  type: WorkerMsgType.Expand,
                  jobId,
                  points: flatPoints,
                  order: params.order,
                  strategyId: params.strategyId,
                  mirrorMode:
                    params.strategyId === SymmetryStrategyKind.MirrorRadial
                      ? params.mirrorMode
                      : MirrorMode.Reflect,
                  cx: center.x,
                  cy: center.y,
                };
                // Zero-copy ownership transfer of input Float64Array
                worker.postMessage(payload, [flatPoints.buffer]);
              });

              if (!jobRes.ok) return err(jobRes.error);
              if (jobRes.value.kind !== 'expand') return err('Risposta worker inattesa.');

              return ok({
                strokes: reconstructWedgesFromBuffer(
                  wedge,
                  jobRes.value.buffer,
                  jobRes.value.lengths,
                  params
                ),
                computeMs: jobRes.value.computeMs,
                roundTripMs: jobRes.value.roundTripMs,
              });
            },

            async expandLSystemZeroCopy(req) {
              if (disposed) {
                return err('Worker WASM già dismesso.');
              }
              const center = req.center ?? LOGICAL_CENTER;
              const jobId = ++jobSeq;

              const jobRes = await new Promise<Result<PendingJobPayload, string>>((resolveJob) => {
                pendingJobs.set(jobId, { resolveJob, tStart: performance.now() });
                const payload: WorkerInboundMessage = {
                  type: WorkerMsgType.ExpandLSystem,
                  jobId,
                  axiom: req.axiom,
                  rules: req.rules,
                  generations: Math.min(req.generations, MANDALA_LIMITS.lSystemCapGenerations),
                  stepLength: req.stepLength,
                  angleDegrees: req.angleDegrees,
                  order: req.order,
                  cx: center.x,
                  cy: center.y,
                };
                worker.postMessage(payload);
              });

              if (!jobRes.ok) return err(jobRes.error);
              if (jobRes.value.kind !== 'lsystem') return err('Risposta worker L-System inattesa.');

              return ok({
                strokes: reconstructFractalStrokesFromBuffer(
                  req.idPrefix,
                  jobRes.value.buffer,
                  jobRes.value.baseLengths,
                  jobRes.value.order,
                  req.color,
                  req.strokeWidth
                ),
                baseSegmentCount: jobRes.value.baseSegmentCount,
                expandedSegmentCount: jobRes.value.expandedSegmentCount,
                computeMs: jobRes.value.computeMs,
                roundTripMs: jobRes.value.roundTripMs,
              });
            },

            async triggerPanicTest() {
              if (disposed) return err('Worker dismesso.');
              const jobId = ++jobSeq;
              const panicRes = await new Promise<Result<unknown, string>>((resolveJob) => {
                pendingJobs.set(jobId, {
                  resolveJob: (r) => resolveJob(r),
                  tStart: performance.now(),
                });
                worker.postMessage({
                  type: WorkerMsgType.InjectPanic,
                  jobId,
                } satisfies WorkerInboundMessage);
              });
              return panicRes.ok ? ok(undefined) : err(panicRes.error);
            },

            dispose() {
              disposed = true;
              for (const pending of pendingJobs.values()) {
                pending.resolveJob(err('Worker terminato prima del completamento job.'));
              }
              pendingJobs.clear();
              worker.terminate();
            },
          };

          resolve(ok(client));
        }
        return;
      }

      if (msg.type === WorkerMsgType.Expanded) {
        const pending = pendingJobs.get(msg.jobId);
        if (pending) {
          pendingJobs.delete(msg.jobId);
          pending.resolveJob(
            ok({
              kind: 'expand',
              buffer: msg.buffer,
              lengths: msg.lengths,
              computeMs: msg.computeMs,
              roundTripMs: performance.now() - pending.tStart,
            })
          );
        }
        return;
      }

      if (msg.type === WorkerMsgType.LSystemExpanded) {
        const pending = pendingJobs.get(msg.jobId);
        if (pending) {
          pendingJobs.delete(msg.jobId);
          pending.resolveJob(
            ok({
              kind: 'lsystem',
              buffer: msg.buffer,
              baseLengths: msg.baseLengths,
              order: msg.order,
              baseSegmentCount: msg.baseSegmentCount,
              expandedSegmentCount: msg.expandedSegmentCount,
              computeMs: msg.computeMs,
              roundTripMs: performance.now() - pending.tStart,
            })
          );
        }
        return;
      }

      if (msg.type === WorkerMsgType.Error) {
        if (!settledInit && msg.jobId === null) {
          settledInit = true;
          clearTimeout(initTimeout);
          worker.terminate();
          resolve(err(msg.message));
          return;
        }
        if (msg.jobId !== null) {
          const pending = pendingJobs.get(msg.jobId);
          if (pending) {
            pendingJobs.delete(msg.jobId);
            pending.resolveJob(err(msg.message));
          }
        }
      }
    };

    worker.onerror = (ev) => {
      const msg = ev.message || 'Errore fatale nel Web Worker WASM.';
      if (!settledInit) {
        settledInit = true;
        clearTimeout(initTimeout);
        worker.terminate();
        resolve(err(msg));
      }
    };

    worker.postMessage({
      type: WorkerMsgType.Init,
      wasmUrl: WASM_CONFIG.binaryUrl,
    } satisfies WorkerInboundMessage);
  });
}
