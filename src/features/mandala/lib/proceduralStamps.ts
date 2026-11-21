/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure Botanical Stamps & Organic Archetypes Generator (Zero DOM, Zero `any`).
 * Inspired by Julala/Plantala vector petals and Blobs harmonic contours.
 * Emits canonical `WedgeStroke[]` usable both for live Layer 2 preview and atomic commits.
 */

import { LOGICAL_CENTER, MANDALA_LIMITS, STAMP_LIMITS } from '../model/constants.ts';
import {
  StampArchetypeId,
  type Point,
  type StampPlacementParams,
  type WedgeStroke,
} from '../model/types.ts';

export interface StampArchetypeDescriptor {
  readonly id: StampArchetypeId;
  readonly label: string;
  readonly description: string;
  readonly generateLocalPolylines: (radius: number) => readonly Point[][];
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function evalCubicBezier(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  return {
    x: mt2 * mt * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t2 * t * p3.x,
    y: mt2 * mt * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t2 * t * p3.y,
  };
}

function buildTeardropPetalPolyline(radius: number, halfWidthRatio: number, samples: number): Point[] {
  const base: Point = { x: 0, y: 0 };
  const tip: Point = { x: radius, y: 0 };
  const ctrlOut1: Point = { x: radius * 0.34, y: -radius * halfWidthRatio };
  const ctrlOut2: Point = { x: radius * 0.78, y: -radius * halfWidthRatio * 0.62 };
  const ctrlIn1: Point = { x: radius * 0.78, y: radius * halfWidthRatio * 0.62 };
  const ctrlIn2: Point = { x: radius * 0.34, y: radius * halfWidthRatio };

  const half = Math.max(8, Math.floor(samples / 2));
  const points: Point[] = [];
  for (let i = 0; i <= half; i++) {
    points.push(evalCubicBezier(base, ctrlOut1, ctrlOut2, tip, i / half));
  }
  for (let i = 1; i <= half; i++) {
    points.push(evalCubicBezier(tip, ctrlIn1, ctrlIn2, base, i / half));
  }
  return points;
}

function generatePetalLocal(radius: number): readonly Point[][] {
  return [buildTeardropPetalPolyline(radius, 0.44, STAMP_LIMITS.petalSampleCount)];
}

function generateMultiLotusLocal(radius: number): readonly Point[][] {
  const outer = buildTeardropPetalPolyline(radius, 0.48, STAMP_LIMITS.petalSampleCount);
  const mid = buildTeardropPetalPolyline(radius * 0.72, 0.34, STAMP_LIMITS.petalSampleCount - 4);
  const inner = buildTeardropPetalPolyline(radius * 0.44, 0.24, STAMP_LIMITS.petalSampleCount - 8);
  return [outer, mid, inner];
}

function generateOrganicBlobLocal(radius: number): readonly Point[][] {
  const steps = STAMP_LIMITS.blobHarmonicCount;
  const centerX = radius * 0.46;
  const baseR = radius * 0.42;
  const pts: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const theta = (i / steps) * Math.PI * 2;
    const modulation = 1 + 0.18 * Math.cos(3 * theta) + 0.09 * Math.sin(5 * theta);
    const rr = baseR * modulation;
    pts.push({
      x: centerX + rr * Math.cos(theta),
      y: rr * Math.sin(theta),
    });
  }
  return [pts];
}

function generateStarburstLocal(radius: number): readonly Point[][] {
  const spikes = STAMP_LIMITS.starburstTipDefault;
  const centerX = radius * 0.48;
  const outerR = radius * 0.48;
  const innerR = outerR * 0.42;
  const pts: Point[] = [];
  const totalVertices = spikes * 2;
  for (let i = 0; i <= totalVertices; i++) {
    const theta = (i / totalVertices) * Math.PI * 2;
    const r = i % 2 === 0 ? outerR : innerR;
    pts.push({
      x: centerX + r * Math.cos(theta),
      y: r * Math.sin(theta),
    });
  }
  return [pts];
}

