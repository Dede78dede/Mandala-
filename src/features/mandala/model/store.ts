/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Zustand Store Barrel composing atomic slices under `./slices/`.
 */

import { create } from 'zustand';
import {
  SymmetryStrategyKind,
  type Palette,
  type SymmetryParams,
} from './types.ts';
import { resolveStrokeStylePreset } from './palettes.ts';
import { describeSymmetryParams } from '../strategies/symmetry.ts';
import { createSceneSlice } from './slices/sceneSlice.ts';
import { createPaletteSlice } from './slices/paletteSlice.ts';
import { createToolSlice } from './slices/toolSlice.ts';
import { createSecuritySlice } from './slices/securitySlice.ts';
import { createViewportSlice } from './slices/viewportSlice.ts';
import { createLensSlice } from './slices/lensSlice.ts';
import { createKineticSlice } from './slices/kineticSlice.ts';
import type { MandalaStore } from './slices/storeTypes.ts';

export type {
  SceneSlice,
  PaletteSlice,
  ToolSlice,
  SecuritySlice,
  ViewportSlice,
  LensSlice,
  KineticSlice,
  MandalaStore,
} from './slices/storeTypes.ts';

export const useMandalaStore = create<MandalaStore>()((...a) => ({
  ...createSceneSlice(...a),
  ...createPaletteSlice(...a),
  ...createToolSlice(...a),
  ...createSecuritySlice(...a),
  ...createViewportSlice(...a),
  ...createLensSlice(...a),
  ...createKineticSlice(...a),
}));

/**
 * Pure selector helper for parametric accessibility description (Layer 3 derived, never stored).
 */
export function buildParametricDescription(
  symmetryParams: SymmetryParams,
  wedgesCount: number,
  activePalette: Palette,
  activeColor: string,
  strokeWidth: number,
  activeDash: readonly number[] | null
): string {
  const dashName = resolveStrokeStylePreset(activeDash).label.toLowerCase();
  const fractalInfo =
    symmetryParams.strategyId === SymmetryStrategyKind.Fractal
      ? ` Iterazioni frattali: ${symmetryParams.generations}, angolo ${symmetryParams.angle}°, passo ${symmetryParams.stepLength}px.`
      : '';
  return `Mandala con ${describeSymmetryParams(symmetryParams)}.${fractalInfo} ${wedgesCount} tratti memorizzati. Palette attiva: ${activePalette.name} (${activePalette.colourblindSafe ? 'accessibile a daltonismo' : 'standard'}). Colore selezionato: ${activeColor}, stile tratto: ${dashName}, spessore ${strokeWidth}px.`;
}
