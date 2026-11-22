/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lazy Module-Scope WASM Worker Loader & Capability Client (MANDALA-PH3-WASM-001 Tasks 3.1.D & 3.1.E).
 * Excluded from initial critical execution; instantiated lazily only when requested or triggered
 * by empirical threshold / feature flag. Enforces per-job timeouts and clean crash recovery.
 */

import {
  DiagnosticSeverity,
  DiagnosticSource,
  DomainErrorCode,
  reportDiagnostic,
} from '../../../shared/lib/diagnostics.ts';
import { Result, ok, err } from '../../../shared/lib/result.ts';
import {
  LOGICAL_CENTER,
  MANDALA_LIMITS,
  WASM_ABI_SPEC,
  WASM_CONFIG,
  isWasmSymmetryFlagEnabled,
} from '../model/constants.ts';
import { MANDALA_MESSAGES } from '../model/messages.ts';
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
    baseOnly?: boolean;
  }): Promise<Result<WasmLSystemResult, string>>;
  triggerPanicTest(): Promise<Result<void, string>>;
  dispose(): void;
}

let cachedClientPromise: Promise<Result<WasmWorkerClient, string>> | null = null;
let cachedInlineWasmPromise: Promise<Result<WasmSymmetryInstance, string>> | null = null;

export function loadWasmSymmetryInstance(): Promise<Result<WasmSymmetryInstance, string>> {
  if (!cachedInlineWasmPromise) {
    cachedInlineWasmPromise = (async () => {
      if (typeof fetch === 'undefined') {
        return err(MANDALA_MESSAGES.wasmWorker.fetchNotAvailable);
      }
      try {
        const res = await fetch(WASM_CONFIG.binaryUrl);
        return await instantiateMandalaWasm(res);
      } catch (e) {
        reportDiagnostic({
          severity: DiagnosticSeverity.Warning,
          source: DiagnosticSource.WasmWorker,
          code: DomainErrorCode.WasmInitFailed,
          message: 'Caricamento diretto modulo WASM fallito.',
          cause: e,
        });
        return err(e instanceof Error ? e.message : 'Caricamento WASM fallito.');
      }
    })();
  }
  return cachedInlineWasmPromise;
}

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

interface PendingJobEntry {
  readonly resolveJob: (res: Result<PendingJobPayload, string>) => void;
  readonly tStart: number;
  readonly timeoutId: ReturnType<typeof setTimeout>;
}

