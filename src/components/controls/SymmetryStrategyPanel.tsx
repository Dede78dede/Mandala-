/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Symmetry Order, Strategy Selector (OCP Registry), and Strategy-Specific Params Panel.
 */

import React, { useState } from 'react';
import { AlertTriangle, Sparkles } from 'lucide-react';
import { MANDALA_LIMITS } from '../../features/mandala/model/constants.ts';
import {
  LSystemPresetId,
  MirrorMode,
  SymmetryStrategyKind,
  type SymmetryParams,
} from '../../features/mandala/model/types.ts';
import { STRATEGY_REGISTRY } from '../../features/mandala/strategies/symmetry.ts';
import { L_SYSTEM_PRESETS, resolveLSystemPreset } from '../../features/mandala/lib/lsystem.ts';
import { formatFractalParamsAnnouncement } from '../../features/mandala/lib/accessibility.ts';
import { useMandalaStore } from '../../features/mandala/model/store.ts';
import { useControlsVariant } from './controlsContext.ts';

interface StrategyOption {
  readonly id: string;
  readonly label: string;
  readonly isActive: (params: SymmetryParams) => boolean;
  readonly buildParams: (prev: SymmetryParams) => SymmetryParams;
}

const SYMMETRY_STRATEGY_OPTIONS: readonly StrategyOption[] = [
  {
    id: SymmetryStrategyKind.Radial,
    label: STRATEGY_REGISTRY[SymmetryStrategyKind.Radial].displayLabel,
    isActive: (p) => p.strategyId === SymmetryStrategyKind.Radial,
    buildParams: (prev) => ({ strategyId: SymmetryStrategyKind.Radial, order: prev.order }),
  },
  {
    id: `${SymmetryStrategyKind.MirrorRadial}-reflect`,
    label: STRATEGY_REGISTRY[SymmetryStrategyKind.MirrorRadial].displayLabel,
    isActive: (p) =>
      p.strategyId === SymmetryStrategyKind.MirrorRadial && p.mirrorMode === MirrorMode.Reflect,
    buildParams: (prev) => ({
      strategyId: SymmetryStrategyKind.MirrorRadial,
      order: prev.order,
      mirrorMode: MirrorMode.Reflect,
    }),
  },
  {
    id: `${SymmetryStrategyKind.MirrorRadial}-alternate`,
    label: 'Alternata',
    isActive: (p) =>
      p.strategyId === SymmetryStrategyKind.MirrorRadial && p.mirrorMode === MirrorMode.Alternate,
    buildParams: (prev) => ({
      strategyId: SymmetryStrategyKind.MirrorRadial,
      order: prev.order,
      mirrorMode: MirrorMode.Alternate,
    }),
  },
  {
    id: SymmetryStrategyKind.Fractal,
    label: STRATEGY_REGISTRY[SymmetryStrategyKind.Fractal].displayLabel,
    isActive: (p) => p.strategyId === SymmetryStrategyKind.Fractal,
    buildParams: (prev) => {
      if (prev.strategyId === SymmetryStrategyKind.Fractal) return prev;
      const preset = resolveLSystemPreset(LSystemPresetId.SacredFlower);
      return {
        strategyId: SymmetryStrategyKind.Fractal,
        preset: preset.id,
        order: prev.order,
        generations: preset.defaultGenerations,
        angle: preset.defaultAngle,
        stepLength: preset.defaultStep,
      };
    },
  },
];

