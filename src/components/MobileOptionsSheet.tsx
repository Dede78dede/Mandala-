/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Mobile Bottom Sheet composed via <MandalaControls variant="sheet"> and <AppMenuSection>.
 */

import React from 'react';
import { X } from 'lucide-react';
import { MandalaControls } from './MandalaControls.tsx';
import { AppMenuSection, type AppMenuActions } from './AppMenu.tsx';

interface MobileOptionsSheetProps extends AppMenuActions {
  isOpen: boolean;
  onClose: () => void;
}

export const MobileOptionsSheet: React.FC<MobileOptionsSheetProps> = ({
  isOpen,
  onClose,
  onOpenFractalModal,
  onOpenExport,
  onOpenAndroidHub,
  onOpenAndroidDownload,
  onPrefetchModal,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/70 backdrop-blur-sm lg:hidden"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-t-3xl bg-slate-900 border-t border-slate-800 p-5 pb-7 shadow-2xl text-slate-100 space-y-5 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Menù, opzioni di simmetria e manutenzione"
      >
        <div className="w-10 h-1.5 bg-slate-700 rounded-full mx-auto -mt-1 mb-2" />

        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">Menù e Controlli</h2>
          <button
            type="button"
            onClick={onClose}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-slate-800"
            aria-label="Chiudi pannello opzioni"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <MandalaControls variant="sheet" className="space-y-5">
          <MandalaControls.Strategy />
          <MandalaControls.StrategyParams />
          <MandalaControls.StrokeStyle />
          <MandalaControls.Palette />
          <MandalaControls.Environment />
        </MandalaControls>

        <div className="pt-3 border-t border-slate-800">
          <AppMenuSection
            compact
            onOpenFractalModal={onOpenFractalModal}
            onOpenExport={onOpenExport}
            onOpenAndroidHub={onOpenAndroidHub}
            onOpenAndroidDownload={onOpenAndroidDownload}
            onPrefetchModal={onPrefetchModal}
            onItemComplete={onClose}
          />
        </div>
      </div>
    </div>
  );
};
