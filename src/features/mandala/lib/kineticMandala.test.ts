/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  describeMotionPauseReason,
  evaluateMotionExecutionGate,
} from '../../../shared/lib/motionLifecycle.ts';
import { KINETIC_LIMITS, LOGICAL_CENTER } from '../model/constants.ts';
import {
  CpuLoadState,
  MotionPauseReason,
  SymmetryStrategyKind,
  type SymmetryParams,
  type WedgeStroke,
} from '../model/types.ts';
import {
  computeBandAngleRad,
  computeBreathingScale,
  partitionWedgesIntoRadialBands,
  computeStrokeReplaySlice,
} from './kineticMandala.ts';
import { exportToSVGBenchmarked } from './svgExport.ts';

const TEST_SYMMETRY: SymmetryParams = {
  strategyId: SymmetryStrategyKind.Radial,
  order: 8,
};

function makeStrokeAtRadius(id: string, radius: number, pointsCount = 4): WedgeStroke {
  const points = Array.from({ length: pointsCount }, (_, idx) => ({
    x: LOGICAL_CENTER.x + radius + idx * 2,
    y: LOGICAL_CENTER.y,
  }));
  return {
    id,
    points,
    stroke: '#f59e0b',
    strokeWidth: 4,
    dash: null,
    opacity: 0.9,
  };
}

test('Motion Lifecycle Gate: enforces prefers-reduced-motion, hidden tab, CPU load, and user play state', () => {
  const paused = evaluateMotionExecutionGate({
    userRequestedPlay: false,
    prefersReducedMotion: false,
    isPageVisible: true,
    cpuLoadState: CpuLoadState.Nominal,
  });
  assert.equal(paused.canAnimate, false);
  assert.equal(paused.pauseReason, MotionPauseReason.PausedByUser);

  const reduced = evaluateMotionExecutionGate({
    userRequestedPlay: true,
    prefersReducedMotion: true,
    isPageVisible: true,
    cpuLoadState: CpuLoadState.Nominal,
  });
  assert.equal(reduced.canAnimate, false);
  assert.equal(reduced.pauseReason, MotionPauseReason.ReducedMotion);
  assert.ok(describeMotionPauseReason(reduced.pauseReason)?.includes('prefers-reduced-motion'));

  const hidden = evaluateMotionExecutionGate({
    userRequestedPlay: true,
    prefersReducedMotion: false,
    isPageVisible: false,
    cpuLoadState: CpuLoadState.Nominal,
  });
  assert.equal(hidden.canAnimate, false);
  assert.equal(hidden.pauseReason, MotionPauseReason.TabHidden);

  const cpuProtected = evaluateMotionExecutionGate({
    userRequestedPlay: true,
    prefersReducedMotion: false,
    isPageVisible: true,
    cpuLoadState: CpuLoadState.Protected,
  });
  assert.equal(cpuProtected.canAnimate, false);
  assert.equal(cpuProtected.pauseReason, MotionPauseReason.CpuProtected);

  const elevated = evaluateMotionExecutionGate({
    userRequestedPlay: true,
    prefersReducedMotion: false,
    isPageVisible: true,
    cpuLoadState: CpuLoadState.Elevated,
  });
  assert.equal(elevated.canAnimate, true);
  assert.equal(elevated.targetFps, 30);

  const nominal = evaluateMotionExecutionGate({
    userRequestedPlay: true,
    prefersReducedMotion: false,
    isPageVisible: true,
    cpuLoadState: CpuLoadState.Nominal,
  });
  assert.equal(nominal.canAnimate, true);
  assert.equal(nominal.targetFps, 60);
});

test('Kinetic Mandala: radial band partitioning classifies inner, mid, outer and preserves alternating spin', () => {
  const innerStroke = makeStrokeAtRadius('inner', 60);
  const midStroke = makeStrokeAtRadius('mid', 180);
  const outerStroke = makeStrokeAtRadius('outer', 300);

  const bands = partitionWedgesIntoRadialBands([innerStroke, midStroke, outerStroke]);
  assert.equal(bands.length, 3);
  const [b0, b1, b2] = bands;
  assert.ok(b0 && b1 && b2);
  assert.equal(b0.strokes.length, 1);
  assert.equal(b0.strokes[0]?.id, 'inner');
  assert.equal(b1.strokes.length, 1);
  assert.equal(b1.strokes[0]?.id, 'mid');
  assert.equal(b2.strokes.length, 1);
  assert.equal(b2.strokes[0]?.id, 'outer');
  assert.ok(b0.speedMultiplier > 0 && b1.speedMultiplier < 0);

  const emptyBands = partitionWedgesIntoRadialBands([]);
  assert.equal(emptyBands.every((b) => b.strokes.length === 0), true);
});

test('Kinetic Mandala: stroke replay slice reveals tip-by-tip without mutating source strokes', () => {
  const s1 = makeStrokeAtRadius('s1', 100, 6);
  const s2 = makeStrokeAtRadius('s2', 200, 6);
  const input = [s1, s2];

  const zero = computeStrokeReplaySlice(input, 0);
  assert.equal(zero.strokes.length, 0);
  assert.equal(zero.completedStrokes, 0);

  const mid = computeStrokeReplaySlice(input, 0.5);
  assert.ok(mid.strokes.length >= 1);
  assert.equal(s1.points.length, 6);
  assert.equal(s2.points.length, 6);

  const partialEarly = computeStrokeReplaySlice(input, 0.25);
  assert.equal(partialEarly.strokes.length, 1);
  assert.ok((partialEarly.strokes[0]?.points.length ?? 999) < 6);

  const full = computeStrokeReplaySlice(input, 1);
  assert.equal(full.strokes.length, 2);
  assert.equal(full.completedStrokes, 2);
});

test('Kinetic Mandala: breathing scale & band angular offset stay bounded', () => {
  assert.equal(computeBreathingScale(1.23, 0), 1.0);
  const amp = 0.05;
  for (let t = 0; t < 10; t += 0.37) {
    const scale = computeBreathingScale(t, amp);
    assert.ok(scale >= 1.0 - amp - 1e-6 && scale <= 1.0 + amp + 1e-6);
  }
  const cw = computeBandAngleRad(0, 2, 1);
  const ccw = computeBandAngleRad(1, 2, 1);
  assert.ok(cw > 0 && ccw < 0);
  assert.equal(
    computeBandAngleRad(0, 1, KINETIC_LIMITS.maxSpeed * 10),
    (KINETIC_LIMITS.ringSpeedMultipliers[0] ?? 1) * KINETIC_LIMITS.maxSpeed
  );
});

test('Animated SVG Export: optional concentric rings CSS honors prefers-reduced-motion', () => {
  const strokes = [makeStrokeAtRadius('s_inner', 50), makeStrokeAtRadius('s_outer', 260)];
  const staticReport = exportToSVGBenchmarked(
    strokes,
    TEST_SYMMETRY,
    1024,
    1024,
    '#0f172a',
    undefined,
    undefined,
    false
  );
  assert.equal(staticReport.svg.includes('@keyframes mandala-cw'), false);

  const animatedReport = exportToSVGBenchmarked(
    strokes,
    TEST_SYMMETRY,
    1024,
    1024,
    '#0f172a',
    undefined,
    undefined,
    true
  );
  assert.equal(animatedReport.svg.includes('@media (prefers-reduced-motion: no-preference)'), true);
  assert.equal(animatedReport.svg.includes('@keyframes mandala-cw'), true);
  assert.equal(animatedReport.svg.includes('class="mandala-ring-0"'), true);
  assert.equal(animatedReport.svg.includes('class="mandala-ring-2"'), true);
});
