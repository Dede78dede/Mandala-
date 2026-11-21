/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Interactive Kinetic Zen & Time-Lapse Stroke Replay Dock.
 * - Mode switcher: Replay Tratti (Time-Lapse) | Anelli Concentrici (Rotazione + Respiro)
 * - Explicit Play/Pause, Restart, Speed presets, Scrubber/Breathing slider
 * - Dual-coded status alert when paused by prefers-reduced-motion or CPU guard
 */

import React, { memo, useMemo } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Pencil,
  Sparkles,
  History,
  ShieldAlert,
  Wand2,
  Camera,
} from 'lucide-react';
import { KINETIC_LIMITS } from '../features/mandala/model/constants.ts';
import {
  KineticMode,
  MorphSlotId,
  MorphTargetKind,
  PolarGeneratorId,
} from '../features/mandala/model/types.ts';
import { useMandalaStore } from '../features/mandala/model/store.ts';
import { POLAR_GENERATOR_LIST } from '../features/mandala/lib/polarGenerators.ts';
import { getResourceHealthSnapshot } from '../features/mandala/lib/resourceGuard.ts';
import {
  describeMotionPauseReason,
  useMotionLifecycle,
} from '../shared/lib/motionLifecycle.ts';

const SPEED_OPTIONS = [0.5, 1, 2] as const;

