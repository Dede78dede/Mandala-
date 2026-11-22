import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearDiagnosticHistory,
  DiagnosticSeverity,
  DiagnosticSource,
  DomainErrorCode,
  getDiagnosticHistory,
  reportDiagnostic,
  subscribeDiagnostics,
} from '../../../shared/lib/diagnostics.ts';
import {
  createResourceScope,
  withImageBitmap,
} from '../../../shared/lib/contextManager.ts';
import {
  CanvasInteractionMode,
  computePinchMetrics,
  resolvePointerDownMode,
  resolveSafeBackingStoreDpr,
} from './canvasPointerFsm.ts';
import {
  buildSvgQuadraticPathData,
  traceQuadraticPolylineFlat,
  traceQuadraticPolylinePoints,
  type QuadraticPathSink,
} from './curveInterpolation.ts';
import {
  parseColdSwapBatch,
  parseWorkerInboundMessage,
} from '../model/schemas.ts';
import {
  KineticMode,
  MirrorMode,
  SymmetryStrategyKind,
  ToolId,
  WorkerMsgType,
} from '../model/types.ts';
import { escapeXmlAttr, sanitizeSvgId } from './svgExport.ts';
import { createFlatBufferView, forEachFlatPolyline } from '../wasm/wasmSymmetryAdapter.ts';
import { drawFlatBufferOnContext } from './canvasRenderer.ts';

test('diagnostics: delivers structured entries to subscribers and caps bounded history', () => {
  clearDiagnosticHistory();
  const received: string[] = [];
  const unsubscribe = subscribeDiagnostics((entry) => {
    received.push(`${entry.code}:${entry.source}`);
  });

  reportDiagnostic({
    severity: DiagnosticSeverity.Warning,
    source: DiagnosticSource.Storage,
    code: DomainErrorCode.StorageQuotaExceeded,
    message: 'Quota exceeded',
    userNotice: 'Spazio ridotto.',
  });
  unsubscribe();
  reportDiagnostic({
    severity: DiagnosticSeverity.Info,
    source: DiagnosticSource.Audio,
    code: DomainErrorCode.AudioBlocked,
    message: 'Muted before gesture',
  });

  assert.deepEqual(received, [`${DomainErrorCode.StorageQuotaExceeded}:${DiagnosticSource.Storage}`]);
  assert.equal(getDiagnosticHistory().length, 2);
  clearDiagnosticHistory();
});

test('canvasPointerFsm: transitions deterministically across tools, pan, pinch, lens, and DPR cap', () => {
  assert.equal(
    resolvePointerDownMode({
      activePointerCount: 2,
      lensEnabled: false,
      kineticMode: KineticMode.Off,
      button: 0,
      pointerType: 'touch',
      isPanToolActive: false,
      isSpaceHeld: false,
      activeTool: ToolId.Brush,
    }),
    CanvasInteractionMode.Pinching
  );

  assert.equal(
    resolvePointerDownMode({
      activePointerCount: 1,
      lensEnabled: true,
      kineticMode: KineticMode.Off,
      button: 0,
      pointerType: 'mouse',
      isPanToolActive: false,
      isSpaceHeld: false,
      activeTool: ToolId.Brush,
    }),
    CanvasInteractionMode.LensTilting
  );

  assert.equal(
    resolvePointerDownMode({
      activePointerCount: 1,
      lensEnabled: false,
      kineticMode: KineticMode.Off,
      button: 0,
      pointerType: 'pen',
      isPanToolActive: false,
      isSpaceHeld: false,
      activeTool: ToolId.Stamp,
    }),
    CanvasInteractionMode.Stamping
  );

  assert.equal(
    resolvePointerDownMode({
      activePointerCount: 1,
      lensEnabled: false,
      kineticMode: KineticMode.Off,
      button: 0,
      pointerType: 'mouse',
      isPanToolActive: false,
      isSpaceHeld: true,
      activeTool: ToolId.Brush,
    }),
    CanvasInteractionMode.Panning
  );

  const pinch = computePinchMetrics([
    { x: 0, y: 0 },
    { x: 30, y: 40 },
  ]);
  assert.ok(pinch);
  assert.equal(pinch.dist, 50);
  assert.deepEqual(pinch.mid, { x: 15, y: 20 });

  assert.equal(resolveSafeBackingStoreDpr(800, 800), 1);
  assert.ok(resolveSafeBackingStoreDpr(6000, 6000) < 1);
});

test('schemas: parseColdSwapBatch and parseWorkerInboundMessage validate runtime boundaries', () => {
  const validBatch = parseColdSwapBatch({
    batchId: 'batch_1',
    wedges: [
      {
        id: 'w1',
        points: [{ x: 400, y: 300 }],
        stroke: '#56B4E9',
        strokeWidth: 3,
        dash: null,
        opacity: 0.9,
      },
    ],
    savedAt: '2026-11-22T00:00:00Z',
  });
  assert.equal(validBatch.ok, true);

  const invalidBatch = parseColdSwapBatch({ batchId: '', wedges: [] });
  assert.equal(invalidBatch.ok, false);

  const validWorkerMsg = parseWorkerInboundMessage({
    type: WorkerMsgType.Expand,
    jobId: 1,
    points: new Float64Array([400, 300, 410, 310]),
    order: 8,
    strategyId: SymmetryStrategyKind.Radial,
    mirrorMode: MirrorMode.Reflect,
    cx: 400,
    cy: 400,
  });
  assert.equal(validWorkerMsg.ok, true);

  const badWorkerMsg = parseWorkerInboundMessage({
    type: WorkerMsgType.Expand,
    jobId: -5,
    order: 99,
  });
  assert.equal(badWorkerMsg.ok, false);
});

