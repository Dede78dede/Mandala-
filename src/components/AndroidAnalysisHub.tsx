/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 1–5 Architecture, WASM Worker Calibration & Android Engineering Hub composed via <ModalShell>.
 * Modular orchestrator delegating tab views to src/components/hub/*.
 */

import React, { useState } from 'react';
import { Code2, Cpu, Gauge, Layers, ShieldCheck, Smartphone, Zap } from 'lucide-react';
import {
  WASM_CONFIG,
  isWasmSymmetryFlagEnabled,
} from '../features/mandala/model/constants.ts';
import {
  AdrStatus,
  HubTabId,
  SymmetryStrategyKind,
  type FractalBenchmarkReport,
  type Phase3BenchmarkReport,
} from '../features/mandala/model/types.ts';
import {
  ANDROID_PHASE1_SCAFFOLD,
  PHASE1_ADRS,
  PHASE3_WASM_SCAFFOLD,
} from '../features/mandala/model/adrRegistry.ts';
import type { BenchmarkableStrategy } from '../features/mandala/lib/benchmark.ts';
import { useMandalaStore } from '../features/mandala/model/store.ts';
import { getResourceHealthSnapshot } from '../features/mandala/lib/resourceGuard.ts';
import { copyToClipboard, downloadTextFile } from '../shared/lib/browserExport.ts';
import { ModalShell } from '../shared/ui/ModalShell.tsx';
import { AdrPhaseTab } from './hub/AdrPhaseTab.tsx';
import { BenchmarkTab, type WorkerParityProbe } from './hub/BenchmarkTab.tsx';
import { ScaffoldTab } from './hub/ScaffoldTab.tsx';
import { TouchPipelineTab, TwaStoreTab } from './hub/TouchTwaTabs.tsx';
import { MemoryPatternTab, type MemoryStressProbe } from './hub/MemoryPatternTab.tsx';
import { executeMemoryStressProbe, executeWorkerAndEscapeHatchProbe } from './hub/hubProbes.ts';

interface AndroidAnalysisHubProps {
  isOpen: boolean;
  onClose: () => void;
}

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
  const wedges = useMandalaStore((s) => s.wedges);
  const symmetryParams = useMandalaStore((s) => s.symmetryParams);
  const setRoutingMode = useMandalaStore((s) => s.setRoutingMode);
  const setForceEscapeHatch = useMandalaStore((s) => s.setForceEscapeHatch);
  const flushCaches = useMandalaStore((s) => s.flushCaches);
  const resetSettings = useMandalaStore((s) => s.resetSettings);

  if (!isOpen) return null;

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
      setWorkerProbe(await executeWorkerAndEscapeHatchProbe());
    } finally {
      setIsProbingWorker(false);
    }
  };

  const handleInspectMemory = () => {
    setMemoryProbe(executeMemoryStressProbe());
  };

  const tabItems = [
    {
      id: HubTabId.Phase1,
      label: `1. ADRs Fasi 1–5 (${PHASE1_ADRS.length})`,
      icon: <ShieldCheck className="w-4 h-4 shrink-0" />,
      activeBorder: 'border-emerald-400 text-emerald-400',
    },
    {
      id: HubTabId.Benchmark,
      label: '2. Benchmark WASM & Gate',
      icon: <Gauge className="w-4 h-4 shrink-0" />,
      activeBorder: 'border-cyan-400 text-cyan-400',
    },
    {
      id: HubTabId.Scaffold,
      label: '3. Scaffold Kotlin & Rust',
      icon: <Code2 className="w-4 h-4 shrink-0" />,
      activeBorder: 'border-cyan-400 text-cyan-400',
    },
    {
      id: HubTabId.Touch,
      label: '4. Touch & S-Pen',
      icon: <Zap className="w-4 h-4 shrink-0" />,
      activeBorder: 'border-cyan-400 text-cyan-400',
    },
    {
      id: HubTabId.Twa,
      label: '5. PWA / TWA Play Store',
      icon: <Layers className="w-4 h-4 shrink-0" />,
      activeBorder: 'border-cyan-400 text-cyan-400',
    },
    {
      id: HubTabId.Memory,
      label: '6. Memoria & Pattern',
      icon: <Cpu className="w-4 h-4 shrink-0" />,
      activeBorder: 'border-purple-400 text-purple-300',
    },
  ] as const;

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
          <span>
            Fase 5 RC · Flag={String(wasmFlagOn)} · WASM Budget{' '}
            {(WASM_CONFIG.sizeBudgetBytes / 1024).toFixed(0)}KB · Font WOFF2 Locali · Strict CSP
          </span>
          <button
            type="button"
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
        {tabItems.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-3 text-xs font-medium border-b-2 whitespace-nowrap transition-colors flex items-center gap-1.5 ${
              activeTab === tab.id
                ? tab.activeBorder
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Body */}
      <div className="flex-1 p-6 overflow-y-auto space-y-6 text-sm text-slate-300">
        {activeTab === HubTabId.Phase1 && <AdrPhaseTab ratifiedCount={ratifiedCount} />}

        {activeTab === HubTabId.Benchmark && (
          <BenchmarkTab
            routingMode={routingMode}
            forceEscapeHatch={forceEscapeHatch}
            benchmarkStrategy={benchmarkStrategy}
            benchmarkReport={benchmarkReport}
            fractalReport={fractalReport}
            workerProbe={workerProbe}
            isRunningBenchmark={isRunningBenchmark}
            isProbingWorker={isProbingWorker}
            onSetRoutingMode={setRoutingMode}
            onToggleForceEscapeHatch={() => setForceEscapeHatch(!forceEscapeHatch)}
            onChangeStrategy={setBenchmarkStrategy}
            onVerifyWorkerAndEscapeHatch={() => void handleVerifyWorkerAndEscapeHatch()}
            onRunDualPathBenchmark={() => void handleRunDualPathBenchmark()}
            onRunFractalBenchmark={() => void handleRunFractalBenchmark()}
            onDownloadBenchmarkJson={handleDownloadBenchmarkJson}
          />
        )}

        {activeTab === HubTabId.Scaffold && (
          <ScaffoldTab
            files={COMBINED_SCAFFOLD}
            selectedIdx={selectedScaffoldIdx}
            copiedPath={copiedPath}
            onSelectIdx={setSelectedScaffoldIdx}
            onCopyFile={(path, content) => void handleCopyFile(path, content)}
            onDownloadFile={handleDownloadFile}
          />
        )}

        {activeTab === HubTabId.Touch && <TouchPipelineTab />}
        {activeTab === HubTabId.Twa && <TwaStoreTab />}

        {activeTab === HubTabId.Memory && (
          <MemoryPatternTab
            healthSnapshot={getResourceHealthSnapshot(wedges, symmetryParams)}
            memoryProbe={memoryProbe}
            onFlushCaches={() => void flushCaches()}
            onResetSettings={resetSettings}
            onInspectMemory={handleInspectMemory}
          />
        )}
      </div>
    </ModalShell>
  );
};
