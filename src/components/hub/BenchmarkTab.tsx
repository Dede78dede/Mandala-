/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Dual-Path JS vs WASM Benchmark, Worker Parity Probe & L-System Fractal Benchmark Tab.
 */

import React from 'react';
import { AlertCircle, CheckCircle2, Download, Play, Zap } from 'lucide-react';
import { MANDALA_LIMITS, WASM_CONFIG } from '../../features/mandala/model/constants.ts';
import {
  AdoptedComputePath,
  ExecutionRoutingMode,
  SymmetryStrategyKind,
  type FractalBenchmarkReport,
  type Phase3BenchmarkReport,
} from '../../features/mandala/model/types.ts';
import type { BenchmarkableStrategy } from '../../features/mandala/lib/benchmark.ts';

export interface WorkerParityProbe {
  readonly ok: boolean;
  readonly wasmBinaryBytes: number;
  readonly workerRoundTripMs: number;
  readonly workerComputeMs: number;
  readonly maxParityDelta: number;
  readonly escapeHatchRenderMs: number;
  readonly escapeHatchPixels: number;
  readonly errorMessage: string | null;
}

interface BenchmarkTabProps {
  readonly routingMode: ExecutionRoutingMode;
  readonly forceEscapeHatch: boolean;
  readonly benchmarkStrategy: BenchmarkableStrategy;
  readonly benchmarkReport: Phase3BenchmarkReport | null;
  readonly fractalReport: FractalBenchmarkReport | null;
  readonly workerProbe: WorkerParityProbe | null;
  readonly isRunningBenchmark: boolean;
  readonly isProbingWorker: boolean;
  readonly onSetRoutingMode: (mode: ExecutionRoutingMode) => void;
  readonly onToggleForceEscapeHatch: () => void;
  readonly onChangeStrategy: (strategy: BenchmarkableStrategy) => void;
  readonly onVerifyWorkerAndEscapeHatch: () => void;
  readonly onRunDualPathBenchmark: () => void;
  readonly onRunFractalBenchmark: () => void;
  readonly onDownloadBenchmarkJson: () => void;
}

function resolveAdoptedPathColor(path: AdoptedComputePath): string {
  if (path === AdoptedComputePath.Wasm) {
    return 'text-purple-300';
  }
  if (path === AdoptedComputePath.GreyZoneJs || path === AdoptedComputePath.GreyZoneWasm) {
    return 'text-amber-400';
  }
  return 'text-emerald-400';
}

export const BenchmarkTab: React.FC<BenchmarkTabProps> = ({
  routingMode,
  forceEscapeHatch,
  benchmarkStrategy,
  benchmarkReport,
  fractalReport,
  workerProbe,
  isRunningBenchmark,
  isProbingWorker,
  onSetRoutingMode,
  onToggleForceEscapeHatch,
  onChangeStrategy,
  onVerifyWorkerAndEscapeHatch,
  onRunDualPathBenchmark,
  onRunFractalBenchmark,
  onDownloadBenchmarkJson,
}) => (
  <div className="space-y-5">
    {/* Runtime Governance & Escape Hatch Controls */}
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <div className="p-4 bg-slate-800/40 border border-slate-700/60 rounded-xl space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-white">
            Routing Esecuzione Fase 3 (Gate Empirico)
          </span>
          <span className="text-[11px] font-mono text-cyan-300">{routingMode}</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[
            { id: ExecutionRoutingMode.AutoGate, label: 'Auto Gate (10/50ms)' },
            { id: ExecutionRoutingMode.ForceJs, label: 'Solo JS Baseline' },
            { id: ExecutionRoutingMode.ForceWasmWorker, label: 'WASM Web Worker' },
          ].map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => onSetRoutingMode(opt.id)}
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
          type="button"
          onClick={onToggleForceEscapeHatch}
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
            onChangeStrategy(val);
          }}
          className="px-2.5 py-2 text-xs bg-slate-900 border border-slate-700 rounded-lg text-slate-200"
          aria-label="Strategia da testare"
        >
          <option value={SymmetryStrategyKind.Radial}>RadialStrategy (N)</option>
          <option value={SymmetryStrategyKind.MirrorRadial}>MirrorRadialStrategy (2N)</option>
        </select>
        <button
          type="button"
          onClick={onVerifyWorkerAndEscapeHatch}
          disabled={isProbingWorker}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/50 text-emerald-300 rounded-lg transition disabled:opacity-50"
        >
          <Zap className="w-3.5 h-3.5" />
          <span>{isProbingWorker ? 'Verifica...' : 'Test Worker & Escape Hatch'}</span>
        </button>
        <button
          type="button"
          onClick={onRunDualPathBenchmark}
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
            type="button"
            onClick={onDownloadBenchmarkJson}
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
                    className={`p-2.5 font-sans font-medium ${resolveAdoptedPathColor(cell.adoptedPath)}`}
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
          type="button"
          onClick={onRunFractalBenchmark}
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
                  fractalReport.wasmEscalationRecommended ? 'text-amber-300' : 'text-emerald-300'
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
);
