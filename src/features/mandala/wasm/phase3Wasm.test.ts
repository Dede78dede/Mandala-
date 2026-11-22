/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { LOGICAL_CENTER, WASM_CONFIG } from '../model/constants.ts';
import {
  AdrStatus,
  MirrorMode,
  SymmetryStrategyKind,
  type SymmetryParams,
  type WedgeStroke,
} from '../model/types.ts';
import { PHASE1_ADRS, PHASE3_WASM_SCAFFOLD } from '../model/adrRegistry.ts';
import { expandStrokeWithStrategy } from '../strategies/symmetry.ts';
import { runPhase3DualPathBenchmark } from '../lib/benchmark.ts';
import { renderSceneToPixelBuffer } from '../engine/pixelBufferEscapeHatch.ts';
import { isWasmSymmetryFlagEnabled } from './wasmLoader.ts';
import {
  expandFlatPointsWithWasm,
  instantiateMandalaWasm,
  packPointsToFloat64,
  reconstructWedgesFromBuffer,
  triggerWasmPanicForTest,
} from './wasmSymmetryAdapter.ts';

function loadWasmBytes(): Uint8Array {
  const wasmPath = path.resolve(process.cwd(), 'public/wasm/mandala_symmetry.wasm');
  return new Uint8Array(fs.readFileSync(wasmPath));
}

function makeWedge(id: string, pointCount: number): WedgeStroke {
  const points = Array.from({ length: pointCount }, (_, i) => ({
    x: LOGICAL_CENTER.x + 50 + i * 7.25,
    y: LOGICAL_CENTER.y - 35 - i * 4.5,
    pressure: 0.75,
  }));
  return {
    id,
    points,
    stroke: '#56B4E9',
    strokeWidth: 3.5,
    dash: null,
    opacity: 0.95,
  };
}

test('Phase 3 WASM binary stays well under 300KB budget and instantiates cleanly', async () => {
  const bytes = loadWasmBytes();
  assert.ok(bytes.byteLength > 100);
  assert.ok(bytes.byteLength < WASM_CONFIG.sizeBudgetBytes);

  const instRes = await instantiateMandalaWasm(bytes);
  assert.equal(instRes.ok, true);
  if (instRes.ok) {
    assert.equal(instRes.value.exports.get_heap_ptr(), 4096);
  }
});

test('Phase 3 WASM achieves <= 1e-12 geometric parity with JS across Radial and MirrorRadial strategies', async () => {
  const instRes = await instantiateMandalaWasm(loadWasmBytes());
  assert.equal(instRes.ok, true);
  if (!instRes.ok) return;
  const wasm = instRes.value;

  const wedge = makeWedge('parity_1', 12);
  const flat = packPointsToFloat64(wedge.points);

  const testCases = [
    { strategyId: SymmetryStrategyKind.Radial as const, order: 8, mirrorMode: MirrorMode.Reflect },
    { strategyId: SymmetryStrategyKind.Radial as const, order: 48, mirrorMode: MirrorMode.Reflect },
    { strategyId: SymmetryStrategyKind.MirrorRadial as const, order: 12, mirrorMode: MirrorMode.Reflect },
    { strategyId: SymmetryStrategyKind.MirrorRadial as const, order: 24, mirrorMode: MirrorMode.Alternate },
  ];

  for (const tc of testCases) {
    const params: SymmetryParams =
      tc.strategyId === SymmetryStrategyKind.Radial
        ? { strategyId: SymmetryStrategyKind.Radial, order: tc.order }
        : {
            strategyId: SymmetryStrategyKind.MirrorRadial,
            order: tc.order,
            mirrorMode: tc.mirrorMode,
          };

    const jsRes = expandStrokeWithStrategy(wedge, params, LOGICAL_CENTER);
    const wasmRes = expandFlatPointsWithWasm(
      wasm,
      flat,
      tc.order,
      tc.strategyId,
      tc.mirrorMode,
      LOGICAL_CENTER.x,
      LOGICAL_CENTER.y
    );

    assert.equal(jsRes.ok, true);
    assert.equal(wasmRes.ok, true);
    if (!jsRes.ok || !wasmRes.ok) continue;

    const reconstructed = reconstructWedgesFromBuffer(
      wedge,
      wasmRes.value.buffer,
      wasmRes.value.lengths,
      params
    );
    assert.equal(reconstructed.length, jsRes.value.length);

    let maxDelta = 0;
    for (let s = 0; s < jsRes.value.length; s++) {
      const recStroke: WedgeStroke | undefined = reconstructed[s];
      const jsStroke: WedgeStroke | undefined = jsRes.value[s];
      assert.ok(recStroke !== undefined && jsStroke !== undefined);
      assert.equal(recStroke.id, jsStroke.id);
      assert.equal(recStroke.points.length, jsStroke.points.length);
      for (let p = 0; p < jsStroke.points.length; p++) {
        const rp = recStroke.points[p];
        const jp = jsStroke.points[p];
        assert.ok(rp !== undefined && jp !== undefined);
        maxDelta = Math.max(
          maxDelta,
          Math.abs(rp.x - jp.x),
          Math.abs(rp.y - jp.y)
        );
      }
    }

    assert.ok(
      maxDelta <= WASM_CONFIG.parityTolerance,
      `Expected parity <= 1e-12, got ${maxDelta}`
    );
  }
});

