/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Botanical Stamp Archetype Tray & Scale Control.
 */

import React from 'react';
import { STAMP_LIMITS } from '../../features/mandala/model/constants.ts';
import { KineticMode, ToolId } from '../../features/mandala/model/types.ts';
import { STAMP_ARCHETYPE_LIST } from '../../features/mandala/lib/proceduralStamps.ts';
import { useMandalaStore } from '../../features/mandala/model/store.ts';

export const StampTrayControl: React.FC = () => {
  const activeTool = useMandalaStore((s) => s.activeTool);
  const kineticMode = useMandalaStore((s) => s.kineticMode);
  const lensEnabled = useMandalaStore((s) => s.lens.enabled);
  const activeStampArchetype = useMandalaStore((s) => s.activeStampArchetype);
  const stampScale = useMandalaStore((s) => s.stampScale);
  const setActiveStampArchetype = useMandalaStore((s) => s.setActiveStampArchetype);
  const setStampScale = useMandalaStore((s) => s.setStampScale);

  if (activeTool !== ToolId.Stamp || kineticMode !== KineticMode.Off || lensEnabled) {
    return null;
  }

  return (
    <div
      data-testid="stamp-archetype-tray"
      className="flex flex-wrap items-center justify-between gap-2 pb-1.5 border-b border-slate-800/80 text-xs"
    >
      <div
        className="flex items-center gap-1 p-0.5 bg-slate-950 border border-slate-800 rounded-xl"
        role="group"
        aria-label="Archetipo Timbro Botanico"
      >
        {STAMP_ARCHETYPE_LIST.map((arch) => {
          const active = activeStampArchetype === arch.id;
          return (
            <button
              key={arch.id}
              type="button"
              aria-pressed={active}
              onClick={() => setActiveStampArchetype(arch.id)}
              title={arch.description}
              className={`min-h-[34px] px-2.5 py-1 rounded-lg text-[11px] font-medium transition whitespace-nowrap ${
                active
                  ? 'bg-cyan-500 text-slate-950 font-semibold'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800'
              }`}
            >
              {arch.label}
            </button>
          );
        })}
      </div>

      <label className="flex items-center gap-2 px-2 py-1 bg-slate-800/60 border border-slate-700/50 rounded-xl">
        <span className="text-[11px] text-slate-400 whitespace-nowrap">Scala Timbro</span>
        <input
          type="range"
          min={STAMP_LIMITS.minScale}
          max={STAMP_LIMITS.maxScale}
          step={0.1}
          value={stampScale}
          onChange={(e) => setStampScale(Number(e.target.value))}
          className="w-20 sm:w-24 h-1.5 accent-cyan-400 cursor-pointer"
          aria-label="Scala dimensione timbro botanico"
        />
        <span className="font-mono text-[11px] text-cyan-300 tabular-nums w-8 text-right">
          {stampScale.toFixed(1)}×
        </span>
      </label>
    </div>
  );
};
