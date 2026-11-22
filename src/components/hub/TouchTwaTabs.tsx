/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Touch/S-Pen Pipeline & PWA/TWA Play Store Documentation Tabs.
 */

import React from 'react';
import { MANDALA_LIMITS } from '../../features/mandala/model/constants.ts';

export const TouchPipelineTab: React.FC = () => (
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
          Integrazione ratificata con{' '}
          <code className="text-cyan-300">androidx.input:input-motionprediction:1.0.0</code> stabile (aggiornata da beta05) e rimappatura pressione non lineare.
        </p>
      </div>
      <div className="p-4 bg-slate-800/40 border border-slate-700/60 rounded-xl">
        <h4 className="text-sm font-semibold text-cyan-400 mb-1">
          3. Palm Rejection Nativo &amp; StateFlow Lifecycle-Aware
        </h4>
        <p className="text-xs text-slate-300 leading-relaxed">
          Consumo stato tramite{' '}
          <code className="text-cyan-300">collectAsStateWithLifecycle()</code> e{' '}
          <code className="text-cyan-300">MandalaViewModel</code> con stack comandi a{' '}
          {MANDALA_LIMITS.maxHistoryCommands} voci.
        </p>
      </div>
    </div>
  </div>
);

export const TwaStoreTab: React.FC = () => (
  <div className="space-y-5">
    <h3 className="text-base font-semibold text-white">
      PWA Offline-First (3 Classi), Update Controllato &amp; TWA Play Store
    </h3>
    <p className="text-xs text-slate-300 leading-relaxed">
      Service Worker Workbox configurato con{' '}
      <code className="text-cyan-300">registerType: &apos;prompt&apos;</code> (nessun{' '}
      <code className="text-cyan-300">skipWaiting()</code> silenzioso): caching a 3 classi (
      <strong>Cache-First</strong> per binari <code className="text-cyan-300">*.wasm</code>,{' '}
      <strong>Network-First</strong> 3s per HTML/manifest, <strong>Stale-While-Revalidate</strong>{' '}
      per font/assets) e banner utente con guardia anti doppio reload. Assenza deliberata di header COOP/COEP (ADR <code className="text-cyan-300">PH4-THREADING</code>).
    </p>
    <pre className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-cyan-300 overflow-x-auto">
      npx @bubblewrap/cli init --manifest=https://your-domain/manifest.webmanifest{'\n'}
      npx @bubblewrap/cli build
    </pre>
  </div>
);
