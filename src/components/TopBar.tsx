/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Top Bar adhering to clean structure, zero-pill brand discipline,
 * Compound MandalaControls, Accessible AppMenuDropdown, quick Flush Cache & Reset buttons,
 * PWA install integration, and lazy-modal hover prefetching.
 */

import React, { memo, useEffect, useState } from 'react';
import {
  Download,
  SlidersHorizontal,
  RefreshCw,
  RotateCcw,
} from 'lucide-react';
import { ModalPrefetchKey } from '../features/mandala/model/types.ts';
import { useMandalaStore } from '../features/mandala/model/store.ts';
import { MandalaControls } from './MandalaControls.tsx';
import { AppMenuDropdown } from './AppMenu.tsx';
import { PWAInstallButton } from '../shared/pwa/PWAInstallButton.tsx';

interface TopBarProps {
  onOpenExport: () => void;
  onOpenAndroidHub: () => void;
  onOpenAndroidDownload?: () => void;
  onOpenFractalModal: () => void;
  onOpenMobileOptions: () => void;
  onPrefetchModal?: (modal: ModalPrefetchKey) => void;
}

export const TopBar: React.FC<TopBarProps> = memo(
  ({
    onOpenExport,
    onOpenAndroidHub,
    onOpenAndroidDownload,
    onOpenFractalModal,
    onOpenMobileOptions,
    onPrefetchModal,
  }) => {
    const flushCaches = useMandalaStore((s) => s.flushCaches);
    const resetSettings = useMandalaStore((s) => s.resetSettings);
    const [isDesktop, setIsDesktop] = useState<boolean>(() => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
      try {
        return window.matchMedia('(min-width: 1024px)').matches;
      } catch {
        return true;
      }
    });

    useEffect(() => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
      try {
        const mq = window.matchMedia('(min-width: 1024px)');
        const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
        setIsDesktop(mq.matches);
        mq.addEventListener('change', onChange);
        return () => mq.removeEventListener('change', onChange);
      } catch {
        return undefined;
      }
    }, []);

    return (
      <header className="w-full max-w-full flex items-center justify-between gap-2 2xl:gap-4 px-3 md:px-4 py-2 bg-slate-900 border-b border-slate-800 text-slate-100 z-40 shrink-0">
        {/* Zone 1: Clean Single-Line Brand Wordmark */}
        <div className="flex items-center shrink-0">
          <a
            href="/"
            className="text-sm sm:text-base md:text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            Mandala Studio
          </a>
        </div>

        {/* Zone 2: Compound Desktop Controls (Mounted only on lg+ viewports) */}
        {isDesktop && (
          <MandalaControls
            variant="topbar"
            className="hidden lg:flex items-center gap-1.5 xl:gap-2 text-xs shrink-0"
          >
            <MandalaControls.Symmetry />
            <MandalaControls.Strategy />
            <MandalaControls.StrategyParams />
            <MandalaControls.StrokeStyle />
            <MandalaControls.Palette />
            <MandalaControls.Environment />
          </MandalaControls>
        )}

        {/* Zone 3: Quick Maintenance, Menu, Mobile Options & Primary Export CTA */}
        <div className="flex items-center gap-1.5 md:gap-2 shrink-0">
          <button
            type="button"
            onMouseEnter={() => onPrefetchModal?.(ModalPrefetchKey.Mobile)}
            onFocus={() => onPrefetchModal?.(ModalPrefetchKey.Mobile)}
            onClick={onOpenMobileOptions}
            className="lg:hidden min-w-[40px] min-h-[40px] flex items-center justify-center px-2 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition shrink-0"
            title="Opzioni Simmetria, Stile e Manutenzione"
            aria-label="Opzioni Simmetria e Stile"
          >
            <SlidersHorizontal className="w-4 h-4" />
          </button>

          <PWAInstallButton />

          <button
            type="button"
            onClick={() => void flushCaches()}
            className="hidden sm:flex min-w-[40px] min-h-[40px] items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-200 bg-slate-800/80 hover:bg-slate-700 border border-slate-700 rounded-lg transition whitespace-nowrap shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            title="Flush Cache (L0–L3, Memoizer e Service Worker)"
            aria-label="Flush Cache"
          >
            <RefreshCw className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span className="hidden 2xl:inline">Flush Cache</span>
          </button>

          <button
            type="button"
            onClick={resetSettings}
            className="hidden sm:flex min-w-[40px] min-h-[40px] items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-200 bg-slate-800/80 hover:bg-slate-700 border border-slate-700 rounded-lg transition whitespace-nowrap shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
            title="Reset Impostazioni ai valori predefiniti"
            aria-label="Reset Impostazioni"
          >
            <RotateCcw className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="hidden 2xl:inline">Reset</span>
          </button>

          <AppMenuDropdown
            onOpenFractalModal={onOpenFractalModal}
            onOpenExport={onOpenExport}
            onOpenAndroidHub={onOpenAndroidHub}
            onOpenAndroidDownload={onOpenAndroidDownload}
            onPrefetchModal={onPrefetchModal}
          />

          <button
            type="button"
            onMouseEnter={() => onPrefetchModal?.(ModalPrefetchKey.Export)}
            onFocus={() => onPrefetchModal?.(ModalPrefetchKey.Export)}
            onClick={onOpenExport}
            className="min-h-[40px] flex items-center gap-1.5 px-3 sm:px-3.5 py-1.5 text-xs font-semibold text-slate-950 bg-cyan-400 hover:bg-cyan-300 rounded-lg transition shadow-sm whitespace-nowrap shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            aria-label="Esporta"
          >
            <Download className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline">Esporta</span>
          </button>
        </div>
      </header>
    );
  }
);

TopBar.displayName = 'TopBar';
