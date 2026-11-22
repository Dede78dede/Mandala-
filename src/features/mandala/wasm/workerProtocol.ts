/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Typed Transferable-Buffer Web Worker Protocol (MANDALA-PH3-WASM-001 §2.1.2 Task 3.1.C).
 */

import {
  MirrorMode,
  SymmetryStrategyKind,
  WorkerMsgType,
} from '../model/types.ts';

export type WorkerInboundMessage =
  | {
      readonly type: WorkerMsgType.Init;
      readonly wasmUrl: string;
    }
  | {
      readonly type: WorkerMsgType.Expand;
      readonly jobId: number;
      readonly points: Float64Array;
      readonly order: number;
      readonly strategyId: SymmetryStrategyKind.Radial | SymmetryStrategyKind.MirrorRadial;
      readonly mirrorMode: MirrorMode;
      readonly cx: number;
      readonly cy: number;
    }
  | {
      readonly type: WorkerMsgType.ExpandLSystem;
      readonly jobId: number;
      readonly axiom: string;
      readonly rules: Readonly<Record<string, string>>;
      readonly generations: number;
      readonly stepLength: number;
      readonly angleDegrees: number;
      readonly order: number;
      readonly cx: number;
      readonly cy: number;
      readonly baseOnly?: boolean;
    }
  | {
      readonly type: WorkerMsgType.InjectPanic;
      readonly jobId: number;
    };

export type WorkerOutboundMessage =
  | {
      readonly type: WorkerMsgType.Ready;
      readonly wasmBytes: number;
    }
  | {
      readonly type: WorkerMsgType.Expanded;
      readonly jobId: number;
      readonly buffer: Float64Array;
      readonly lengths: Uint32Array;
      readonly computeMs: number;
    }
  | {
      readonly type: WorkerMsgType.LSystemExpanded;
      readonly jobId: number;
      readonly buffer: Float64Array;
      readonly baseLengths: Uint32Array;
      readonly order: number;
      readonly baseSegmentCount: number;
      readonly expandedSegmentCount: number;
      readonly computeMs: number;
    }
  | {
      readonly type: WorkerMsgType.Error;
      readonly jobId: number | null;
      readonly message: string;
    };
