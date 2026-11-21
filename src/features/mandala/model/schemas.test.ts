import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMandalaDocumentJSON } from './schemas.ts';

test('Zod boundary: valid MandalaDocument JSON parses cleanly to ok result', () => {
  const validJson = JSON.stringify({
    schemaVersion: 1,
    title: 'Test Mandala',
    symmetryParams: { strategyId: 'mirror-radial', order: 12, mirrorMode: 'alternate' },
    wedges: [
      {
        id: 's1',
        points: [
          { x: 400, y: 300, pressure: 0.5 },
          { x: 420, y: 330, pressure: 0.8 },
        ],
        stroke: '#56B4E9',
        strokeWidth: 4,
        dash: [14, 10],
        opacity: 0.95,
      },
    ],
    paletteId: 'okabe-ito',
    activeColour: '#56B4E9',
    activeStrokeWidth: 4,
    activeDash: [14, 10],
    createdAt: '2026-11-16T17:00:00.000Z',
  });

  const res = parseMandalaDocumentJSON(validJson);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.value.schemaVersion, 1);
    assert.equal(res.value.wedges.length, 1);
  }
});

test('Zod boundary: rejects unsupported schemaVersion or malformed JSON safely', () => {
  const badVersion = JSON.stringify({
    schemaVersion: 99,
    title: 'Future Doc',
    symmetryParams: { strategyId: 'radial', order: 8 },
    wedges: [],
    paletteId: 'okabe-ito',
    activeColour: '#56B4E9',
    activeStrokeWidth: 3.5,
    activeDash: null,
    createdAt: '2026-11-16T17:00:00.000Z',
  });
  const res1 = parseMandalaDocumentJSON(badVersion);
  assert.equal(res1.ok, false);

  const res2 = parseMandalaDocumentJSON('{ not valid json');
  assert.equal(res2.ok, false);
});