async function createPersistentWorkerClient(): Promise<Result<WasmWorkerClient, string>> {
  if (typeof Worker === 'undefined') {
    reportDiagnostic({
      severity: DiagnosticSeverity.Info,
      source: DiagnosticSource.WasmWorker,
      code: DomainErrorCode.WasmFallbackToJs,
      message: MANDALA_MESSAGES.wasmWorker.workerNotSupported,
    });
    return err(MANDALA_MESSAGES.wasmWorker.workerNotSupported);
  }

  return new Promise<Result<WasmWorkerClient, string>>((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./symmetryWorker.ts', import.meta.url), {
        type: 'module',
      });
    } catch (e) {
      reportDiagnostic({
        severity: DiagnosticSeverity.Warning,
        source: DiagnosticSource.WasmWorker,
        code: DomainErrorCode.WasmInitFailed,
        message: MANDALA_MESSAGES.wasmWorker.workerCreationFailed,
        userNotice: MANDALA_MESSAGES.wasmWorker.fallbackNotice,
        cause: e,
      });
      resolve(err(e instanceof Error ? e.message : MANDALA_MESSAGES.wasmWorker.workerCreationFailed));
      return;
    }

    let jobSeq = 0;
    let disposed = false;
    let settledInit = false;

    const pendingJobs = new Map<number, PendingJobEntry>();

    const settlePendingJob = (jobId: number, outcome: Result<PendingJobPayload, string>): void => {
      const pending = pendingJobs.get(jobId);
      if (!pending) return;
      pendingJobs.delete(jobId);
      clearTimeout(pending.timeoutId);
      pending.resolveJob(outcome);
    };

    const failAllPendingJobs = (reason: string): void => {
      for (const [id, pending] of pendingJobs.entries()) {
        clearTimeout(pending.timeoutId);
        pending.resolveJob(err(reason));
        pendingJobs.delete(id);
      }
    };

    const registerJob = (
      jobId: number,
      resolveJob: (res: Result<PendingJobPayload, string>) => void
    ): void => {
      const timeoutId = setTimeout(() => {
        if (!pendingJobs.has(jobId)) return;
        const msg = MANDALA_MESSAGES.wasmWorker.timeoutError(jobId);
        reportDiagnostic({
          severity: DiagnosticSeverity.Warning,
          source: DiagnosticSource.WasmWorker,
          code: DomainErrorCode.WasmWorkerTimeout,
          message: msg,
          userNotice: MANDALA_MESSAGES.wasmWorker.fallbackNotice,
        });
        settlePendingJob(jobId, err(msg));
      }, WASM_ABI_SPEC.workerJobTimeoutMs);

      pendingJobs.set(jobId, {
        resolveJob,
        tStart: performance.now(),
        timeoutId,
      });
    };

    const initTimeout = setTimeout(() => {
      if (!settledInit) {
        settledInit = true;
        disposed = true;
        worker.terminate();
        cachedClientPromise = null;
        reportDiagnostic({
          severity: DiagnosticSeverity.Warning,
          source: DiagnosticSource.WasmWorker,
          code: DomainErrorCode.WasmWorkerTimeout,
          message: MANDALA_MESSAGES.wasmWorker.initTimeoutError,
          userNotice: MANDALA_MESSAGES.wasmWorker.fallbackNotice,
        });
        resolve(err(MANDALA_MESSAGES.wasmWorker.initTimeoutError));
      }
    }, WASM_ABI_SPEC.workerInitTimeoutMs);

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
                return err(MANDALA_MESSAGES.wasmWorker.workerDisposed);
              }
              if (params.strategyId === SymmetryStrategyKind.Fractal) {
                return err(MANDALA_MESSAGES.wasmWorker.useLSystemMethod);
              }
              const flatPoints = packPointsToFloat64(wedge.points);
              const jobId = ++jobSeq;

              const jobRes = await new Promise<Result<PendingJobPayload, string>>((resolveJob) => {
                registerJob(jobId, resolveJob);
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
                worker.postMessage(payload, [flatPoints.buffer]);
              });

              if (!jobRes.ok) return err(jobRes.error);
              if (jobRes.value.kind !== 'expand') {
                return err(MANDALA_MESSAGES.wasmWorker.unexpectedReply);
              }

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
                return err(MANDALA_MESSAGES.wasmWorker.workerDisposed);
              }
              const center = req.center ?? LOGICAL_CENTER;
              const jobId = ++jobSeq;
              const baseOnly = Boolean(req.baseOnly);

              const jobRes = await new Promise<Result<PendingJobPayload, string>>((resolveJob) => {
                registerJob(jobId, resolveJob);
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
                  baseOnly,
                };
                worker.postMessage(payload);
              });

              if (!jobRes.ok) return err(jobRes.error);
              if (jobRes.value.kind !== 'lsystem') {
                return err(MANDALA_MESSAGES.wasmWorker.unexpectedLSystemReply);
              }

              return ok({
                strokes: reconstructFractalStrokesFromBuffer(
                  req.idPrefix,
                  jobRes.value.buffer,
                  jobRes.value.baseLengths,
                  baseOnly ? 1 : jobRes.value.order,
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
              if (disposed) return err(MANDALA_MESSAGES.wasmWorker.workerDisposed);
              const jobId = ++jobSeq;
              const panicRes = await new Promise<Result<unknown, string>>((resolveJob) => {
                registerJob(jobId, (r) => resolveJob(r));
                worker.postMessage({
                  type: WorkerMsgType.InjectPanic,
                  jobId,
                } satisfies WorkerInboundMessage);
              });
              return panicRes.ok ? ok(undefined) : err(panicRes.error);
            },

            dispose() {
              disposed = true;
              failAllPendingJobs(MANDALA_MESSAGES.wasmWorker.workerTerminatedBeforeDone);
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
          settlePendingJob(
            msg.jobId,
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
          settlePendingJob(
            msg.jobId,
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
          disposed = true;
          worker.terminate();
          cachedClientPromise = null;
          resolve(err(msg.message));
          return;
        }
        if (msg.jobId !== null) {
          settlePendingJob(msg.jobId, err(msg.message));
        }
      }
    };

    worker.onerror = (ev) => {
      const msg = ev.message || MANDALA_MESSAGES.wasmWorker.fatalWorkerError;
      disposed = true;
      failAllPendingJobs(msg);
      cachedClientPromise = null;
      reportDiagnostic({
        severity: DiagnosticSeverity.Error,
        source: DiagnosticSource.WasmWorker,
        code: DomainErrorCode.WasmWorkerCrash,
        message: msg,
        userNotice: MANDALA_MESSAGES.wasmWorker.fallbackNotice,
        cause: ev,
      });
      if (!settledInit) {
        settledInit = true;
        clearTimeout(initTimeout);
        worker.terminate();
        resolve(err(msg));
      } else {
        worker.terminate();
      }
    };

    worker.postMessage({
      type: WorkerMsgType.Init,
      wasmUrl: WASM_CONFIG.binaryUrl,
    } satisfies WorkerInboundMessage);
  });
}
