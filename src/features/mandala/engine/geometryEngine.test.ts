import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ComputeBackend,
  JsGeometryEngine,
  assessSceneComputeProfile,
} from './geometryEngine.ts';
import {
  MirrorMode,
  PaletteId,
  StrokeStyleId,
  SymmetryStrategyKind,
  type WedgeStroke,
} from '../model/types.ts';
import {
  resolvePaletteById,
  resolveStrokeStylePreset,
} from '../model/palettes.ts';
import { buildMandalaDocument } from '../lib/persistence.ts';
import { parseMandalaDocument } from '../model/schemas.ts';
import { ANDROID_PHASE1_SCAFFOLD, PHASE1_ADRS } from '../model/adrRegistry.ts';

function makeStroke(id: string): WedgeStroke {
  return {
    id,
    points: [
      { x: 400, y: 300 },
      { x: 420, y: 320 },
    ],
    stroke: '#56B4E9',
    strokeWidth: 3.5,
    dash: null,
    opacity: 0.95,
  };
}

test('Phase 3 GeometryEngine: expands scene cleanly and trips pixel-buffer escape hatch at >=2000 primitives', () => {
  const few = [makeStroke('s1'), makeStroke('s2')];
  const res = JsGeometryEngine.expandScene(few, {
    strategyId: SymmetryStrategyKind.Radial,
    order: 8,
  });
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.value.length, 16);

  const lowProfile = assessSceneComputeProfile(few, {
    strategyId: SymmetryStrategyKind.Radial,
    order: 8,
  });
  assert.equal(lowProfile.requiresPixelBufferEscapeHatch, false);
  assert.equal(lowProfile.recommendedBackend, ComputeBackend.MainThreadJs);

  // 100 base wedges * (12 * 2) mirror-radial = 2400 >= 2000 threshold
  const heavy = Array.from({ length: 100 }, (_, i) => makeStroke(`h_${i}`));
  const heavyProfile = assessSceneComputeProfile(heavy, {
    strategyId: SymmetryStrategyKind.MirrorRadial,
    order: 12,
    mirrorMode: MirrorMode.Reflect,
  });
  assert.equal(heavyProfile.estimatedExpandedPrimitives, 2400);
  assert.equal(heavyProfile.requiresPixelBufferEscapeHatch, true);
  assert.equal(heavyProfile.recommendedBackend, ComputeBackend.WebWorkerJs);
});

test('Palettes & Stroke Style Helpers: deterministic preset and fallback resolution', () => {
  assert.equal(resolveStrokeStylePreset(null).id, StrokeStyleId.Solid);
  assert.equal(resolveStrokeStylePreset([2, 10]).id, StrokeStyleId.Dotted);
  assert.equal(resolveStrokeStylePreset([14, 10]).id, StrokeStyleId.Dashed);

  assert.equal(resolvePaletteById(PaletteId.CyberZen).id, PaletteId.CyberZen);
  assert.equal(resolvePaletteById('unknown-palette-id').id, PaletteId.OkabeIto);
});

test('Persistence buildMandalaDocument round-trips cleanly through Zod parseMandalaDocument', () => {
  const doc = buildMandalaDocument({
    symmetryParams: {
      strategyId: SymmetryStrategyKind.MirrorRadial,
      order: 10,
      mirrorMode: MirrorMode.Alternate,
    },
    wedges: [makeStroke('p1')],
    paletteId: PaletteId.OkabeIto,
    activeColour: '#E69F00',
    activeStrokeWidth: 4,
    activeDash: [14, 10],
  });
  const parsed = parseMandalaDocument(doc);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.value.wedges.length, 1);
    assert.equal(parsed.value.symmetryParams.order, 10);
  }
});

test('Phase 3 readiness ADR and fixed Android MandalaCanvas.kt scaffold parity', () => {
  assert.ok(PHASE1_ADRS.some((a) => a.id === 'PH3-ENGINE'));
  const ktCanvas = ANDROID_PHASE1_SCAFFOLD.find((f) =>
    f.path.endsWith('MandalaCanvas.kt')
  );
  assert.ok(ktCanvas);
  assert.ok(ktCanvas.content.includes('Color.parseColor(wedge.stroke)'));
  assert.ok(ktCanvas.content.includes('MirrorRadialStrategy'));
  assert.ok(ktCanvas.content.includes('native.drawCircle'));
  assert.ok(ktCanvas.content.includes('previewWedge'));
});