export const KineticReplayBar: React.FC = memo(() => {
  const wedges = useMandalaStore((s) => s.wedges);
  const symmetryParams = useMandalaStore((s) => s.symmetryParams);
  const kineticMode = useMandalaStore((s) => s.kineticMode);
  const kineticPlaying = useMandalaStore((s) => s.kineticPlaying);
  const kineticSpeed = useMandalaStore((s) => s.kineticSpeed);
  const replayProgress = useMandalaStore((s) => s.replayProgress);
  const concentricBreathing = useMandalaStore((s) => s.concentricBreathing);
  const morphSlotA = useMandalaStore((s) => s.morphSlotA);
  const morphSlotB = useMandalaStore((s) => s.morphSlotB);
  const morphTargetKind = useMandalaStore((s) => s.morphTargetKind);
  const morphTargetPolarPreset = useMandalaStore((s) => s.morphTargetPolarPreset);
  const morphProgress = useMandalaStore((s) => s.morphProgress);

  const enterKineticMode = useMandalaStore((s) => s.enterKineticMode);
  const exitKineticMode = useMandalaStore((s) => s.exitKineticMode);
  const setKineticPlaying = useMandalaStore((s) => s.setKineticPlaying);
  const setKineticSpeed = useMandalaStore((s) => s.setKineticSpeed);
  const setReplayProgress = useMandalaStore((s) => s.setReplayProgress);
  const setConcentricBreathing = useMandalaStore((s) => s.setConcentricBreathing);
  const captureMorphSlot = useMandalaStore((s) => s.captureMorphSlot);
  const setMorphTargetKind = useMandalaStore((s) => s.setMorphTargetKind);
  const setMorphTargetPolarPreset = useMandalaStore((s) => s.setMorphTargetPolarPreset);
  const setMorphProgress = useMandalaStore((s) => s.setMorphProgress);

  const health = useMemo(
    () => getResourceHealthSnapshot(wedges, symmetryParams),
    [wedges, symmetryParams]
  );

  const motionGate = useMotionLifecycle(kineticPlaying, health.cpuLoadState);
  const pauseNotice = describeMotionPauseReason(motionGate.pauseReason);

  if (kineticMode === KineticMode.Off) return null;

  const isReplay = kineticMode === KineticMode.StrokeReplay;
  const isConcentric = kineticMode === KineticMode.ConcentricRings;
  const isMorph = kineticMode === KineticMode.Morph;
  const progressPercent = Math.round(replayProgress * 100);
  const morphPercent = Math.round(morphProgress * 100);

  return (
    <section
      data-testid="kinetic-replay-bar"
      aria-label="Controlli Modalità Zen, Morphing e Replay"
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      className="absolute bottom-3 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-1.5rem)] max-w-3xl bg-slate-900/95 backdrop-blur-md border border-slate-700 rounded-2xl shadow-2xl p-3 text-slate-100 space-y-2.5 transition-opacity duration-150 motion-reduce:transition-none"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Segmented Kinetic Mode Switcher */}
        <div
          className="flex items-center gap-1 p-1 bg-slate-950 rounded-xl border border-slate-800"
          role="group"
          aria-label="Tipo di animazione mandala"
        >
          <button
            type="button"
            onClick={() => enterKineticMode(KineticMode.StrokeReplay)}
            aria-pressed={isReplay}
            className={`min-h-[38px] inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap ${
              isReplay
                ? 'bg-cyan-500 text-slate-950 font-semibold'
                : 'text-slate-300 hover:text-white hover:bg-slate-800'
            }`}
          >
            <History className="w-3.5 h-3.5 shrink-0" />
            <span>Replay Tratti</span>
          </button>

          <button
            type="button"
            onClick={() => enterKineticMode(KineticMode.ConcentricRings)}
            aria-pressed={isConcentric}
            className={`min-h-[38px] inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap ${
              isConcentric
                ? 'bg-cyan-500 text-slate-950 font-semibold'
                : 'text-slate-300 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 shrink-0" />
            <span>Anelli Zen</span>
          </button>

          <button
            type="button"
            onClick={() => enterKineticMode(KineticMode.Morph)}
            aria-pressed={isMorph}
            className={`min-h-[38px] inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap ${
              isMorph
                ? 'bg-cyan-500 text-slate-950 font-semibold'
                : 'text-slate-300 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Wand2 className="w-3.5 h-3.5 shrink-0" />
            <span>Morphing</span>
          </button>
        </div>

        {/* Transport & Speed Controls */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            data-testid="kinetic-play-pause"
            onClick={() => setKineticPlaying(!kineticPlaying)}
            className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white transition whitespace-nowrap"
          >
            {kineticPlaying ? (
              <>
                <Pause className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                <span>Pausa</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>Play</span>
              </>
            )}
          </button>

          {isReplay && (
            <button
              type="button"
              onClick={() => {
                setReplayProgress(0);
                setKineticPlaying(true);
              }}
              aria-label="Riavvia replay dall'inizio"
              className="min-w-[38px] min-h-[38px] inline-flex items-center justify-center rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white transition"
              title="Riavvia dall'inizio"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}

          <div className="hidden sm:flex items-center gap-1 p-1 bg-slate-950 border border-slate-800 rounded-lg">
            {SPEED_OPTIONS.map((spd) => (
              <button
                key={spd}
                type="button"
                onClick={() => setKineticSpeed(spd)}
                aria-pressed={Math.abs(kineticSpeed - spd) < 0.05}
                className={`min-h-[32px] px-2 rounded text-[11px] font-mono tabular-nums transition whitespace-nowrap ${
                  Math.abs(kineticSpeed - spd) < 0.05
                    ? 'bg-slate-700 text-cyan-300 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {spd}x
              </button>
            ))}
          </div>

          <button
            type="button"
            data-testid="exit-kinetic-button"
            onClick={exitKineticMode}
            className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-cyan-400 hover:bg-cyan-300 text-slate-950 transition whitespace-nowrap"
          >
            <Pencil className="w-3.5 h-3.5 shrink-0" />
            <span>Disegna</span>
          </button>
        </div>
      </div>

      {/* Mode-specific Controls */}
      {isReplay && (
        <label className="flex items-center gap-3 text-xs">
          <span className="text-slate-400 whitespace-nowrap">Avanzamento Replay</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={replayProgress}
            onChange={(e) => {
              setKineticPlaying(false);
              setReplayProgress(Number(e.target.value));
            }}
            className="flex-1 h-2 accent-cyan-400 cursor-pointer"
          />
          <span className="font-mono text-cyan-300 tabular-nums w-10 text-right">
            {progressPercent}%
          </span>
        </label>
      )}

      {isConcentric && (
        <label className="flex items-center gap-3 text-xs">
          <span className="text-slate-400 whitespace-nowrap">Respiro Radiale</span>
          <input
            type="range"
            min={0}
            max={KINETIC_LIMITS.maxBreathing}
            step={0.01}
            value={concentricBreathing}
            onChange={(e) => setConcentricBreathing(Number(e.target.value))}
            className="flex-1 h-2 accent-cyan-400 cursor-pointer"
          />
          <span className="font-mono text-cyan-300 tabular-nums w-10 text-right">
            {Math.round(concentricBreathing * 100)}%
          </span>
        </label>
      )}

      {isMorph && (
        <div className="space-y-2 pt-0.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => captureMorphSlot(MorphSlotId.SlotA)}
                className="min-h-[34px] inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 transition whitespace-nowrap"
              >
                <Camera className="w-3 h-3 text-cyan-400 shrink-0" />
                <span>{morphSlotA ? morphSlotA.label : 'Salva Prima A'}</span>
              </button>

              <button
                type="button"
                onClick={() => captureMorphSlot(MorphSlotId.SlotB)}
                className="min-h-[34px] inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 transition whitespace-nowrap"
              >
                <Camera className="w-3 h-3 text-purple-400 shrink-0" />
                <span>{morphSlotB ? morphSlotB.label : 'Salva Dopo B'}</span>
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setMorphTargetKind(MorphTargetKind.UserSlotB)}
                disabled={!morphSlotB}
                aria-pressed={morphTargetKind === MorphTargetKind.UserSlotB}
                className={`min-h-[34px] px-2.5 py-1 rounded-lg text-[11px] font-medium border transition whitespace-nowrap disabled:opacity-40 ${
                  morphTargetKind === MorphTargetKind.UserSlotB
                    ? 'bg-purple-700 border-purple-500 text-white'
                    : 'bg-slate-800 border-slate-700 text-slate-300'
                }`}
              >
                Verso Slot B
              </button>

              <select
                aria-label="Target Armonica Polare per Morphing"
                value={morphTargetPolarPreset}
                onChange={(e) => setMorphTargetPolarPreset(e.target.value as PolarGeneratorId)}
                className={`min-h-[34px] px-2 py-1 rounded-lg text-[11px] border transition ${
                  morphTargetKind === MorphTargetKind.PolarPreset
                    ? 'bg-purple-950/60 border-purple-500 text-purple-200 font-medium'
                    : 'bg-slate-800 border-slate-700 text-slate-300'
                }`}
              >
                {POLAR_GENERATOR_LIST.map((desc) => (
                  <option key={desc.id} value={desc.id}>
                    Target: {desc.name.split(' (')[0]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label className="flex items-center gap-3 text-xs">
            <span className="text-slate-400 whitespace-nowrap">Progresso Morph</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={morphProgress}
              onChange={(e) => {
                setKineticPlaying(false);
                setMorphProgress(Number(e.target.value));
              }}
              className="flex-1 h-2 accent-purple-400 cursor-pointer"
            />
            <span className="font-mono text-purple-300 tabular-nums w-10 text-right">
              {morphPercent}%
            </span>
          </label>
        </div>
      )}

      {pauseNotice && (
        <p className="flex items-center gap-2 text-[11px] text-amber-200 bg-amber-950/50 border border-amber-800/70 rounded-lg px-2.5 py-1.5">
          <ShieldAlert className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span>{pauseNotice}</span>
        </p>
      )}
    </section>
  );
});

KineticReplayBar.displayName = 'KineticReplayBar';
