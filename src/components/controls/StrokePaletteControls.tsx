/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Stroke Style, Colorblind-Safe Palette, Drawing Tools, History & Environment Controls.
 */

import React from 'react';
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
  Flower2,
} from 'lucide-react';
import { MANDALA_LIMITS } from '../../features/mandala/model/constants.ts';
import { ToolId } from '../../features/mandala/model/types.ts';
import {
  PALETTES,
  STROKE_STYLE_PRESETS,
  getContrastIndicatorColor,
  resolveStrokeStyleById,
  resolveStrokeStylePreset,
} from '../../features/mandala/model/palettes.ts';
import { useMandalaStore } from '../../features/mandala/model/store.ts';
import { useControlsVariant } from './controlsContext.ts';

export const StrokeStyleControl: React.FC = () => {
  const variant = useControlsVariant();
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

export const PaletteControl: React.FC = () => {
  const variant = useControlsVariant();
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
        if (!targetColor) return;
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
                    backgroundColor: getContrastIndicatorColor(c),
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

export const ToolsControl: React.FC = () => {
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

export const HistoryControl: React.FC = () => {
  const undoStack = useMandalaStore((s) => s.undoStack);
  const redoStack = useMandalaStore((s) => s.redoStack);
  const undo = useMandalaStore((s) => s.undo);
  const redo = useMandalaStore((s) => s.redo);
  const clearCanvas = useMandalaStore((s) => s.clearCanvas);

  const lastUndo = undoStack[undoStack.length - 1];
  const lastRedo = redoStack[redoStack.length - 1];
  const canUndo = Boolean(lastUndo);
  const canRedo = Boolean(lastRedo);
  const undoLabel = lastUndo ? `Annulla: ${lastUndo.label}` : 'Annulla tratto';
  const redoLabel = lastRedo ? `Ripristina: ${lastRedo.label}` : 'Ripristina tratto';

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

export const EnvironmentTogglesControl: React.FC = () => {
  const variant = useControlsVariant();
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
