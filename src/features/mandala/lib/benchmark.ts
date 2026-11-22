/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 1 & Phase 3 Dual-Path Benchmark Harness (MANDALA-PH1 §10.2 & MANDALA-PH3-WASM-001 §3.2).
 * Measures JavaScript Strategy baseline vs Real WebAssembly Linear-Memory Kernel
 * across N ∈ {8, 12, 24, 36, 48} and wedge complexities {5, 25, 50} to calibrate
 * minWedgeComplexity empirically under the 10ms / 50ms gate rule.
 */

import {
  LOGICAL_CENTER,
  MANDALA_LIMITS,
  STRATEGY_COMPLEXITY_THRESHOLDS,
  WASM_CONFIG,
} from '../model/constants.ts';
import {
  AdoptedComputePath,
  BenchmarkComplexityLabel,
  GateVerdict,
  MirrorMode,
  SymmetryStrategyKind,
  type BenchmarkCell,
  type FractalBenchmarkCell,
  type FractalBenchmarkReport,
  type Phase3BenchmarkCell,
  type Phase3BenchmarkReport,
  type SymmetryParams,
  type WedgeStroke,
} from '../model/types.ts';
import {
  expandStrokeWithStrategy,
  generateFractalStrokesWithMetrics,
} from '../strategies/symmetry.ts';
import { L_SYSTEM_PRESETS } from './lsystem.ts';
import {
  expandFlatPointsWithWasm,
  expandLSystemWithWasm,
  packPointsToFloat64,
  reconstructWedgesFromBuffer,
  type WasmSymmetryInstance,
} from '../wasm/wasmSymmetryAdapter.ts';

function buildSyntheticWedge(pointCount: number): WedgeStroke {
  const points = Array.from({ length: pointCount }, (_, i) => ({
    x: LOGICAL_CENTER.x + Math.cos(i * 0.25) * (40 + i * 4),
    y: LOGICAL_CENTER.y - Math.sin(i * 0.25) * (40 + i * 4),
    pressure: 0.65,
  }));

  return {
    id: `bench_wedge_${pointCount}`,
    points,
    stroke: '#56B4E9',
    strokeWidth: MANDALA_LIMITS.defaultStrokeWidth,
    dash: null,
    opacity: 1,
  };
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx] ?? 0;
}

export type BenchmarkableStrategy =
  | SymmetryStrategyKind.Radial
  | SymmetryStrategyKind.MirrorRadial;

export function runPhase1BenchmarkMatrix(
  strategyId: BenchmarkableStrategy = SymmetryStrategyKind.Radial,
  wedgesPerScene: number = 12
): BenchmarkCell[] {
  const orders = [8, 12, 24, 36, 48] as const;
  const complexities: ReadonlyArray<{ label: BenchmarkComplexityLabel; count: number }> = [
    { label: BenchmarkComplexityLabel.Low, count: 5 },
    { label: BenchmarkComplexityLabel.Medium, count: 25 },
    { label: BenchmarkComplexityLabel.High, count: 50 },
  ];

  const results: BenchmarkCell[] = [];
  const iterations = 25;
  const warmup = 5;

  for (const order of orders) {
    for (const comp of complexities) {
      const wedge = buildSyntheticWedge(comp.count);
      const scene = Array.from({ length: wedgesPerScene }, () => wedge);
      const params: SymmetryParams =
        strategyId === SymmetryStrategyKind.Radial
          ? { strategyId: SymmetryStrategyKind.Radial, order }
          : {
              strategyId: SymmetryStrategyKind.MirrorRadial,
              order,
              mirrorMode: MirrorMode.Reflect,
            };

      const timings: number[] = [];
      let expandedCount = 0;

      for (let run = 0; run < iterations + warmup; run++) {
        const t0 = performance.now();
        let countThisRun = 0;
        for (const w of scene) {
          const res = expandStrokeWithStrategy(w, params, LOGICAL_CENTER);
          if (res.ok) countThisRun += res.value.length;
        }
        const elapsed = performance.now() - t0;
        if (run >= warmup) {
          timings.push(elapsed);
          expandedCount = countThisRun;
        }
      }

      timings.sort((a, b) => a - b);
      const medianMs = Number(percentile(timings, 50).toFixed(3));
      const p95Ms = Number(percentile(timings, 95).toFixed(3));

      const gateVerdict: GateVerdict =
        medianMs >= MANDALA_LIMITS.wasmGateCandidateMs
          ? GateVerdict.WasmCandidate
          : medianMs > MANDALA_LIMITS.wasmGateOptimalMs
            ? GateVerdict.GreyZone
            : GateVerdict.OptimalJs;

      results.push({
        order,
        complexityLabel: comp.label,
        pointCount: comp.count,
        expandedCount,
        medianMs,
        p95Ms,
        gateVerdict,
      });
    }
  }

  return results;
}

/**
 * Phase 3 Dual-Path Empirical Benchmark (JS Strategy vs Linear-Memory WASM Kernel).
 * Measures no-op boundary cost separately and computes mechanical ADR adoption verdict.
 */
