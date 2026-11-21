/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure Polar Harmonics & Tessellation Generators (Zero DOM, Zero `any`).
 * Covers Rose Curves (Rhodonea), Epitrochoid (Spirograph), and Hexagonal Crown tessellations
 * emitting canonical `WedgeStroke[]` centered on `LOGICAL_CENTER`.
 */

import { LOGICAL_CENTER, MANDALA_LIMITS, POLAR_LIMITS } from '../model/constants.ts';
import {
  PolarGeneratorId,
  type Point,
  type PolarGenerationParams,
  type WedgeStroke,
} from '../model/types.ts';

export interface PolarGeneratorDescriptor {
  readonly id: PolarGeneratorId;
  readonly name: string;
  readonly description: string;
  readonly defaultNumerator: number;
  readonly defaultDenominator: number;
  readonly defaultRadius: number;
  readonly generateStrokes: (
    params: PolarGenerationParams,
    center: Point,
    idPrefix: string
  ) => WedgeStroke[];
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y !== 0) {
    const tmp = y;
    y = x % y;
    x = tmp;
  }
  return Math.max(1, x);
}

function generateRoseCurveStrokes(
  params: PolarGenerationParams,
  center: Point,
  idPrefix: string
): WedgeStroke[] {
  const num = clamp(Math.round(params.numerator), POLAR_LIMITS.minNumerator, POLAR_LIMITS.maxNumerator);
  const den = clamp(
    Math.round(params.denominator),
    POLAR_LIMITS.minDenominator,
    POLAR_LIMITS.maxDenominator
  );
  const divisor = gcd(num, den);
  const n = num / divisor;
  const d = den / divisor;
  const k = n / d;
  const totalCycles = d % 2 === 1 && n % 2 === 1 ? Math.PI * d : Math.PI * 2 * d;
  const steps = clamp(
    Math.round(params.sampleSteps),
    POLAR_LIMITS.minSampleSteps,
    POLAR_LIMITS.maxSampleSteps
  );
  const R = clamp(
    params.amplitudeRadius,
    POLAR_LIMITS.minAmplitudeRadius,
    POLAR_LIMITS.maxAmplitudeRadius
  );

  const pts: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const theta = (i / steps) * totalCycles;
    const r = R * Math.cos(k * theta);
    pts.push({
      x: Number((center.x + r * Math.cos(theta)).toFixed(2)),
      y: Number((center.y + r * Math.sin(theta)).toFixed(2)),
    });
  }

  return [
    {
      id: `${idPrefix}_rose_${n}_${d}`,
      points: pts,
      stroke: params.strokeColor,
      strokeWidth: clamp(
        params.strokeWidth,
        MANDALA_LIMITS.minStrokeWidth,
        MANDALA_LIMITS.maxStrokeWidth
      ),
      dash: params.dash ? [...params.dash] : null,
      opacity: MANDALA_LIMITS.defaultOpacity,
    },
  ];
}

function generateEpitrochoidStrokes(
  params: PolarGenerationParams,
  center: Point,
  idPrefix: string
): WedgeStroke[] {
  const num = clamp(Math.round(params.numerator), POLAR_LIMITS.minNumerator, POLAR_LIMITS.maxNumerator);
  const den = clamp(
    Math.round(params.denominator),
    POLAR_LIMITS.minDenominator,
    POLAR_LIMITS.maxDenominator
  );
  const R = clamp(
    params.amplitudeRadius,
    POLAR_LIMITS.minAmplitudeRadius,
    POLAR_LIMITS.maxAmplitudeRadius
  );
  const steps = clamp(
    Math.round(params.sampleSteps),
    POLAR_LIMITS.minSampleSteps,
    POLAR_LIMITS.maxSampleSteps
  );

  const fixedR = R * 0.56;
  const rollingR = fixedR * (den / Math.max(1, num));
  const penD = rollingR * 1.15;
  const divisor = gcd(num, den);
  const revolutions = (den / divisor) * Math.PI * 2;
  const maxRaw = fixedR + rollingR + penD;
  const normScale = maxRaw > R ? R / maxRaw : 1;

  const pts: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * revolutions;
    const ratio = (fixedR + rollingR) / Math.max(0.01, rollingR);
    const rawX = (fixedR + rollingR) * Math.cos(t) - penD * Math.cos(ratio * t);
    const rawY = (fixedR + rollingR) * Math.sin(t) - penD * Math.sin(ratio * t);
    pts.push({
      x: Number((center.x + rawX * normScale).toFixed(2)),
      y: Number((center.y + rawY * normScale).toFixed(2)),
    });
  }

  return [
    {
      id: `${idPrefix}_epitrochoid_${num}_${den}`,
      points: pts,
      stroke: params.strokeColor,
      strokeWidth: clamp(
        params.strokeWidth,
        MANDALA_LIMITS.minStrokeWidth,
        MANDALA_LIMITS.maxStrokeWidth
      ),
      dash: params.dash ? [...params.dash] : null,
      opacity: MANDALA_LIMITS.defaultOpacity,
    },
  ];
}