export const STAMP_ARCHETYPE_REGISTRY: Readonly<Record<StampArchetypeId, StampArchetypeDescriptor>> = {
  [StampArchetypeId.Petal]: {
    id: StampArchetypeId.Petal,
    label: 'Petalo',
    description: 'Petalo botanico slanciato con curvatura di Bezier.',
    generateLocalPolylines: generatePetalLocal,
  },
  [StampArchetypeId.MultiLotus]: {
    id: StampArchetypeId.MultiLotus,
    label: 'Loto',
    description: 'Tre corone concentriche di petali di loto sacri.',
    generateLocalPolylines: generateMultiLotusLocal,
  },
  [StampArchetypeId.OrganicBlob]: {
    id: StampArchetypeId.OrganicBlob,
    label: 'Blob',
    description: 'Forma organica fluida generata da armoniche polari.',
    generateLocalPolylines: generateOrganicBlobLocal,
  },
  [StampArchetypeId.Starburst]: {
    id: StampArchetypeId.Starburst,
    label: 'Stella',
    description: 'Astro geometrico radiante a 8 punte nitide.',
    generateLocalPolylines: generateStarburstLocal,
  },
};

export const STAMP_ARCHETYPE_LIST: readonly StampArchetypeDescriptor[] = Object.values(
  STAMP_ARCHETYPE_REGISTRY
);

export function resolveStampArchetype(id: StampArchetypeId): StampArchetypeDescriptor {
  return STAMP_ARCHETYPE_REGISTRY[id] ?? STAMP_ARCHETYPE_REGISTRY[StampArchetypeId.Petal];
}

/**
 * Computes deterministic orientation & radius for pointer tap or drag placement.
 * A simple tap (or tiny drag) aims radially outward from mandala `center`.
 */
export function computeStampPlacementVector(
  anchor: Point,
  target: Point | null,
  scaleMultiplier: number = STAMP_LIMITS.defaultScale,
  center: Point = LOGICAL_CENTER
): { readonly radius: number; readonly angleRad: number } {
  const safeScale = clamp(scaleMultiplier, STAMP_LIMITS.minScale, STAMP_LIMITS.maxScale);
  if (target) {
    const dx = target.x - anchor.x;
    const dy = target.y - anchor.y;
    const dragDist = Math.hypot(dx, dy);
    if (dragDist >= 8) {
      return {
        radius: clamp(dragDist * safeScale, STAMP_LIMITS.minRadius, STAMP_LIMITS.maxRadius),
        angleRad: Math.atan2(dy, dx),
      };
    }
  }

  const radialDx = anchor.x - center.x;
  const radialDy = anchor.y - center.y;
  const radialAngle =
    Math.hypot(radialDx, radialDy) > 1e-3 ? Math.atan2(radialDy, radialDx) : -Math.PI / 2;

  return {
    radius: clamp(
      STAMP_LIMITS.defaultRadius * safeScale,
      STAMP_LIMITS.minRadius,
      STAMP_LIMITS.maxRadius
    ),
    angleRad: radialAngle,
  };
}

/**
 * Generates canonical `WedgeStroke[]` placed at `params.anchor` rotated by `params.angleRad`.
 */
export function generateBotanicalStampStrokes(
  params: StampPlacementParams,
  idPrefix: string = `stamp_${Date.now()}`
): WedgeStroke[] {
  const descriptor = resolveStampArchetype(params.archetype);
  const safeRadius = clamp(params.radius, STAMP_LIMITS.minRadius, STAMP_LIMITS.maxRadius);
  const cos = Math.cos(params.angleRad);
  const sin = Math.sin(params.angleRad);
  const localPolylines = descriptor.generateLocalPolylines(safeRadius);

  return localPolylines.map((poly, idx) => ({
    id: `${idPrefix}_${params.archetype}_${idx}`,
    points: poly.map((pt) => ({
      x: Number((params.anchor.x + pt.x * cos - pt.y * sin).toFixed(2)),
      y: Number((params.anchor.y + pt.x * sin + pt.y * cos).toFixed(2)),
    })),
    stroke: params.strokeColor,
    strokeWidth: clamp(
      params.strokeWidth,
      MANDALA_LIMITS.minStrokeWidth,
      MANDALA_LIMITS.maxStrokeWidth
    ),
    dash: params.dash ? [...params.dash] : null,
    opacity: MANDALA_LIMITS.defaultOpacity,
  }));
}
