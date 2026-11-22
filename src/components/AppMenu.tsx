/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Accessible Workspace Menu & Resource Maintenance Panel.
 * Shared DRY surface used both as TopBar dropdown menu and inside MobileOptionsSheet:
 * - Workspace Navigation (Frattali, Esporta/Importa, Motore & Diagnostica, Pulisci Tela)
 * - Live Memory/CPU Anti-Saturation Guard Monitor (dual-coded Icon + Label, tabular-nums)
 * - Explicit Flush Cache, Reset Impostazioni, and Reset Completo buttons
 */

import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  Menu,
  Sparkles,
  Download,
  Smartphone,
  Trash2,
  RotateCcw,
  ShieldCheck,
  ShieldAlert,
  Cpu,
  HardDrive,
  RefreshCw,
  ChevronDown,
  AlertTriangle,
  Globe,
  Focus,
  PlayCircle,
} from 'lucide-react';
import {
  CpuLoadState,
  KineticMode,
  MemoryPressureLevel,
  ModalPrefetchKey,
  type ResourceHealthSnapshot,
} from '../features/mandala/model/types.ts';
import { RESOURCE_GUARD_LIMITS } from '../features/mandala/model/constants.ts';
import { getResourceHealthSnapshot } from '../features/mandala/lib/resourceGuard.ts';
import { MANDALA_MESSAGES } from '../features/mandala/model/messages.ts';
import { isAndroidHybridHost } from '../shared/lib/androidBridge.ts';
import { useMandalaStore } from '../features/mandala/model/store.ts';

export interface AppMenuActions {
  readonly onOpenFractalModal: () => void;
  readonly onOpenExport: () => void;
  readonly onOpenAndroidHub: () => void;
  readonly onOpenAndroidDownload?: () => void;
  readonly onPrefetchModal?: (modal: ModalPrefetchKey) => void;
}

interface MenuBodyProps extends AppMenuActions {
  readonly onItemComplete?: () => void;
  readonly compact?: boolean;
}

function resolveHealthPresentation(health: ResourceHealthSnapshot): {
  label: string;
  toneClass: string;
  isWarning: boolean;
} {
  if (
    health.memoryPressure === MemoryPressureLevel.Critical ||
    health.cpuLoadState === CpuLoadState.Protected
  ) {
    return {
      label: 'Protetto (Soglia Alta)',
      toneClass: 'text-amber-300 bg-amber-950/50 border-amber-700/70',
      isWarning: true,
    };
  }
  if (
    health.memoryPressure === MemoryPressureLevel.Elevated ||
    health.cpuLoadState === CpuLoadState.Elevated
  ) {
    return {
      label: 'Carico Elevato',
      toneClass: 'text-amber-200 bg-slate-800/80 border-amber-700/50',
      isWarning: true,
    };
  }
  return {
    label: 'Nominale',
    toneClass: 'text-emerald-300 bg-slate-800/70 border-slate-700',
    isWarning: false,
  };
}