function generateHexagonalCrownStrokes(
  params: PolarGenerationParams,
  center: Point,
  idPrefix: string
): WedgeStroke[] {
  const R = clamp(
    params.amplitudeRadius,
    POLAR_LIMITS.minAmplitudeRadius,
    POLAR_LIMITS.maxAmplitudeRadius
  );
  const layers = clamp(
    Math.round(params.denominator),
    POLAR_LIMITS.minHexLayers,
    POLAR_LIMITS.maxHexLayers
  );
  const petals = clamp(Math.round(params.numerator), 4, 12);
  const strokes: WedgeStroke[] = [];
  const strokeWidth = clamp(
    params.strokeWidth,
    MANDALA_LIMITS.minStrokeWidth,
    MANDALA_LIMITS.maxStrokeWidth
  );

  for (let layer = 1; layer <= layers; layer++) {
    const layerR = (R * layer) / layers;
    const phase = (layer % 2) * (Math.PI / petals);
    const pts: Point[] = [];
    for (let i = 0; i <= petals; i++) {
      const theta = phase + (i / petals) * Math.PI * 2;
      pts.push({
        x: Number((center.x + layerR * Math.cos(theta)).toFixed(2)),
        y: Number((center.y + layerR * Math.sin(theta)).toFixed(2)),
      });
    }
    strokes.push({
      id: `${idPrefix}_crown_${layer}`,
      points: pts,
      stroke: params.strokeColor,
      strokeWidth,
      dash: params.dash ? [...params.dash] : null,
      opacity: MANDALA_LIMITS.defaultOpacity,
    });
  }

  return strokes;
}

export const POLAR_GENERATOR_REGISTRY: Readonly<Record<PolarGeneratorId, PolarGeneratorDescriptor>> =
  {
    [PolarGeneratorId.RoseCurve]: {
      id: PolarGeneratorId.RoseCurve,
      name: 'Rodonea (Rosa Polare)',
      description: 'Petali armonici continui r = R·cos(n/d·θ).',
      defaultNumerator: 5,
      defaultDenominator: 3,
      defaultRadius: 230,
      generateStrokes: generateRoseCurveStrokes,
    },
    [PolarGeneratorId.Epitrochoid]: {
      id: PolarGeneratorId.Epitrochoid,
      name: 'Epitrocoide (Spirograph)',
      description: 'Intrecci ciclici di ruota orbitante.',
      defaultNumerator: 7,
      defaultDenominator: 3,
      defaultRadius: 240,
      generateStrokes: generateEpitrochoidStrokes,
    },
    [PolarGeneratorId.HexagonalCrown]: {
      id: PolarGeneratorId.HexagonalCrown,
      name: 'Corona Poligonale',
      description: 'Corone poligonali sfasate a strati.',
      defaultNumerator: 6,
      defaultDenominator: 4,
      defaultRadius: 250,
      generateStrokes: generateHexagonalCrownStrokes,
    },
  };

export const POLAR_GENERATOR_LIST: readonly PolarGeneratorDescriptor[] = Object.values(
  POLAR_GENERATOR_REGISTRY
);

export function resolvePolarGenerator(id: PolarGeneratorId): PolarGeneratorDescriptor {
  return POLAR_GENERATOR_REGISTRY[id] ?? POLAR_GENERATOR_REGISTRY[PolarGeneratorId.RoseCurve];
}

export function generatePolarHarmonicStrokes(
  params: PolarGenerationParams,
  center: Point = LOGICAL_CENTER,
  idPrefix: string = `polar_${Date.now()}`
): WedgeStroke[] {
  const descriptor = resolvePolarGenerator(params.generatorId);
  return descriptor.generateStrokes(params, center, idPrefix);
}
