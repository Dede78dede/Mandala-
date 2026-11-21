import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ComplexityMetric,
  ExportFormat,
  LSystemPresetId,
  SymmetryStrategyKind,
  type WedgeStroke,
} from '../model/types.ts';
import { LOGICAL_CENTER } from '../model/constants.ts';
import { ok } from '../../../shared/lib/result.ts';
import {
  RadialStrategy,
  FractalStrategy,
  generateFractalStrokesWithMetrics,
  type SymmetryStrategy,
} from './symmetry.ts';
import { expandLSystem, interpretTurtle } from '../lib/lsystem.ts';
import {
  ComputeBackend,
  assessSceneComputeProfile,
  resolveDispatchBackendForWedge,
} from '../engine/geometryEngine.ts';
import { runFractalBenchmarkMatrix } from '../lib/benchmark.ts';
import {
  formatCrosshairAnnouncement,
  formatExportAnnouncement,
  formatFractalParamsAnnouncement,
} from '../lib/accessibility.ts';
import { ANDROID_PHASE1_SCAFFOLD, PHASE1_ADRS } from '../model/adrRegistry.ts';

function makeWedgeWithPoints(id: string, pointCount: number): WedgeStroke {
  return {
    id,
    points: Array.from({ length: pointCount }, (_, i) => ({ x: 400 + i * 3, y: 300 })),
    stroke: '#56B4E9',
    strokeWidth: 3.5,
    dash: null,
    opacity: 0.95,
  };
}

test('Task 4.1.B: pure L-System grammar expansion & Koch turtle segments compose via RadialStrategy', () => {
  const expanded = expandLSystem('F', { F: 'F+F-F-F+F' }, 1);
  assert.equal(expanded, 'F+F-F-F+F');

  const polylines = interpretTurtle('F+F', 10, 90, LOGICAL_CENTER);
  assert.equal(polylines.length, 1);
  assert.equal(polylines[0].length, 3);
  // First segment went straight up (-10 on Y)
  assert.ok(Math.abs(polylines[0][1].y - (LOGICAL_CENTER.y - 10)) < 1e-6);

  const metrics = generateFractalStrokesWithMetrics(
    {
      strategyId: SymmetryStrategyKind.Fractal,
      preset: LSystemPresetId.KochSnowflake,
      order: 6,
      generations: 2,
      angle: 90,
      stepLength: 10,
    },
    LOGICAL_CENTER,
    '#E69F00',
    3
  );
  assert.ok(metrics.baseSegmentCount > 0);
  assert.equal(metrics.expandedSegmentCount, metrics.baseSegmentCount * 6);
  assert.equal(FractalStrategy.complexityMetric, ComplexityMetric.Segments);
});

test('Task 4.1.D: data-driven orchestrator routes a synthetic strategy strictly by minWedgeComplexity', () => {
  const syntheticThreshold = 60;
  const syntheticRegistry: Record<string, SymmetryStrategy> = {
    [SymmetryStrategyKind.Radial]: {
      ...RadialStrategy,
      minWedgeComplexity: syntheticThreshold,
      complexityMetric: ComplexityMetric.Points,
      expansionMultiplier: (order) => order * 3,
      expand(wedge, params, center) {
        return ok(RadialStrategy.expand(wedge, params, center).ok ? [wedge] : []);
      },
    },
  };

  // 2 points * (6 * 3 = 18 multiplier) = 36 < 60 => stays on MainThreadJs
  const smallWedge = makeWedgeWithPoints('small', 2);
  assert.equal(
    resolveDispatchBackendForWedge(
      smallWedge,
      SymmetryStrategyKind.Radial,
      6,
      syntheticRegistry
    ),
    ComputeBackend.MainThreadJs
  );

  // 4 points * (6 * 3 = 18 multiplier) = 72 >= 60 => dispatches to WasmSimd
  const denseWedge = makeWedgeWithPoints('dense', 4);
  assert.equal(
    resolveDispatchBackendForWedge(
      denseWedge,
      SymmetryStrategyKind.Radial,
      6,
      syntheticRegistry
    ),
    ComputeBackend.WasmSimd
  );

  const profile = assessSceneComputeProfile(
    [denseWedge],
    { strategyId: SymmetryStrategyKind.Radial, order: 6 },
    syntheticRegistry
  );
  assert.equal(profile.estimatedComplexityUnits, 72);
  assert.equal(profile.exceedsStrategyThreshold, true);
  assert.equal(profile.recommendedBackend, ComputeBackend.WasmSimd);
});

test('Phase 4 Fractal Benchmark Matrix executes across 4 presets × generations 1..6', () => {
  const report = runFractalBenchmarkMatrix(8);
  assert.equal(report.cells.length, 24);
  assert.equal(report.order, 8);
  assert.ok(report.cells.every((c) => c.expandedSegmentCount === c.segmentCount * 8));
});

test('Phase 4 Accessibility formatters produce pre-composed announcements', () => {
  const crosshairMsg = formatCrosshairAnnouncement({ x: 430, y: 440 }, false);
  assert.ok(crosshairMsg.includes('X 430'));
  assert.ok(crosshairMsg.includes('raggio 50px'));

  const exportMsg = formatExportAnnouncement(ExportFormat.Svg, '12.4 KB');
  assert.ok(exportMsg.includes('SVG'));

  const fractalWarn = formatFractalParamsAnnouncement('Sacred Blossom', 5, 36, 20);
  assert.ok(fractalWarn.includes('Avviso carico CPU elevato'));
});

test('Phase 4 ADRs (PH4-STRATEGY-COMPOSITION & PH4-THREADING) and Kotlin Fractal parity', () => {
  assert.ok(PHASE1_ADRS.some((a) => a.id === 'PH4-STRATEGY-COMPOSITION'));
  assert.ok(PHASE1_ADRS.some((a) => a.id === 'PH4-THREADING'));
  assert.ok(PHASE1_ADRS.length >= 11);

  const ktDoc = ANDROID_PHASE1_SCAFFOLD.find((f) => f.path.endsWith('MandalaDocument.kt'));
  const ktStrat = ANDROID_PHASE1_SCAFFOLD.find((f) => f.path.endsWith('SymmetryStrategy.kt'));
  const ktCanvas = ANDROID_PHASE1_SCAFFOLD.find((f) => f.path.endsWith('MandalaCanvas.kt'));

  assert.ok(ktDoc?.content.includes('data class Fractal'));
  assert.ok(ktStrat?.content.includes('object FractalStrategy'));
  assert.ok(ktCanvas?.content.includes('LiveRegionMode.Polite'));
});
