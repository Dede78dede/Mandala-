/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StateCreator } from 'zustand';
import { playHapticTone } from '../../../../shared/lib/hapticAudio.ts';
import { DEFAULT_PALETTE, resolveStrokeStylePreset } from '../palettes.ts';
import { HapticTone } from '../types.ts';
import {
  initialWorkspaceSeed,
  persistStateSnapshot,
  scheduleAnnouncement,
} from './storeHelpers.ts';
import type { MandalaStore, PaletteSlice } from './storeTypes.ts';

export const createPaletteSlice: StateCreator<MandalaStore, [], [], PaletteSlice> = (set, get) => ({
  activePalette: initialWorkspaceSeed.activePalette,
  activeColor: initialWorkspaceSeed.activeColor,
  strokeWidth: initialWorkspaceSeed.strokeWidth,
  activeDash: initialWorkspaceSeed.activeDash,

  selectPalette: (palette) => {
    const nextColor =
      palette.colours[2] ?? palette.colours[0] ?? DEFAULT_PALETTE.colours[0];
    set(() => ({ activePalette: palette, activeColor: nextColor }));
    const updated = get();
    persistStateSnapshot(updated);
    playHapticTone(updated.soundEnabled, HapticTone.Click);
    scheduleAnnouncement(
      set,
      `Palette attivata: ${palette.name}. ${palette.colourblindSafe ? 'Sicura per daltonismo.' : ''}`
    );
  },

  setActiveColor: (color) => {
    set(() => ({ activeColor: color }));
    persistStateSnapshot(get());
  },

  setStrokeWidth: (width) => {
    set(() => ({ strokeWidth: width }));
    persistStateSnapshot(get());
  },

  setActiveDash: (dash) => {
    set(() => ({ activeDash: dash }));
    const updated = get();
    persistStateSnapshot(updated);
    playHapticTone(updated.soundEnabled, HapticTone.Click);
    scheduleAnnouncement(set, `Stile tratto: ${resolveStrokeStylePreset(dash).label}`);
  },
});
