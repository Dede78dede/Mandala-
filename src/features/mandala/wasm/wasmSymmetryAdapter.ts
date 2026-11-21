/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 3 WebAssembly Symmetry Adapter (MANDALA-PH3-WASM-001 §2.1.2).
 * Uses flat Float64Array linear-memory layout + Context-Managed arena reset (`try...finally`)
 * with strict type guards and 1e-12 geometric parity.
 */

import { Result, ok, err } from '../../../shared/lib/result.ts';
import { MANDALA_LIMITS } from '../model/constants.ts';
import {
  MirrorMode,
  SymmetryStrategyKind,
  type Point,
  type SymmetryParams,
  type WedgeStroke,
} from '../model/types.ts';

export interface WasmSymmetryExports {
  readonly memory: WebAssembly.Memory;
  readonly alloc_bytes: (size: number) => number;
  readonly reset_arena: () => void;
  readonly get_heap_ptr: () => number;
  readonly expand_radial_f64: (
    inPtr: number,
    ptCount: number,
    order: number,
    cx: number,
    cy: number,
    cosSinPtr: number,
    outPtr: number
  ) => number;
  readonly expand_mirror_radial_f64: (
    inPtr: number,
    ptCount: number,
    order: number,
    cx: number,
    cy: number,
    anglesPtr: number,
    outPtr: number
  ) => number;
  readonly inject_panic_test: () => void;
  readonly sin_f64?: (theta: number) => number;
  readonly expand_lsystem_bytes?: (
    axiomPtr: number,
    axiomLen: number,
    rulesPtr: number,
    generations: number,
    bufA: number,
    bufB: number,
    maxCap: number,
    outMetaPtr: number
  ) => number;
  readonly interpret_lsystem_turtle_f64?: (
    instrPtr: number,
    instrLen: number,
    stepLen: number,
    radAngle: number,
    startX: number,
    startY: number,
    stackPtr: number,
    outPtsPtr: number,
    outLensPtr: number,
    maxPts: number,
    maxPolys: number
  ) => number;
}

export interface WasmSymmetryInstance {
  readonly exports: WasmSymmetryExports;
  readonly binaryByteLength: number;
}

export interface WasmExpandedGeometry {
  readonly buffer: Float64Array;
  readonly lengths: Uint32Array;
  readonly computeMs: number;
}

export interface WasmLSystemGeometry {
  readonly buffer: Float64Array;
  readonly baseLengths: Uint32Array;
  readonly order: number;
  readonly baseSegmentCount: number;
  readonly expandedSegmentCount: number;
  readonly computeMs: number;
}

function isWasmExportsValid(raw: WebAssembly.Exports): raw is WebAssembly.Exports & WasmSymmetryExports {
  return (
    raw.memory instanceof WebAssembly.Memory &&
    typeof raw.alloc_bytes === 'function' &&
    typeof raw.reset_arena === 'function' &&
    typeof raw.get_heap_ptr === 'function' &&
    typeof raw.expand_radial_f64 === 'function' &&
    typeof raw.expand_mirror_radial_f64 === 'function' &&
    typeof raw.inject_panic_test === 'function'
  );
}

/**
 * Instantiates the WebAssembly module from raw bytes or a fetch Response (streaming preferred).
 */
export async function instantiateMandalaWasm(
  source: ArrayBuffer | Uint8Array | Response
): Promise<Result<WasmSymmetryInstance, string>> {
  try {
    let result: WebAssembly.WebAssemblyInstantiatedSource;
    let byteLen = 0;

    if (source instanceof Response) {
      if (!source.ok) {
        return err(`Fetch WASM fallita con stato HTTP ${source.status}.`);
      }
      const bytes = await source.arrayBuffer();
      byteLen = bytes.byteLength;
      result = await WebAssembly.instantiate(bytes);
    } else {
      const normalized = source instanceof Uint8Array ? source : new Uint8Array(source);
      byteLen = normalized.byteLength;
      const copy = new Uint8Array(normalized.byteLength);
      copy.set(normalized);
      result = await WebAssembly.instantiate(copy);
    }

    const rawExports = result.instance.exports;
    if (!isWasmExportsValid(rawExports)) {
      return err('Il modulo WASM non espone il contratto di esportazione atteso.');
    }

    return ok({ exports: rawExports, binaryByteLength: byteLen });
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Errore di istanziazione WASM.');
  }
}

/**
 * Deterministic Context Manager guaranteeing `reset_arena()` runs on exit,
 * keeping WASM linear memory bounded across 1,000+ consecutive expansions.
 */
function withWasmArena<T>(
  exports: WasmSymmetryExports,
  work: () => Result<T, string>
): Result<T, string> {
  try {
    return work();
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Trappola di esecuzione WASM.');
  } finally {
    exports.reset_arena();
  }
}

