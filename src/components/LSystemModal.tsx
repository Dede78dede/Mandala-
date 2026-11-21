/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * L-System Sacred Geometry Modal composed via <ModalShell>.
 */

import React, { useState } from 'react';
import { Sparkles, Check, Compass } from 'lucide-react';
import { MANDALA_LIMITS, POLAR_LIMITS } from '../features/mandala/model/constants.ts';
import {
  LSystemPresetId,
  PolarGeneratorId,
  ProceduralTabId,
} from '../features/mandala/model/types.ts';
import { L_SYSTEM_PRESETS, resolveLSystemPreset } from '../features/mandala/lib/lsystem.ts';
import {
  POLAR_GENERATOR_LIST,
  resolvePolarGenerator,
} from '../features/mandala/lib/polarGenerators.ts';
import { useMandalaStore } from '../features/mandala/model/store.ts';
import { ModalShell } from '../shared/ui/ModalShell.tsx';

interface LSystemModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const PRESET_LIST = Object.values(L_SYSTEM_PRESETS);

export const LSystemModal: React.FC<LSystemModalProps> = ({ isOpen, onClose }) => {
  const commitFractalGenerationSmart = useMandalaStore((s) => s.commitFractalGenerationSmart);
  const commitPolarGeneration = useMandalaStore((s) => s.commitPolarGeneration);

  const [activeTab, setActiveTab] = useState<ProceduralTabId>(ProceduralTabId.LSystem);

  // L-System state
  const [selectedPreset, setSelectedPreset] = useState<LSystemPresetId>(
    LSystemPresetId.SacredFlower
  );
  const [generations, setGenerations] = useState<number>(3);
  const [angle, setAngle] = useState<number>(36);
  const [step, setStep] = useState<number>(20);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);

  // Polar Harmonics state
  const [polarId, setPolarId] = useState<PolarGeneratorId>(PolarGeneratorId.RoseCurve);
  const [polarRadius, setPolarRadius] = useState<number>(POLAR_LIMITS.defaultAmplitudeRadius);
  const [polarNum, setPolarNum] = useState<number>(POLAR_LIMITS.defaultNumerator);
  const [polarDen, setPolarDen] = useState<number>(POLAR_LIMITS.defaultDenominator);
  const [polarSteps, setPolarSteps] = useState<number>(POLAR_LIMITS.defaultSampleSteps);

  if (!isOpen) return null;

  const handleSelectPreset = (presetId: LSystemPresetId) => {
    setSelectedPreset(presetId);
    const p = resolveLSystemPreset(presetId);
    setGenerations(p.defaultGenerations);
    setAngle(p.defaultAngle);
    setStep(p.defaultStep);
  };

  const handleSelectPolar = (id: PolarGeneratorId) => {
    setPolarId(id);
    const desc = resolvePolarGenerator(id);
    setPolarRadius(desc.defaultRadius);
    setPolarNum(desc.defaultNumerator);
    setPolarDen(desc.defaultDenominator);
  };

  const handleGenerate = async () => {
    if (isGenerating) return;
    setIsGenerating(true);
    try {
      if (activeTab === ProceduralTabId.LSystem) {
        await commitFractalGenerationSmart(selectedPreset, generations, angle, step);
      } else {
        commitPolarGeneration({
          generatorId: polarId,
          amplitudeRadius: polarRadius,
          numerator: polarNum,
          denominator: polarDen,
          sampleSteps: polarSteps,
        });
      }
      onClose();
    } finally {
      setIsGenerating(false);
    }
  };

  const usesWasmEscalation = generations >= MANDALA_LIMITS.fractalPerfWarningGenerations;

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title="Generatore Procedurale"
      subtitle="Frattali L-System (JS/WASM) e Armoniche Polari parametriche"
      closeButtonAriaLabel="Chiudi finestra"
      icon={<Sparkles className="w-4 h-4" />}
      iconContainerClassName="bg-purple-500/10 text-purple-400 border border-purple-500/20"
      maxWidthClassName="max-w-lg"
      footer={
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white rounded-lg transition"
          >
            Annulla
          </button>
          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={isGenerating}
            className="flex items-center gap-2 px-5 py-2 text-xs font-semibold text-white bg-purple-700 hover:bg-purple-600 disabled:opacity-60 rounded-lg shadow-md transition"
          >
            <Sparkles className="w-4 h-4" />
            <span>{isGenerating ? 'Calcolo in corso...' : 'Genera su Mandala'}</span>
          </button>
        </div>
      }
    >
      <div className="p-6 space-y-5 text-sm max-h-[75vh] overflow-y-auto">
        {/* Procedural Generator Mode Tabs */}
        <div
          className="grid grid-cols-2 gap-1 p-1 bg-slate-950 border border-slate-800 rounded-xl"
          role="tablist"
          aria-label="Tipo di generatore procedurale"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === ProceduralTabId.LSystem}
            onClick={() => setActiveTab(ProceduralTabId.LSystem)}
            className={`min-h-[40px] flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap ${
              activeTab === ProceduralTabId.LSystem
                ? 'bg-purple-700 text-white font-semibold'
                : 'text-slate-300 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 shrink-0" />
            <span>L-System Frattali</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === ProceduralTabId.PolarHarmonics}
            onClick={() => setActiveTab(ProceduralTabId.PolarHarmonics)}
            className={`min-h-[40px] flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap ${
              activeTab === ProceduralTabId.PolarHarmonics
                ? 'bg-purple-700 text-white font-semibold'
                : 'text-slate-300 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Compass className="w-3.5 h-3.5 shrink-0" />
            <span>Armoniche Polari</span>
          </button>
        </div>

        {activeTab === ProceduralTabId.LSystem ? (
          <>
            <div>
              <span className="block text-xs font-semibold text-slate-400 mb-2">
                Archetipo Geometrico
              </span>
              <div className="grid grid-cols-2 gap-2.5">
                {PRESET_LIST.map((preset) => {
                  const isSelected = selectedPreset === preset.id;
                  return (
                    <button
                      type="button"
                      key={preset.id}
                      onClick={() => handleSelectPreset(preset.id)}
                      className={`p-3 rounded-xl border text-left transition flex flex-col justify-between ${
                        isSelected
                          ? 'bg-purple-950/40 border-purple-500 text-white shadow-sm'
                          : 'bg-slate-800/40 border-slate-700/60 text-slate-300 hover:border-slate-600'
                      }`}
                    >
                      <span className="font-semibold text-xs flex items-center justify-between">
                        {preset.name}
                        {isSelected && <Check className="w-3.5 h-3.5 text-purple-400" />}
                      </span>
                      <span className="text-[11px] text-slate-400 mt-1 line-clamp-2">
                        {preset.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-4 pt-2 border-t border-slate-800">
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <label htmlFor="lsys-gen" className="text-slate-300">
                    Generazioni ricorsive (Iterazioni):
                  </label>
                  <span className="font-mono text-purple-300 font-bold tabular-nums">
                    {generations} {usesWasmEscalation ? '· WASM Worker' : '· JS Rapido'}
                  </span>
                </div>
                <input
                  id="lsys-gen"
                  type="range"
                  min="1"
                  max={MANDALA_LIMITS.lSystemCapGenerations}
                  step="1"
                  value={generations}
                  onChange={(e) => setGenerations(parseInt(e.target.value, 10))}
                  className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                />
                <span className="text-[11px] text-slate-400 block">
                  Cap a {MANDALA_LIMITS.lSystemCapGenerations} iterazioni con accelerazione WASM lineare off-thread automatica da Gen {MANDALA_LIMITS.fractalPerfWarningGenerations}
                </span>
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <label htmlFor="lsys-angle" className="text-slate-300">
                    Angolo di rotazione branch:
                  </label>
                  <span className="font-mono text-purple-300 font-bold tabular-nums">{angle}°</span>
                </div>
                <input
                  id="lsys-angle"
                  type="range"
                  min="15"
                  max="120"
                  step="1"
                  value={angle}
                  onChange={(e) => setAngle(parseInt(e.target.value, 10))}
                  className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <label htmlFor="lsys-step" className="text-slate-300">
                    Lunghezza passo (scala):
                  </label>
                  <span className="font-mono text-purple-300 font-bold tabular-nums">{step}px</span>
                </div>
                <input
                  id="lsys-step"
                  type="range"
                  min="5"
                  max="40"
                  step="1"
                  value={step}
                  onChange={(e) => setStep(parseInt(e.target.value, 10))}
                  className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                />
              </div>
            </div>
          </>
        ) : (
          <>
            <div>
              <span className="block text-xs font-semibold text-slate-400 mb-2">
                Curva Armonica / Tassellazione
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {POLAR_GENERATOR_LIST.map((desc) => {
                  const isSelected = polarId === desc.id;
                  return (
                    <button
                      type="button"
                      key={desc.id}
                      onClick={() => handleSelectPolar(desc.id)}
                      className={`p-3 rounded-xl border text-left transition flex flex-col justify-between ${
                        isSelected
                          ? 'bg-purple-950/40 border-purple-500 text-white shadow-sm'
                          : 'bg-slate-800/40 border-slate-700/60 text-slate-300 hover:border-slate-600'
                      }`}
                    >
                      <span className="font-semibold text-xs flex items-center justify-between gap-1">
                        <span>{desc.name.split(' (')[0]}</span>
                        {isSelected && <Check className="w-3.5 h-3.5 text-purple-400 shrink-0" />}
                      </span>
                      <span className="text-[11px] text-slate-400 mt-1 leading-snug">
                        {desc.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-4 pt-2 border-t border-slate-800">
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <label htmlFor="polar-radius" className="text-slate-300">
                    Raggio Ampiezza:
                  </label>
                  <span className="font-mono text-purple-300 font-bold tabular-nums">
                    {polarRadius}px
                  </span>
                </div>
                <input
                  id="polar-radius"
                  type="range"
                  min={POLAR_LIMITS.minAmplitudeRadius}
                  max={POLAR_LIMITS.maxAmplitudeRadius}
                  step="5"
                  value={polarRadius}
                  onChange={(e) => setPolarRadius(parseInt(e.target.value, 10))}
                  className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <label htmlFor="polar-num" className="text-slate-300">
                      {polarId === PolarGeneratorId.HexagonalCrown ? 'Lati / Petali:' : 'Armonica N:'}
                    </label>
                    <span className="font-mono text-purple-300 font-bold tabular-nums">
                      {polarNum}
                    </span>
                  </div>
                  <input
                    id="polar-num"
                    type="range"
                    min={POLAR_LIMITS.minNumerator}
                    max={POLAR_LIMITS.maxNumerator}
                    step="1"
                    value={polarNum}
                    onChange={(e) => setPolarNum(parseInt(e.target.value, 10))}
                    className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <label htmlFor="polar-den" className="text-slate-300">
                      {polarId === PolarGeneratorId.HexagonalCrown ? 'Anelli / Corone:' : 'Rapporto D:'}
                    </label>
                    <span className="font-mono text-purple-300 font-bold tabular-nums">
                      {polarDen}
                    </span>
                  </div>
                  <input
                    id="polar-den"
                    type="range"
                    min={
                      polarId === PolarGeneratorId.HexagonalCrown
                        ? POLAR_LIMITS.minHexLayers
                        : POLAR_LIMITS.minDenominator
                    }
                    max={
                      polarId === PolarGeneratorId.HexagonalCrown
                        ? POLAR_LIMITS.maxHexLayers
                        : POLAR_LIMITS.maxDenominator
                    }
                    step="1"
                    value={polarDen}
                    onChange={(e) => setPolarDen(parseInt(e.target.value, 10))}
                    className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <label htmlFor="polar-steps" className="text-slate-300">
                    Campionamento Curva:
                  </label>
                  <span className="font-mono text-purple-300 font-bold tabular-nums">
                    {polarSteps} pt
                  </span>
                </div>
                <input
                  id="polar-steps"
                  type="range"
                  min={POLAR_LIMITS.minSampleSteps}
                  max={POLAR_LIMITS.maxSampleSteps}
                  step="12"
                  value={polarSteps}
                  onChange={(e) => setPolarSteps(parseInt(e.target.value, 10))}
                  className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                />
              </div>
            </div>
          </>
        )}
      </div>
    </ModalShell>
  );
};
