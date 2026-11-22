import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RadialStrategy,
  MirrorRadialStrategy,
  FractalStrategy,
  STRATEGY_REGISTRY,
  expandStrokeWithStrategy,
  describeSymmetryParams,
  rotatePoint,
  reflectPoint,
} from './symmetry.ts';
import { LOGICAL_CENTER } from '../model/constants.ts';
import {
  LSystemPresetId,
  MirrorMode,
  SymmetryErrorCode,
  SymmetryStrategyKind,
  type SymmetryParams,
  type WedgeStroke,
} from '../model/types.ts';
import { runPhase1BenchmarkMatrix } from '../lib/benchmark.ts';

const sampleWedge: WedgeStroke = {
  id: 'w1',
  points: [
    { x: 400, y: 300 },
    { x: 425, y: 325 },
    { x: 450, y: 350 },
  ],
  stroke: '#56B4E9',
  strokeWidth: 3.5,
  dash: null,
  opacity: 0.95,
};

test('RadialStrategy: N=8 produces 8 strokes at 45 degree increments', () => {
  const res = RadialStrategy.expand(
    sampleWedge,
    { strategyId: SymmetryStrategyKind.Radial, order: 8 },
    LOGICAL_CENTER
  );
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.value.length, 8);
    // 2nd stroke (index 2 => 90 degrees clockwise around (400,400)): (400,300) -> (500,400)
    const p90 = res.value[2]?.points[0];
    assert.ok(p90);
    assert.ok(Math.abs(p90.x - 500) < 1e-6);
    assert.ok(Math.abs(p90.y - 400) < 1e-6);
  }
});

test('RadialStrategy: degenerate empty wedge returns ok([]) without throwing', () => {
  const empty: WedgeStroke = { ...sampleWedge, points: [] };
  const res = RadialStrategy.expand(
    empty,
    { strategyId: SymmetryStrategyKind.Radial, order: 8 },
    LOGICAL_CENTER
  );
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.value.length, 0);
});

test('RadialStrategy: invalid symmetry order returns typed err result', () => {
  const res = RadialStrategy.expand(
    sampleWedge,
    { strategyId: SymmetryStrategyKind.Radial, order: 0 },
    LOGICAL_CENTER
  );
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error.code, SymmetryErrorCode.InvalidOrder);
});

test('RadialStrategy: idempotent under point-order reversal', () => {
  const reversed: WedgeStroke = { ...sampleWedge, points: [...sampleWedge.points].reverse() };
  const res1 = RadialStrategy.expand(
    sampleWedge,
    { strategyId: SymmetryStrategyKind.Radial, order: 6 },
    LOGICAL_CENTER
  );
  const res2 = RadialStrategy.expand(
    reversed,
    { strategyId: SymmetryStrategyKind.Radial, order: 6 },
    LOGICAL_CENTER
  );
  assert.equal(res1.ok, true);
  assert.equal(res2.ok, true);
  if (res1.ok && res2.ok) {
    assert.equal(res1.value.length, res2.value.length);
    const ptA = res1.value[1]?.points[0];
    const r2pts = res2.value[1]?.points;
    const ptB = r2pts ? r2pts[r2pts.length - 1] : undefined;
    assert.ok(ptA && ptB);
    assert.ok(Math.abs(ptA.x - ptB.x) < 1e-9);
    assert.ok(Math.abs(ptA.y - ptB.y) < 1e-9);
  }
});

test('MirrorRadialStrategy: reflect vs alternate modes produce 2N strokes with distance preservation', () => {
  const reflectRes = MirrorRadialStrategy.expand(
    sampleWedge,
    { strategyId: SymmetryStrategyKind.MirrorRadial, order: 6, mirrorMode: MirrorMode.Reflect },
    LOGICAL_CENTER
  );
  const altRes = MirrorRadialStrategy.expand(
    sampleWedge,
    { strategyId: SymmetryStrategyKind.MirrorRadial, order: 6, mirrorMode: MirrorMode.Alternate },
    LOGICAL_CENTER
  );

  assert.equal(reflectRes.ok, true);
  assert.equal(altRes.ok, true);
  if (reflectRes.ok && altRes.ok) {
    assert.equal(reflectRes.value.length, 12);
    assert.equal(altRes.value.length, 12);
    // Distance from center preserved on reflected point
    const origPt = sampleWedge.points[1];
    const reflPt = reflectRes.value[1]?.points[1];
    assert.ok(origPt && reflPt);
    const origDist = Math.hypot(origPt.x - 400, origPt.y - 400);
    const reflDist = Math.hypot(reflPt.x - 400, reflPt.y - 400);
    assert.ok(Math.abs(origDist - reflDist) < 1e-6);
    // Alternate mode differs on odd wedge index (wedge 1 reflected stroke = index 3)
    const r3 = reflectRes.value[3]?.points[1];
    const a3 = altRes.value[3]?.points[1];
    assert.ok(r3 && a3);
    assert.notEqual(r3.x.toFixed(3), a3.x.toFixed(3));
  }
});

test('STRATEGY_REGISTRY: data-driven dispatch works for all strategies', () => {
  const paramsList: SymmetryParams[] = [
    { strategyId: SymmetryStrategyKind.Radial, order: 8 },
    {
      strategyId: SymmetryStrategyKind.MirrorRadial,
      order: 8,
      mirrorMode: MirrorMode.Alternate,
    },
    {
      strategyId: SymmetryStrategyKind.Fractal,
      preset: LSystemPresetId.SacredFlower,
      order: 8,
      generations: 3,
      angle: 36,
      stepLength: 20,
    },
  ];
  for (const params of paramsList) {
    assert.ok(STRATEGY_REGISTRY[params.strategyId]);
    const res = expandStrokeWithStrategy(sampleWedge, params, LOGICAL_CENTER);
    assert.equal(res.ok, true);
    assert.ok(describeSymmetryParams(params).length > 5);
  }
  assert.equal(FractalStrategy.id, SymmetryStrategyKind.Fractal);
});

test('rotatePoint and reflectPoint preserve center invariance', () => {
  const r = rotatePoint(LOGICAL_CENTER, 2.1, LOGICAL_CENTER);
  const f = reflectPoint(LOGICAL_CENTER, 0.7, LOGICAL_CENTER);
  assert.equal(r.x, LOGICAL_CENTER.x);
  assert.equal(r.y, LOGICAL_CENTER.y);
  assert.equal(f.x, LOGICAL_CENTER.x);
  assert.equal(f.y, LOGICAL_CENTER.y);
});

test('Phase 1 Benchmark Matrix executes across N=8..48 and 3 complexities', () => {
  const matrix = runPhase1BenchmarkMatrix(SymmetryStrategyKind.Radial, 4);
  assert.equal(matrix.length, 15);
  assert.equal(matrix[0]?.order, 8);
  assert.equal(matrix[matrix.length - 1]?.order, 48);
  assert.ok(matrix.every((cell) => typeof cell.medianMs === 'number' && cell.p95Ms >= cell.medianMs));
});