test('Phase 3 WASM linear memory remains bounded across 1,000 expansions and catches panic traps safely', async () => {
  const instRes = await instantiateMandalaWasm(loadWasmBytes());
  assert.equal(instRes.ok, true);
  if (!instRes.ok) return;
  const wasm = instRes.value;

  const flat = packPointsToFloat64(makeWedge('mem_loop', 25).points);
  for (let i = 0; i < 1000; i++) {
    const res = expandFlatPointsWithWasm(
      wasm,
      flat,
      24,
      SymmetryStrategyKind.Radial,
      MirrorMode.Reflect,
      LOGICAL_CENTER.x,
      LOGICAL_CENTER.y
    );
    assert.equal(res.ok, true);
  }
  assert.equal(wasm.exports.get_heap_ptr(), 4096);

  // Inject WASM trap (`unreachable`) and verify graceful Result Err + arena cleanup
  const panicRes = triggerWasmPanicForTest(wasm);
  assert.equal(panicRes.ok, false);
  assert.equal(wasm.exports.get_heap_ptr(), 4096);
});

test('Phase 3 Dual-Path Benchmark executes 15-cell JS vs WASM matrix and calibrates threshold', async () => {
  const instRes = await instantiateMandalaWasm(loadWasmBytes());
  assert.equal(instRes.ok, true);
  if (!instRes.ok) return;

  const report = runPhase3DualPathBenchmark(
    instRes.value,
    SymmetryStrategyKind.Radial,
    6
  );

  assert.equal(report.cells.length, 15);
  assert.equal(report.wasmBinaryBytes, instRes.value.binaryByteLength);
  assert.ok(report.noopRoundTripMs >= 0);
  for (const cell of report.cells) {
    assert.ok(cell.medianMs >= 0);
    assert.ok(cell.wasmMedianMs >= 0);
    assert.ok(cell.speedupRatio > 0);
  }
});

test('Phase 3 Pixel-Buffer Escape Hatch rasterizes N=48 dense scene directly to RGBA Uint8ClampedArray', () => {
  const heavyWedges = Array.from({ length: 50 }, (_, idx) => makeWedge(`eh_${idx}`, 4));
  const out = renderSceneToPixelBuffer(
    heavyWedges,
    { strategyId: SymmetryStrategyKind.Radial, order: 48 },
    256,
    256
  );

  assert.equal(out.expandedPrimitives, 2400);
  assert.equal(out.data.length, 256 * 256 * 4);
  assert.ok(out.nonTransparentPixels > 100);
});

test('Phase 3 feature flag defaults off and ADRs + Rust crate scaffold are complete', () => {
  assert.equal(isWasmSymmetryFlagEnabled(), false);

  const engineAdr = PHASE1_ADRS.find((a) => a.id === 'PH3-ENGINE');
  const calibAdr = PHASE1_ADRS.find((a) => a.id === 'PH3-WASM-CALIBRATION');
  assert.equal(engineAdr?.status, AdrStatus.Ratified);
  assert.equal(calibAdr?.status, AdrStatus.Ratified);

  assert.ok(PHASE3_WASM_SCAFFOLD.some((f) => f.path === 'crate/Cargo.toml'));
  assert.ok(PHASE3_WASM_SCAFFOLD.some((f) => f.path === 'crate/src/lib.rs'));
});
