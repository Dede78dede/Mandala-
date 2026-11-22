/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StateCreator } from 'zustand';
import { flushAllApplicationCaches } from '../../../../shared/lib/cacheService.ts';
import { playHapticTone } from '../../../../shared/lib/hapticAudio.ts';
import {
  KINETIC_LIMITS,
  MANDALA_LIMITS,
  STAMP_LIMITS,
  WORLD_SPACE_LIMITS,
} from '../constants.ts';
import { DEFAULT_PALETTE, PALETTES } from '../palettes.ts';
import {
  ExecutionRoutingMode,
  HapticTone,
  KineticMode,
  MorphTargetKind,
  PolarGeneratorId,
  StampArchetypeId,
  ToolId,
  type FlushCacheReport,
} from '../types.ts';
import { clearSavedSessionStorage } from '../../lib/persistence.ts';
import { DEFAULT_CAMERA_TRANSFORM } from '../../lib/viewportCamera.ts';
import { DEFAULT_LENS_CONFIG } from '../../lib/lensProjection.ts';
import {
  DEFAULT_SYMMETRY_PARAMS,
  persistStateSnapshot,
  scheduleAnnouncement,
} from './storeHelpers.ts';
import type { MandalaStore, SecuritySlice } from './storeTypes.ts';

export const createSecuritySlice: StateCreator<MandalaStore, [], [], SecuritySlice> = (set, get) => ({
  autoProtectEnabled: true,
  guardAlert: null,
  lastMaintenanceMessage: null,
  lastCacheFlushReport: null,

  setAutoProtectEnabled: (enabled) => {
    set(() => ({ autoProtectEnabled: enabled }));
    scheduleAnnouncement(
      set,
      enabled
        ? 'Protezione anti-saturazione memoria e CPU attivata.'
        : 'Protezione anti-saturazione disattivata.'
    );
  },

  dismissGuardAlert: () => set(() => ({ guardAlert: null })),

  dismissMaintenanceMessage: () => set(() => ({ lastMaintenanceMessage: null })),

  flushCaches: async () => {
    const res = await flushAllApplicationCaches();
    const report: FlushCacheReport = res.ok
      ? res.value
      : {
          l1EntriesCleared: 0,
          memoEntriesCleared: 0,
          renderSnapshotsCleared: 0,
          browserCachesDeleted: 0,
          coldBatchesCleared: 0,
          estimatedBytesFreed: 0,
          flushedAt: new Date().toISOString(),
        };

    const kbFreed = (report.estimatedBytesFreed / 1024).toFixed(1);
    const gpuNote =
      report.gpuTexturesCleared && report.gpuTexturesCleared > 0
        ? `, ${report.gpuTexturesCleared} texture GPU`
        : '';
    const msg = `Cache svuotata: ${report.l1EntriesCleared} voci L1, ${report.memoEntriesCleared} memo${gpuNote}, ${report.coldBatchesCleared} batch L3 (${kbFreed} KB liberati).`;
    set((s) => ({
      sceneVersion: s.sceneVersion + 1,
      lastCacheFlushReport: report,
      lastMaintenanceMessage: msg,
      lens: s.lens.hasCustomTexture ? { ...s.lens, hasCustomTexture: false } : s.lens,
      guardAlert: null,
    }));
    playHapticTone(get().soundEnabled, HapticTone.Harmonic);
    scheduleAnnouncement(set, msg);
    return report;
  },

  resetSettings: () => {
    const defaultPalette = PALETTES[0] ?? DEFAULT_PALETTE;
    const defaultColor =
      defaultPalette.colours[2] ?? defaultPalette.colours[0] ?? DEFAULT_PALETTE.colours[0];
    set((s) => ({
      sceneVersion: s.sceneVersion + 1,
      symmetryParams: DEFAULT_SYMMETRY_PARAMS,
      activePalette: defaultPalette,
      activeColor: defaultColor,
      strokeWidth: MANDALA_LIMITS.defaultStrokeWidth,
      activeDash: null,
      activeTool: ToolId.Brush,
      activeStampArchetype: StampArchetypeId.Petal,
      stampScale: STAMP_LIMITS.defaultScale,
      showGuides: true,
      pressureEnabled: true,
      soundEnabled: true,
      routingMode: ExecutionRoutingMode.AutoGate,
      forceEscapeHatch: false,
      autoProtectEnabled: true,
      camera: DEFAULT_CAMERA_TRANSFORM,
      worldRadius: WORLD_SPACE_LIMITS.extendedRadius,
      isPanToolActive: false,
      lens: DEFAULT_LENS_CONFIG,
      kineticMode: KineticMode.Off,
      kineticPlaying: false,
      kineticSpeed: KINETIC_LIMITS.defaultSpeed,
      replayProgress: 1,
      concentricBreathing: KINETIC_LIMITS.defaultBreathing,
      morphProgress: 0,
      morphTargetKind: MorphTargetKind.PolarPreset,
      morphTargetPolarPreset: PolarGeneratorId.RoseCurve,
      guardAlert: null,
      lastMaintenanceMessage:
        'Impostazioni, Camera, Lente e Animazioni ripristinate (disegno preservato).',
    }));
    persistStateSnapshot(get());
    playHapticTone(get().soundEnabled, HapticTone.Harmonic);
    scheduleAnnouncement(set, 'Impostazioni ripristinate ai valori predefiniti.');
  },

  resetWorkspaceAll: async () => {
    await clearSavedSessionStorage();
    await flushAllApplicationCaches();
    const defaultPalette = PALETTES[0] ?? DEFAULT_PALETTE;
    const defaultColor =
      defaultPalette.colours[2] ?? defaultPalette.colours[0] ?? DEFAULT_PALETTE.colours[0];
    set((s) => ({
      wedges: [],
      sceneVersion: s.sceneVersion + 1,
      undoStack: [],
      redoStack: [],
      persistenceWarning: null,
      symmetryParams: DEFAULT_SYMMETRY_PARAMS,
      activePalette: defaultPalette,
      activeColor: defaultColor,
      strokeWidth: MANDALA_LIMITS.defaultStrokeWidth,
      activeDash: null,
      activeTool: ToolId.Brush,
      activeStampArchetype: StampArchetypeId.Petal,
      stampScale: STAMP_LIMITS.defaultScale,
      showGuides: true,
      pressureEnabled: true,
      soundEnabled: true,
      routingMode: ExecutionRoutingMode.AutoGate,
      forceEscapeHatch: false,
      autoProtectEnabled: true,
      camera: DEFAULT_CAMERA_TRANSFORM,
      worldRadius: WORLD_SPACE_LIMITS.extendedRadius,
      isPanToolActive: false,
      lens: DEFAULT_LENS_CONFIG,
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
      guardAlert: null,
      lastMaintenanceMessage:
        'Reset completo eseguito: cache svuotata, impostazioni e tela ripristinate.',
    }));
    scheduleAnnouncement(set, 'Reset completo eseguito.');
  },
});
