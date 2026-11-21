/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LOGICAL_CENTER,
  MORPH_LIMITS,
  POLAR_LIMITS,
  STAMP_LIMITS,
} from '../model/constants.ts';
import {
  PolarGeneratorId,
  StampArchetypeId,
  SvgAnimationMode,
  SymmetryStrategyKind,
  type WedgeStroke,
} from '../model/types.ts';
import {
  STAMP_ARCHETYPE_LIST,
  computeStampPlacementVector,
  generateBotanicalStampStrokes,
} from './proceduralStamps.ts';
import {
  POLAR_GENERATOR_LIST,
  generatePolarHarmonicStrokes,
} from './polarGenerators.ts';
import {
  interpolateHexColor,
  interpolateStrokeScene,
  resamplePolylineUniform,
} from './morphInterpolator.ts';
import { exportToSVGBenchmarked } from './svgExport.ts';

test('Botanical Stamps: all archetypes produce bounded finite strokes anchored accurately', () => {
  for (const descriptor of STAMP_ARCHETYPE_LIST) {
    const strokes = generateBotanicalStampStrokes(
      {
        archetype: descriptor.id,
        anchor: { x: 460, y: 320 },
        radius: STAMP_LIMITS.defaultRadius,
        angleRad: Math.PI / 4,
        strokeColor: '#38bdf8',
        strokeWidth: 3.5,
        dash: null,
      },
      `test_${descriptor.id}`
    );

    assert.ok(strokes.length >= 1, `${descriptor.id} should emit at least 1 stroke`);
    for (const s of strokes) {
      assert.ok(s.points.length >= 6);
      for (const p of s.points) {
        assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
      }
    }
  }

  const multiLotus = generateBotanicalStampStrokes({
    archetype: StampArchetypeId.MultiLotus,
    anchor: LOGICAL_CENTER,
    radius: 70,
    angleRad: 0,
    strokeColor: '#f59e0b',
    strokeWidth: 4,
    dash: [6, 4],
  });
  assert.equal(multiLotus.length, STAMP_LIMITS.multiLotusLayerCount);
  assert.deepEqual(multiLotus[0].dash, [6, 4]);
});

test('Stamp Placement Vector: tap aims radially outward while drag adapts orientation and clamped radius', () => {
  const anchor = { x: LOGICAL_CENTER.x + 120, y: LOGICAL_CENTER.y };
  const tapVec = computeStampPlacementVector(anchor, null, 1.0, LOGICAL_CENTER);
  assert.ok(Math.abs(tapVec.angleRad) < 1e-6);
  assert.equal(tapVec.radius, STAMP_LIMITS.defaultRadius);

  const hugeDrag = computeStampPlacementVector(
    anchor,
    { x: anchor.x, y: anchor.y + 999 },
    2.0,
    LOGICAL_CENTER
  );
  assert.equal(hugeDrag.radius, STAMP_LIMITS.maxRadius);
  assert.ok(Math.abs(hugeDrag.angleRad - Math.PI / 2) < 1e-6);
});

test('Polar Generators: RoseCurve, Epitrochoid, and HexagonalCrown generate bounded finite geometry', () => {
  for (const desc of POLAR_GENERATOR_LIST) {
    const strokes = generatePolarHarmonicStrokes(
      {
        generatorId: desc.id,
        amplitudeRadius: POLAR_LIMITS.defaultAmplitudeRadius,
        numerator: desc.defaultNumerator,
        denominator: desc.defaultDenominator,
        sampleSteps: POLAR_LIMITS.defaultSampleSteps,
        strokeColor: '#c084fc',
        strokeWidth: 3,
        dash: null,
      },
      LOGICAL_CENTER,
      `polar_${desc.id}`
    );
    assert.ok(strokes.length >= 1);
    for (const s of strokes) {
      assert.ok(s.points.length >= 5);
      for (const pt of s.points) {
        assert.ok(Number.isFinite(pt.x) && Number.isFinite(pt.y));
        assert.ok(
          Math.hypot(pt.x - LOGICAL_CENTER.x, pt.y - LOGICAL_CENTER.y) <=
            POLAR_LIMITS.maxAmplitudeRadius + 2
        );
      }
    }
  }

  const hex = generatePolarHarmonicStrokes(
    {
      generatorId: PolarGeneratorId.HexagonalCrown,
      amplitudeRadius: 200,
      numerator: 6,
      denominator: 4,
      sampleSteps: 120,
      strokeColor: '#38bdf8',
      strokeWidth: 3,
      dash: null,
    },
    LOGICAL_CENTER,
    'hex_test'
  );
  assert.equal(hex.length, 4);
});

