/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 5 Unit & Parity Tests:
 * - WASM binary budget tightened to <= 200 KB (204,800 B)
 * - L-System grammar rewriting & turtle graphics + radial expansion parity <= 1e-12 vs JS
 * - Arena reset determinism (`get_heap_ptr() === 4096`) across repeated G5/G6 runs
 * - Sacred Blossom Gen 6 acceleration under 50 ms main/WASM budget
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { LOGICAL_CENTER, WASM_CONFIG } from '../model/constants.ts';
import { AdrPhase, AdrStatus, LSystemPresetId, SymmetryStrategyKind } from '../model/types.ts';
import { PHASE1_ADRS, PHASE3_WASM_SCAFFOLD } from '../model/adrRegistry.ts';
import { L_SYSTEM_PRESETS } from '../lib/lsystem.ts';
import { generateFractalStrokesWithMetrics } from '../strategies/symmetry.ts';
import { runFractalBenchmarkMatrix } from '../lib/benchmark.ts';
import {
  expandLSystemWithWasm,
  instantiateMandalaWasm,
  reconstructFractalStrokesFromBuffer,
} from './wasmSymmetryAdapter.ts';

function loadWasmBytes(): Uint8Array {
  return new Uint8Array(
    fs.readFileSync(path.resolve(process.cwd(), 'public/wasm/mandala_symmetry.wasm'))
  );
}

test('Phase 5 WASM budget is tightened to <= 200 KB and L-System exports are present', async () => {
  assert.equal(WASM_CONFIG.sizeBudgetBytes, 200 * 1024);
  const bytes = loadWasmBytes();
  assert.ok(
    bytes.byteLength <= WASM_CONFIG.sizeBudgetBytes,
    `WASM size ${bytes.byteLength} exceeds 200 KB`
  );

  const instRes = await instantiateMandalaWasm(bytes);
  assert.equal(instRes.ok, true);
  if (!instRes.ok) return;

  assert.equal(typeof instRes.value.exports.sin_f64, 'function');
  assert.equal(typeof instRes.value.exports.expand_lsystem_bytes, 'function');
  assert.equal(typeof instRes.value.exports.interpret_lsystem_turtle_f64, 'function');
  assert.equal(instRes.value.exports.get_heap_ptr(), 4096);
});

test('Phase 5 WASM L-System kernel maintains <= 1e-12 geometric parity across all 4 presets', async () => {
  const instRes = await instantiateMandalaWasm(loadWasmBytes());
  assert.equal(instRes.ok, true);
  if (!instRes.ok) return;
  const wasm = instRes.value;

  const presets = Object.values(L_SYSTEM_PRESETS);
  for (const preset of presets) {
    const gen = preset.id === LSystemPresetId.DragonCurve ? 5 : 4;
    const order = 8;

    const jsMetrics = generateFractalStrokesWithMetrics(
      {
        strategyId: SymmetryStrategyKind.Fractal,
        preset: preset.id,
        order,
        generations: gen,
        angle: preset.defaultAngle,
        stepLength: preset.defaultStep,
      },
      LOGICAL_CENTER,
      '#56B4E9',
      3.5
    );

    const wasmRes = expandLSystemWithWasm(
      wasm,
      preset.axiom,
      preset.rules,
      gen,
      preset.defaultStep,
      preset.defaultAngle,
      order,
      LOGICAL_CENTER
    );
    assert.equal(wasmRes.ok, true);
    if (!wasmRes.ok) continue;

    assert.equal(wasmRes.value.baseSegmentCount, jsMetrics.baseSegmentCount);
    assert.equal(wasmRes.value.expandedSegmentCount, jsMetrics.expandedSegmentCount);

    const wasmStrokes = reconstructFractalStrokesFromBuffer(
      `w_${preset.id}`,
      wasmRes.value.buffer,
      wasmRes.value.baseLengths,
      order,
      '#56B4E9',
      3.5
    );
    assert.equal(wasmStrokes.length, jsMetrics.strokes.length);

    let maxDelta = 0;
    for (let s = 0; s < jsMetrics.strokes.length; s++) {
      const jp = jsMetrics.strokes[s].points;
      const wp = wasmStrokes[s].points;
      assert.equal(wp.length, jp.length);
      for (let k = 0; k < jp.length; k++) {
        maxDelta = Math.max(maxDelta, Math.abs(wp[k].x - jp[k].x), Math.abs(wp[k].y - jp[k].y));
      }
    }

    assert.ok(
      maxDelta <= WASM_CONFIG.parityTolerance,
      `Preset ${preset.id} parity delta ${maxDelta} exceeded ${WASM_CONFIG.parityTolerance}`
    );
  }
  assert.equal(wasm.exports.get_heap_ptr(), 4096);
});

test('Phase 5 WASM Sacred Blossom Gen 6 computes well under 50ms and resets linear arena', async () => {
  const instRes = await instantiateMandalaWasm(loadWasmBytes());
  assert.equal(instRes.ok, true);
  if (!instRes.ok) return;
  const wasm = instRes.value;

  const blossom = L_SYSTEM_PRESETS[LSystemPresetId.SacredFlower];
  const samples: number[] = [];

  for (let i = 0; i < 10; i++) {
    const res = expandLSystemWithWasm(
      wasm,
      blossom.axiom,
      blossom.rules,
      6,
      blossom.defaultStep,
      blossom.defaultAngle,
      8,
      LOGICAL_CENTER
    );
    assert.equal(res.ok, true);
    if (res.ok) {
      samples.push(res.value.computeMs);
      assert.equal(res.value.baseSegmentCount, 15625);
    }
  }

  samples.sort((a, b) => a - b);
  const medianComputeMs = samples[Math.floor(samples.length / 2)];
  assert.ok(
    medianComputeMs < 50,
    `Expected WASM Sacred Blossom G6 < 50ms, got ${medianComputeMs.toFixed(2)}ms`
  );
  assert.equal(wasm.exports.get_heap_ptr(), 4096);
});

test('Phase 5 Dual Fractal Benchmark populates WASM kernel metrics and Phase 5 ADRs are ratified', async () => {
  const instRes = await instantiateMandalaWasm(loadWasmBytes());
  assert.equal(instRes.ok, true);
  if (!instRes.ok) return;

  const report = runFractalBenchmarkMatrix(8, instRes.value);
  assert.equal(report.wasmKernelActive, true);
  assert.equal(report.cells.length, 24);
  for (const cell of report.cells) {
    assert.ok(typeof cell.wasmMedianMs === 'number');
    assert.ok(typeof cell.wasmSpeedupRatio === 'number');
  }

  const ph5Adrs = PHASE1_ADRS.filter((a) => a.phase === AdrPhase.Phase5);
  assert.ok(ph5Adrs.length >= 4);
  assert.ok(ph5Adrs.every((a) => a.status === AdrStatus.Ratified));

  const libRs = PHASE3_WASM_SCAFFOLD.find((f) => f.path === 'crate/src/lib.rs');
  assert.ok(libRs?.content.includes('expand_lsystem_turtle_flat'));
});
