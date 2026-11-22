/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure/Async Probe Runners for AndroidAnalysisHub (Worker parity, Pixel Escape Hatch & Memory L0/L1).
 */

import { LOGICAL_CENTER, WASM_CONFIG } from '../../features/mandala/model/constants.ts';
import { SymmetryStrategyKind, type WedgeStroke } from '../../features/mandala/model/types.ts';
import { expandStrokeWithStrategy } from '../../features/mandala/strategies/symmetry.ts';
import { SHARED_SYMMETRY_CACHE } from '../../features/mandala/memory/geometryCache.ts';
import { TypedPointBuffer } from '../../features/mandala/memory/pointBuffer.ts';
import { buildSceneMemoryReport } from '../../features/mandala/memory/memoryBudget.ts';
import { renderSceneToPixelBuffer } from '../../features/mandala/engine/pixelBufferEscapeHatch.ts';
import { useMandalaStore } from '../../features/mandala/model/store.ts';
import { withTimedScope } from '../../shared/lib/contextManager.ts';
import type { WorkerParityProbe } from './BenchmarkTab.tsx';
import type { MemoryStressProbe } from './MemoryPatternTab.tsx';

export async function executeWorkerAndEscapeHatchProbe(): Promise<WorkerParityProbe> {
  const { loadWasmWorkerClient } = await import('../../features/mandala/wasm/wasmLoader.ts');
  const sampleWedge: WedgeStroke = {
    id: 'parity_probe',
    points: Array.from({ length: 16 }, (_, i) => ({
      x: LOGICAL_CENTER.x + Math.cos(i * 0.3) * (60 + i * 6),
      y: LOGICAL_CENTER.y - Math.sin(i * 0.3) * (60 + i * 6),
    })),
    stroke: '#56B4E9',
    strokeWidth: 3.5,
    dash: null,
    opacity: 0.95,
  };
  const params = {
    strategyId: SymmetryStrategyKind.Radial,
    order: 24,
  } as const;

  const jsBaseline = expandStrokeWithStrategy(sampleWedge, params, LOGICAL_CENTER);
  const clientRes = await loadWasmWorkerClient();

  const heavyScene = Array.from({ length: 45 }, (_, idx) => ({
    ...sampleWedge,
    id: `eh_${idx}`,
    points: sampleWedge.points.slice(0, 4),
  }));
  const pixelOut = renderSceneToPixelBuffer(
    heavyScene,
    { strategyId: SymmetryStrategyKind.Radial, order: 48 },
    400,
    400
  );

  if (!clientRes.ok || !jsBaseline.ok) {
    return {
      ok: false,
      wasmBinaryBytes: 0,
      workerRoundTripMs: 0,
      workerComputeMs: 0,
      maxParityDelta: 0,
      escapeHatchRenderMs: Number(pixelOut.renderMs.toFixed(2)),
      escapeHatchPixels: pixelOut.nonTransparentPixels,
      errorMessage: !clientRes.ok ? clientRes.error : 'JS baseline fallito.',
    };
  }

  const workerRes = await clientRes.value.expandWedgeZeroCopy(
    sampleWedge,
    params,
    LOGICAL_CENTER
  );
  if (!workerRes.ok) {
    return {
      ok: false,
      wasmBinaryBytes: clientRes.value.wasmBinaryBytes,
      workerRoundTripMs: 0,
      workerComputeMs: 0,
      maxParityDelta: 0,
      escapeHatchRenderMs: Number(pixelOut.renderMs.toFixed(2)),
      escapeHatchPixels: pixelOut.nonTransparentPixels,
      errorMessage: workerRes.error,
    };
  }

  let maxDelta = 0;
  for (let s = 0; s < jsBaseline.value.length; s++) {
    const jsStroke = jsBaseline.value[s];
    if (!jsStroke) continue;
    const jsPts = jsStroke.points;
    const wPts = workerRes.value.strokes[s]?.points ?? [];
    for (let p = 0; p < jsPts.length; p++) {
      const jp = jsPts[p];
      const wp = wPts[p];
      if (!jp) continue;
      const dx = Math.abs(jp.x - (wp?.x ?? 0));
      const dy = Math.abs(jp.y - (wp?.y ?? 0));
      maxDelta = Math.max(maxDelta, dx, dy);
    }
  }

  return {
    ok: maxDelta <= WASM_CONFIG.parityTolerance,
    wasmBinaryBytes: clientRes.value.wasmBinaryBytes,
    workerRoundTripMs: Number(workerRes.value.roundTripMs.toFixed(3)),
    workerComputeMs: Number(workerRes.value.computeMs.toFixed(3)),
    maxParityDelta: maxDelta,
    escapeHatchRenderMs: Number(pixelOut.renderMs.toFixed(2)),
    escapeHatchPixels: pixelOut.nonTransparentPixels,
    errorMessage: null,
  };
}

export function executeMemoryStressProbe(): MemoryStressProbe {
  const testBuf = new TypedPointBuffer(256);
  const { durationMs } = withTimedScope(() => {
    for (let i = 0; i < 10_000; i++) {
      testBuf.push(400 + Math.cos(i) * 100, 400 + Math.sin(i) * 100, 0.7);
    }
  });
  const l0BytesAllocated = testBuf.byteLength;
  testBuf.reset();

  const state = useMandalaStore.getState();
  const sceneReport = buildSceneMemoryReport({
    wedges: state.wedges,
    historyDepth: state.undoStack.length + state.redoStack.length,
    l0BufferBytes: l0BytesAllocated,
    l1CacheStats: SHARED_SYMMETRY_CACHE.getStats(),
  });

  return {
    l0Push10kMs: Number(durationMs.toFixed(3)),
    l0BytesAllocated,
    sceneReport,
  };
}
