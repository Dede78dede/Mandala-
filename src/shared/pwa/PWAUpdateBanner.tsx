/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Accessible Service Worker "Update available — reload" Banner (MANDALA-PH4 Task 4.2.D).
 */

import React from 'react';
import { RefreshCw, X } from 'lucide-react';
import { useServiceWorkerUpdate } from './useServiceWorkerUpdate.ts';

export const PWAUpdateBanner: React.FC = () => {
  const { needRefresh, applyUpdate, dismissUpdate } = useServiceWorkerUpdate();

  if (!needRefresh) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-24 right-4 z-50 flex items-center gap-3 px-4 py-2.5 rounded-xl bg-slate-900 border border-cyan-500/60 shadow-2xl text-xs text-slate-100"
    >
      <span>Aggiornamento disponibile — ricarica per la nuova build</span>
      <button
        type="button"
        onClick={() => void applyUpdate()}
        className="inline-flex items-center gap-1 px-2.5 py-1 bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-semibold rounded-lg transition"
      >
        <RefreshCw className="w-3.5 h-3.5" />
        <span>Ricarica</span>
      </button>
      <button
        type="button"
        onClick={dismissUpdate}
        className="p-1 text-slate-400 hover:text-white rounded"
        aria-label="Rimanda aggiornamento"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
