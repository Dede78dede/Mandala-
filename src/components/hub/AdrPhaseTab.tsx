/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ADR Phase Registry Tab for Engineering Hub.
 */

import React from 'react';
import { AdrStatus } from '../../features/mandala/model/types.ts';
import { PHASE1_ADRS } from '../../features/mandala/model/adrRegistry.ts';

interface AdrPhaseTabProps {
  readonly ratifiedCount: number;
}

export const AdrPhaseTab: React.FC<AdrPhaseTabProps> = ({ ratifiedCount }) => (
  <div className="space-y-6">
    <div className="p-4 bg-emerald-950/20 border border-emerald-800/40 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div>
        <h3 className="text-sm font-semibold text-white">
          Fase 4 Consolidata — Composizione Strategie, A11y WCAG 2.1 AA &amp; PWA Controlled Update
        </h3>
        <p className="text-xs text-slate-400 mt-1">
          3 strategie attive (Radiale, Speculare, Frattale L-System), routing data-driven senza branch, mirror parametrico throttled a 500ms, live region a 300ms e Service Worker a 3 classi con{' '}
          <code className="text-emerald-300">registerType: prompt</code>.
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
);
