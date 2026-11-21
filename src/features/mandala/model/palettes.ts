/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Immutable Palette & Stroke Style Registries (MANDALA-PH1 §4.3 & PH6 §6.1).
 * Stroke style (solid/dashed/dotted) is strictly independent of colour.
 */

import {
  PaletteId,
  StrokeStyleId,
  type Palette,
  type StrokeStylePreset,
} from './types.ts';

export const PALETTES: readonly Palette[] = [
  {
    id: PaletteId.OkabeIto,
    name: 'Okabe-Ito (Universal CUD)',
    colourblindSafe: true,
    description:
      'Empiricamente verificata per protanopia, deuteranopia e tritanopia (Color Universal Design)',
    colours: [
      '#000000',
      '#E69F00',
      '#56B4E9',
      '#009E73',
      '#F0E442',
      '#0072B2',
      '#D55E00',
      '#CC79A7',
    ],
  },
  {
    id: PaletteId.SacredGold,
    name: 'Sacred Temple & Gold',
    colourblindSafe: false,
    description: 'Toni caldi meditativi, oro regale, ocra e rame',
    colours: [
      '#F59E0B',
      '#D97706',
      '#B45309',
      '#E11D48',
      '#9333EA',
      '#0D9488',
      '#F8FAFC',
      '#1E293B',
    ],
  },
  {
    id: PaletteId.CyberZen,
    name: 'Cyber Zen (High Contrast)',
    colourblindSafe: true,
    description: "Elevato contrasto per visibilità all'aperto e schermi AMOLED",
    colours: [
      '#FFFFFF',
      '#38BDF8',
      '#4ADE80',
      '#F43F5E',
      '#A855F7',
      '#FACC15',
      '#FB923C',
      '#64748B',
    ],
  },
  {
    id: PaletteId.Monochrome,
    name: 'Ink & Monochrome',
    colourblindSafe: true,
    description: 'Studio calligrafico e incisione ad alto contrasto acromatico',
    colours: [
      '#0F172A',
      '#334155',
      '#64748B',
      '#94A3B8',
      '#CBD5E1',
      '#E2E8F0',
      '#F8FAFC',
      '#38BDF8',
    ],
  },
] as const;

export const STROKE_STYLE_PRESETS: readonly StrokeStylePreset[] = [
  { id: StrokeStyleId.Solid, label: 'Continuo', dash: null },
  { id: StrokeStyleId.Dashed, label: 'Tratteggiato', dash: [14, 10] },
  { id: StrokeStyleId.Dotted, label: 'Punteggiato', dash: [2, 10] },
] as const;

export function resolvePaletteById(paletteId: string): Palette {
  return PALETTES.find((p) => p.id === paletteId) ?? PALETTES[0];
}

export function resolveStrokeStylePreset(dash: readonly number[] | null): StrokeStylePreset {
  if (dash === null || dash.length === 0) {
    return STROKE_STYLE_PRESETS[0];
  }
  return dash[0] <= 4 ? STROKE_STYLE_PRESETS[2] : STROKE_STYLE_PRESETS[1];
}

export function resolveStrokeStyleById(styleId: string): StrokeStylePreset | undefined {
  return STROKE_STYLE_PRESETS.find((preset) => preset.id === styleId);
}
