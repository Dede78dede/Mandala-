/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure L-System Grammar Expander & Turtle Graphics Interpreter (MANDALA-PH4 §2.1.B).
 */

import { MANDALA_LIMITS } from '../model/constants.ts';
import { LSystemPresetId, type Point } from '../model/types.ts';

export interface LSystemPreset {
  id: LSystemPresetId;
  name: string;
  description: string;
  axiom: string;
  rules: Readonly<Record<string, string>>;
  defaultAngle: number;
  defaultGenerations: number;
  defaultStep: number;
}

export const L_SYSTEM_PRESETS: Readonly<Record<LSystemPresetId, LSystemPreset>> = {
  [LSystemPresetId.SacredFlower]: {
    id: LSystemPresetId.SacredFlower,
    name: 'Sacred Blossom',
    description: 'Struttura radiale floreale armoniosa a petali sovrapposti',
    axiom: 'F',
    rules: { F: 'F[+F]F[-F][F]' },
    defaultAngle: 36,
    defaultGenerations: 3,
    defaultStep: 22,
  },
  [LSystemPresetId.KochSnowflake]: {
    id: LSystemPresetId.KochSnowflake,
    name: 'Koch Geometry',
    description: 'Classica simmetria frattale a fiocco di neve auto-similare',
    axiom: 'F',
    rules: { F: 'F+F-F-F+F' },
    defaultAngle: 90,
    defaultGenerations: 3,
    defaultStep: 16,
  },
  [LSystemPresetId.SierpinskiArrowhead]: {
    id: LSystemPresetId.SierpinskiArrowhead,
    name: 'Sierpinski Lattice',
    description: 'Reticolo cristallino sacro triangolare',
    axiom: 'A',
    rules: { A: 'B-A-B', B: 'A+B+A' },
    defaultAngle: 60,
    defaultGenerations: 4,
    defaultStep: 14,
  },
  [LSystemPresetId.DragonCurve]: {
    id: LSystemPresetId.DragonCurve,
    name: 'Dragon Vortex',
    description: 'Spirale ricorsiva piegata a 90°',
    axiom: 'FX',
    rules: { X: 'X+YF+', Y: '-FX-Y' },
    defaultAngle: 90,
    defaultGenerations: 5,
    defaultStep: 12,
  },
};

export function resolveLSystemPreset(presetId: string): LSystemPreset {
  return (
    Object.values(L_SYSTEM_PRESETS).find((p) => p.id === presetId) ??
    L_SYSTEM_PRESETS[LSystemPresetId.SacredFlower]
  );
}

export interface LSystemComplexityEstimate {
  readonly instructionLength: number;
  readonly moveSegments: number;
  readonly breakCount: number;
  readonly estimatedPolylines: number;
}

/**
 * Estimates L-System grammar size, turtle segments, and polyline count in O(generations * alphabet)
 * with zero allocations so workload guards can reject excessive fractals pre-flight.
 */
export function estimateLSystemComplexity(
  axiom: string,
  rules: Readonly<Record<string, string>>,
  generations: number
): LSystemComplexityEstimate {
  let counts = new Map<string, number>();
  for (let i = 0; i < axiom.length; i++) {
    const ch = axiom[i];
    if (!ch) continue;
    counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }

  const safeGen = Math.min(Math.max(1, generations), MANDALA_LIMITS.lSystemCapGenerations);
  for (let g = 0; g < safeGen; g++) {
    const next = new Map<string, number>();
    for (const [ch, cnt] of counts.entries()) {
      const repl = rules[ch] ?? ch;
      for (let k = 0; k < repl.length; k++) {
        const rc = repl[k];
        if (!rc) continue;
        next.set(rc, (next.get(rc) ?? 0) + cnt);
      }
    }
    counts = next;
  }

  let instructionLength = 0;
  let moveSegments = 0;
  let breakCount = 0;
  for (const [ch, cnt] of counts.entries()) {
    instructionLength += cnt;
    if (ch === 'F' || ch === 'A' || ch === 'B' || ch === 'G') {
      moveSegments += cnt;
    } else if (ch === 'f') {
      moveSegments += cnt;
      breakCount += cnt;
    } else if (ch === ']') {
      breakCount += cnt;
    }
  }

  return {
    instructionLength,
    moveSegments,
    breakCount,
    estimatedPolylines: Math.max(1, breakCount + 1),
  };
}

export function expandLSystem(
  axiom: string,
  rules: Readonly<Record<string, string>>,
  generations: number
): string {
  let current = axiom;
  const safeGen = Math.min(Math.max(1, generations), MANDALA_LIMITS.lSystemCapGenerations);
  for (let g = 0; g < safeGen; g++) {
    let next = '';
    for (let i = 0; i < current.length; i++) {
      const char = current[i];
      if (!char) continue;
      next += rules[char] ?? char;
    }
    current = next;
  }
  return current;
}

export function interpretTurtle(
  instructions: string,
  stepLength: number,
  angleDegrees: number,
  start: Point
): Point[][] {
  const polylines: Point[][] = [];
  let currentPolyline: Point[] = [{ x: start.x, y: start.y }];
  const radAngle = (angleDegrees * Math.PI) / 180;

  let x = start.x;
  let y = start.y;
  let angle = -Math.PI / 2;
  const stack: Array<{ x: number; y: number; angle: number }> = [];

  for (let i = 0; i < instructions.length; i++) {
    const cmd = instructions[i];
    if (cmd === 'F' || cmd === 'A' || cmd === 'B' || cmd === 'G') {
      x += stepLength * Math.cos(angle);
      y += stepLength * Math.sin(angle);
      currentPolyline.push({ x, y });
    } else if (cmd === 'f') {
      x += stepLength * Math.cos(angle);
      y += stepLength * Math.sin(angle);
      if (currentPolyline.length > 1) {
        polylines.push(currentPolyline);
      }
      currentPolyline = [{ x, y }];
    } else if (cmd === '+') {
      angle += radAngle;
    } else if (cmd === '-') {
      angle -= radAngle;
    } else if (cmd === '[') {
      stack.push({ x, y, angle });
    } else if (cmd === ']') {
      if (currentPolyline.length > 1) {
        polylines.push(currentPolyline);
      }
      const state = stack.pop();
      if (state) {
        x = state.x;
        y = state.y;
        angle = state.angle;
      }
      currentPolyline = [{ x, y }];
    }
  }

  if (currentPolyline.length > 1) {
    polylines.push(currentPolyline);
  }

  return polylines;
}
