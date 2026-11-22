/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StateCreator } from 'zustand';
import { playHapticTone } from '../../../../shared/lib/hapticAudio.ts';
import { KINETIC_LIMITS } from '../constants.ts';
import {
  HapticTone,
  KineticMode,
  MorphSlotId,
  MorphTargetKind,
  PolarGeneratorId,
  type MorphSlotSnapshot,
} from '../types.ts';
import { scheduleAnnouncement } from './storeHelpers.ts';
import type { KineticSlice, MandalaStore } from './storeTypes.ts';

export const createKineticSlice: StateCreator<MandalaStore, [], [], KineticSlice> = (set, get) => ({
  kineticMode: KineticMode.Off,
  kineticPlaying: false,
  kineticSpeed: KINETIC_LIMITS.defaultSpeed,
  replayProgress: 1,
  concentricBreathing: KINETIC_LIMITS.defaultBreathing,
  morphSlotA: null,
  morphSlotB: null,
  morphTargetKind: MorphTargetKind.PolarPreset,
  morphTargetPolarPreset: PolarGeneratorId.RoseCurve,
  morphProgress: 0,

  enterKineticMode: (mode) => {
    const current = get();
    const autoSlotA: MorphSlotSnapshot | null =
      mode === KineticMode.Morph && !current.morphSlotA
        ? {
            strokes: current.wedges.map((w) => ({ ...w, points: [...w.points] })),
            label: `Tela Prima (${current.wedges.length})`,
            capturedAtIso: new Date().toISOString(),
          }
        : current.morphSlotA;

    const statusMsg =
      mode === KineticMode.StrokeReplay
        ? 'Replay progressivo attivo: premi Disegna o Esc per tornare alla tela.'
        : mode === KineticMode.Morph
          ? 'Kinetic Morphing attivo: trasforma il Mandala tra Slot A/B e Armoniche Polari.'
          : 'Modalità Zen Concentrica attiva: anelli e respiro in tempo reale.';

    set((s) => ({
      kineticMode: mode,
      kineticPlaying: true,
      replayProgress: mode === KineticMode.StrokeReplay ? 0 : 1,
      morphSlotA: autoSlotA,
      morphProgress: mode === KineticMode.Morph ? 0 : s.morphProgress,
      isPanToolActive: false,
      lens: s.lens.enabled ? { ...s.lens, enabled: false, isAnimating: false } : s.lens,
      lastMaintenanceMessage: statusMsg,
    }));
    playHapticTone(get().soundEnabled, HapticTone.Harmonic);
    scheduleAnnouncement(
      set,
      mode === KineticMode.StrokeReplay
        ? 'Avviato replay progressivo dei tratti.'
        : mode === KineticMode.Morph
          ? 'Avviato morphing cinetico su Canvas 2D.'
          : 'Avviata modalità zen con anelli concentrici.'
    );
  },

  exitKineticMode: () => {
    if (get().kineticMode === KineticMode.Off) return;
    set(() => ({
      kineticMode: KineticMode.Off,
      kineticPlaying: false,
      replayProgress: 1,
    }));
    scheduleAnnouncement(set, 'Ritorno alla modalità di disegno piana.');
  },

  setKineticPlaying: (kineticPlaying) => {
    set((s) => ({
      kineticPlaying,
      replayProgress:
        kineticPlaying && s.kineticMode === KineticMode.StrokeReplay && s.replayProgress >= 0.999
          ? 0
          : s.replayProgress,
    }));
    playHapticTone(get().soundEnabled, HapticTone.Click);
  },

  setKineticSpeed: (speed) => {
    const safeSpeed = Math.max(KINETIC_LIMITS.minSpeed, Math.min(KINETIC_LIMITS.maxSpeed, speed));
    set(() => ({ kineticSpeed: safeSpeed }));
  },

  setReplayProgress: (progress) => {
    const safeProgress = Math.max(0, Math.min(1, progress));
    set(() => ({ replayProgress: safeProgress }));
  },

  setConcentricBreathing: (amplitude) => {
    const safeAmp = Math.max(0, Math.min(KINETIC_LIMITS.maxBreathing, amplitude));
    set(() => ({ concentricBreathing: safeAmp }));
  },

  captureMorphSlot: (slot) => {
    const state = get();
    const snapshot: MorphSlotSnapshot = {
      strokes: state.wedges.map((w) => ({
        ...w,
        points: w.points.map((p) => ({ ...p })),
        dash: w.dash ? [...w.dash] : null,
      })),
      label: `${slot === MorphSlotId.SlotA ? 'Prima A' : 'Dopo B'} (${state.wedges.length})`,
      capturedAtIso: new Date().toISOString(),
    };
    set(() =>
      slot === MorphSlotId.SlotA
        ? { morphSlotA: snapshot }
        : { morphSlotB: snapshot, morphTargetKind: MorphTargetKind.UserSlotB }
    );
    playHapticTone(state.soundEnabled, HapticTone.Click);
    scheduleAnnouncement(set, `Catturato ${snapshot.label} per il morphing.`);
  },

  clearMorphSlot: (slot) => {
    set((s) =>
      slot === MorphSlotId.SlotA
        ? { morphSlotA: null }
        : {
            morphSlotB: null,
            morphTargetKind:
              s.morphTargetKind === MorphTargetKind.UserSlotB
                ? MorphTargetKind.PolarPreset
                : s.morphTargetKind,
          }
    );
  },

  setMorphTargetKind: (morphTargetKind) => set(() => ({ morphTargetKind })),

  setMorphTargetPolarPreset: (morphTargetPolarPreset) =>
    set(() => ({
      morphTargetPolarPreset,
      morphTargetKind: MorphTargetKind.PolarPreset,
    })),

  setMorphProgress: (progress) => {
    const safeProgress = Math.max(0, Math.min(1, progress));
    set(() => ({ morphProgress: safeProgress }));
  },
});
