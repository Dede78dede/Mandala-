/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StateCreator } from 'zustand';
import {
  CAMERA_LIMITS,
  LOGICAL_CANVAS_SIZE,
  WORLD_SPACE_LIMITS,
} from '../constants.ts';
import {
  clampCameraPan,
  zoomCameraAtScreenPoint,
} from '../../lib/viewportCamera.ts';
import {
  initialWorkspaceSeed,
  persistStateSnapshot,
  scheduleAnnouncement,
} from './storeHelpers.ts';
import type { MandalaStore, ViewportSlice } from './storeTypes.ts';

export const createViewportSlice: StateCreator<MandalaStore, [], [], ViewportSlice> = (set, get) => ({
  camera: initialWorkspaceSeed.camera,
  worldRadius: initialWorkspaceSeed.worldRadius,
  isPanToolActive: false,

  setZoom: (zoom, displaySize = 600) => {
    const state = get();
    const centerAnchor = { x: displaySize / 2, y: displaySize / 2 };
    const nextCamera = zoomCameraAtScreenPoint(
      state.camera,
      zoom,
      centerAnchor,
      displaySize,
      state.worldRadius
    );
    set(() => ({ camera: nextCamera }));
    persistStateSnapshot(get());
  },

  zoomAtScreenPoint: (
    targetZoom,
    anchorScreenPt,
    displaySize,
    viewportWidth = displaySize,
    viewportHeight = displaySize
  ) => {
    const state = get();
    const nextCamera = zoomCameraAtScreenPoint(
      state.camera,
      targetZoom,
      anchorScreenPt,
      displaySize,
      state.worldRadius,
      viewportWidth,
      viewportHeight
    );
    set(() => ({ camera: nextCamera }));
  },

  panByScreenDelta: (dxScreen, dyScreen, displaySize) => {
    set((s) => {
      const scale = (Math.max(1, displaySize) / LOGICAL_CANVAS_SIZE) * s.camera.zoom;
      const nextPanX = clampCameraPan(s.camera.panX - dxScreen / scale, s.worldRadius);
      const nextPanY = clampCameraPan(s.camera.panY - dyScreen / scale, s.worldRadius);
      return {
        camera: {
          ...s.camera,
          panX: nextPanX,
          panY: nextPanY,
        },
      };
    });
  },

  setWorldRadius: (radius) => {
    const safeRadius = Math.max(
      WORLD_SPACE_LIMITS.baseRadius,
      Math.min(WORLD_SPACE_LIMITS.extendedRadius * 2, Math.round(radius))
    );
    set(() => ({ worldRadius: safeRadius }));
    persistStateSnapshot(get());
  },

  setIsPanToolActive: (active) => set(() => ({ isPanToolActive: active })),

  resetViewport: () => {
    set(() => ({
      camera: {
        zoom: CAMERA_LIMITS.defaultZoom,
        panX: 0,
        panY: 0,
      },
      isPanToolActive: false,
    }));
    persistStateSnapshot(get());
    scheduleAnnouncement(set, 'Camera reimpostata al 100% al centro.');
  },
});