test('contextManager: withImageBitmap always closes bitmap on error and ExitStack disposes LIFO', async () => {
  let closed = false;
  const fakeBitmap = {
    width: 16,
    height: 16,
    close() {
      closed = true;
    },
  } as unknown as ImageBitmap;

  await assert.rejects(
    () =>
      withImageBitmap(fakeBitmap, () => {
        throw new Error('simulated gpu failure');
      }),
    /simulated gpu failure/
  );
  assert.equal(closed, true);

  const order: string[] = [];
  const scope = createResourceScope();
  scope.adopt({
    dispose: () => {
      order.push('first');
    },
  });
  scope.defer(() => {
    order.push('second-throws');
    throw new Error('cleanup noise');
  });
  scope.defer(() => {
    order.push('third');
  });
  scope.disposeAll();
  assert.deepEqual(order, ['third', 'second-throws', 'first']);
});

test('curveInterpolation & SoA flat view produce identical Bezier segments for Points and Float64Array', () => {
  const pts = [
    { x: 400, y: 400 },
    { x: 420, y: 360 },
    { x: 460, y: 340 },
    { x: 500, y: 390 },
  ];
  const flat = new Float64Array([400, 400, 420, 360, 460, 340, 500, 390]);
  const lengths = new Uint32Array([4]);

  const recordOps = (): string[] => {
    const ops: string[] = [];
    const sink: QuadraticPathSink = {
      moveTo: (x, y) => ops.push(`M:${x.toFixed(2)},${y.toFixed(2)}`),
      quadraticCurveTo: (cx, cy, x, y) =>
        ops.push(`Q:${cx.toFixed(2)},${cy.toFixed(2)},${x.toFixed(2)},${y.toFixed(2)}`),
      lineTo: (x, y) => ops.push(`L:${x.toFixed(2)},${y.toFixed(2)}`),
    };
    traceQuadraticPolylinePoints(sink, pts, 1);
    return ops;
  };

  const recordFlatOps = (): string[] => {
    const ops: string[] = [];
    const sink: QuadraticPathSink = {
      moveTo: (x, y) => ops.push(`M:${x.toFixed(2)},${y.toFixed(2)}`),
      quadraticCurveTo: (cx, cy, x, y) =>
        ops.push(`Q:${cx.toFixed(2)},${cy.toFixed(2)},${x.toFixed(2)},${y.toFixed(2)}`),
      lineTo: (x, y) => ops.push(`L:${x.toFixed(2)},${y.toFixed(2)}`),
    };
    const view = createFlatBufferView(flat, lengths);
    forEachFlatPolyline(view, (offset, count) => {
      traceQuadraticPolylineFlat(sink, view.buffer, offset, count, 1);
    });
    return ops;
  };

  const pointOps = recordOps();
  const flatOps = recordFlatOps();
  assert.deepEqual(flatOps, pointOps);

  const svgD = buildSvgQuadraticPathData(pts, 400, 400, 1, 1);
  assert.equal(svgD, 'M 0.00 0.00 Q 20.00 -40.00 40.00 -50.00 Q 60.00 -60.00 80.00 -35.00 L 100.00 -10.00');

  assert.equal(escapeXmlAttr(`"<script>&'`), '&quot;&lt;script&gt;&amp;&#39;');
  assert.equal(sanitizeSvgId('9bad id!@#'), 'id_9bad_id___');
});

test('canvasRenderer: drawFlatBufferOnContext renders single points and Bezier polylines inside save/restore', () => {
  const calls: string[] = [];
  const fakeCtx = {
    globalAlpha: 1,
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    setLineDash: (d: number[]) => calls.push(`dash:${d.join(',')}`),
    beginPath: () => calls.push('beginPath'),
    arc: (x: number, y: number, r: number) => calls.push(`arc:${x},${y},${r}`),
    fill: () => calls.push('fill'),
    moveTo: (x: number, y: number) => calls.push(`M:${x},${y}`),
    quadraticCurveTo: (cx: number, cy: number, x: number, y: number) =>
      calls.push(`Q:${cx},${cy},${x},${y}`),
    lineTo: (x: number, y: number) => calls.push(`L:${x},${y}`),
    stroke: () => calls.push('stroke'),
  } as unknown as CanvasRenderingContext2D;

  const buffer = new Float64Array([10, 20, 100, 100, 120, 140, 140, 160]);
  const lengths = new Uint32Array([1, 3]);

  drawFlatBufferOnContext(
    fakeCtx,
    buffer,
    lengths,
    { stroke: '#56B4E9', strokeWidth: 4, dash: [6, 3], opacity: 0.8 },
    1
  );

  assert.equal(calls[0], 'save');
  assert.equal(calls[calls.length - 1], 'restore');
  assert.ok(calls.includes('dash:6,3'));
  assert.ok(calls.includes('arc:10,20,2'));
  assert.ok(calls.includes('fill'));
  assert.ok(calls.includes('M:100,100'));
  assert.ok(calls.includes('Q:120,140,130,150'));
  assert.ok(calls.includes('L:140,160'));
  assert.ok(calls.includes('stroke'));
});
