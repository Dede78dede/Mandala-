/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 4-Tier Memory Architecture, Resource Health Telemetry & Design Principles Tab.
 */

import React from 'react';
import { Play, RefreshCw, RotateCcw } from 'lucide-react';
import {
  IDB_SWAP_CONFIG,
  MANDALA_LIMITS,
  MEMORY_TIER_LIMITS,
  RESOURCE_GUARD_LIMITS,
} from '../../features/mandala/model/constants.ts';
import type { ResourceHealthSnapshot } from '../../features/mandala/model/types.ts';
import type { SceneMemoryReport } from '../../features/mandala/memory/memoryBudget.ts';

export interface MemoryStressProbe {
  readonly l0Push10kMs: number;
  readonly l0BytesAllocated: number;
  readonly sceneReport: SceneMemoryReport;
}

const DESIGN_PRINCIPLES_MATRIX: ReadonlyArray<{
  readonly principle: string;
  readonly implementation: string;
  readonly antipatternAvoided: string;
}> = [
  {
    principle: 'DRY',
    implementation:
      '<ModalShell>, canvasRenderer.ts & curveInterpolation.ts unificati per Web/SVG/PNG, browserExport.ts',
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
      'withCanvasState, withOffscreenCanvas (64MB 4K), withBlobUrl, withImageBitmap, withIndexedDb e withWasmArena',
    antipatternAvoided: 'Leak di Canvas backing-store, ImageBitmap GPU, AudioContext e ObjectURL',
  },
];

interface MemoryPatternTabProps {
  readonly healthSnapshot: ResourceHealthSnapshot;
  readonly memoryProbe: MemoryStressProbe | null;
  readonly onFlushCaches: () => void;
  readonly onResetSettings: () => void;
  readonly onInspectMemory: () => void;
}

