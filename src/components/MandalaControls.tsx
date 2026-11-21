/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Compound Component Control Panel (MANDALA-PH2 Task 2.2.C & PH6 §11).
 * Parent shares layout variant via Context (no high-frequency state);
 * each sub-component subscribes only to its minimal Zustand slice.
 */

import React, { createContext, memo, useContext, useState } from 'react';
import {
  Undo2,
  Redo2,
  Paintbrush,
  CircleDot,
  Eraser,
  PenTool,
  Trash2,
  SlidersHorizontal,
  Eye,
  EyeOff,
  Volume2,
  VolumeX,
  Sparkles,
  AlertTriangle,
  Flower2,
} from 'lucide-react';
import { MANDALA_LIMITS, STAMP_LIMITS } from '../features/mandala/model/constants.ts';
import {
  KineticMode,
  LSystemPresetId,
  MirrorMode,
  SymmetryStrategyKind,
  ToolId,
  type SymmetryParams,
} from '../features/mandala/model/types.ts';
import {
  PALETTES,
  STROKE_STYLE_PRESETS,
  resolveStrokeStyleById,
  resolveStrokeStylePreset,
} from '../features/mandala/model/palettes.ts';
import { L_SYSTEM_PRESETS, resolveLSystemPreset } from '../features/mandala/lib/lsystem.ts';
import { STAMP_ARCHETYPE_LIST } from '../features/mandala/lib/proceduralStamps.ts';
import { formatFractalParamsAnnouncement } from '../features/mandala/lib/accessibility.ts';
import { useMandalaStore } from '../features/mandala/model/store.ts';

type ControlsVariant = 'topbar' | 'bottom' | 'sheet';

const MandalaControlsContext = createContext<{ variant: ControlsVariant }>({
  variant: 'topbar',
});

interface MandalaControlsRootProps {
  variant?: ControlsVariant;
  children: React.ReactNode;
  className?: string;
}

const MandalaControlsRoot: React.FC<MandalaControlsRootProps> = ({
  variant = 'topbar',
  children,
  className = '',
}) => {
  return (
    <MandalaControlsContext.Provider value={{ variant }}>
      <div className={className}>{children}</div>
    </MandalaControlsContext.Provider>
  );
};

interface StrategyOption {
  readonly id: string;
  readonly label: string;
  readonly isActive: (params: SymmetryParams) => boolean;
  readonly buildParams: (prev: SymmetryParams) => SymmetryParams;
}