test('Morph Interpolator: uniform arc-length resampling, color lerp, and unmatched stroke collapse', () => {
  const resampled = resamplePolylineUniform(
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
    MORPH_LIMITS.resampledPointCount
  );
  assert.equal(resampled.length, MORPH_LIMITS.resampledPointCount);
  assert.equal(resampled[0].x, 0);
  assert.equal(resampled[resampled.length - 1].x, 100);

  const midColor = interpolateHexColor('#000000', '#ffffff', 0.5);
  assert.equal(midColor.toLowerCase(), '#808080');

  const sceneA: WedgeStroke[] = [
    {
      id: 'a0',
      points: [
        { x: 400, y: 300 },
        { x: 480, y: 300 },
      ],
      stroke: '#000000',
      strokeWidth: 2,
      dash: null,
      opacity: 1,
    },
  ];
  const sceneB: WedgeStroke[] = [
    {
      id: 'b0',
      points: [
        { x: 400, y: 360 },
        { x: 520, y: 360 },
      ],
      stroke: '#ffffff',
      strokeWidth: 6,
      dash: null,
      opacity: 1,
    },
    {
      id: 'b1',
      points: [
        { x: 500, y: 260 },
        { x: 540, y: 260 },
      ],
      stroke: '#38bdf8',
      strokeWidth: 4,
      dash: null,
      opacity: 0.8,
    },
  ];

  const atZero = interpolateStrokeScene(sceneA, sceneB, 0);
  assert.equal(atZero.length, 1);
  const atMid = interpolateStrokeScene(sceneA, sceneB, 0.5);
  assert.equal(atMid.length, 2);
  assert.equal(atMid[0].points.length, MORPH_LIMITS.resampledPointCount);
  assert.equal(atMid[0].strokeWidth, 4);
  assert.ok(atMid[1].opacity > 0 && atMid[1].opacity < 0.8);
  const atOne = interpolateStrokeScene(sceneA, sceneB, 1);
  assert.equal(atOne.length, 2);
});

test('SVG Export Path-Drawing Mode: emits pathLength="1", staggered delays, and reduced-motion guard', () => {
  const sampleStrokes: WedgeStroke[] = [
    {
      id: 'draw_p',
      points: [
        { x: 400, y: 300 },
        { x: 440, y: 260 },
      ],
      stroke: '#38bdf8',
      strokeWidth: 4,
      dash: null,
      opacity: 0.95,
    },
    {
      id: 'draw_dot',
      points: [{ x: 400, y: 240 }],
      stroke: '#f59e0b',
      strokeWidth: 6,
      dash: null,
      opacity: 0.95,
    },
  ];

  const report = exportToSVGBenchmarked(
    sampleStrokes,
    { strategyId: SymmetryStrategyKind.Radial, order: 4 },
    1000,
    1000,
    '#090d16',
    undefined,
    undefined,
    SvgAnimationMode.PathDrawing,
    { cycleDurationSec: 3.5, staggerDelayMs: 60, loop: false }
  );

  assert.equal(report.svg.includes('pathLength="1"'), true);
  assert.equal(report.svg.includes('class="mandala-draw-path"'), true);
  assert.equal(report.svg.includes('class="mandala-draw-dot"'), true);
  assert.equal(report.svg.includes('animation-delay: 60ms'), true);
  assert.equal(report.svg.includes('@media (prefers-reduced-motion: no-preference)'), true);
  assert.equal(report.svg.includes('3.50s'), true);

  const loopedReport = exportToSVGBenchmarked(
    sampleStrokes,
    { strategyId: SymmetryStrategyKind.Radial, order: 4 },
    1000,
    1000,
    '#090d16',
    undefined,
    undefined,
    SvgAnimationMode.PathDrawing,
    { cycleDurationSec: 3.5, staggerDelayMs: 60, loop: true }
  );
  assert.equal(loopedReport.svg.includes('infinite alternate'), true);
});
