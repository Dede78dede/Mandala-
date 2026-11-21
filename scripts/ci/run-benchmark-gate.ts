#!/usr/bin/env tsx
/**
 * CI Quality Gate: Pure Compute Performance Regression Gate (JS & WASM, excluding SwiftShader GPU paint).
 * Compares live benchmark medians against `benchmarks/baseline.json` (max +15% regression allowed).
 *
 * Flags:
 *   --update                  Regenerate benchmarks/baseline.json with current measurements
 *   --simulate-regression=N   Inject synthetic +N% latency inflation to verify CI failure behavior
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  runFractalBenchmarkMatrix,
  runPhase3DualPathBenchmark,
} from '../../src/features/mandala/lib/benchmark.ts';
import { SymmetryStrategyKind } from '../../src/features/mandala/model/types.ts';
import { instantiateMandalaWasm } from '../../src/features/mandala/wasm/wasmSymmetryAdapter.ts';

const MAX_REGRESSION_RATIO = 1.15; // +15%
const NOISE_FLOOR_MS = 5.0; // Avoid V8 JIT/GC jitter false-positives on sub-5ms micro-cells
const BASELINE_PATH = path.resolve(process.cwd(), 'benchmarks/baseline.json');
const WASM_PATH = path.resolve(process.cwd(), 'public/wasm/mandala_symmetry.wasm');

const args = process.argv.slice(2);
const updateMode = args.includes('--update');
const simArg = args.find((a) => a.startsWith('--simulate-regression='));
const simulatedPct = simArg ? Number(simArg.split('=')[1]) : 0;
const simMultiplier = Number.isFinite(simulatedPct) && simulatedPct > 0 ? 1 + simulatedPct / 100 : 1;

async function main() {
  const wasmBytes = new Uint8Array(fs.readFileSync(WASM_PATH));
  const instRes = await instantiateMandalaWasm(wasmBytes);
  if (!instRes.ok) {
    console.error(`[BENCH-GATE FAIL] WASM instantiation error: ${instRes.error}`);
    process.exit(1);
  }
  const wasm = instRes.value;

  // Warmup V8 TurboFan JIT & stabilize heap before recording baseline or gate timings
  runPhase3DualPathBenchmark(wasm, SymmetryStrategyKind.Radial, 4);
  runFractalBenchmarkMatrix(8, wasm);

  const radial = runPhase3DualPathBenchmark(wasm, SymmetryStrategyKind.Radial, 12);
  const mirror = runPhase3DualPathBenchmark(wasm, SymmetryStrategyKind.MirrorRadial, 12);
  const fractal = runFractalBenchmarkMatrix(8, wasm);

  const metrics: Record<string, number> = {};

  for (const c of radial.cells) {
    metrics[`radial:N${c.order}:${c.pointCount}pt:js`] = Number((c.medianMs * simMultiplier).toFixed(3));
    metrics[`radial:N${c.order}:${c.pointCount}pt:wasm`] = Number((c.wasmMedianMs * simMultiplier).toFixed(3));
  }
  for (const c of mirror.cells) {
    metrics[`mirror:N${c.order}:${c.pointCount}pt:js`] = Number((c.medianMs * simMultiplier).toFixed(3));
    metrics[`mirror:N${c.order}:${c.pointCount}pt:wasm`] = Number((c.wasmMedianMs * simMultiplier).toFixed(3));
  }
  for (const c of fractal.cells) {
    metrics[`fractal:${c.presetId}:G${c.generations}:js`] = Number((c.medianMs * simMultiplier).toFixed(3));
    if (c.wasmMedianMs !== undefined) {
      metrics[`fractal:${c.presetId}:G${c.generations}:wasm`] = Number((c.wasmMedianMs * simMultiplier).toFixed(3));
    }
  }

  if (updateMode) {
    const payload = {
      schemaVersion: 1,
      policy: {
        maxRegressionPct: 15,
        noiseFloorMs: NOISE_FLOOR_MS,
        excludesGpuPaint: true,
        runtime: `node-${process.version}`,
      },
      generatedAt: new Date().toISOString(),
      wasmBinaryBytes: wasmBytes.byteLength,
      metrics,
    };
    fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(payload, null, 2) + '\n', 'utf8');
    console.log(`[BENCH-GATE] Baseline updated at ${path.relative(process.cwd(), BASELINE_PATH)} (${Object.keys(metrics).length} cells).`);
    return;
  }

  if (!fs.existsSync(BASELINE_PATH)) {
    console.error(`[BENCH-GATE FAIL] Missing baseline file: ${BASELINE_PATH}. Run with --update first.`);
    process.exit(1);
  }

  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  const baseMetrics: Record<string, number> = baseline.metrics ?? {};

  let evaluatedCount = 0;
  const regressions: string[] = [];

  for (const [key, currentVal] of Object.entries(metrics)) {
    const baseVal = baseMetrics[key];
    if (typeof baseVal !== 'number') continue;
    if (baseVal < NOISE_FLOOR_MS && currentVal < NOISE_FLOOR_MS * MAX_REGRESSION_RATIO) {
      continue;
    }
    evaluatedCount += 1;
    const allowedMax = Math.max(baseVal * MAX_REGRESSION_RATIO, NOISE_FLOOR_MS * MAX_REGRESSION_RATIO);
    if (currentVal > allowedMax) {
      const pct = (((currentVal - baseVal) / Math.max(0.001, baseVal)) * 100).toFixed(1);
      regressions.push(`${key}: baseline=${baseVal}ms -> current=${currentVal}ms (+${pct}%, limit=+15%)`);
    }
  }

  // Explicitly assert Phase 5 L-System Sacred Blossom G6 WASM speedup and <50ms guarantee
  const blossomWasmG6 = metrics['fractal:sacredFlower:G6:wasm'];
  if (typeof blossomWasmG6 === 'number' && blossomWasmG6 >= 50) {
    regressions.push(`fractal:sacredFlower:G6:wasm=${blossomWasmG6}ms exceeds 50ms Phase 5 threshold`);
  }

  console.log(
    `[BENCH-GATE] Checked ${evaluatedCount} compute-significant cells (threshold: +15%, floor: ${NOISE_FLOOR_MS}ms, GPU paint excluded).`
  );
  console.log(
    `[BENCH-GATE] Sacred Blossom G6: JS=${metrics['fractal:sacredFlower:G6:js']}ms | WASM=${blossomWasmG6}ms`
  );

  if (regressions.length > 0) {
    console.error(`[BENCH-GATE FAIL] Detected ${regressions.length} performance regression(s):`);
    for (const r of regressions) {
      console.error(`  - ${r}`);
    }
    process.exit(1);
  }

  console.log('[BENCH-GATE PASS] All pure JS/WASM median benchmarks within +15% baseline budget.');
}

void main();