export const SymmetryControl: React.FC = () => {
  const variant = useControlsVariant();
  const order = useMandalaStore((s) => s.symmetryParams.order);
  const setSymmetryOrder = useMandalaStore((s) => s.setSymmetryOrder);

  if (variant === 'bottom') {
    return (
      <div className="flex lg:hidden items-center gap-1 px-1.5 py-0.5 bg-slate-800/90 rounded-lg text-xs shrink-0 border border-slate-700/60">
        <span className="text-slate-400 font-medium text-[11px]">N:</span>
        <button
          onClick={() => setSymmetryOrder(Math.max(MANDALA_LIMITS.minOrder, order - 1))}
          className="w-6 h-7 flex items-center justify-center bg-slate-700 hover:bg-slate-600 rounded text-white font-bold"
          aria-label="Diminuisci simmetria"
        >
          -
        </button>
        <span className="w-5 text-center font-mono text-cyan-400 font-bold tabular-nums">
          {order}
        </span>
        <button
          onClick={() => setSymmetryOrder(Math.min(MANDALA_LIMITS.maxOrder, order + 1))}
          className="w-6 h-7 flex items-center justify-center bg-slate-700 hover:bg-slate-600 rounded text-white font-bold"
          aria-label="Aumenta simmetria"
        >
          +
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-800/80 rounded-lg border border-slate-700/60">
      <label
        htmlFor="symmetry-slider"
        className="text-slate-400 font-medium whitespace-nowrap text-[11px]"
      >
        N:
      </label>
      <span className="font-mono text-cyan-400 font-bold w-5 text-center tabular-nums text-xs">
        {order}
      </span>
      <input
        id="symmetry-slider"
        type="range"
        min={MANDALA_LIMITS.minOrder}
        max={MANDALA_LIMITS.maxOrder}
        step="1"
        value={order}
        onChange={(e) => setSymmetryOrder(parseInt(e.target.value, 10))}
        className="w-16 xl:w-20 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer"
        aria-label="Ordine di simmetria radiale"
      />
    </div>
  );
};

export const StrategyControl: React.FC = () => {
  const variant = useControlsVariant();
  const symmetryParams = useMandalaStore((s) => s.symmetryParams);
  const setStrategy = useMandalaStore((s) => s.setStrategy);

  if (variant === 'sheet') {
    return (
      <div className="space-y-2">
        <span className="text-xs font-medium text-slate-400 block">Strategia di Simmetria</span>
        <div
          className="grid grid-cols-2 sm:grid-cols-4 gap-2"
          role="group"
          aria-label="Strategia di simmetria"
        >
          {SYMMETRY_STRATEGY_OPTIONS.map((opt) => {
            const active = opt.isActive(symmetryParams);
            return (
              <button
                key={opt.id}
                type="button"
                aria-pressed={active}
                onClick={() => setStrategy(opt.buildParams(symmetryParams))}
                className={`min-h-[44px] px-3 py-2 rounded-xl text-xs font-medium border transition ${
                  active
                    ? 'bg-cyan-500 text-slate-950 border-cyan-400 font-semibold'
                    : 'bg-slate-800 text-slate-300 border-slate-700'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex items-center p-0.5 bg-slate-800 rounded-lg border border-slate-700/60"
      role="group"
      aria-label="Selettore strategia di simmetria"
    >
      {SYMMETRY_STRATEGY_OPTIONS.map((opt) => {
        const active = opt.isActive(symmetryParams);
        return (
          <button
            key={opt.id}
            type="button"
            aria-pressed={active}
            onClick={() => setStrategy(opt.buildParams(symmetryParams))}
            className={`px-2 py-1 text-[11px] font-medium rounded transition whitespace-nowrap ${
              active
                ? 'bg-cyan-500 text-slate-950 shadow-sm font-semibold'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
};

const PRESET_ENTRIES = Object.values(L_SYSTEM_PRESETS);

const RadialParamsSlot: React.FC = () => null;

const MirrorRadialParamsSlot: React.FC = () => {
  const variant = useControlsVariant();
  const symmetryParams = useMandalaStore((s) => s.symmetryParams);
  const setStrategy = useMandalaStore((s) => s.setStrategy);

  if (variant !== 'sheet' || symmetryParams.strategyId !== SymmetryStrategyKind.MirrorRadial) {
    return null;
  }

  return (
    <div className="p-3 bg-slate-800/50 border border-slate-700/70 rounded-xl space-y-2">
      <span className="text-[11px] font-medium text-slate-400 block">
        Modalità Riflessione Asse
      </span>
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Modalità riflessione speculare">
        {[
          { mode: MirrorMode.Reflect, label: 'Bilaterale (Reflect)' },
          { mode: MirrorMode.Alternate, label: 'Alternata (Intreccio)' },
        ].map((item) => {
          const active = symmetryParams.mirrorMode === item.mode;
          return (
            <button
              key={item.mode}
              type="button"
              aria-pressed={active}
              onClick={() =>
                setStrategy({
                  strategyId: SymmetryStrategyKind.MirrorRadial,
                  order: symmetryParams.order,
                  mirrorMode: item.mode,
                })
              }
              className={`min-h-[40px] px-2.5 py-1.5 rounded-lg text-xs border transition ${
                active
                  ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200 font-semibold'
                  : 'bg-slate-900 border-slate-700 text-slate-400'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};

const FractalParamsSlot: React.FC = () => {
  const variant = useControlsVariant();
  const symmetryParams = useMandalaStore((s) => s.symmetryParams);
  const setStrategy = useMandalaStore((s) => s.setStrategy);
  const commitFractalGenerationSmart = useMandalaStore((s) => s.commitFractalGenerationSmart);
  const announceLiveMessage = useMandalaStore((s) => s.announceLiveMessage);
  const [popoverOpen, setPopoverOpen] = useState<boolean>(false);
  const [isApplying, setIsApplying] = useState<boolean>(false);

  if (symmetryParams.strategyId !== SymmetryStrategyKind.Fractal) {
    return null;
  }

  const activePreset = resolveLSystemPreset(symmetryParams.preset);
  const hasPerfWarning =
    symmetryParams.generations >= MANDALA_LIMITS.fractalPerfWarningGenerations;

  const updateFractal = (
    patch: Partial<Extract<SymmetryParams, { strategyId: SymmetryStrategyKind.Fractal }>>
  ) => {
    const next = { ...symmetryParams, ...patch };
    setStrategy(next);
    const resolved = resolveLSystemPreset(next.preset);
    announceLiveMessage(
      formatFractalParamsAnnouncement(resolved.name, next.generations, next.angle, next.stepLength)
    );
  };

  const paramsForm = (
    <div className="space-y-3 text-xs">
      <div>
        <label htmlFor={`fractal-preset-${variant}`} className="block text-slate-400 mb-1">
          Preset L-System
        </label>
        <select
          id={`fractal-preset-${variant}`}
          value={symmetryParams.preset}
          onChange={(e) => {
            const p = resolveLSystemPreset(e.target.value);
            updateFractal({
              preset: p.id,
              generations: p.defaultGenerations,
              angle: p.defaultAngle,
              stepLength: p.defaultStep,
            });
          }}
          className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-slate-100"
        >
          {PRESET_ENTRIES.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <div className="flex justify-between mb-1">
          <label htmlFor={`fractal-gen-${variant}`} className="text-slate-300">
            Generazioni L-System (1–{MANDALA_LIMITS.lSystemCapGenerations})
          </label>
          <span className="font-mono text-purple-300 font-bold tabular-nums">
            {symmetryParams.generations}
          </span>
        </div>
        <input
          id={`fractal-gen-${variant}`}
          type="range"
          min="1"
          max={MANDALA_LIMITS.lSystemCapGenerations}
          step="1"
          value={symmetryParams.generations}
          onChange={(e) => updateFractal({ generations: parseInt(e.target.value, 10) })}
          className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer"
        />
        {hasPerfWarning && (
          <p className="mt-1 flex items-center gap-1 text-[11px] text-amber-300">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>Attenzione: ≥ 5 generazioni possono superare il budget frame su CPU mobile.</span>
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor={`fractal-angle-${variant}`} className="flex justify-between text-slate-300 mb-1">
            <span>Angolo</span>
            <span className="font-mono text-purple-300">{symmetryParams.angle}°</span>
          </label>
          <input
            id={`fractal-angle-${variant}`}
            type="range"
            min="15"
            max="120"
            step="1"
            value={symmetryParams.angle}
            onChange={(e) => updateFractal({ angle: parseInt(e.target.value, 10) })}
            className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer"
          />
        </div>
        <div>
          <label htmlFor={`fractal-step-${variant}`} className="flex justify-between text-slate-300 mb-1">
            <span>Passo</span>
            <span className="font-mono text-purple-300">{symmetryParams.stepLength}px</span>
          </label>
          <input
            id={`fractal-step-${variant}`}
            type="range"
            min="5"
            max="40"
            step="1"
            value={symmetryParams.stepLength}
            onChange={(e) => updateFractal({ stepLength: parseInt(e.target.value, 10) })}
            className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer"
          />
        </div>
      </div>

      <button
        type="button"
        disabled={isApplying}
        onClick={() => {
          if (isApplying) return;
          setIsApplying(true);
          void commitFractalGenerationSmart(
            symmetryParams.preset,
            symmetryParams.generations,
            symmetryParams.angle,
            symmetryParams.stepLength
          ).finally(() => {
            setIsApplying(false);
            setPopoverOpen(false);
          });
        }}
        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-purple-700 hover:bg-purple-600 disabled:opacity-60 text-white font-semibold rounded-lg transition"
      >
        <Sparkles className="w-3.5 h-3.5" />
        <span>{isApplying ? 'Calcolo Frattale...' : `Applica Frattale (${activePreset.name})`}</span>
      </button>
    </div>
  );

  if (variant === 'sheet') {
    return (
      <div className="p-3.5 bg-purple-950/20 border border-purple-700/50 rounded-xl space-y-2">
        <span className="text-xs font-semibold text-purple-300 block">
          Parametri Strategia Frattale
        </span>
        {paramsForm}
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setPopoverOpen((prev) => !prev)}
        aria-expanded={popoverOpen}
        aria-label="Parametri strategia frattale"
        className="px-2 py-1 text-[11px] font-medium bg-purple-950/60 hover:bg-purple-900/70 text-purple-200 border border-purple-700/70 rounded-lg transition whitespace-nowrap flex items-center gap-1"
      >
        <span>{activePreset.name.split(' ')[0]} · G{symmetryParams.generations}</span>
        {hasPerfWarning && <AlertTriangle className="w-3 h-3 text-amber-400" />}
      </button>
      {popoverOpen && (
        <div
          role="dialog"
          aria-label="Parametri L-System Frattale"
          className="absolute left-0 top-full mt-2 w-72 p-4 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-50"
        >
          {paramsForm}
        </div>
      )}
    </div>
  );
};

const STRATEGY_PARAMS_RENDERERS: Readonly<Record<SymmetryStrategyKind, React.FC>> = {
  [SymmetryStrategyKind.Radial]: RadialParamsSlot,
  [SymmetryStrategyKind.MirrorRadial]: MirrorRadialParamsSlot,
  [SymmetryStrategyKind.Fractal]: FractalParamsSlot,
};

export const StrategyParamsControl: React.FC = () => {
  const strategyId = useMandalaStore((s) => s.symmetryParams.strategyId);
  const ActiveSlot = STRATEGY_PARAMS_RENDERERS[strategyId];
  return <ActiveSlot />;
};
