/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAMERA_LIMITS,
  LOGICAL_CENTER,
  WORLD_SPACE_LIMITS,
} from '../model/constants.ts';
import {
  CoordinateSpaceOrigin,
  SymmetryStrategyKind,
  type CameraTransform,
  type WedgeStroke,
} from '../model/types.ts';
import {
  migrateDocumentV1ToV2,
  parseMandalaDocument,
  resolveDocumentToActiveWedges,
} from '../model/schemas.ts';
import {
  computeCameraVisibleWorldBounds,
  computeWorldMinDistSq,
  cullStrokesToWorldBounds,
  measureWedgesMaxRadius,
  screenToWorldPoint,
  worldToScreenPoint,
  zoomCameraAtScreenPoint,
} from './viewportCamera.ts';
import { exportToSVG } from './svgExport.ts';

function makeStroke(id: string, x: number, y: number): WedgeStroke {
  return {
    id,
    points: [
      { x, y, pressure: 0.6 },
      { x: x + 20, y: y + 15, pressure: 0.7 },
    ],
    stroke: '#38bdf8',
    strokeWidth: 4,
    dash: null,
    opacity: 0.95,
  };
}

test('Phase A Camera: worldToScreenPoint <-> screenToWorldPoint lossless round-trip across zoom and pan', () => {
  const cameras: CameraTransform[] = [
    { zoom: CAMERA_LIMITS.minZoom, panX: -300, panY: 250 },
    { zoom: 1.0, panX: 0, panY: 0 },
    { zoom: 3.5, panX: 180, panY: -140 },
    { zoom: CAMERA_LIMITS.maxZoom, panX: 400, panY: 400 },
  ];

  const worldPt = { x: 560, y: 215, pressure: 0.8 };
  for (const cam of cameras) {
    const screen = worldToScreenPoint(worldPt, cam, 600, 1280, 720);
    const back = screenToWorldPoint(screen, cam, 600, 1280, 720);
    assert.ok(Math.abs(back.x - worldPt.x) < 1e-6);
    assert.ok(Math.abs(back.y - worldPt.y) < 1e-6);
    assert.equal(back.pressure, 0.8);
  }
});

test('Phase A Camera: zoomCameraAtScreenPoint keeps world anchor fixed under cursor', () => {
  const initial: CameraTransform = { zoom: 1.2, panX: 60, panY: -40 };
  const anchor = { x: 740, y: 290 };
  const displaySize = 620;
  const vw = 1200;
  const vh = 760;

  const worldBefore = screenToWorldPoint(anchor, initial, displaySize, vw, vh);
  const zoomed = zoomCameraAtScreenPoint(
    initial,
    4.0,
    anchor,
    displaySize,
    WORLD_SPACE_LIMITS.extendedRadius,
    vw,
    vh
  );
  const worldAfter = screenToWorldPoint(anchor, zoomed, displaySize, vw, vh);

  assert.equal(zoomed.zoom, 4.0);
  assert.ok(Math.abs(worldAfter.x - worldBefore.x) < 1e-6);
  assert.ok(Math.abs(worldAfter.y - worldBefore.y) < 1e-6);
});

test('Phase A Input Decimation: computeWorldMinDistSq scales inversely with zoom squared', () => {
  const d1 = computeWorldMinDistSq(4, 1.0);
  const d2 = computeWorldMinDistSq(4, 2.0);
  const d8 = computeWorldMinDistSq(4, 8.0);
  const dOut = computeWorldMinDistSq(4, 0.5);

  assert.equal(d1, 4);
  assert.equal(d2, 1);
  assert.ok(Math.abs(d8 - 4 / 64) < 1e-9);
  assert.equal(dOut, 16);
});

test('Phase A Spatial Culling: cullStrokesToWorldBounds keeps intersecting strokes and skips off-screen geometry', () => {
  const cam: CameraTransform = { zoom: 4.0, panX: 0, panY: 0 };
  const visible = computeCameraVisibleWorldBounds(cam, 600, 0, 600, 600);

  const inside = makeStroke('in_center', LOGICAL_CENTER.x - 10, LOGICAL_CENTER.y + 5);
  const farOutside = makeStroke('far_out', LOGICAL_CENTER.x + 900, LOGICAL_CENTER.y + 900);

  const culled = cullStrokesToWorldBounds([inside, farOutside], visible);
  assert.equal(culled.length, 1);
  assert.equal(culled[0].id, 'in_center');
});

test('Phase A Schema v1 -> v2 Migration: lossless conversion to origin-centered coordinates and back', () => {
  const v1 = {
    schemaVersion: 1 as const,
    title: 'Classic Doc',
    symmetryParams: { strategyId: SymmetryStrategyKind.Radial as const, order: 12 },
    wedges: [makeStroke('mig_1', 620, 180)],
    paletteId: 'okabe-ito',
    activeColour: '#38bdf8',
    activeStrokeWidth: 3.5,
    activeDash: null,
    createdAt: '2026-11-18T12:00:00.000Z',
  };

  const v2 = migrateDocumentV1ToV2(v1);
  assert.equal(v2.schemaVersion, 2);
  assert.equal(v2.coordinateOrigin, CoordinateSpaceOrigin.CenteredZero);
  assert.equal(v2.wedges[0].points[0].x, 220);
  assert.equal(v2.wedges[0].points[0].y, -220);

  const validated = parseMandalaDocument(v2);
  assert.equal(validated.ok, true);
  if (validated.ok) {
    const resolved = resolveDocumentToActiveWedges(validated.value);
    assert.equal(resolved.wedges[0].points[0].x, 620);
    assert.equal(resolved.wedges[0].points[0].y, 180);
  }
});

test('Phase A Extended World Export: measures outer radius and exports SVG over 2400px span', () => {
  const outerStroke = makeStroke('outer_ring', LOGICAL_CENTER.x + 950, LOGICAL_CENTER.y);
  const maxR = measureWedgesMaxRadius([outerStroke]);
  assert.ok(maxR >= 970);

  const svg = exportToSVG(
    [outerStroke],
    { strategyId: SymmetryStrategyKind.Radial, order: 6 },
    1200,
    1200,
    '#090d16'
  );
  assert.ok(svg.includes('<path'));
});
