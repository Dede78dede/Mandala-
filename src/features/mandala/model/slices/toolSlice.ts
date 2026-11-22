/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StateCreator } from 'zustand';
import { playHapticTone } from '../../../../shared/lib/hapticAudio.ts';
import { STAMP_LIMITS } from '../constants.ts';
import {
  ExecutionRoutingMode,
  HapticTone,
  KineticMode,
  StampArchetypeId,
  ToolId,
} from '../types.ts';
import type { MandalaStore, ToolSlice } from './storeTypes.ts';

export const createToolSlice: StateCreator<MandalaStore, [], [], ToolSlice> = (set, get) => ({
  activeTool: ToolId.Brush,
  activeStampArchetype: StampArchetypeId.Petal,
  stampScale: STAMP_LIMITS.defaultScale,
  showGuides: true,
  pressureEnabled: true,
  soundEnabled: true,
  routingMode: ExecutionRoutingMode.AutoGate,
  forceEscapeHatch: false,

  setActiveTool: (tool) => {
    const state = get();
    const wasLensEnabled = state.lens.enabled;
    const wasKinetic = state.kineticMode !== KineticMode.Off;
    set((s) => ({
      activeTool: tool,
      isPanToolActive: false,
      kineticMode: KineticMode.Off,
      kineticPlaying: false,
      lens: wasLensEnabled ? { ...s.lens, enabled: false, isAnimating: false } : s.lens,
      lastMaintenanceMessage:
        wasLensEnabled || wasKinetic
          ? 'Vista Piana ripristinata per disegnare con precisione.'
          : s.lastMaintenanceMessage,
    }));
  },
  setActiveStampArchetype: (activeStampArchetype) => {
    set(() => ({ activeStampArchetype, activeTool: ToolId.Stamp }));
    playHapticTone(get().soundEnabled, HapticTone.Click);
  },
  setStampScale: (scale) => {
    const clamped = Math.min(STAMP_LIMITS.maxScale, Math.max(STAMP_LIMITS.minScale, scale));
    set(() => ({ stampScale: clamped }));
  },
  setShowGuides: (show) => set(() => ({ showGuides: show })),
  setPressureEnabled: (enabled) => set(() => ({ pressureEnabled: enabled })),
  setSoundEnabled: (enabled) => set(() => ({ soundEnabled: enabled })),
  setRoutingMode: (mode) => set(() => ({ routingMode: mode })),
  setForceEscapeHatch: (enabled) => set(() => ({ forceEscapeHatch: enabled })),
});
