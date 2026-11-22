/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StateCreator } from 'zustand';
import { playHapticTone } from '../../../../shared/lib/hapticAudio.ts';
import { KALEIDOSCOPE_LIMITS } from '../constants.ts';
import { HapticTone, KineticMode } from '../types.ts';
import {
  DEFAULT_LENS_CONFIG,
  normalizeLensConfig,
} from '../../lib/lensProjection.ts';
import { scheduleAnnouncement } from './storeHelpers.ts';
import type { LensSlice, MandalaStore } from './storeTypes.ts';

export const createLensSlice: StateCreator<MandalaStore, [], [], LensSlice> = (set, get) => ({
  lens: DEFAULT_LENS_CONFIG,

  setLensEnabled: (enabled) => {
    set((s) => ({
      lens: { ...s.lens, enabled, isAnimating: enabled ? s.lens.isAnimating : false },
      isPanToolActive: enabled ? false : s.isPanToolActive,
      kineticMode: enabled ? KineticMode.Off : s.kineticMode,
      kineticPlaying: enabled ? false : s.kineticPlaying,
      lastMaintenanceMessage: enabled
        ? 'Anteprima Lente Semisferica WebGL2 attiva. Tocca per inclinare o torna in Vista Piana per disegnare.'
        : s.lastMaintenanceMessage,
    }));
    playHapticTone(get().soundEnabled, HapticTone.Harmonic);
    scheduleAnnouncement(
      set,
      enabled
        ? 'Anteprima lente semisferica attivata.'
        : 'Vista piana di disegno attivata.'
    );
  },

  setLensProfile: (profile) => {
    set((s) => ({ lens: normalizeLensConfig({ ...s.lens, profile }) }));
    playHapticTone(get().soundEnabled, HapticTone.Click);
  },

  setLensCurvature: (curvature) => {
    set((s) => ({ lens: normalizeLensConfig({ ...s.lens, curvature }) }));
  },

  setLensRefractiveIndex: (refractiveIndex) => {
    set((s) => ({ lens: normalizeLensConfig({ ...s.lens, refractiveIndex }) }));
  },

  setLensFresnel: (fresnelIntensity) => {
    set((s) => ({ lens: normalizeLensConfig({ ...s.lens, fresnelIntensity }) }));
  },

  setLensTilt: (tiltX, tiltY) => {
    set((s) => ({ lens: normalizeLensConfig({ ...s.lens, tiltX, tiltY }) }));
  },

  setLensTextureQuality: (textureQuality) => {
    set((s) => ({ lens: normalizeLensConfig({ ...s.lens, textureQuality }) }));
    playHapticTone(get().soundEnabled, HapticTone.Click);
  },

  setLensAnimating: (isAnimating) => {
    set((s) => ({ lens: normalizeLensConfig({ ...s.lens, isAnimating }) }));
    playHapticTone(get().soundEnabled, HapticTone.Click);
  },

  setLensBreatheAmplitude: (breatheAmplitude) => {
    set((s) => ({ lens: normalizeLensConfig({ ...s.lens, breatheAmplitude }) }));
  },

  setLensHueShiftSpeed: (hueShiftSpeed) => {
    set((s) => ({ lens: normalizeLensConfig({ ...s.lens, hueShiftSpeed }) }));
  },

  setKaleidoscopeFolds: (folds) => {
    const safeFolds = Math.round(
      Math.min(KALEIDOSCOPE_LIMITS.maxFolds, Math.max(KALEIDOSCOPE_LIMITS.minFolds, folds))
    );
    set((s) => ({ lens: normalizeLensConfig({ ...s.lens, kaleidoscopeFolds: safeFolds }) }));
  },

  setKaleidoscopeTwist: (kaleidoscopeTwist) => {
    set((s) => ({ lens: normalizeLensConfig({ ...s.lens, kaleidoscopeTwist }) }));
  },

  setHasCustomTexture: (hasCustomTexture) => {
    set((s) => ({ lens: normalizeLensConfig({ ...s.lens, hasCustomTexture }) }));
  },

  resetLensTilt: () => {
    set((s) => ({ lens: { ...s.lens, tiltX: 0, tiltY: 0 } }));
  },

  exitLensForDrawing: () => {
    if (!get().lens.enabled) return;
    set((s) => ({
      lens: { ...s.lens, enabled: false, isAnimating: false },
      lastMaintenanceMessage: 'Vista Piana ripristinata per disegnare con precisione.',
    }));
    scheduleAnnouncement(set, 'Ritorno automatico in vista piana per il tratto.');
  },
});
