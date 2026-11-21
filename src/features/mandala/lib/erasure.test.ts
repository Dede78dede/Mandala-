import test from 'node:test';
import assert from 'node:assert/strict';
import { findWedgesIntersectingEraser, distSqPointToSegment } from './erasure.ts';
import { LOGICAL_CENTER } from '../model/constants.ts';
import { SymmetryStrategyKind, type WedgeStroke } from '../model/types.ts';

test('distSqPointToSegment: exact orthogonal distance to horizontal segment', () => {
  const dSq = distSqPointToSegment({ x: 50, y: 15 }, { x: 0, y: 10 }, { x: 100, y: 10 });
  assert.equal(dSq, 25);
});

test('findWedgesIntersectingEraser: erases base wedge when touching any N-fold symmetric petal', () => {
  const strokeA: WedgeStroke = {
    id: 'w_a',
    points: [
      { x: 400, y: 200 }, // 200px above center (400, 400)
      { x: 420, y: 200 },
    ],
    stroke: '#56B4E9',
    strokeWidth: 4,
    dash: null,
    opacity: 1,
  };
  const strokeB: WedgeStroke = {
    id: 'w_b',
    points: [
      { x: 400, y: 360 }, // Inner ring
      { x: 410, y: 360 },
    ],
    stroke: '#E69F00',
    strokeWidth: 4,
    dash: null,
    opacity: 1,
  };

  // Click at the 90-degree rotated copy of strokeA: (400, 200) rotated +90 deg around (400, 400) = (600, 400)
  const hits = findWedgesIntersectingEraser(
    [strokeA, strokeB],
    { x: 600, y: 400 },
    15,
    { strategyId: SymmetryStrategyKind.Radial, order: 4 },
    LOGICAL_CENTER
  );

  assert.deepEqual(hits, ['w_a']);
});

test('findWedgesIntersectingEraser: handles single-point dot strokes cleanly', () => {
  const dotStroke: WedgeStroke = {
    id: 'dot_1',
    points: [{ x: 400, y: 300 }],
    stroke: '#009E73',
    strokeWidth: 8,
    dash: null,
    opacity: 1,
  };

  const hits = findWedgesIntersectingEraser(
    [dotStroke],
    { x: 400, y: 500 }, // 180-deg symmetric reflection
    12,
    { strategyId: SymmetryStrategyKind.Radial, order: 4 },
    LOGICAL_CENTER
  );
  assert.deepEqual(hits, ['dot_1']);
});
