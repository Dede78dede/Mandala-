/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Download } from 'lucide-react';
import { usePWAInstall } from './usePWAInstall.ts';
import { useOnlineStatus } from './useOnlineStatus.ts';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        onClick={install}
        className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-medium text-cyan-200 bg-cyan-950/60 hover:bg-cyan-900/70 border border-cyan-700/60 rounded-lg transition whitespace-nowrap shrink-0"
        title="Installa come App su Android o Desktop"
        aria-label="Installa App"
      >
        <Download className="w-3.5 h-3.5 text-cyan-400" />
        <span className="hidden md:inline">Installa App</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          onClick={() => setShowIOSGuide(true)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-cyan-200 bg-cyan-950/60 hover:bg-cyan-900/70 border border-cyan-700/60 rounded-lg transition whitespace-nowrap shrink-0"
          aria-label="Installa su iOS"
        >
          <Download className="w-3.5 h-3.5 text-cyan-400" />
          <span className="hidden sm:inline">Installa</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
            <div className="w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl text-slate-100">
              <h3 className="text-base font-semibold text-white">Installa su iPhone / iPad</h3>
              <p className="mt-2 text-xs text-slate-300 leading-relaxed">
                1. Tocca il pulsante <strong>Condividi</strong> nella barra di Safari.
                <br />
                2. Scorri verso il basso e tocca <strong>Aggiungi alla schermata Home</strong>.
              </p>
              <button
                onClick={() => setShowIOSGuide(false)}
                className="mt-4 w-full rounded-xl bg-slate-800 hover:bg-slate-700 py-2.5 text-xs font-semibold text-white transition"
              >
                Chiudi
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div
      role="status"
      className="fixed top-14 left-1/2 -translate-x-1/2 z-40 px-3 py-1.5 rounded-lg bg-amber-950/90 border border-amber-700/80 text-xs font-medium text-amber-200 shadow-lg backdrop-blur-md"
    >
      Modalità Offline attiva — Engine e documenti salvati in locale
    </div>
  );
};
