/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Persistent Phase 3 WebAssembly Module Worker (MANDALA-PH3-WASM-001 §2.1.2 Task 3.1.C).
 * Validates inbound messages via Zod (`parseWorkerInboundMessage`) before dispatching
 * linear-memory WASM kernels and transferring zero-copy Float64Array buffers back.
 */

import { parseWorkerInboundMessage } from '../model/schemas.ts';
import { WorkerMsgType } from '../model/types.ts';
import {
  expandFlatPointsWithWasm,
  expandLSystemWithWasm,
  instantiateMandalaWasm,
  triggerWasmPanicForTest,
  type WasmSymmetryInstance,
} from './wasmSymmetryAdapter.ts';
import type { WorkerOutboundMessage } from './workerProtocol.ts';

let wasmInstance: WasmSymmetryInstance | null = null;

function postOutbound(msg: WorkerOutboundMessage, transferables: Transferable[] = []): void {
  self.postMessage(msg, { transfer: transferables });
}

self.onmessage = async (event: MessageEvent<unknown>) => {
  const parsed = parseWorkerInboundMessage(event.data);
  if (!parsed.ok) {
    postOutbound({
      type: WorkerMsgType.Error,
      jobId: null,
      message: parsed.error,
    });
    return;
  }

  const msg = parsed.value;

  if (msg.type === WorkerMsgType.Init) {
    try {
      const response = await fetch(msg.wasmUrl);
      const res = await instantiateMandalaWasm(response);
      if (!res.ok) {
        postOutbound({
          type: WorkerMsgType.Error,
          jobId: null,
          message: res.error,
        });
        return;
      }
      wasmInstance = res.value;
      postOutbound({
        type: WorkerMsgType.Ready,
        wasmBytes: res.value.binaryByteLength,
      });
    } catch (e) {
      postOutbound({
        type: WorkerMsgType.Error,
        jobId: null,
        message: e instanceof Error ? e.message : 'Errore inizializzazione Worker WASM.',
      });
    }
    return;
  }

  if (msg.type === WorkerMsgType.InjectPanic) {
    if (!wasmInstance) {
      postOutbound({
        type: WorkerMsgType.Error,
        jobId: msg.jobId,
        message: 'Worker WASM non ancora inizializzato (INIT mancante).',
      });
      return;
    }
    const trap = triggerWasmPanicForTest(wasmInstance);
    postOutbound({
      type: WorkerMsgType.Error,
      jobId: msg.jobId,
      message: trap.ok ? 'Nessun trap ricevuto.' : trap.error,
    });
    return;
  }

  if (msg.type === WorkerMsgType.ExpandLSystem) {
    if (!wasmInstance) {
      postOutbound({
        type: WorkerMsgType.Error,
        jobId: msg.jobId,
        message: 'EXPAND_LSYSTEM ricevuto prima del completamento INIT del Worker WASM.',
      });
      return;
    }

    const res = expandLSystemWithWasm(
      wasmInstance,
      msg.axiom,
      msg.rules,
      msg.generations,
      msg.stepLength,
      msg.angleDegrees,
      msg.order,
      { x: msg.cx, y: msg.cy },
      Boolean(msg.baseOnly)
    );

    if (!res.ok) {
      postOutbound({
        type: WorkerMsgType.Error,
        jobId: msg.jobId,
        message: res.error,
      });
      return;
    }

    const { buffer, baseLengths, order, baseSegmentCount, expandedSegmentCount, computeMs } =
      res.value;
    postOutbound(
      {
        type: WorkerMsgType.LSystemExpanded,
        jobId: msg.jobId,
        buffer,
        baseLengths,
        order,
        baseSegmentCount,
        expandedSegmentCount,
        computeMs,
      },
      [buffer.buffer, baseLengths.buffer]
    );
    return;
  }

  if (msg.type === WorkerMsgType.Expand) {
    if (!wasmInstance) {
      postOutbound({
        type: WorkerMsgType.Error,
        jobId: msg.jobId,
        message: 'EXPAND ricevuto prima del completamento INIT del Worker WASM.',
      });
      return;
    }

    const res = expandFlatPointsWithWasm(
      wasmInstance,
      msg.points,
      msg.order,
      msg.strategyId,
      msg.mirrorMode,
      msg.cx,
      msg.cy
    );

    if (!res.ok) {
      postOutbound({
        type: WorkerMsgType.Error,
        jobId: msg.jobId,
        message: res.error,
      });
      return;
    }

    const { buffer, lengths, computeMs } = res.value;
    postOutbound(
      {
        type: WorkerMsgType.Expanded,
        jobId: msg.jobId,
        buffer,
        lengths,
        computeMs,
      },
      [buffer.buffer, lengths.buffer]
    );
  }
};
