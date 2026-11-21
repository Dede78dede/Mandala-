/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 1–3 Architecture, WASM Worker Calibration & Android Engineering Hub composed via <ModalShell>.
 * Tabs:
 * 1. ADRs Fasi 1–3 (9/9 Ratificati)
 * 2. Benchmark Dual-Path JS vs WASM + Worker Parity Probe + Pixel-Buffer Escape Hatch
 * 3. Scaffold Android (Kotlin 2.1) & Rust/WASM Crate
 * 4. Touch & S-Pen Low-Latency Pipeline
 * 5. PWA / TWA Play Store
 * 6. Architettura Memoria 4-Livelli & Principi Design
 */

import React, { useState } from 'react';
import {
  Smartphone,
  Layers,
  Copy,
  Check,
  Zap,
  Gauge,
  ShieldCheck,
  Code2,
  Play,
  Download,
  Cpu,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import {
  RefreshCw,
  RotateCcw,
} from 'lucide-react';
import {
  IDB_SWAP_CONFIG,
  LOGICAL_CENTER,
  MANDALA_LIMITS,
  MEMORY_TIER_LIMITS,
  RESOURCE_GUARD_LIMITS,
  WASM_CONFIG,
  isWasmSymmetryFlagEnabled,
} from '../features/mandala/model/constants.ts';
import {
  AdrStatus,
  ExecutionRoutingMode,
  HubTabId,
  SymmetryStrategyKind,
  type FractalBenchmarkReport,
  type Phase3BenchmarkReport,
  type WedgeStroke,
} from '../features/mandala/model/types.ts';
import {
  PHASE1_ADRS,
  ANDROID_PHASE1_SCAFFOLD,
  PHASE3_WASM_SCAFFOLD,
} from '../features/mandala/model/adrRegistry.ts';
import type { BenchmarkableStrategy } from '../features/mandala/lib/benchmark.ts';
import { expandStrokeWithStrategy } from '../features/mandala/strategies/symmetry.ts';
import { useMandalaStore } from '../features/mandala/model/store.ts';
import { SHARED_SYMMETRY_CACHE } from '../features/mandala/memory/geometryCache.ts';
import { TypedPointBuffer } from '../features/mandala/memory/pointBuffer.ts';
import {
  buildSceneMemoryReport,
  type SceneMemoryReport,
} from '../features/mandala/memory/memoryBudget.ts';
import { renderSceneToPixelBuffer } from '../features/mandala/engine/pixelBufferEscapeHatch.ts';
import { getResourceHealthSnapshot } from '../features/mandala/lib/resourceGuard.ts';
import { withTimedScope } from '../shared/lib/contextManager.ts';
import { copyToClipboard, downloadTextFile } from '../shared/lib/browserExport.ts';
import { ModalShell } from '../shared/ui/ModalShell.tsx';

interface AndroidAnalysisHubProps {
  isOpen: boolean;
  onClose: () => void;
}

interface MemoryStressProbe {
  readonly l0Push10kMs: number;
  readonly l0BytesAllocated: number;
  readonly sceneReport: SceneMemoryReport;
}

interface WorkerParityProbe {
  readonly ok: boolean;
  readonly wasmBinaryBytes: number;
  readonly workerRoundTripMs: number;
  readonly workerComputeMs: number;
  readonly maxParityDelta: number;
  readonly escapeHatchRenderMs: number;
  readonly escapeHatchPixels: number;
  readonly errorMessage: string | null;
}

const DESIGN_PRINCIPLES_MATRIX: ReadonlyArray<{
  readonly principle: string;
  readonly implementation: string;
  readonly antipatternAvoided: string;
}> = [
  {
    principle: 'DRY',
    implementation:
      '<ModalShell>, canvasRenderer.ts unico per Web/PNG offscreen, resolveStrokeStylePreset e browserExport.ts',
    antipatternAvoided: 'Logica Bézier/blob/modale replicata in 3 componenti',
  },
  {
    principle: 'SOLID (SRP · OCP · DIP)',
    implementation:
      'Strategy registry senza branch, SwapStoragePort & GeometryEngine interfacce invertite, slice Zustand atomiche',
    antipatternAvoided: 'God-Store accoppiato a IndexedDB, AudioContext e Canvas DOM',
  },
  {
    principle: 'KISS & YAGNI',
    implementation:
      'Esecuzione JS + L1 LRU sincrona finché sotto soglia 10ms/50ms; WASM Worker attivato solo su evidenza empirica',
    antipatternAvoided: 'WASM/SharedArrayBuffer sempre attivi anche su N=3..24 (<1ms)',
  },
  {
    principle: 'CUPID & CoS',
    implementation:
      'Moduli puri componibili con Result<T, E>, connascence ridotta a contratti in types.ts/constants.ts',
    antipatternAvoided: 'Magic string sparse e dipendenze circolari UI ↔ geometria',
  },
  {
    principle: 'Context Managers',
    implementation:
      'withCanvasState, withOffscreenCanvas (64MB 4K), withBlobUrl, withIndexedDb e withWasmArena (reset_arena)',
    antipatternAvoided: 'Leak di Canvas backing-store, lineare WASM, AudioContext e ObjectURL',
  },
];

const COMBINED_SCAFFOLD = [...ANDROID_PHASE1_SCAFFOLD, ...PHASE3_WASM_SCAFFOLD] as const;

export const AndroidAnalysisHub: React.FC<AndroidAnalysisHubProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<HubTabId>(HubTabId.Phase1);
  const [selectedScaffoldIdx, setSelectedScaffoldIdx] = useState<number>(0);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [benchmarkReport, setBenchmarkReport] = useState<Phase3BenchmarkReport | null>(null);
  const [fractalReport, setFractalReport] = useState<FractalBenchmarkReport | null>(null);
  const [isRunningBenchmark, setIsRunningBenchmark] = useState<boolean>(false);
  const [benchmarkStrategy, setBenchmarkStrategy] = useState<BenchmarkableStrategy>(
    SymmetryStrategyKind.Radial
  );
  const [memoryProbe, setMemoryProbe] = useState<MemoryStressProbe | null>(null);
  const [workerProbe, setWorkerProbe] = useState<WorkerParityProbe | null>(null);
  const [isProbingWorker, setIsProbingWorker] = useState<boolean>(false);

  const routingMode = useMandalaStore((s) => s.routingMode);
  const forceEscapeHatch = useMandalaStore((s) => s.forceEscapeHatch);
  const setRoutingMode = useMandalaStore((s) => s.setRoutingMode);
  const setForceEscapeHatch = useMandalaStore((s) => s.setForceEscapeHatch);
  const flushCaches = useMandalaStore((s) => s.flushCaches);
  const resetSettings = useMandalaStore((s) => s.resetSettings);

  if (!isOpen) return null;

  const activeScaffoldFile = COMBINED_SCAFFOLD[selectedScaffoldIdx] ?? COMBINED_SCAFFOLD[0];
  const ratifiedCount = PHASE1_ADRS.filter((a) => a.status === AdrStatus.Ratified).length;
  const wasmFlagOn = isWasmSymmetryFlagEnabled();

  const handleCopyFile = async (path: string, content: string) => {
    const res = await copyToClipboard(content);
    if (res.ok) {
      setCopiedPath(path);
      setTimeout(() => setCopiedPath(null), 2000);
    }
  };

  const handleDownloadFile = (filename: string, content: string) => {
    const baseName = filename.split('/').pop() ?? 'file.txt';
    downloadTextFile(content, baseName, 'text/plain;charset=utf-8');
  };

  const handleRunDualPathBenchmark = async () => {
    setIsRunningBenchmark(true);
    try {
      const [{ loadWasmSymmetryInstance }, { runPhase3DualPathBenchmark }] = await Promise.all([
        import('../features/mandala/wasm/wasmLoader.ts'),
        import('../features/mandala/lib/benchmark.ts'),
      ]);
      const wasmRes = await loadWasmSymmetryInstance();
      const wasmInst = wasmRes.ok ? wasmRes.value : null;
      const report = runPhase3DualPathBenchmark(wasmInst, benchmarkStrategy, 12);
      setBenchmarkReport(report);
    } finally {
      setIsRunningBenchmark(false);
    }
  };

  const handleRunFractalBenchmark = async () => {
    const [{ loadWasmSymmetryInstance }, { runFractalBenchmarkMatrix }] = await Promise.all([
      import('../features/mandala/wasm/wasmLoader.ts'),
      import('../features/mandala/lib/benchmark.ts'),
    ]);
    const wasmRes = await loadWasmSymmetryInstance();
    const wasmInst = wasmRes.ok ? wasmRes.value : null;
    const report = runFractalBenchmarkMatrix(8, wasmInst);
    setFractalReport(report);
  };

  const handleDownloadBenchmarkJson = () => {
    if (!benchmarkReport) return;
    downloadTextFile(
      JSON.stringify(benchmarkReport, null, 2),
      `phase3-benchmark-${benchmarkReport.strategyId}.json`,
      'application/json;charset=utf-8'
    );
  };

  const handleVerifyWorkerAndEscapeHatch = async () => {
    setIsProbingWorker(true);
    try {
      const { loadWasmWorkerClient } = await import('../features/mandala/wasm/wasmLoader.ts');
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
        strategyId: SymmetryStrategyKind.Radial as const,
        order: 24,
      };

      const jsBaseline = expandStrokeWithStrategy(sampleWedge, params, LOGICAL_CENTER);
      const clientRes = await loadWasmWorkerClient();

      // Heavy N=48 x 45 wedges -> 2160 primitives >= 2000 escape hatch test
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
        setWorkerProbe({
          ok: false,
          wasmBinaryBytes: 0,
          workerRoundTripMs: 0,
          workerComputeMs: 0,
          maxParityDelta: 0,
          escapeHatchRenderMs: Number(pixelOut.renderMs.toFixed(2)),
          escapeHatchPixels: pixelOut.nonTransparentPixels,
          errorMessage: !clientRes.ok ? clientRes.error : 'JS baseline fallito.',
        });
        return;
      }

      const workerRes = await clientRes.value.expandWedgeZeroCopy(
        sampleWedge,
        params,
        LOGICAL_CENTER
      );
      if (!workerRes.ok) {
        setWorkerProbe({
          ok: false,
          wasmBinaryBytes: clientRes.value.wasmBinaryBytes,
          workerRoundTripMs: 0,
          workerComputeMs: 0,
          maxParityDelta: 0,
          escapeHatchRenderMs: Number(pixelOut.renderMs.toFixed(2)),
          escapeHatchPixels: pixelOut.nonTransparentPixels,
          errorMessage: workerRes.error,
        });
        return;
      }

      let maxDelta = 0;
      for (let s = 0; s < jsBaseline.value.length; s++) {
        const jsPts = jsBaseline.value[s].points;
        const wPts = workerRes.value.strokes[s]?.points ?? [];
        for (let p = 0; p < jsPts.length; p++) {
          const dx = Math.abs(jsPts[p].x - (wPts[p]?.x ?? 0));
          const dy = Math.abs(jsPts[p].y - (wPts[p]?.y ?? 0));
          maxDelta = Math.max(maxDelta, dx, dy);
        }
      }

      setWorkerProbe({
        ok: maxDelta <= WASM_CONFIG.parityTolerance,
        wasmBinaryBytes: clientRes.value.wasmBinaryBytes,
        workerRoundTripMs: Number(workerRes.value.roundTripMs.toFixed(3)),
        workerComputeMs: Number(workerRes.value.computeMs.toFixed(3)),
        maxParityDelta: maxDelta,
        escapeHatchRenderMs: Number(pixelOut.renderMs.toFixed(2)),
        escapeHatchPixels: pixelOut.nonTransparentPixels,
        errorMessage: null,
      });
    } finally {
      setIsProbingWorker(false);
    }
  };

  const handleInspectMemory = () => {
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

    setMemoryProbe({
      l0Push10kMs: Number(durationMs.toFixed(3)),
      l0BytesAllocated,
      sceneReport,
    });
  };

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title="Fase 5 Release Engineering — WASM L-System, Quality Gates & Android"
      subtitle={`${ratifiedCount}/${PHASE1_ADRS.length} ADRs ratificati · L-System WASM Off-Thread, Strict CSP, Bundle Gates & Kotlin 2.1`}
      ariaLabel="Fase 5: Release Engineering, Benchmark WASM, Quality Gates e Scaffold"
      closeButtonAriaLabel="Chiudi finestra"
      icon={<Smartphone className="w-5 h-5" />}
      iconContainerClassName="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
      maxWidthClassName="max-w-6xl"
      heightClassName="h-[90vh]"
      footer={
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>Fase 5 RC · Flag={String(wasmFlagOn)} · WASM Budget {(WASM_CONFIG.sizeBudgetBytes / 1024).toFixed(0)}KB · Font WOFF2 Locali · Strict CSP</span>
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition"
          >
            Chiudi
          </button>
        </div>
      }
    >
      {/* Tabs */}
      <div className="flex items-center gap-1 px-4 border-b border-slate-800 bg-slate-900/60 overflow-x-auto shrink-0">
        <button
          onClick={() => setActiveTab(HubTabId.Phase1)}
          className={`px-3 py-3 text-xs font-medium border-b-2 whitespace-nowrap transition-colors flex items-center gap-1.5 ${
            activeTab === HubTabId.Phase1
              ? 'border-emerald-400 text-emerald-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <ShieldCheck className="w-4 h-4 shrink-0" />
          1. ADRs Fasi 1–5 ({PHASE1_ADRS.length})
        </button>
        <button
          onClick={() => setActiveTab(HubTabId.Benchmark)}
          className={`px-3 py-3 text-xs font-medium border-b-2 whitespace-nowrap transition-colors flex items-center gap-1.5 ${
            activeTab === HubTabId.Benchmark
              ? 'border-cyan-400 text-cyan-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Gauge className="w-4 h-4 shrink-0" />
          2. Benchmark WASM &amp; Gate
        </button>
        <button
          onClick={() => setActiveTab(HubTabId.Scaffold)}
          className={`px-3 py-3 text-xs font-medium border-b-2 whitespace-nowrap transition-colors flex items-center gap-1.5 ${
            activeTab === HubTabId.Scaffold
              ? 'border-cyan-400 text-cyan-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Code2 className="w-4 h-4 shrink-0" />
          3. Scaffold Kotlin &amp; Rust
        </button>
        <button
          onClick={() => setActiveTab(HubTabId.Touch)}
          className={`px-3 py-3 text-xs font-medium border-b-2 whitespace-nowrap transition-colors flex items-center gap-1.5 ${
            activeTab === HubTabId.Touch
              ? 'border-cyan-400 text-cyan-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Zap className="w-4 h-4 shrink-0" />
          4. Touch &amp; S-Pen
        </button>
        <button
          onClick={() => setActiveTab(HubTabId.Twa)}
          className={`px-3 py-3 text-xs font-medium border-b-2 whitespace-nowrap transition-colors flex items-center gap-1.5 ${
            activeTab === HubTabId.Twa
              ? 'border-cyan-400 text-cyan-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Layers className="w-4 h-4 shrink-0" />
          5. PWA / TWA Play Store
        </button>
        <button
          onClick={() => setActiveTab(HubTabId.Memory)}
          className={`px-3 py-3 text-xs font-medium border-b-2 whitespace-nowrap transition-colors flex items-center gap-1.5 ${
            activeTab === HubTabId.Memory
              ? 'border-purple-400 text-purple-300'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Cpu className="w-4 h-4 shrink-0" />
          6. Memoria &amp; Pattern
        </button>
      </div>

      {/* Tab Body */}
      <div className="flex-1 p-6 overflow-y-auto space-y-6 text-sm text-slate-300">
        {activeTab === HubTabId.Phase1 && (
          <div className="space-y-6">
            <div className="p-4 bg-emerald-950/20 border border-emerald-800/40 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-white">
                  Fase 4 Consolidata — Composizione Strategie, A11y WCAG 2.1 AA &amp; PWA Controlled Update
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  3 strategie attive (Radiale, Speculare, Frattale L-System), routing data-driven senza branch, mirror parametrico throttled a 500ms, live region a 300ms e Service Worker a 3 classi con <code className="text-emerald-300">registerType: prompt</code>.
                </p>
              </div>
              <span className="text-xs font-mono font-semibold text-emerald-300 whitespace-nowrap">
                {ratifiedCount}/{PHASE1_ADRS.length} ADRs Ratificati
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {PHASE1_ADRS.map((adr) => (
                <div
                  key={adr.id}
                  className="p-4 bg-slate-800/40 border border-slate-700/60 rounded-xl space-y-2"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-mono font-semibold text-cyan-400">
                      {adr.id} · {adr.phase}
                    </span>
                    <span
                      className={`font-medium ${
                        adr.status === AdrStatus.Ratified ? 'text-emerald-400' : 'text-amber-400'
                      }`}
                    >
                      {adr.status}
                    </span>
                  </div>
                  <h4 className="text-sm font-semibold text-white">{adr.title}</h4>
                  <p className="text-xs text-slate-300 leading-relaxed">{adr.decision}</p>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    <strong>Motivazione:</strong> {adr.rationale}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    <strong>Condizione di revisione:</strong> {adr.revisitCondition}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === HubTabId.Benchmark && (
          <div className="space-y-5">
            {/* Runtime Governance & Escape Hatch Controls */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div className="p-4 bg-slate-800/40 border border-slate-700/60 rounded-xl space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-white">
                    Routing Esecuzione Fase 3 (Gate Empirico)
                  </span>
                  <span className="text-[11px] font-mono text-cyan-300">
                    {routingMode}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { id: ExecutionRoutingMode.AutoGate, label: 'Auto Gate (10/50ms)' },
                    { id: ExecutionRoutingMode.ForceJs, label: 'Solo JS Baseline' },
                    { id: ExecutionRoutingMode.ForceWasmWorker, label: 'WASM Web Worker' },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => setRoutingMode(opt.id)}
                      className={`px-2.5 py-1.5 text-xs rounded-lg border transition ${
                        routingMode === opt.id
                          ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200 font-medium'
                          : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-4 bg-slate-800/40 border border-slate-700/60 rounded-xl flex items-center justify-between gap-3">
                <div>
                  <span className="text-xs font-semibold text-white block">
                    Pixel-Buffer Escape Hatch (Layer 1 RGBA)
                  </span>
                  <span className="text-[11px] text-slate-400">
                    Attivazione automatica ≥ {MANDALA_LIMITS.escapeHatchStrokeThreshold} primitive o manuale per test render_to_buffer.
                  </span>
                </div>
                <button
                  onClick={() => setForceEscapeHatch(!forceEscapeHatch)}
                  aria-pressed={forceEscapeHatch}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition shrink-0 ${
                    forceEscapeHatch
                      ? 'bg-amber-500/20 border-amber-400 text-amber-300'
                      : 'bg-slate-900 border-slate-700 text-slate-300 hover:text-white'
                  }`}
                >
                  {forceEscapeHatch ? 'Attivo (Forzato)' : 'Auto (≥2000)'}
                </button>
              </div>
            </div>

            {/* Dual-Path Benchmark Action Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-slate-800/40 border border-slate-700/60 rounded-xl">
              <div>
                <h3 className="text-sm font-semibold text-white">
                  Matrice Dual-Path JS vs WASM (Gate {MANDALA_LIMITS.wasmGateOptimalMs}ms /{' '}
                  {MANDALA_LIMITS.wasmGateCandidateMs}ms)
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Confronta strategia JS vs kernel <code className="text-cyan-300">mandala_symmetry.wasm</code> su 12 tratti × N=8..48 e misura il costo di confine no-op.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <select
                  value={benchmarkStrategy}
                  onChange={(e) => {
                    const val =
                      e.target.value === SymmetryStrategyKind.MirrorRadial
                        ? SymmetryStrategyKind.MirrorRadial
                        : SymmetryStrategyKind.Radial;
                    setBenchmarkStrategy(val);
                  }}
                  className="px-2.5 py-2 text-xs bg-slate-900 border border-slate-700 rounded-lg text-slate-200"
                  aria-label="Strategia da testare"
                >
                  <option value={SymmetryStrategyKind.Radial}>RadialStrategy (N)</option>
                  <option value={SymmetryStrategyKind.MirrorRadial}>
                    MirrorRadialStrategy (2N)
                  </option>
                </select>
                <button
                  onClick={() => void handleVerifyWorkerAndEscapeHatch()}
                  disabled={isProbingWorker}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/50 text-emerald-300 rounded-lg transition disabled:opacity-50"
                >
                  <Zap className="w-3.5 h-3.5" />
                  <span>{isProbingWorker ? 'Verifica...' : 'Test Worker & Escape Hatch'}</span>
                </button>
                <button
                  onClick={() => void handleRunDualPathBenchmark()}
                  disabled={isRunningBenchmark}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-cyan-500 hover:bg-cyan-400 text-slate-950 rounded-lg transition disabled:opacity-50"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>{isRunningBenchmark ? 'Calibrazione...' : 'Esegui Benchmark JS vs WASM'}</span>
                </button>
              </div>
            </div>

            {workerProbe && (
              <div
                className={`p-4 rounded-xl border text-xs grid grid-cols-2 md:grid-cols-4 gap-3 tabular-nums ${
                  workerProbe.ok
                    ? 'bg-emerald-950/20 border-emerald-700/50'
                    : 'bg-rose-950/20 border-rose-700/50'
                }`}
              >
                <div>
                  <span className="text-slate-400 block">Worker &amp; Parità 1e-12</span>
                  <strong className="inline-flex items-center gap-1 font-mono text-white">
                    {workerProbe.ok ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
                    )}
                    {workerProbe.ok
                      ? `Δ=${workerProbe.maxParityDelta.toExponential(1)} (${workerProbe.wasmBinaryBytes} B)`
                      : workerProbe.errorMessage}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-400 block">Zero-Copy Worker RTT</span>
                  <strong className="font-mono text-cyan-300">
                    {workerProbe.workerRoundTripMs} ms (core {workerProbe.workerComputeMs} ms)
                  </strong>
                </div>
                <div>
                  <span className="text-slate-400 block">Escape Hatch N=48 (2160 prim.)</span>
                  <strong className="font-mono text-amber-300">
                    {workerProbe.escapeHatchRenderMs} ms ({workerProbe.escapeHatchPixels.toLocaleString()} px)
                  </strong>
                </div>
                <div>
                  <span className="text-slate-400 block">Budget Binario WASM</span>
                  <strong className="font-mono text-emerald-300">
                    {workerProbe.wasmBinaryBytes} B / {(WASM_CONFIG.sizeBudgetBytes / 1024).toFixed(0)} KB
                  </strong>
                </div>
              </div>
            )}

            {!benchmarkReport ? (
              <div className="p-8 text-center bg-slate-800/20 border border-slate-800 rounded-xl text-xs text-slate-400">
                Premi <strong>Esegui Benchmark JS vs WASM</strong> per calibrare la matrice completa N=8..48 oppure <strong>Test Worker &amp; Escape Hatch</strong> per verificare la parità zero-copy sul Web Worker reale.
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 bg-slate-950/70 border border-slate-800 rounded-xl text-xs tabular-nums">
                  <div className="flex flex-wrap items-center gap-4">
                    <span>
                      No-op boundary:{' '}
                      <strong className="font-mono text-cyan-300">
                        {benchmarkReport.noopRoundTripMs} ms
                      </strong>
                    </span>
                    <span>
                      Binario WASM:{' '}
                      <strong className="font-mono text-emerald-300">
                        {benchmarkReport.wasmBinaryBytes} B
                      </strong>
                    </span>
                    <span>
                      Soglia calibrata:{' '}
                      <strong className="font-mono text-amber-300">
                        {benchmarkReport.calibratedMinWedgeComplexity !== null
                          ? `${benchmarkReport.calibratedMinWedgeComplexity} primitive`
                          : 'JS Ottimale su tutta la matrice'}
                      </strong>
                    </span>
                  </div>
                  <button
                    onClick={handleDownloadBenchmarkJson}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-cyan-300 rounded-lg transition"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Esporta JSON</span>
                  </button>
                </div>

                <div className="overflow-x-auto border border-slate-800 rounded-xl">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-800/80 text-slate-200">
                      <tr>
                        <th className="p-2.5 border-b border-slate-700">N</th>
                        <th className="p-2.5 border-b border-slate-700">Complessità</th>
                        <th className="p-2.5 border-b border-slate-700">Tratti</th>
                        <th className="p-2.5 border-b border-slate-700">JS Med (p95)</th>
                        <th className="p-2.5 border-b border-slate-700">WASM Med (Core)</th>
                        <th className="p-2.5 border-b border-slate-700">Ratio</th>
                        <th className="p-2.5 border-b border-slate-700">Decisione ADR</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70 tabular-nums font-mono">
                      {benchmarkReport.cells.map((cell, idx) => (
                        <tr key={idx} className="hover:bg-slate-800/30">
                          <td className="p-2.5 text-white font-semibold">N={cell.order}</td>
                          <td className="p-2.5 font-sans text-slate-300">{cell.complexityLabel}</td>
                          <td className="p-2.5 text-slate-300">{cell.expandedCount}</td>
                          <td className="p-2.5 text-cyan-300">
                            {cell.medianMs.toFixed(3)} ({cell.p95Ms.toFixed(2)})
                          </td>
                          <td className="p-2.5 text-purple-300">
                            {cell.wasmMedianMs.toFixed(3)} ({cell.wasmComputeOnlyMs.toFixed(3)})
                          </td>
                          <td className="p-2.5 text-slate-300">{cell.speedupRatio}×</td>
                          <td
                            className={`p-2.5 font-sans font-medium ${
                              cell.adoptedPath === 'WASM'
                                ? 'text-purple-300'
                                : cell.adoptedPath.startsWith('GREY')
                                  ? 'text-amber-400'
                                  : 'text-emerald-400'
                            }`}
                          >
                            {cell.adoptedPath} · {cell.gateVerdict}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Phase 4 Fractal Strategy Benchmark Section */}
            <div className="p-4 bg-purple-950/20 border border-purple-800/40 rounded-xl space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h4 className="text-xs font-semibold text-white">
                    Benchmark Strategia Frattale L-System (Generazioni 1–6 · Soglia Segmenti)
                  </h4>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Verifica se i 4 preset superano la regola dei 50ms a generazioni ≥ 5 per eventuale porting Rust in Fase 5.
                  </p>
                </div>
                <button
                  onClick={() => void handleRunFractalBenchmark()}
                  className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition shrink-0"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>Esegui Benchmark Frattale (1–6)</span>
                </button>
              </div>

              {fractalReport && (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-4 text-xs px-3 py-2 bg-slate-950/70 rounded-lg border border-slate-800">
                    <span>
                      Soglia segmenti calibrata:{' '}
                      <strong className="font-mono text-purple-300">
                        {fractalReport.calibratedSegmentThreshold} seg
                      </strong>
                    </span>
                    <span>
                      Escalation WASM Fase 5:{' '}
                      <strong
                        className={`font-mono ${
                          fractalReport.wasmEscalationRecommended
                            ? 'text-amber-300'
                            : 'text-emerald-300'
                        }`}
                      >
                        {fractalReport.wasmEscalationRecommended
                          ? 'Raccomandata (gen >= 5 > 50ms)'
                          : 'Non necessaria (JS entro 50ms)'}
                      </strong>
                    </span>
                  </div>

                  <div className="overflow-x-auto border border-slate-800 rounded-xl max-h-64 overflow-y-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-800/80 text-slate-200 sticky top-0">
                        <tr>
                          <th className="p-2 border-b border-slate-700">Preset</th>
                          <th className="p-2 border-b border-slate-700">Gen</th>
                          <th className="p-2 border-b border-slate-700">Segmenti Base</th>
                          <th className="p-2 border-b border-slate-700">Espansi (N=8)</th>
                          <th className="p-2 border-b border-slate-700">JS Med (p95)</th>
                          <th className="p-2 border-b border-slate-700">WASM Med (Speedup)</th>
                          <th className="p-2 border-b border-slate-700">Regola 50ms</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/70 tabular-nums font-mono">
                        {fractalReport.cells.map((c, idx) => (
                          <tr key={idx} className="hover:bg-slate-800/30">
                            <td className="p-2 font-sans text-white">{c.presetName}</td>
                            <td className="p-2 text-purple-300">G{c.generations}</td>
                            <td className="p-2 text-slate-300">{c.segmentCount}</td>
                            <td className="p-2 text-slate-300">{c.expandedSegmentCount}</td>
                            <td className="p-2 text-cyan-300">
                              {c.medianMs.toFixed(3)} ({c.p95Ms.toFixed(2)})
                            </td>
                            <td className="p-2 text-emerald-300">
                              {c.wasmMedianMs !== undefined
                                ? `${c.wasmMedianMs.toFixed(3)} ms (${c.wasmSpeedupRatio ?? 1}×)`
                                : 'N/D'}
                            </td>
                            <td
                              className={`p-2 font-sans font-medium ${
                                c.exceeds50msRule ? 'text-amber-300' : 'text-emerald-400'
                              }`}
                            >
                              {c.exceeds50msRule ? 'Worker WASM Attivo' : 'OK JS (<50ms)'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === HubTabId.Scaffold && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {COMBINED_SCAFFOLD.map((file, idx) => (
                <button
                  key={file.path}
                  onClick={() => setSelectedScaffoldIdx(idx)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition ${
                    selectedScaffoldIdx === idx
                      ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300'
                      : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:text-white'
                  }`}
                >
                  {file.path.split('/').pop()}
                </button>
              ))}
            </div>

            <div className="flex items-center justify-between px-4 py-2.5 bg-slate-800/60 border border-slate-700/60 rounded-xl text-xs">
              <div>
                <span className="font-semibold text-white">{activeScaffoldFile.title}</span>
                <span className="text-slate-400 ml-2 font-mono text-[11px]">
                  {activeScaffoldFile.path}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() =>
                    void handleCopyFile(activeScaffoldFile.path, activeScaffoldFile.content)
                  }
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition"
                >
                  {copiedPath === activeScaffoldFile.path ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span>{copiedPath === activeScaffoldFile.path ? 'Copiato' : 'Copia'}</span>
                </button>
                <button
                  onClick={() =>
                    handleDownloadFile(activeScaffoldFile.path, activeScaffoldFile.content)
                  }
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg transition"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Scarica</span>
                </button>
              </div>
            </div>

            <pre className="p-4 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-cyan-300 overflow-x-auto max-h-[46vh] leading-relaxed">
              {activeScaffoldFile.content}
            </pre>
          </div>
        )}

        {activeTab === HubTabId.Touch && (
          <div className="space-y-4">
            <h3 className="text-base font-semibold text-white">
              Pipeline Input Tattile &amp; Stilo S-Pen (&lt;8 ms Latency · ADR PH2-MOTION)
            </h3>
            <div className="space-y-3">
              <div className="p-4 bg-slate-800/40 border border-slate-700/60 rounded-xl">
                <h4 className="text-sm font-semibold text-cyan-400 mb-1">
                  1. Batch Storici ad Alta Frequenza (MotionEvent.getHistoricalX/Y)
                </h4>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Cattura tutti i campioni intermedi tra un frame e il successivo (240Hz–480Hz) per curve Bézier continue senza spezzature anche nei gesti rapidi.
                </p>
              </div>
              <div className="p-4 bg-slate-800/40 border border-slate-700/60 rounded-xl">
                <h4 className="text-sm font-semibold text-cyan-400 mb-1">
                  2. MotionEventPredictor 1.0.0 Stabile &amp; Curva Pressione
                </h4>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Integrazione ratificata con <code className="text-cyan-300">androidx.input:input-motionprediction:1.0.0</code> stabile (aggiornata da beta05) e rimappatura pressione non lineare.
                </p>
              </div>
              <div className="p-4 bg-slate-800/40 border border-slate-700/60 rounded-xl">
                <h4 className="text-sm font-semibold text-cyan-400 mb-1">
                  3. Palm Rejection Nativo &amp; StateFlow Lifecycle-Aware
                </h4>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Consumo stato tramite <code className="text-cyan-300">collectAsStateWithLifecycle()</code> e <code className="text-cyan-300">MandalaViewModel</code> con stack comandi a {MANDALA_LIMITS.maxHistoryCommands} voci.
                </p>
              </div>
            </div>
          </div>
        )}

        {activeTab === HubTabId.Twa && (
          <div className="space-y-5">
            <h3 className="text-base font-semibold text-white">
              PWA Offline-First (3 Classi), Update Controllato &amp; TWA Play Store
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              Service Worker Workbox configurato con <code className="text-cyan-300">registerType: &apos;prompt&apos;</code> (nessun <code className="text-cyan-300">skipWaiting()</code> silenzioso): caching a 3 classi (<strong>Cache-First</strong> per binari <code className="text-cyan-300">*.wasm</code>, <strong>Network-First</strong> 3s per HTML/manifest, <strong>Stale-While-Revalidate</strong> per font/assets) e banner utente con guardia anti doppio reload. Assenza deliberata di header COOP/COEP (ADR <code className="text-cyan-300">PH4-THREADING</code>).
            </p>
            <pre className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-cyan-300 overflow-x-auto">
              npx @bubblewrap/cli init --manifest=https://your-domain/manifest.webmanifest{'\n'}
              npx @bubblewrap/cli build
            </pre>
          </div>
        )}

        {activeTab === HubTabId.Memory && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-purple-950/20 border border-purple-800/40 rounded-xl">
              <div>
                <h3 className="text-sm font-semibold text-white">
                  Architettura Memoria Gerarchica &amp; Sicurezza Risorse (L0–L3)
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Tetto punti {RESOURCE_GUARD_LIMITS.maxScenePoints.toLocaleString()} · Tetto Heap {(RESOURCE_GUARD_LIMITS.l2HardMaxBytes / (1024 * 1024)).toFixed(0)} MB · Circuit Breaker CPU {RESOURCE_GUARD_LIMITS.cpuCircuitBreakerMs}ms
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => void flushCaches()}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-cyan-950/60 hover:bg-cyan-900/60 text-cyan-200 border border-cyan-700/60 rounded-lg transition"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Flush Cache</span>
                </button>
                <button
                  type="button"
                  onClick={resetSettings}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-amber-950/40 hover:bg-amber-900/50 text-amber-200 border border-amber-700/60 rounded-lg transition"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset Impostazioni</span>
                </button>
                <button
                  type="button"
                  onClick={handleInspectMemory}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>Stress Test Memoria L0–L3</span>
                </button>
              </div>
            </div>

            {(() => {
              const st = useMandalaStore.getState();
              const snap = getResourceHealthSnapshot(st.wedges, st.symmetryParams);
              return (
                <div className="p-4 bg-slate-950/70 border border-slate-800 rounded-xl grid grid-cols-2 md:grid-cols-4 gap-3 text-xs tabular-nums">
                  <div>
                    <span className="text-slate-400 block">Stato CPU &amp; Render</span>
                    <strong className="font-mono text-cyan-300">
                      {snap.cpuLoadState} ({snap.lastRenderMs} ms · peak {snap.peakRenderMs} ms)
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Saturazione Punti / Primitive</span>
                    <strong className="font-mono text-emerald-300">
                      {snap.l2PointCount.toLocaleString()} pt · {snap.expandedPrimitives.toLocaleString()} prim.
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Cache L1 + Heap L2</span>
                    <strong className="font-mono text-purple-300">
                      {((snap.l1BytesUsed + snap.l2WedgeHeapBytes) / 1024).toFixed(1)} KB ({snap.l1Entries} voci)
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Indice Saturazione</span>
                    <strong className="font-mono text-amber-300">
                      {(snap.saturationRatio * 100).toFixed(1)}% ({snap.jsHeapUsedMb !== null ? `${snap.jsHeapUsedMb} MB JS` : snap.memoryPressure})
                    </strong>
                  </div>
                </div>
              );
            })()}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div className="p-4 bg-slate-800/40 border border-slate-700/60 rounded-xl space-y-1.5">
                <span className="font-mono text-cyan-400 font-semibold">L0 · TypedPointBuffer (Float32Array)</span>
                <p className="text-slate-300">
                  Stride {MEMORY_TIER_LIMITS.l0PointStride} ([x, y, pressure]), pooling {MEMORY_TIER_LIMITS.l0InitialCapacityPoints}..{MEMORY_TIER_LIMITS.l0MaxPooledPoints} punti e render rAF imperativo zero-GC a 240Hz.
                </p>
              </div>
              <div className="p-4 bg-slate-800/40 border border-slate-700/60 rounded-xl space-y-1.5">
                <span className="font-mono text-emerald-400 font-semibold">L1 · SymmetryLruCache O(1)</span>
                <p className="text-slate-300">
                  Max {MEMORY_TIER_LIMITS.l1MaxEntries} voci / {(MEMORY_TIER_LIMITS.l1MaxBytes / (1024 * 1024)).toFixed(0)} MiB con chiave immutabile ed eviction FIFO/LRU deterministica.
                </p>
              </div>
              <div className="p-4 bg-slate-800/40 border border-slate-700/60 rounded-xl space-y-1.5">
                <span className="font-mono text-amber-400 font-semibold">L2 · Heap Working Set &amp; Partitioner</span>
                <p className="text-slate-300">
                  Finestra calda a {MEMORY_TIER_LIMITS.l2HotWedgeLimit} tratti, cronologia limitata a {MANDALA_LIMITS.maxHistoryCommands} comandi e classificazione pressione.
                </p>
              </div>
              <div className="p-4 bg-slate-800/40 border border-slate-700/60 rounded-xl space-y-1.5">
                <span className="font-mono text-purple-400 font-semibold">L3 · SwapStoragePort (IndexedDB)</span>
                <p className="text-slate-300">
                  Dual persistence asincrona debounced su DB <code className="text-purple-300">{IDB_SWAP_CONFIG.dbName}</code> + batch cold_wedges oltre il limite di 5MB di localStorage.
                </p>
              </div>
            </div>

            {memoryProbe && (
              <div className="p-4 bg-slate-950/70 border border-purple-700/50 rounded-xl grid grid-cols-2 md:grid-cols-4 gap-3 text-xs tabular-nums">
                <div>
                  <span className="text-slate-400 block">Push 10.000 pt (L0)</span>
                  <strong className="font-mono text-cyan-300">{memoryProbe.l0Push10kMs} ms ({(memoryProbe.l0BytesAllocated / 1024).toFixed(0)} KB)</strong>
                </div>
                <div>
                  <span className="text-slate-400 block">L1 Cache Hit Rate</span>
                  <strong className="font-mono text-emerald-300">
                    {(memoryProbe.sceneReport.l1CacheStats.hitRate * 100).toFixed(1)}% ({memoryProbe.sceneReport.l1CacheStats.entries} voci)
                  </strong>
                </div>
                <div>
                  <span className="text-slate-400 block">Heap Scena L2</span>
                  <strong className="font-mono text-amber-300">
                    {(memoryProbe.sceneReport.l2WedgeHeapBytes / 1024).toFixed(2)} KB ({memoryProbe.sceneReport.hotWedgeCount} hot)
                  </strong>
                </div>
                <div>
                  <span className="text-slate-400 block">Pressione &amp; Swap L3</span>
                  <strong className="font-mono text-purple-300">
                    {memoryProbe.sceneReport.pressureLevel} · {memoryProbe.sceneReport.coldSwapCandidateCount} cold
                  </strong>
                </div>
              </div>
            )}

            <div className="overflow-x-auto border border-slate-800 rounded-xl">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-800/80 text-slate-200">
                  <tr>
                    <th className="p-3 border-b border-slate-700">Principio</th>
                    <th className="p-3 border-b border-slate-700">Implementazione nel Progetto</th>
                    <th className="p-3 border-b border-slate-700">Antipattern Evitato</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {DESIGN_PRINCIPLES_MATRIX.map((row) => (
                    <tr key={row.principle} className="hover:bg-slate-800/30">
                      <td className="p-2.5 font-mono font-semibold text-cyan-300 whitespace-nowrap">
                        {row.principle}
                      </td>
                      <td className="p-2.5 text-slate-300">{row.implementation}</td>
                      <td className="p-2.5 text-slate-400">{row.antipatternAvoided}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </ModalShell>
  );
};