export const AppMenuSection: React.FC<MenuBodyProps> = memo(
  ({
    onOpenFractalModal,
    onOpenExport,
    onOpenAndroidHub,
    onOpenAndroidDownload,
    onPrefetchModal,
    onItemComplete,
    compact = false,
  }) => {
    const insideAndroidHost = isAndroidHybridHost();
    const wedges = useMandalaStore((s) => s.wedges);
    const symmetryParams = useMandalaStore((s) => s.symmetryParams);
    const autoProtectEnabled = useMandalaStore((s) => s.autoProtectEnabled);
    const lensEnabled = useMandalaStore((s) => s.lens.enabled);
    const cameraZoom = useMandalaStore((s) => s.camera.zoom);
    const setAutoProtectEnabled = useMandalaStore((s) => s.setAutoProtectEnabled);
    const setLensEnabled = useMandalaStore((s) => s.setLensEnabled);
    const kineticMode = useMandalaStore((s) => s.kineticMode);
    const enterKineticMode = useMandalaStore((s) => s.enterKineticMode);
    const exitKineticMode = useMandalaStore((s) => s.exitKineticMode);
    const resetViewport = useMandalaStore((s) => s.resetViewport);
    const clearCanvas = useMandalaStore((s) => s.clearCanvas);
    const flushCaches = useMandalaStore((s) => s.flushCaches);
    const resetSettings = useMandalaStore((s) => s.resetSettings);
    const resetWorkspaceAll = useMandalaStore((s) => s.resetWorkspaceAll);

    const [isFlushing, setIsFlushing] = useState<boolean>(false);
    const [confirmFullReset, setConfirmFullReset] = useState<boolean>(false);

    const health = useMemo(
      () => getResourceHealthSnapshot(wedges, symmetryParams),
      [wedges, symmetryParams]
    );
    const presentation = resolveHealthPresentation(health);

    const totalMemMb = ((health.l1BytesUsed + health.l2WedgeHeapBytes) / (1024 * 1024)).toFixed(2);
    const capMemMb = (RESOURCE_GUARD_LIMITS.l2HardMaxBytes / (1024 * 1024)).toFixed(0);

    const handleFlush = async () => {
      setIsFlushing(true);
      try {
        await flushCaches();
      } finally {
        setIsFlushing(false);
      }
    };

    const handleResetSettings = () => {
      resetSettings();
      onItemComplete?.();
    };

    const handleFullReset = async () => {
      if (!confirmFullReset) {
        setConfirmFullReset(true);
        return;
      }
      setConfirmFullReset(false);
      await resetWorkspaceAll();
      onItemComplete?.();
    };

    return (
      <div className={compact ? 'space-y-4' : 'space-y-3'}>
        {/* Sezione 1: Funzioni & Strumenti */}
        <div className="space-y-1.5">
          <span className="text-[11px] font-medium text-slate-400 block px-1">
            Strumenti di Creazione
          </span>
          <div className="grid grid-cols-1 gap-1">
            <button
              type="button"
              onMouseEnter={() => onPrefetchModal?.(ModalPrefetchKey.Fractal)}
              onFocus={() => onPrefetchModal?.(ModalPrefetchKey.Fractal)}
              onClick={() => {
                onOpenFractalModal();
                onItemComplete?.();
              }}
              className="w-full min-h-[40px] flex items-center justify-between px-3 py-2 text-xs font-medium text-slate-200 hover:text-white hover:bg-slate-800 rounded-lg transition text-left"
            >
              <span className="flex items-center gap-2.5">
                <Sparkles className="w-4 h-4 text-purple-400 shrink-0" />
                <span>Generatore Frattali L-System</span>
              </span>
            </button>

            <button
              type="button"
              onMouseEnter={() => onPrefetchModal?.(ModalPrefetchKey.Export)}
              onFocus={() => onPrefetchModal?.(ModalPrefetchKey.Export)}
              onClick={() => {
                onOpenExport();
                onItemComplete?.();
              }}
              className="w-full min-h-[40px] flex items-center justify-between px-3 py-2 text-xs font-medium text-slate-200 hover:text-white hover:bg-slate-800 rounded-lg transition text-left"
            >
              <span className="flex items-center gap-2.5">
                <Download className="w-4 h-4 text-cyan-400 shrink-0" />
                <span>Esporta / Importa (PNG, SVG, JSON)</span>
              </span>
            </button>

            <button
              type="button"
              onMouseEnter={() => onPrefetchModal?.(ModalPrefetchKey.Hub)}
              onFocus={() => onPrefetchModal?.(ModalPrefetchKey.Hub)}
              onClick={() => {
                onOpenAndroidHub();
                onItemComplete?.();
              }}
              className="w-full min-h-[40px] flex items-center justify-between px-3 py-2 text-xs font-medium text-slate-200 hover:text-white hover:bg-slate-800 rounded-lg transition text-left"
            >
              <span className="flex items-center gap-2.5">
                <Smartphone className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Motore Fase 5 &amp; Diagnostica</span>
              </span>
            </button>

            {onOpenAndroidDownload && (
              <button
                type="button"
                data-testid="menu-android-apk-button"
                onMouseEnter={() => onPrefetchModal?.(ModalPrefetchKey.AndroidDownload)}
                onFocus={() => onPrefetchModal?.(ModalPrefetchKey.AndroidDownload)}
                onClick={() => {
                  onOpenAndroidDownload();
                  onItemComplete?.();
                }}
                className="w-full min-h-[44px] flex items-center justify-between px-3 py-2 text-xs font-medium text-cyan-200 hover:text-white hover:bg-slate-800 rounded-lg transition text-left"
              >
                <span className="flex items-center gap-2.5">
                  <Download className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>
                    {insideAndroidHost
                      ? MANDALA_MESSAGES.distribution.menuButtonAndroid
                      : MANDALA_MESSAGES.distribution.menuButtonWeb}
                  </span>
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setLensEnabled(!lensEnabled);
                onItemComplete?.();
              }}
              className="w-full min-h-[40px] flex items-center justify-between px-3 py-2 text-xs font-medium text-slate-200 hover:text-white hover:bg-slate-800 rounded-lg transition text-left"
            >
              <span className="flex items-center gap-2.5">
                <Globe className="w-4 h-4 text-cyan-400 shrink-0" />
                <span>
                  {lensEnabled ? 'Torna a Vista Piana' : 'Anteprima Lente Semisferica WebGL2'}
                </span>
              </span>
            </button>

            <button
              type="button"
              data-testid="menu-zen-replay-button"
              onClick={() => {
                if (kineticMode === KineticMode.Off) {
                  enterKineticMode(
                    wedges.length > 0 ? KineticMode.StrokeReplay : KineticMode.ConcentricRings
                  );
                } else {
                  exitKineticMode();
                }
                onItemComplete?.();
              }}
              className="w-full min-h-[40px] flex items-center justify-between px-3 py-2 text-xs font-medium text-slate-200 hover:text-white hover:bg-slate-800 rounded-lg transition text-left"
            >
              <span className="flex items-center gap-2.5">
                <PlayCircle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>
                  {kineticMode === KineticMode.Off
                    ? 'Modalità Zen & Replay Tratti'
                    : 'Esci da Modalità Zen'}
                </span>
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                resetViewport();
                onItemComplete?.();
              }}
              className="w-full min-h-[40px] flex items-center justify-between px-3 py-2 text-xs font-medium text-slate-200 hover:text-white hover:bg-slate-800 rounded-lg transition text-left"
            >
              <span className="flex items-center gap-2.5">
                <Focus className="w-4 h-4 text-sky-400 shrink-0" />
                <span>Centra Camera (100% · {Math.round(cameraZoom * 100)}%)</span>
              </span>
            </button>

            <button
              type="button"
              disabled={wedges.length === 0}
              onClick={() => {
                clearCanvas();
                onItemComplete?.();
              }}
              className="w-full min-h-[40px] flex items-center justify-between px-3 py-2 text-xs font-medium text-slate-200 hover:text-rose-300 hover:bg-rose-950/30 disabled:opacity-40 disabled:pointer-events-none rounded-lg transition text-left"
            >
              <span className="flex items-center gap-2.5">
                <Trash2 className="w-4 h-4 text-rose-400 shrink-0" />
                <span>Pulisci Tela ({wedges.length} tratti)</span>
              </span>
            </button>
          </div>
        </div>

        {/* Sezione 2: Sistema Anti-Saturazione Memoria & CPU */}
        <div className="pt-2.5 border-t border-slate-800 space-y-2">
          <div className="flex items-center justify-between px-1">
            <span className="text-[11px] font-medium text-slate-400">
              Sicurezza Memoria &amp; CPU
            </span>
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-md border ${presentation.toneClass}`}
            >
              {presentation.isWarning ? (
                <ShieldAlert className="w-3 h-3 shrink-0" />
              ) : (
                <ShieldCheck className="w-3 h-3 shrink-0" />
              )}
              <span>{presentation.label}</span>
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[11px] tabular-nums">
            <div className="p-2 bg-slate-950/70 border border-slate-800 rounded-lg">
              <span className="flex items-center gap-1 text-slate-400">
                <HardDrive className="w-3 h-3 text-cyan-400" />
                Memoria L1–L2
              </span>
              <strong className="font-mono text-slate-100 block mt-0.5">
                {totalMemMb} / {capMemMb} MB
              </strong>
            </div>

            <div className="p-2 bg-slate-950/70 border border-slate-800 rounded-lg">
              <span className="flex items-center gap-1 text-slate-400">
                <Cpu className="w-3 h-3 text-purple-400" />
                Frame / Primitive
              </span>
              <strong className="font-mono text-slate-100 block mt-0.5">
                {health.lastRenderMs} ms · {health.expandedPrimitives.toLocaleString()}
              </strong>
            </div>
          </div>

          <label className="flex items-center justify-between px-2.5 py-2 bg-slate-800/40 border border-slate-800 rounded-lg text-xs text-slate-300 cursor-pointer">
            <span>Auto-Trim Anti-Saturazione</span>
            <input
              type="checkbox"
              checked={autoProtectEnabled}
              onChange={(e) => setAutoProtectEnabled(e.target.checked)}
              className="w-4 h-4 accent-cyan-400 rounded cursor-pointer"
            />
          </label>
        </div>

        {/* Sezione 3: Flush Cache & Reset Impostazioni */}
        <div className="pt-2.5 border-t border-slate-800 space-y-1.5">
          <span className="text-[11px] font-medium text-slate-400 block px-1">
            Manutenzione &amp; Ripristino
          </span>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => void handleFlush()}
              disabled={isFlushing}
              className="min-h-[40px] flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs font-medium text-cyan-200 bg-cyan-950/40 hover:bg-cyan-900/50 border border-cyan-800/60 rounded-lg transition whitespace-nowrap disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${isFlushing ? 'animate-spin' : ''}`} />
              <span>{isFlushing ? 'Pulizia...' : 'Flush Cache'}</span>
            </button>

            <button
              type="button"
              onClick={handleResetSettings}
              className="min-h-[40px] flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs font-medium text-amber-200 bg-amber-950/30 hover:bg-amber-900/40 border border-amber-800/60 rounded-lg transition whitespace-nowrap"
            >
              <RotateCcw className="w-3.5 h-3.5 shrink-0" />
              <span>Reset Impostazioni</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => void handleFullReset()}
            className={`w-full min-h-[40px] flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border transition whitespace-nowrap ${
              confirmFullReset
                ? 'bg-rose-600 hover:bg-rose-500 border-rose-500 text-white'
                : 'bg-slate-800/60 hover:bg-rose-950/40 border-slate-700 text-slate-300 hover:text-rose-200'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>
              {confirmFullReset
                ? 'Conferma Reset Completo'
                : 'Reset Completo Workspace'}
            </span>
          </button>
        </div>
      </div>
    );
  }
);

AppMenuSection.displayName = 'AppMenuSection';

export const AppMenuDropdown: React.FC<AppMenuActions> = (actions) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        e.target instanceof Node &&
        !containerRef.current.contains(e.target)
      ) {
        setIsOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    window.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('keydown', handleKey);
    };
  }, [isOpen]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label="Apri menù principale"
        className="min-h-[40px] flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-medium text-slate-100 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition whitespace-nowrap shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
      >
        <Menu className="w-4 h-4 text-cyan-400 shrink-0" />
        <span>Menù</span>
        <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-label="Menù principale e manutenzione"
          className="absolute right-0 top-full mt-2 w-[22.5rem] p-3.5 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl z-50 transition-opacity duration-150 motion-reduce:transition-none"
        >
          <AppMenuSection {...actions} onItemComplete={() => setIsOpen(false)} />
        </div>
      )}
    </div>
  );
};