export const MemoryPatternTab: React.FC<MemoryPatternTabProps> = ({
  healthSnapshot,
  memoryProbe,
  onFlushCaches,
  onResetSettings,
  onInspectMemory,
}) => (
  <div className="space-y-6">
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-purple-950/20 border border-purple-800/40 rounded-xl">
      <div>
        <h3 className="text-sm font-semibold text-white">
          Architettura Memoria Gerarchica &amp; Sicurezza Risorse (L0–L3)
        </h3>
        <p className="text-xs text-slate-400 mt-0.5">
          Tetto punti {RESOURCE_GUARD_LIMITS.maxScenePoints.toLocaleString()} · Tetto Heap{' '}
          {(RESOURCE_GUARD_LIMITS.l2HardMaxBytes / (1024 * 1024)).toFixed(0)} MB · Circuit Breaker CPU{' '}
          {RESOURCE_GUARD_LIMITS.cpuCircuitBreakerMs}ms
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onFlushCaches}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-cyan-950/60 hover:bg-cyan-900/60 text-cyan-200 border border-cyan-700/60 rounded-lg transition"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Flush Cache</span>
        </button>
        <button
          type="button"
          onClick={onResetSettings}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-amber-950/40 hover:bg-amber-900/50 text-amber-200 border border-amber-700/60 rounded-lg transition"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Reset Impostazioni</span>
        </button>
        <button
          type="button"
          onClick={onInspectMemory}
          className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition"
        >
          <Play className="w-3.5 h-3.5" />
          <span>Stress Test Memoria L0–L3</span>
        </button>
      </div>
    </div>

    <div className="p-4 bg-slate-950/70 border border-slate-800 rounded-xl grid grid-cols-2 md:grid-cols-4 gap-3 text-xs tabular-nums">
      <div>
        <span className="text-slate-400 block">Stato CPU &amp; Render</span>
        <strong className="font-mono text-cyan-300">
          {healthSnapshot.cpuLoadState} ({healthSnapshot.lastRenderMs} ms · peak{' '}
          {healthSnapshot.peakRenderMs} ms)
        </strong>
      </div>
      <div>
        <span className="text-slate-400 block">Saturazione Punti / Primitive</span>
        <strong className="font-mono text-emerald-300">
          {healthSnapshot.l2PointCount.toLocaleString()} pt ·{' '}
          {healthSnapshot.expandedPrimitives.toLocaleString()} prim.
        </strong>
      </div>
      <div>
        <span className="text-slate-400 block">Cache L1 + Heap L2</span>
        <strong className="font-mono text-purple-300">
          {((healthSnapshot.l1BytesUsed + healthSnapshot.l2WedgeHeapBytes) / 1024).toFixed(1)} KB (
          {healthSnapshot.l1Entries} voci)
        </strong>
      </div>
      <div>
        <span className="text-slate-400 block">Indice Saturazione</span>
        <strong className="font-mono text-amber-300">
          {(healthSnapshot.saturationRatio * 100).toFixed(1)}% (
          {healthSnapshot.jsHeapUsedMb !== null
            ? `${healthSnapshot.jsHeapUsedMb} MB JS`
            : healthSnapshot.memoryPressure}
          )
        </strong>
      </div>
    </div>

    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
      <div className="p-4 bg-slate-800/40 border border-slate-700/60 rounded-xl space-y-1.5">
        <span className="font-mono text-cyan-400 font-semibold">
          L0 · TypedPointBuffer (Float32Array)
        </span>
        <p className="text-slate-300">
          Stride {MEMORY_TIER_LIMITS.l0PointStride} ([x, y, pressure]), pooling{' '}
          {MEMORY_TIER_LIMITS.l0InitialCapacityPoints}..{MEMORY_TIER_LIMITS.l0MaxPooledPoints} punti e render rAF imperativo zero-GC a 240Hz.
        </p>
      </div>
      <div className="p-4 bg-slate-800/40 border border-slate-700/60 rounded-xl space-y-1.5">
        <span className="font-mono text-emerald-400 font-semibold">L1 · SymmetryLruCache O(1)</span>
        <p className="text-slate-300">
          Max {MEMORY_TIER_LIMITS.l1MaxEntries} voci /{' '}
          {(MEMORY_TIER_LIMITS.l1MaxBytes / (1024 * 1024)).toFixed(0)} MiB con chiave immutabile ed eviction FIFO/LRU deterministica.
        </p>
      </div>
      <div className="p-4 bg-slate-800/40 border border-slate-700/60 rounded-xl space-y-1.5">
        <span className="font-mono text-amber-400 font-semibold">
          L2 · Heap Working Set &amp; Partitioner
        </span>
        <p className="text-slate-300">
          Finestra calda a {MEMORY_TIER_LIMITS.l2HotWedgeLimit} tratti, cronologia limitata a{' '}
          {MANDALA_LIMITS.maxHistoryCommands} comandi e classificazione pressione.
        </p>
      </div>
      <div className="p-4 bg-slate-800/40 border border-slate-700/60 rounded-xl space-y-1.5">
        <span className="font-mono text-purple-400 font-semibold">
          L3 · SwapStoragePort (IndexedDB)
        </span>
        <p className="text-slate-300">
          Dual persistence asincrona debounced su DB{' '}
          <code className="text-purple-300">{IDB_SWAP_CONFIG.dbName}</code> + batch cold_wedges oltre il limite di 5MB di localStorage.
        </p>
      </div>
    </div>

    {memoryProbe && (
      <div className="p-4 bg-slate-950/70 border border-purple-700/50 rounded-xl grid grid-cols-2 md:grid-cols-4 gap-3 text-xs tabular-nums">
        <div>
          <span className="text-slate-400 block">Push 10.000 pt (L0)</span>
          <strong className="font-mono text-cyan-300">
            {memoryProbe.l0Push10kMs} ms ({(memoryProbe.l0BytesAllocated / 1024).toFixed(0)} KB)
          </strong>
        </div>
        <div>
          <span className="text-slate-400 block">L1 Cache Hit Rate</span>
          <strong className="font-mono text-emerald-300">
            {(memoryProbe.sceneReport.l1CacheStats.hitRate * 100).toFixed(1)}% (
            {memoryProbe.sceneReport.l1CacheStats.entries} voci)
          </strong>
        </div>
        <div>
          <span className="text-slate-400 block">Heap Scena L2</span>
          <strong className="font-mono text-amber-300">
            {(memoryProbe.sceneReport.l2WedgeHeapBytes / 1024).toFixed(2)} KB (
            {memoryProbe.sceneReport.hotWedgeCount} hot)
          </strong>
        </div>
        <div>
          <span className="text-slate-400 block">Pressione &amp; Swap L3</span>
          <strong className="font-mono text-purple-300">
            {memoryProbe.sceneReport.pressureLevel} ·{' '}
            {memoryProbe.sceneReport.coldSwapCandidateCount} cold
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
);
