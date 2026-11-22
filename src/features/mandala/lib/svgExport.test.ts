import test from 'node:test';
import assert from 'node:assert/strict';
import { exportToSVG, exportToSVGBenchmarked } from './svgExport.ts';
import {
  MirrorMode,
  SvgSerializationMode,
  SymmetryStrategyKind,
  type WedgeStroke,
} from '../model/types.ts';

test('exportToSVGBenchmarked: emits centered -W/2 -H/2 viewBox and prefers smaller <defs>/<use> at high N', () => {
  const complexStroke: WedgeStroke = {
    id: 's_bench',
    points: Array.from({ length: 20 }, (_, i) => ({ x: 400 + i * 5, y: 200 + i * 3 })),
    stroke: '#56B4E9',
    strokeWidth: 3,
    dash: [14, 10],
    opacity: 1,
  };

  const report = exportToSVGBenchmarked(
    [complexStroke],
    { strategyId: SymmetryStrategyKind.Radial, order: 24 },
    1200,
    1200,
    '#090d16',
    SvgSerializationMode.Auto
  );

  assert.ok(report.svg.includes('viewBox="-600 -600 1200 1200"'));
  assert.equal(report.modeUsed, SvgSerializationMode.DefsUse);
  assert.ok(report.defsUseBytes !== null && report.defsUseBytes < report.absoluteBytes);
  assert.ok(report.svg.includes('<defs>'));
  assert.ok(report.svg.includes('<use href="#w0"'));
});

test('exportToSVG: renders single-point strokes as centered SVG <circle> elements', () => {
  const dot: WedgeStroke = {
    id: 'dot_svg',
    points: [{ x: 400, y: 200 }],
    stroke: '#E69F00',
    strokeWidth: 8,
    dash: null,
    opacity: 0.95,
  };

  const svg = exportToSVG(
    [dot],
    {
      strategyId: SymmetryStrategyKind.MirrorRadial,
      order: 4,
      mirrorMode: MirrorMode.Reflect,
    },
    800,
    800,
    'none'
  );
  assert.ok(svg.includes('<circle'));
  assert.ok(svg.includes('cx="0.00"'));
  assert.ok(svg.includes('cy="-200.00"'));
});

test('exportToSVG: emits midpoint quadratic Bezier Q commands and escapes unsafe XML attributes', () => {
  const curveStroke: WedgeStroke = {
    id: 'curve_test',
    points: [
      { x: 400, y: 200 },
      { x: 440, y: 260 },
      { x: 480, y: 220 },
      { x: 520, y: 300 },
    ],
    stroke: '#56B4E9" onclick="alert(1)',
    strokeWidth: 4,
    dash: null,
    opacity: 1,
  };

  const svg = exportToSVG(
    [curveStroke],
    { strategyId: SymmetryStrategyKind.Radial, order: 4 },
    800,
    800,
    '#090d16'
  );

  assert.ok(svg.includes(' Q '), 'SVG should emit quadratic Bezier Q commands matching Canvas 2D');
  assert.ok(!svg.includes('onclick="alert(1)"'), 'Unsafe quote attributes must be XML-escaped');
  assert.ok(svg.includes('&quot;'));
});
