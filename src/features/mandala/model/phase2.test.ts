import test from 'node:test';
import assert from 'node:assert/strict';
import { useMandalaStore } from './store.ts';
import { PHASE1_ADRS, ANDROID_PHASE1_SCAFFOLD } from './adrRegistry.ts';
import type { WedgeStroke } from './types.ts';

test('Phase 2 Command Pattern: commitStroke, eraseAtPoint, undo, redo are reversible', () => {
  const store = useMandalaStore.getState();
  store.clearCanvas();

  const stroke: WedgeStroke = {
    id: 'cmd_test_1',
    points: [
      { x: 400, y: 250 },
      { x: 430, y: 270 },
    ],
    stroke: '#56B4E9',
    strokeWidth: 4,
    dash: null,
    opacity: 0.95,
  };

  useMandalaStore.getState().commitStroke(stroke);
  assert.equal(useMandalaStore.getState().wedges.length, 1);
  assert.ok(useMandalaStore.getState().undoStack.length >= 1);

  // Erase symmetrically across an expanded petal (N=8 -> 45 deg increments, hit at base)
  const erased = useMandalaStore.getState().eraseAtPoint({ x: 400, y: 250 }, 15);
  assert.equal(erased, 1);
  assert.equal(useMandalaStore.getState().wedges.length, 0);

  // Undo erasure -> stroke returns
  useMandalaStore.getState().undo();
  assert.equal(useMandalaStore.getState().wedges.length, 1);

  // Redo erasure -> stroke removed again
  useMandalaStore.getState().redo();
  assert.equal(useMandalaStore.getState().wedges.length, 0);
});

test('Phase 2 Revised Android Scaffold: libs.versions.toml contains JUnit5 plugin, serialization, ViewModel, and stable motionprediction', () => {
  const toml = ANDROID_PHASE1_SCAFFOLD.find((f) => f.path === 'gradle/libs.versions.toml');
  assert.ok(toml);
  assert.ok(toml.content.includes('inputMotionPrediction = "1.0.0"'));
  assert.ok(!toml.content.includes('1.0.0-beta05'));
  assert.ok(toml.content.includes('de.mannodermaus.android-junit5'));
  assert.ok(toml.content.includes('org.jetbrains.kotlin.plugin.serialization'));
  assert.ok(toml.content.includes('androidx-lifecycle-viewmodel-compose'));
  assert.ok(toml.content.includes('androidx-lifecycle-runtime-compose'));
  assert.ok(toml.content.includes('androidx-activity-compose'));
  assert.ok(toml.content.includes('compileSdk = "35"'));
  assert.ok(toml.content.includes('minSdk = "28"'));

  const adrIds = PHASE1_ADRS.map((a) => a.id);
  assert.ok(adrIds.includes('PH2-HISTORY'));
  assert.ok(adrIds.includes('PH2-MOTION'));
});