export function runPhase3DualPathBenchmark(
  wasmInstance: WasmSymmetryInstance | null,
  strategyId: BenchmarkableStrategy = SymmetryStrategyKind.Radial,
  wedgesPerScene: number = 12
): Phase3BenchmarkReport {
  const orders = [8, 12, 24, 36, 48] as const;
  const complexities: ReadonlyArray<{ label: BenchmarkComplexityLabel; count: number }> = [
    { label: BenchmarkComplexityLabel.Low, count: 5 },
    { label: BenchmarkComplexityLabel.Medium, count: 25 },
    { label: BenchmarkComplexityLabel.High, count: 50 },
  ];

  // Measure empty-wedge boundary overhead (Task 4.1)
  let noopRoundTripMs = 0;
  if (wasmInstance) {
    const emptyPts = new Float64Array(0);
    const noopRuns: number[] = [];
    for (let i = 0; i < 30; i++) {
      const t0 = performance.now();
      expandFlatPointsWithWasm(
        wasmInstance,
        emptyPts,
        8,
        strategyId,
        MirrorMode.Reflect,
        LOGICAL_CENTER.x,
        LOGICAL_CENTER.y
      );
      noopRuns.push(performance.now() - t0);
    }
    noopRuns.sort((a, b) => a - b);
    noopRoundTripMs = Number(percentile(noopRuns, 50).toFixed(4));
  }

  const cells: Phase3BenchmarkCell[] = [];
  const iterations = 20;
  const warmup = 4;

  for (const order of orders) {
    for (const comp of complexities) {
      const wedge = buildSyntheticWedge(comp.count);
      const scene = Array.from({ length: wedgesPerScene }, () => wedge);
      const params: SymmetryParams =
        strategyId === SymmetryStrategyKind.Radial
          ? { strategyId: SymmetryStrategyKind.Radial, order }
          : {
              strategyId: SymmetryStrategyKind.MirrorRadial,
              order,
              mirrorMode: MirrorMode.Reflect,
            };

      const jsTimings: number[] = [];
      const wasmTotalTimings: number[] = [];
      const wasmComputeTimings: number[] = [];
      let expandedCount = 0;

      for (let run = 0; run < iterations + warmup; run++) {
        // 1. JS Strategy baseline (uncached raw math)
        const tJs0 = performance.now();
        let jsCount = 0;
        for (const w of scene) {
          const r = expandStrokeWithStrategy(w, params, LOGICAL_CENTER);
          if (r.ok) jsCount += r.value.length;
        }
        const jsElapsed = performance.now() - tJs0;

        // 2. Real WASM Linear-Memory Kernel
        let wasmElapsed = jsElapsed;
        let wasmComputeOnly = jsElapsed;
        if (wasmInstance) {
          const tW0 = performance.now();
          let accCompute = 0;
          for (const w of scene) {
            const flat = packPointsToFloat64(w.points);
            const wRes = expandFlatPointsWithWasm(
              wasmInstance,
              flat,
              order,
              strategyId,
              MirrorMode.Reflect,
              LOGICAL_CENTER.x,
              LOGICAL_CENTER.y
            );
            if (wRes.ok) {
              accCompute += wRes.value.computeMs;
              reconstructWedgesFromBuffer(w, wRes.value.buffer, wRes.value.lengths, params);
            }
          }
          wasmElapsed = performance.now() - tW0;
          wasmComputeOnly = accCompute;
        }

        if (run >= warmup) {
          expandedCount = jsCount;
          jsTimings.push(jsElapsed);
          wasmTotalTimings.push(wasmElapsed);
          wasmComputeTimings.push(wasmComputeOnly);
        }
      }

      jsTimings.sort((a, b) => a - b);
      wasmTotalTimings.sort((a, b) => a - b);
      wasmComputeTimings.sort((a, b) => a - b);

      const jsMedianMs = Number(percentile(jsTimings, 50).toFixed(3));
      const jsP95Ms = Number(percentile(jsTimings, 95).toFixed(3));
      const wasmMedianMs = Number(percentile(wasmTotalTimings, 50).toFixed(3));
      const wasmP95Ms = Number(percentile(wasmTotalTimings, 95).toFixed(3));
      const wasmComputeOnlyMs = Number(percentile(wasmComputeTimings, 50).toFixed(3));
      const boundaryOverheadMs = Number(Math.max(0, wasmMedianMs - wasmComputeOnlyMs).toFixed(3));
      const speedupRatio =
        wasmMedianMs > 0 ? Number((jsMedianMs / wasmMedianMs).toFixed(2)) : 1;

      const gateVerdict: GateVerdict =
        jsMedianMs >= MANDALA_LIMITS.wasmGateCandidateMs
          ? GateVerdict.WasmCandidate
          : jsMedianMs > MANDALA_LIMITS.wasmGateOptimalMs
            ? GateVerdict.GreyZone
            : GateVerdict.OptimalJs;

      let adoptedPath: AdoptedComputePath = AdoptedComputePath.Js;
      if (jsMedianMs <= MANDALA_LIMITS.wasmGateOptimalMs && wasmMedianMs <= MANDALA_LIMITS.wasmGateOptimalMs) {
        adoptedPath = AdoptedComputePath.Js;
      } else if (
        jsMedianMs >= MANDALA_LIMITS.wasmGateCandidateMs &&
        speedupRatio >= WASM_CONFIG.adoptionSpeedupRatio
      ) {
        adoptedPath = AdoptedComputePath.Wasm;
      } else if (
        jsMedianMs > MANDALA_LIMITS.wasmGateOptimalMs ||
        wasmMedianMs > MANDALA_LIMITS.wasmGateOptimalMs
      ) {
        adoptedPath =
          speedupRatio >= WASM_CONFIG.adoptionSpeedupRatio
            ? AdoptedComputePath.GreyZoneWasm
            : AdoptedComputePath.GreyZoneJs;
      }

      cells.push({
        order,
        complexityLabel: comp.label,
        pointCount: comp.count,
        expandedCount,
        medianMs: jsMedianMs,
        p95Ms: jsP95Ms,
        gateVerdict,
        wasmMedianMs,
        wasmP95Ms,
        wasmComputeOnlyMs,
        boundaryOverheadMs,
        speedupRatio,
        adoptedPath,
      });
    }
  }

  const firstWasmAdopted = cells.find(
    (c) =>
      c.adoptedPath === AdoptedComputePath.Wasm ||
      c.adoptedPath === AdoptedComputePath.GreyZoneWasm
  );

  return {
    strategyId,
    noopRoundTripMs,
    wasmBinaryBytes: wasmInstance?.binaryByteLength ?? 0,
    calibratedMinWedgeComplexity: firstWasmAdopted ? firstWasmAdopted.expandedCount : null,
    cells,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Phase 4 Fractal Strategy Benchmark Matrix (MANDALA-PH4 §4.2):
 * Evaluates all L-System presets across generations 1..6 at N=order, measuring segment count
 * and verifying whether generations >= 5 exceed the 50ms threshold rule for Phase 5 escalation.
 */
export function runFractalBenchmarkMatrix(
  order: number = 8,
  wasmInstance: WasmSymmetryInstance | null = null
): FractalBenchmarkReport {
  const presets = Object.values(L_SYSTEM_PRESETS);
  const cells: FractalBenchmarkCell[] = [];
  const iterations = 12;
  const warmup = 2;

  for (const preset of presets) {
    for (let gen = 1; gen <= MANDALA_LIMITS.lSystemCapGenerations; gen++) {
      const timings: number[] = [];
      const wasmTimings: number[] = [];
      let segmentCount = 0;
      let expandedSegmentCount = 0;

      for (let run = 0; run < iterations + warmup; run++) {
        const t0 = performance.now();
        const metrics = generateFractalStrokesWithMetrics(
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
          MANDALA_LIMITS.defaultStrokeWidth
        );
        const elapsed = performance.now() - t0;

        let wasmElapsed = elapsed;
        if (wasmInstance) {
          const wRes = expandLSystemWithWasm(
            wasmInstance,
            preset.axiom,
            preset.rules,
            gen,
            preset.defaultStep,
            preset.defaultAngle,
            order,
            LOGICAL_CENTER
          );
          if (wRes.ok) {
            wasmElapsed = wRes.value.computeMs;
          }
        }

        if (run >= warmup) {
          timings.push(elapsed);
          if (wasmInstance) wasmTimings.push(wasmElapsed);
          segmentCount = metrics.baseSegmentCount;
          expandedSegmentCount = metrics.expandedSegmentCount;
        }
      }

      timings.sort((a, b) => a - b);
      const medianMs = Number(percentile(timings, 50).toFixed(3));
      const p95Ms = Number(percentile(timings, 95).toFixed(3));

      let wasmMedianMs: number | undefined;
      let wasmSpeedupRatio: number | undefined;
      if (wasmInstance && wasmTimings.length > 0) {
        wasmTimings.sort((a, b) => a - b);
        wasmMedianMs = Number(percentile(wasmTimings, 50).toFixed(3));
        wasmSpeedupRatio =
          wasmMedianMs > 0 ? Number((medianMs / wasmMedianMs).toFixed(2)) : 1;
      }

      cells.push({
        presetId: preset.id,
        presetName: preset.name,
        generations: gen,
        order,
        segmentCount,
        expandedSegmentCount,
        medianMs,
        p95Ms,
        exceeds50msRule: medianMs >= MANDALA_LIMITS.wasmGateCandidateMs,
        wasmMedianMs,
        wasmSpeedupRatio,
      });
    }
  }

  return {
    order,
    calibratedSegmentThreshold: STRATEGY_COMPLEXITY_THRESHOLDS.fractalSegments,
    wasmEscalationRecommended: cells.some(
      (c) => c.generations >= MANDALA_LIMITS.fractalPerfWarningGenerations && c.exceeds50msRule
    ),
    wasmKernelActive: wasmInstance !== null,
    cells,
    generatedAt: new Date().toISOString(),
  };
}

