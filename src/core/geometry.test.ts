import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rotatePoint,
  reflectPoint,
  expandRadial,
  expandMirrorRadial,
  expandLSystem,
  interpretTurtle,
  exportToSVG,
  MirrorMode,
  SymmetryStrategyKind,
  Point,
  WedgeStroke,
  PALETTES,
} from './geometry.ts';

test('rotatePoint: rotating (10, 0) around (0, 0) by 90 degrees yields (0, 10)', () => {
  const center: Point = { x: 0, y: 0 };
  const p: Point = { x: 10, y: 0 };
  const rotated = rotatePoint(p, Math.PI / 2, center);
  assert.ok(Math.abs(rotated.x - 0) < 1e-6);
  assert.ok(Math.abs(rotated.y - 10) < 1e-6);
});

test('rotatePoint: center point maps to itself under all rotations', () => {
  const center: Point = { x: 250, y: 250 };
  const rotated = rotatePoint(center, 1.234, center);
  assert.equal(rotated.x, center.x);
  assert.equal(rotated.y, center.y);
});

test('reflectPoint: reflecting point across vertical axis preserves y and inverts dx', () => {
  const center: Point = { x: 100, y: 100 };
  const p: Point = { x: 120, y: 130 };
  // Axis pointing up (angle -PI/2 or PI/2)
  const reflected = reflectPoint(p, Math.PI / 2, center);
  assert.ok(Math.abs(reflected.x - 80) < 1e-6);
  assert.ok(Math.abs(reflected.y - 130) < 1e-6);
});

test('expandRadial: N=8 expansion produces 8 strokes', () => {
  const stroke: WedgeStroke = {
    id: 's1',
    points: [{ x: 100, y: 50 }, { x: 100, y: 80 }],
    stroke: '#56B4E9',
    strokeWidth: 3,
    dash: null,
    opacity: 1,
  };
  const expanded = expandRadial(stroke, 8, { x: 100, y: 100 });
  assert.equal(expanded.length, 8);
  assert.equal(expanded[0].id, 's1');
  assert.equal(expanded[1].id, 's1_r1');
});

test('expandMirrorRadial: N=6 expansion produces 12 strokes', () => {
  const stroke: WedgeStroke = {
    id: 's2',
    points: [{ x: 100, y: 50 }, { x: 110, y: 70 }],
    stroke: '#E69F00',
    strokeWidth: 2,
    dash: null,
    opacity: 1,
  };
  const expanded = expandMirrorRadial(stroke, 6, MirrorMode.Reflect, { x: 100, y: 100 });
  assert.equal(expanded.length, 12);
});

test('L-System expansion: expands axiom according to grammatical rules', () => {
  const axiom = 'F';
  const rules = { F: 'F+F' };
  const gen1 = expandLSystem(axiom, rules, 1);
  assert.equal(gen1, 'F+F');
  const gen2 = expandLSystem(axiom, rules, 2);
  assert.equal(gen2, 'F+F+F+F');
});

test('interpretTurtle: produces polylines for simple steps', () => {
  const polylines = interpretTurtle('FF', 10, 90, { x: 0, y: 0 });
  assert.ok(polylines.length >= 1);
  assert.equal(polylines[0].length, 3);
});

test('exportToSVG: generates valid SVG markup with vector geometry', () => {
  const stroke: WedgeStroke = {
    id: 's_svg',
    points: [{ x: 50, y: 50 }, { x: 60, y: 80 }],
    stroke: '#009E73',
    strokeWidth: 2,
    dash: null,
    opacity: 1,
  };
  const svg = exportToSVG([stroke], { strategyId: SymmetryStrategyKind.Radial, order: 4 }, 200, 200);
  assert.ok(svg.includes('<svg'));
  assert.ok(svg.includes('viewBox="-100 -100 200 200"'));
  assert.ok(svg.includes('stroke="#009E73"'));
  assert.ok(svg.includes('</svg>'));
});

test('Okabe-Ito palette exists and contains 8 distinct verified colors', () => {
  const okabe = PALETTES.find((p) => p.id === 'okabe-ito');
  assert.ok(okabe);
  assert.equal(okabe.colourblindSafe, true);
  assert.equal(okabe.colours.length, 8);
  assert.ok(okabe.colours.includes('#56B4E9')); // Sky Blue
  assert.ok(okabe.colours.includes('#E69F00')); // Orange
});