export function packPointsToFloat64(points: readonly Point[]): Float64Array {
  const out = new Float64Array(points.length * 2);
  for (let i = 0; i < points.length; i++) {
    out[i * 2] = points[i].x;
    out[i * 2 + 1] = points[i].y;
  }
  return out;
}

export function expandFlatPointsWithWasm(
  instance: WasmSymmetryInstance,
  flatPoints: Float64Array,
  order: number,
  strategyId: SymmetryStrategyKind.Radial | SymmetryStrategyKind.MirrorRadial,
  mirrorMode: MirrorMode,
  cx: number,
  cy: number
): Result<WasmExpandedGeometry, string> {
  if (order < MANDALA_LIMITS.minOrder || order > MANDALA_LIMITS.maxOrder) {
    return err(`Ordine simmetria non valido per WASM: ${order}.`);
  }
  const ptCount = Math.floor(flatPoints.length / 2);
  if (ptCount === 0) {
    return ok({
      buffer: new Float64Array(0),
      lengths: new Uint32Array(0),
      computeMs: 0,
    });
  }

  const { exports } = instance;
  return withWasmArena(exports, () => {
    const t0 = performance.now();
    const isMirror = strategyId === SymmetryStrategyKind.MirrorRadial;
    const strokeMultiplier = isMirror ? 2 : 1;
    const outputStrokeCount = order * strokeMultiplier;
    const outputPointCount = outputStrokeCount * ptCount;

    const inPtr = exports.alloc_bytes(ptCount * 16);
    const anglesPtr = exports.alloc_bytes(order * (isMirror ? 32 : 16));
    const outPtr = exports.alloc_bytes(outputPointCount * 16);
    if (inPtr < 0 || anglesPtr < 0 || outPtr < 0) {
      return err('Memoria lineare WASM esaurita durante alloc_bytes.');
    }

    // Read view AFTER all alloc_bytes calls (in case memory.grow detached previous ArrayBuffer view)
    const memF64 = new Float64Array(exports.memory.buffer);
    memF64.set(flatPoints.subarray(0, ptCount * 2), inPtr >> 3);

    const step = (2 * Math.PI) / order;
    const angIdx = anglesPtr >> 3;

    if (isMirror) {
      const alternate = mirrorMode === MirrorMode.Alternate;
      for (let i = 0; i < order; i++) {
        const baseAngle = i * step;
        const mirrorAxis = baseAngle + (alternate && i % 2 === 1 ? step / 4 : 0);
        memF64[angIdx + i * 4] = Math.cos(baseAngle);
        memF64[angIdx + i * 4 + 1] = Math.sin(baseAngle);
        memF64[angIdx + i * 4 + 2] = Math.cos(2 * mirrorAxis);
        memF64[angIdx + i * 4 + 3] = Math.sin(2 * mirrorAxis);
      }
      exports.expand_mirror_radial_f64(inPtr, ptCount, order, cx, cy, anglesPtr, outPtr);
    } else {
      for (let i = 0; i < order; i++) {
        const angle = i * step;
        memF64[angIdx + i * 2] = Math.cos(angle);
        memF64[angIdx + i * 2 + 1] = Math.sin(angle);
      }
      exports.expand_radial_f64(inPtr, ptCount, order, cx, cy, anglesPtr, outPtr);
    }

    const outStart = outPtr >> 3;
    const resultBuffer = new Float64Array(outputPointCount * 2);
    resultBuffer.set(memF64.subarray(outStart, outStart + outputPointCount * 2));

    const lengths = new Uint32Array(outputStrokeCount);
    lengths.fill(ptCount);

    return ok({
      buffer: resultBuffer,
      lengths,
      computeMs: performance.now() - t0,
    });
  });
}