const SYMMETRY_STRATEGY_OPTIONS: readonly StrategyOption[] = [
  {
    id: 'radial',
    label: 'Radiale',
    isActive: (p) => p.strategyId === SymmetryStrategyKind.Radial,
    buildParams: (prev) => ({ strategyId: SymmetryStrategyKind.Radial, order: prev.order }),
  },
  {
    id: 'reflect',
    label: 'Speculare',
    isActive: (p) =>
      p.strategyId === SymmetryStrategyKind.MirrorRadial && p.mirrorMode === MirrorMode.Reflect,
    buildParams: (prev) => ({
      strategyId: SymmetryStrategyKind.MirrorRadial,
      order: prev.order,
      mirrorMode: MirrorMode.Reflect,
    }),
  },
  {
    id: 'alternate',
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
    id: 'fractal',
    label: 'Frattale',
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

const SymmetryControl: React.FC = () => {
  const { variant } = useContext(MandalaControlsContext);
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

const StrategyControl: React.FC = () => {
  const { variant } = useContext(MandalaControlsContext);
  const symmetryParams = useMandalaStore((s) => s.symmetryParams);
  const setStrategy = useMandalaStore((s) => s.setStrategy);

  if (variant === 'sheet') {
    return (
      <div className="space-y-2">
        <span className="text-xs font-medium text-slate-400 block">Strategia di Simmetria</span>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" role="group" aria-label="Strategia di simmetria">
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
  const { variant } = useContext(MandalaControlsContext);
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
  const { variant } = useContext(MandalaControlsContext);
  const symmetryParams = useMandalaStore((s) => s.symmetryParams);
  const setStrategy = useMandalaStore((s) => s.setStrategy);
  const commitFractalGeneration = useMandalaStore((s) => s.commitFractalGeneration);
  const announceLiveMessage = useMandalaStore((s) => s.announceLiveMessage);
  const [popoverOpen, setPopoverOpen] = useState<boolean>(false);

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
            const p = resolveLSystemPreset(e.target.value as LSystemPresetId);
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
        onClick={() => {
          commitFractalGeneration(
            symmetryParams.preset,
            symmetryParams.generations,
            symmetryParams.angle,
            symmetryParams.stepLength
          );
          setPopoverOpen(false);
        }}
        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-purple-700 hover:bg-purple-600 text-white font-semibold rounded-lg transition"
      >
        <Sparkles className="w-3.5 h-3.5" />
        <span>Applica Frattale ({activePreset.name})</span>
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

/**
 * Compound sub-component rendering strategy-specific parameters via dictionary lookup
 * (zero conditional branching in the parent control panel: MANDALA-PH4 §2.1.C).
 */
const StrategyParamsControl: React.FC = () => {
  const strategyId = useMandalaStore((s) => s.symmetryParams.strategyId);
  const ActiveSlot = STRATEGY_PARAMS_RENDERERS[strategyId];
  return <ActiveSlot />;
};

const StrokeStyleControl: React.FC = () => {
  const { variant } = useContext(MandalaControlsContext);
  const activeDash = useMandalaStore((s) => s.activeDash);
  const setActiveDash = useMandalaStore((s) => s.setActiveDash);

  const currentPreset = resolveStrokeStylePreset(activeDash);

  if (variant === 'sheet') {
    return (
      <div className="space-y-2">
        <span className="text-xs font-medium text-slate-400 block">
          Stile Tratto (Indipendente dal Colore)
        </span>
        <div className="grid grid-cols-3 gap-2">
          {STROKE_STYLE_PRESETS.map((preset) => {
            const active = preset.id === currentPreset.id;
            return (
              <button
                key={preset.id}
                type="button"
                aria-pressed={active}
                onClick={() => setActiveDash(preset.dash)}
                className={`min-h-[44px] px-3 py-2 rounded-xl text-xs font-medium border transition ${
                  active
                    ? 'bg-cyan-500 text-slate-950 border-cyan-400 font-semibold'
                    : 'bg-slate-800 text-slate-300 border-slate-700'
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center">
      <label htmlFor="stroke-style-select" className="sr-only">
        Stile Tratto
      </label>
      <select
        id="stroke-style-select"
        value={currentPreset.id}
        onChange={(e) => {
          const preset = resolveStrokeStyleById(e.target.value);
          if (preset) setActiveDash(preset.dash);
        }}
        className="px-2 py-1 text-[11px] bg-slate-800 text-slate-200 border border-slate-700/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-cyan-400"
        aria-label="Stile del tratto indipendente dal colore"
      >
        {STROKE_STYLE_PRESETS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
    </div>
  );
};

const PaletteControl: React.FC = () => {
  const { variant } = useContext(MandalaControlsContext);
  const activePalette = useMandalaStore((s) => s.activePalette);
  const selectPalette = useMandalaStore((s) => s.selectPalette);
  const activeColor = useMandalaStore((s) => s.activeColor);
  const setActiveColor = useMandalaStore((s) => s.setActiveColor);
  const activeTool = useMandalaStore((s) => s.activeTool);
  const setActiveTool = useMandalaStore((s) => s.setActiveTool);

  if (variant === 'bottom') {
    const selectedIdx = Math.max(
      0,
      activePalette.colours.findIndex((c) => c === activeColor)
    );

    const handleSwatchKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, idx: number) => {
      const len = activePalette.colours.length;
      let nextIdx: number | null = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') nextIdx = (idx + 1) % len;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') nextIdx = (idx - 1 + len) % len;
      else if (e.key === 'Home') nextIdx = 0;
      else if (e.key === 'End') nextIdx = len - 1;

      if (nextIdx !== null) {
        e.preventDefault();
        const targetColor = activePalette.colours[nextIdx];
        setActiveColor(targetColor);
        if (activeTool === ToolId.Eraser) setActiveTool(ToolId.Brush);
        const parent = e.currentTarget.parentElement;
        const buttons = parent?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
        buttons?.[nextIdx]?.focus();
      }
    };

    return (
      <div
        role="radiogroup"
        aria-label={`Colori palette ${activePalette.name}`}
        className="flex items-center gap-[3px] sm:gap-2 min-w-0 flex-1 overflow-x-auto scrollbar-none py-0.5 px-0.5"
      >
        {activePalette.colours.map((c, idx) => {
          const isSelected = activeColor === c && activeTool !== ToolId.Eraser;
          const isFocusTarget = idx === selectedIdx;
          return (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={isSelected}
              tabIndex={isFocusTarget ? 0 : -1}
              onKeyDown={(e) => handleSwatchKeyDown(e, idx)}
              onClick={() => {
                setActiveColor(c);
                if (activeTool === ToolId.Eraser) setActiveTool(ToolId.Brush);
              }}
              className={`relative w-7 h-7 sm:w-9 sm:h-9 rounded-full transition-transform flex items-center justify-center shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-white ${
                isSelected
                  ? 'scale-105 ring-2 ring-cyan-400 ring-offset-1 sm:ring-offset-2 ring-offset-slate-900'
                  : 'hover:scale-105 opacity-90'
              }`}
              style={{ backgroundColor: c }}
              aria-label={`Colore ${c}`}
              title={c}
            >
              {isSelected && (
                <span
                  className="w-2 h-2 rounded-full"
                  style={{
                    backgroundColor: c === '#000000' || c === '#0F172A' ? '#ffffff' : '#000000',
                  }}
                />
              )}
            </button>
          );
        })}
      </div>
    );
  }

  if (variant === 'sheet') {
    return (
      <div className="space-y-2">
        <label htmlFor="mobile-palette-select" className="text-xs font-medium text-slate-400 block">
          Palette Cromatica
        </label>
        <select
          id="mobile-palette-select"
          value={activePalette.id}
          onChange={(e) => {
            const p = PALETTES.find((pal) => pal.id === e.target.value);
            if (p) selectPalette(p);
          }}
          className="w-full min-h-[44px] px-3 py-2 text-xs bg-slate-800 text-slate-100 border border-slate-700 rounded-xl"
        >
          {PALETTES.map((pal) => (
            <option key={pal.id} value={pal.id}>
              {pal.name} {pal.colourblindSafe ? '(Sicura CUD)' : ''}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div className="flex items-center">
      <label htmlFor="palette-select" className="sr-only">
        Seleziona Palette
      </label>
      <select
        id="palette-select"
        value={activePalette.id}
        onChange={(e) => {
          const p = PALETTES.find((pal) => pal.id === e.target.value);
          if (p) selectPalette(p);
        }}
        className="px-2 py-1 text-[11px] bg-slate-800 text-slate-200 border border-slate-700/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-cyan-400"
        aria-label="Palette cromatica"
      >
        {PALETTES.map((pal) => (
          <option key={pal.id} value={pal.id}>
            {pal.name.split(' (')[0]} {pal.colourblindSafe ? '✓' : ''}
          </option>
        ))}
      </select>
    </div>
  );
};

const ToolsControl: React.FC = () => {
  const activeTool = useMandalaStore((s) => s.activeTool);
  const setActiveTool = useMandalaStore((s) => s.setActiveTool);
  const pressureEnabled = useMandalaStore((s) => s.pressureEnabled);
  const setPressureEnabled = useMandalaStore((s) => s.setPressureEnabled);
  const strokeWidth = useMandalaStore((s) => s.strokeWidth);
  const setStrokeWidth = useMandalaStore((s) => s.setStrokeWidth);

  return (
    <>
      <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
        <button
          onClick={() => setActiveTool(ToolId.Brush)}
          className={`w-9 h-10 sm:w-11 sm:h-11 flex items-center justify-center rounded-xl transition ${
            activeTool === ToolId.Brush
              ? 'bg-cyan-500 text-slate-950 shadow-md font-semibold'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
          title="Pennello Mandala"
          aria-label="Strumento Pennello"
        >
          <Paintbrush className="w-4 h-4 sm:w-5 sm:h-5" />
        </button>

        <button
          onClick={() => setActiveTool(ToolId.Point)}
          className={`w-9 h-10 sm:w-11 sm:h-11 flex items-center justify-center rounded-xl transition ${
            activeTool === ToolId.Point
              ? 'bg-cyan-500 text-slate-950 shadow-md font-semibold'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
          title="Posiziona Punto Simmetrico"
          aria-label="Strumento Punto"
        >
          <CircleDot className="w-4 h-4 sm:w-5 sm:h-5" />
        </button>

        <button
          onClick={() => setActiveTool(ToolId.Stamp)}
          aria-pressed={activeTool === ToolId.Stamp}
          className={`w-9 h-10 sm:w-11 sm:h-11 flex items-center justify-center rounded-xl transition ${
            activeTool === ToolId.Stamp
              ? 'bg-cyan-500 text-slate-950 shadow-md font-semibold'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
          title="Timbro Botanico (clicca o trascina per ruotare e scalare)"
          aria-label="Strumento Timbro Botanico"
        >
          <Flower2 className="w-4 h-4 sm:w-5 sm:h-5" />
        </button>

        <button
          onClick={() => setActiveTool(ToolId.Eraser)}
          className={`w-9 h-10 sm:w-11 sm:h-11 flex items-center justify-center rounded-xl transition ${
            activeTool === ToolId.Eraser
              ? 'bg-rose-500 text-white shadow-md font-semibold'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
          title="Gomma Spicchio (cancella tratto simmetrico)"
          aria-label="Strumento Gomma"
        >
          <Eraser className="w-4 h-4 sm:w-5 sm:h-5" />
        </button>

        <button
          onClick={() => setPressureEnabled(!pressureEnabled)}
          className={`hidden sm:flex w-11 h-11 items-center justify-center rounded-xl transition ${
            pressureEnabled
              ? 'bg-slate-800 text-cyan-400 border border-cyan-500/40'
              : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'
          }`}
          title={pressureEnabled ? 'Pressione Stilo S-Pen Attiva' : 'Pressione Disattivata'}
          aria-label="Sensibilità alla pressione dello stilo"
        >
          <PenTool className="w-5 h-5" />
        </button>
      </div>

      {/* Stroke Width Slider */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 bg-slate-800/60 rounded-xl border border-slate-700/50 min-w-0 flex-1 max-w-[140px] sm:max-w-[230px]">
        <SlidersHorizontal className="hidden sm:block w-3.5 h-3.5 text-slate-400 shrink-0" />
        <input
          type="range"
          min={MANDALA_LIMITS.minStrokeWidth}
          max={MANDALA_LIMITS.maxStrokeWidth}
          step="0.5"
          value={strokeWidth}
          onChange={(e) => setStrokeWidth(parseFloat(e.target.value))}
          className="min-w-0 w-full flex-1 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer"
          aria-label="Spessore del tratto"
        />
        <span className="text-[11px] font-mono text-slate-300 whitespace-nowrap text-right tabular-nums shrink-0">
          {strokeWidth}px
        </span>
      </div>
    </>
  );
};

const HistoryControl: React.FC = () => {
  const undoStack = useMandalaStore((s) => s.undoStack);
  const redoStack = useMandalaStore((s) => s.redoStack);
  const undo = useMandalaStore((s) => s.undo);
  const redo = useMandalaStore((s) => s.redo);
  const clearCanvas = useMandalaStore((s) => s.clearCanvas);

  const canUndo = undoStack.length > 0;
  const canRedo = redoStack.length > 0;
  const undoLabel = canUndo ? `Annulla: ${undoStack[undoStack.length - 1].label}` : 'Annulla tratto';
  const redoLabel = canRedo ? `Ripristina: ${redoStack[redoStack.length - 1].label}` : 'Ripristina tratto';

  return (
    <div className="flex items-center gap-0.5 shrink-0">
      <button
        onClick={undo}
        disabled={!canUndo}
        className="w-9 h-10 sm:w-11 sm:h-11 flex items-center justify-center rounded-xl text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none transition"
        title={undoLabel}
        aria-label="Annulla ultimo tratto"
      >
        <Undo2 className="w-4 h-4 sm:w-5 sm:h-5" />
      </button>

      <button
        onClick={redo}
        disabled={!canRedo}
        className="w-9 h-10 sm:w-11 sm:h-11 flex items-center justify-center rounded-xl text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none transition"
        title={redoLabel}
        aria-label="Ripristina tratto annullato"
      >
        <Redo2 className="w-4 h-4 sm:w-5 sm:h-5" />
      </button>

      <button
        onClick={clearCanvas}
        className="w-9 h-10 sm:w-11 sm:h-11 flex items-center justify-center rounded-xl text-slate-400 hover:text-rose-400 hover:bg-rose-950/20 transition"
        title="Pulisci tela"
        aria-label="Pulisci l'intera tela"
      >
        <Trash2 className="w-4 h-4 sm:w-5 sm:h-5" />
      </button>
    </div>
  );
};

const EnvironmentTogglesControl: React.FC = () => {
  const { variant } = useContext(MandalaControlsContext);
  const showGuides = useMandalaStore((s) => s.showGuides);
  const setShowGuides = useMandalaStore((s) => s.setShowGuides);
  const soundEnabled = useMandalaStore((s) => s.soundEnabled);
  const setSoundEnabled = useMandalaStore((s) => s.setSoundEnabled);
  const pressureEnabled = useMandalaStore((s) => s.pressureEnabled);
  const setPressureEnabled = useMandalaStore((s) => s.setPressureEnabled);

  if (variant === 'sheet') {
    return (
      <div className="space-y-2.5 pt-1">
        <div className="grid grid-cols-2 gap-2.5">
          <button
            onClick={() => setShowGuides(!showGuides)}
            className={`min-h-[44px] flex items-center justify-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition ${
              showGuides
                ? 'bg-cyan-950/60 border-cyan-700 text-cyan-300'
                : 'bg-slate-800 border-slate-700 text-slate-400'
            }`}
          >
            {showGuides ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            <span>{showGuides ? 'Guide Visibili' : 'Guide Nascoste'}</span>
          </button>

          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className={`min-h-[44px] flex items-center justify-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition ${
              soundEnabled
                ? 'bg-cyan-950/60 border-cyan-700 text-cyan-300'
                : 'bg-slate-800 border-slate-700 text-slate-400'
            }`}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            <span>{soundEnabled ? 'Suono Attivo' : 'Suono Muto'}</span>
          </button>
        </div>
        <button
          onClick={() => setPressureEnabled(!pressureEnabled)}
          className={`w-full min-h-[44px] flex items-center justify-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition ${
            pressureEnabled
              ? 'bg-cyan-950/60 border-cyan-700 text-cyan-300'
              : 'bg-slate-800 border-slate-700 text-slate-400'
          }`}
        >
          <PenTool className="w-4 h-4" />
          <span>{pressureEnabled ? 'Pressione Stilo S-Pen Attiva' : 'Pressione Stilo Disattivata'}</span>
        </button>
      </div>
    );
  }

  return (
    <>
      <button
        onClick={() => setShowGuides(!showGuides)}
        className={`p-2 rounded-lg border transition ${
          showGuides
            ? 'bg-cyan-950/60 border-cyan-800/80 text-cyan-400'
            : 'bg-slate-800/60 border-slate-700/60 text-slate-400 hover:text-white'
        }`}
        title={showGuides ? 'Nascondi guide' : 'Mostra guide'}
        aria-label={showGuides ? 'Nascondi guide visive' : 'Mostra guide visive'}
      >
        {showGuides ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
      </button>

      <button
        onClick={() => setSoundEnabled(!soundEnabled)}
        className={`p-2 rounded-lg border transition ${
          soundEnabled
            ? 'bg-cyan-950/60 border-cyan-800/80 text-cyan-400'
            : 'bg-slate-800/60 border-slate-700/60 text-slate-400 hover:text-white'
        }`}
        title={soundEnabled ? 'Suono attivo' : 'Muto'}
        aria-label={soundEnabled ? 'Disattiva feedback sonoro' : 'Attiva feedback sonoro'}
      >
        {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
      </button>
    </>
  );
};

const StampTrayControl: React.FC = () => {
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

export const MandalaControls = Object.assign(MandalaControlsRoot, {
  Symmetry: memo(SymmetryControl),
  Strategy: memo(StrategyControl),
  StrategyParams: memo(StrategyParamsControl),
  StrokeStyle: memo(StrokeStyleControl),
  Palette: memo(PaletteControl),
  Tools: memo(ToolsControl),
  StampTray: memo(StampTrayControl),
  History: memo(HistoryControl),
  Environment: memo(EnvironmentTogglesControl),
});