function estimateLSystemCapacity(
  axiom: string,
  rules: Readonly<Record<string, string>>,
  generations: number
): { bufCap: number; maxPts: number; maxPolys: number } {
  let counts = new Map<string, number>();
  for (let i = 0; i < axiom.length; i++) {
    const ch = axiom[i];
    counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  for (let g = 0; g < generations; g++) {
    const next = new Map<string, number>();
    for (const [ch, cnt] of counts.entries()) {
      const repl = rules[ch] ?? ch;
      for (let k = 0; k < repl.length; k++) {
        const rc = repl[k];
        next.set(rc, (next.get(rc) ?? 0) + cnt);
      }
    }
    counts = next;
  }

  let totalLen = 0;
  let moves = 0;
  let breaks = 0;
  for (const [ch, cnt] of counts.entries()) {
    totalLen += cnt;
    if (ch === 'F' || ch === 'A' || ch === 'B' || ch === 'G' || ch === 'f') {
      moves += cnt;
    }
    if (ch === ']' || ch === 'f') {
      breaks += cnt;
    }
  }

  return {
    bufCap: Math.max(256, totalLen + axiom.length + 64),
    maxPts: Math.max(64, moves + breaks + 32),
    maxPolys: Math.max(32, breaks + 32),
  };
}

/**
 * Phase 5 L-System Grammar Expansion + Turtle Graphics + Radial Symmetry Kernel in WASM linear memory.
 */
export function expandLSystemWithWasm(
  instance: WasmSymmetryInstance,
  axiom: string,
  rules: Readonly<Record<string, string>>,
  generations: number,
  stepLength: number,
  angleDegrees: number,
  order: number,
  center: Point
): Result<WasmLSystemGeometry, string> {
  const { exports } = instance;
  if (
    typeof exports.expand_lsystem_bytes !== 'function' ||
    typeof exports.interpret_lsystem_turtle_f64 !== 'function'
  ) {
    return err('Kernel WASM L-System non esportato in questa build.');
  }
  if (order < 1 || order > MANDALA_LIMITS.maxOrder) {
    return err(`Ordine simmetria non valido per L-System WASM: ${order}.`);
  }

  const safeGen = Math.min(Math.max(1, generations), MANDALA_LIMITS.lSystemCapGenerations);
  const { bufCap, maxPts, maxPolys } = estimateLSystemCapacity(axiom, rules, safeGen);
  const encoder = new TextEncoder();
  const axiomBytes = encoder.encode(axiom);
  const ruleEntries = Object.entries(rules).map(([key, val]) => ({
    code: key.charCodeAt(0) & 127,
    bytes: encoder.encode(val),
  }));

  return withWasmArena(exports, () => {
    const t0 = performance.now();

    const axiomPtr = exports.alloc_bytes(Math.max(8, axiomBytes.length));
    const rulesTablePtr = exports.alloc_bytes(1024);
    const rulePtrs = ruleEntries.map((r) => exports.alloc_bytes(Math.max(8, r.bytes.length)));
    const bufAPtr = exports.alloc_bytes(bufCap);
    const bufBPtr = exports.alloc_bytes(bufCap);
    const outMetaPtr = exports.alloc_bytes(16);
    const stackPtr = exports.alloc_bytes(256 * 24);
    const outPtsPtr = exports.alloc_bytes(maxPts * 16);
    const outLensPtr = exports.alloc_bytes(maxPolys * 4);

    if (
      axiomPtr < 0 ||
      rulesTablePtr < 0 ||
      bufAPtr < 0 ||
      bufBPtr < 0 ||
      outMetaPtr < 0 ||
      stackPtr < 0 ||
      outPtsPtr < 0 ||
      outLensPtr < 0 ||
      rulePtrs.some((p) => p < 0)
    ) {
      return err('Memoria lineare WASM esaurita durante allocazione L-System.');
    }

    const memU8 = new Uint8Array(exports.memory.buffer);
    const memI32 = new Int32Array(exports.memory.buffer);

    memU8.set(axiomBytes, axiomPtr);
    memU8.fill(0, rulesTablePtr, rulesTablePtr + 1024);

    for (let i = 0; i < ruleEntries.length; i++) {
      const entry = ruleEntries[i];
      const rPtr = rulePtrs[i];
      memU8.set(entry.bytes, rPtr);
      const slotIdx = (rulesTablePtr + (entry.code << 3)) >> 2;
      memI32[slotIdx] = rPtr;
      memI32[slotIdx + 1] = entry.bytes.length;
    }

    const expandedLen = exports.expand_lsystem_bytes!(
      axiomPtr,
      axiomBytes.length,
      rulesTablePtr,
      safeGen,
      bufAPtr,
      bufBPtr,
      bufCap,
      outMetaPtr
    );
    if (expandedLen < 0) {
      return err('Superata capacità buffer espansione L-System in WASM.');
    }

    const finalInstrPtr = memI32[outMetaPtr >> 2];
    const finalInstrLen = memI32[(outMetaPtr >> 2) + 1];
    const radAngle = (angleDegrees * Math.PI) / 180;

    const polyCount = exports.interpret_lsystem_turtle_f64!(
      finalInstrPtr,
      finalInstrLen,
      stepLength,
      radAngle,
      center.x,
      center.y,
      stackPtr,
      outPtsPtr,
      outLensPtr,
      maxPts,
      maxPolys
    );
    if (polyCount < 0) {
      return err('Errore esecuzione turtle graphics WASM.');
    }

    const latestI32 = new Int32Array(exports.memory.buffer);
    const baseLengths = new Uint32Array(polyCount);
    let totalBasePts = 0;
    let baseSegmentCount = 0;
    const lensStart = outLensPtr >> 2;
    for (let i = 0; i < polyCount; i++) {
      const len = latestI32[lensStart + i];
      baseLengths[i] = len;
      totalBasePts += len;
      baseSegmentCount += Math.max(0, len - 1);
    }

    if (totalBasePts === 0 || polyCount === 0) {
      return ok({
        buffer: new Float64Array(0),
        baseLengths: new Uint32Array(0),
        order,
        baseSegmentCount: 0,
        expandedSegmentCount: 0,
        computeMs: performance.now() - t0,
      });
    }

    const anglesPtr = exports.alloc_bytes(order * 16);
    const radialOutPtr = exports.alloc_bytes(order * totalBasePts * 16);
    if (anglesPtr < 0 || radialOutPtr < 0) {
      return err('Memoria lineare WASM esaurita durante espansione radiale L-System.');
    }

    const memF64 = new Float64Array(exports.memory.buffer);
    const stepRad = (2 * Math.PI) / order;
    const angIdx = anglesPtr >> 3;
    for (let fold = 0; fold < order; fold++) {
      const theta = fold * stepRad;
      memF64[angIdx + fold * 2] = Math.cos(theta);
      memF64[angIdx + fold * 2 + 1] = Math.sin(theta);
    }

    const totalExpandedPts = exports.expand_radial_f64(
      outPtsPtr,
      totalBasePts,
      order,
      center.x,
      center.y,
      anglesPtr,
      radialOutPtr
    );

    const outStart = radialOutPtr >> 3;
    const resultBuffer = new Float64Array(totalExpandedPts * 2);
    resultBuffer.set(memF64.subarray(outStart, outStart + totalExpandedPts * 2));

    return ok({
      buffer: resultBuffer,
      baseLengths,
      order,
      baseSegmentCount,
      expandedSegmentCount: baseSegmentCount * order,
      computeMs: performance.now() - t0,
    });
  });
}

export function reconstructFractalStrokesFromBuffer(
  idPrefix: string,
  buffer: Float64Array,
  baseLengths: Uint32Array,
  order: number,
  color: string,
  strokeWidth: number
): WedgeStroke[] {
  const polyCount = baseLengths.length;
  if (polyCount === 0 || order < 1) return [];

  let basePointTotal = 0;
  for (let i = 0; i < polyCount; i++) {
    basePointTotal += baseLengths[i];
  }

  const strokes: WedgeStroke[] = new Array<WedgeStroke>(polyCount * order);
  let outIdx = 0;
  let polyOffsetFloats = 0;

  for (let pIdx = 0; pIdx < polyCount; pIdx++) {
    const ptCount = baseLengths[pIdx];
    const baseId = `${idPrefix}_${pIdx}`;

    for (let fold = 0; fold < order; fold++) {
      const foldBaseFloat = fold * basePointTotal * 2 + polyOffsetFloats;
      const pts: Point[] = new Array<Point>(ptCount);
      for (let k = 0; k < ptCount; k++) {
        const idx = foldBaseFloat + k * 2;
        pts[k] = { x: buffer[idx], y: buffer[idx + 1] };
      }

      strokes[outIdx++] = {
        id: fold === 0 ? baseId : `${baseId}_r${fold}`,
        points: pts,
        stroke: color,
        strokeWidth,
        dash: null,
        opacity: MANDALA_LIMITS.defaultOpacity,
      };
    }

    polyOffsetFloats += ptCount * 2;
  }

  return strokes;
}

export function reconstructWedgesFromBuffer(
  sourceWedge: WedgeStroke,
  buffer: Float64Array,
  lengths: Uint32Array,
  params: SymmetryParams
): WedgeStroke[] {
  const strokes: WedgeStroke[] = new Array<WedgeStroke>(lengths.length);
  let floatOffset = 0;
  const isMirror = params.strategyId === SymmetryStrategyKind.MirrorRadial;

  for (let sIdx = 0; sIdx < lengths.length; sIdx++) {
    const ptCount = lengths[sIdx];
    const pts: Point[] = new Array<Point>(ptCount);
    for (let p = 0; p < ptCount; p++) {
      const base = floatOffset + p * 2;
      const origPressure = sourceWedge.points[p]?.pressure;
      pts[p] =
        origPressure !== undefined
          ? { x: buffer[base], y: buffer[base + 1], pressure: origPressure }
          : { x: buffer[base], y: buffer[base + 1] };
    }
    floatOffset += ptCount * 2;

    const suffix = isMirror
      ? `_m${Math.floor(sIdx / 2)}_${sIdx % 2 === 0 ? 'a' : 'b'}`
      : sIdx === 0
        ? ''
        : `_r${sIdx}`;

    strokes[sIdx] = {
      ...sourceWedge,
      id: `${sourceWedge.id}${suffix}`,
      points: pts,
    };
  }

  return strokes;
}

export function triggerWasmPanicForTest(instance: WasmSymmetryInstance): Result<void, string> {
  return withWasmArena(instance.exports, () => {
    instance.exports.inject_panic_test();
    return ok(undefined);
  });
}
