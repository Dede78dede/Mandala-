/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Resolution-Independent Vector SVG Serializer (MANDALA-PH2 §4.3.2 & PH6 §5.3).
 * Emits centred viewBox (-W/2 -H/2 W H), supports single-point dots,
 * and benchmarks <path> absolute coordinates vs <defs>/<use> instancing.
 */

import {
  CANVAS_THEME,
  LOGICAL_CANVAS_SIZE,
  LOGICAL_CENTER,
  SVG_ANIMATION_LIMITS,
  SVG_DEFAULT_EXPORT_SIZE,
} from '../model/constants.ts';
import {
  SvgAnimationMode,
  SvgSerializationMode,
  SymmetryStrategyKind,
  type SvgExportReport,
  type SvgPathDrawingConfig,
  type SymmetryParams,
  type WedgeStroke,
} from '../model/types.ts';
import { JsGeometryEngine } from '../engine/geometryEngine.ts';
import { partitionWedgesIntoRadialBands } from './kineticMandala.ts';

export const DEFAULT_SVG_PATH_DRAWING_CONFIG: SvgPathDrawingConfig = {
  cycleDurationSec: SVG_ANIMATION_LIMITS.defaultCycleDurationSec,
  staggerDelayMs: SVG_ANIMATION_LIMITS.defaultStaggerDelayMs,
  loop: false,
};

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function resolveSvgAnimationMode(modeOrBool: SvgAnimationMode | boolean): SvgAnimationMode {
  if (typeof modeOrBool === 'boolean') {
    return modeOrBool ? SvgAnimationMode.ConcentricRings : SvgAnimationMode.None;
  }
  return modeOrBool;
}

function buildStrokeSvgPrimitive(
  s: WedgeStroke,
  scaleX: number,
  scaleY: number,
  strokeScale: number,
  centered: boolean,
  idAttr?: string,
  pathDrawingDelayMs?: number
): string {
  if (s.points.length === 0) return '';
  const cxOffset = centered ? LOGICAL_CENTER.x : 0;
  const cyOffset = centered ? LOGICAL_CENTER.y : 0;
  const idPart = idAttr ? ` id="${idAttr}"` : '';
  const isPathDraw = pathDrawingDelayMs !== undefined;
  const delayAttr = isPathDraw ? ` style="animation-delay: ${pathDrawingDelayMs}ms"` : '';

  if (s.points.length === 1) {
    const cx = ((s.points[0].x - cxOffset) * scaleX).toFixed(2);
    const cy = ((s.points[0].y - cyOffset) * scaleY).toFixed(2);
    const r = Math.max(1, (s.strokeWidth * strokeScale) / 2).toFixed(2);
    const classPart = isPathDraw ? ` class="mandala-draw-dot"` : '';
    return `    <circle${idPart}${classPart} cx="${cx}" cy="${cy}" r="${r}" fill="${s.stroke}" opacity="${s.opacity}"${delayAttr} />`;
  }

  const d = s.points
    .map((p, idx) => {
      const px = ((p.x - cxOffset) * scaleX).toFixed(2);
      const py = ((p.y - cyOffset) * scaleY).toFixed(2);
      return `${idx === 0 ? 'M' : 'L'} ${px} ${py}`;
    })
    .join(' ');
  const dashAttr =
    !isPathDraw && s.dash
      ? ` stroke-dasharray="${s.dash.map((v) => (v * strokeScale).toFixed(2)).join(',')}"`
      : '';
  const pathLengthPart = isPathDraw ? ` pathLength="1" class="mandala-draw-path"` : '';
  return `    <path${idPart}${pathLengthPart} d="${d}" fill="none" stroke="${s.stroke}" stroke-width="${(s.strokeWidth * strokeScale).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round" opacity="${s.opacity}"${dashAttr}${delayAttr} />`;
}

const KINETIC_SVG_STYLE_BLOCK = `  <style>
    .mandala-ring-0, .mandala-ring-1, .mandala-ring-2 { transform-origin: 0px 0px; }
    @media (prefers-reduced-motion: no-preference) {
      @keyframes mandala-cw { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      @keyframes mandala-ccw { from { transform: rotate(360deg); } to { transform: rotate(0deg); } }
      @keyframes mandala-breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.035); } }
      .mandala-ring-0 { animation: mandala-cw 42s linear infinite; }
      .mandala-ring-1 { animation: mandala-ccw 68s linear infinite; }
      .mandala-ring-2 { animation: mandala-cw 110s linear infinite; }
      #mandala-geometry { transform-origin: 0px 0px; animation: mandala-breathe 9s ease-in-out infinite; }
    }
  </style>
`;

function buildPathDrawingStyleBlock(cfg: SvgPathDrawingConfig): string {
  const safeDuration = clamp(
    cfg.cycleDurationSec,
    SVG_ANIMATION_LIMITS.minCycleDurationSec,
    SVG_ANIMATION_LIMITS.maxCycleDurationSec
  ).toFixed(2);
  const iterationMode = cfg.loop ? 'infinite alternate' : 'both';
  return `  <style>
    @media (prefers-reduced-motion: no-preference) {
      @keyframes mandala-draw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
      @keyframes mandala-dot-in { from { opacity: 0; } to { opacity: 1; } }
      .mandala-draw-path {
        stroke-dasharray: 1;
        stroke-dashoffset: 1;
        animation: mandala-draw ${safeDuration}s cubic-bezier(0.22, 1, 0.36, 1) ${iterationMode};
      }
      .mandala-draw-dot {
        animation: mandala-dot-in 0.45s ease-out ${iterationMode};
      }
    }
  </style>
`;
}

function wrapSvg(
  body: string,
  width: number,
  height: number,
  backgroundColor: string,
  defsBlock?: string,
  extraStyleBlock: string = ''
): string {
  const vx = -(width / 2);
  const vy = -(height / 2);
  const bgRect =
    backgroundColor !== CANVAS_THEME.transparentBackground
      ? `  <rect x="${vx}" y="${vy}" width="${width}" height="${height}" fill="${backgroundColor}" />\n`
      : '';
  const defs = defsBlock ? `  <defs>\n${defsBlock}\n  </defs>\n` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${width} ${height}" width="${width}" height="${height}">
${extraStyleBlock}${defs}${bgRect}  <g id="mandala-geometry">
${body}
  </g>
</svg>`;
}

export function exportToSVGBenchmarked(
  wedges: readonly WedgeStroke[],
  symmetryParams: SymmetryParams,
  width: number = SVG_DEFAULT_EXPORT_SIZE,
  height: number = SVG_DEFAULT_EXPORT_SIZE,
  backgroundColor: string = CANVAS_THEME.backgroundHex,
  preference: SvgSerializationMode = SvgSerializationMode.Auto,
  worldSpan: number = LOGICAL_CANVAS_SIZE,
  animationModeInput: SvgAnimationMode | boolean = SvgAnimationMode.None,
  pathDrawingConfig: Partial<SvgPathDrawingConfig> = {}
): SvgExportReport {
  const safeSpan = Math.max(LOGICAL_CANVAS_SIZE, worldSpan);
  const scaleX = width / safeSpan;
  const scaleY = height / safeSpan;
  const strokeScale = Math.min(scaleX, scaleY);
  const animMode = resolveSvgAnimationMode(animationModeInput);

  if (animMode === SvgAnimationMode.ConcentricRings) {
    const expandedRes = JsGeometryEngine.expandScene(wedges, symmetryParams, LOGICAL_CENTER);
    const expanded = expandedRes.ok ? expandedRes.value : [];
    const bands = partitionWedgesIntoRadialBands(expanded, LOGICAL_CENTER);
    const bandGroups = bands
      .map((band) => {
        const prims = band.strokes
          .map((s) => buildStrokeSvgPrimitive(s, scaleX, scaleY, strokeScale, true))
          .filter(Boolean)
          .join('\n');
        return `    <g class="mandala-ring-${band.bandIndex}">\n${prims}\n    </g>`;
      })
      .join('\n');
    const animatedSvg = wrapSvg(
      bandGroups,
      width,
      height,
      backgroundColor,
      undefined,
      KINETIC_SVG_STYLE_BLOCK
    );
    const animatedBytes = byteLength(animatedSvg);
    return {
      svg: animatedSvg,
      modeUsed: SvgSerializationMode.Absolute,
      absoluteBytes: animatedBytes,
      defsUseBytes: null,
      selectedBytes: animatedBytes,
    };
  }

  if (animMode === SvgAnimationMode.PathDrawing) {
    const mergedCfg: SvgPathDrawingConfig = {
      cycleDurationSec: clamp(
        pathDrawingConfig.cycleDurationSec ?? DEFAULT_SVG_PATH_DRAWING_CONFIG.cycleDurationSec,
        SVG_ANIMATION_LIMITS.minCycleDurationSec,
        SVG_ANIMATION_LIMITS.maxCycleDurationSec
      ),
      staggerDelayMs: Math.round(
        clamp(
          pathDrawingConfig.staggerDelayMs ?? DEFAULT_SVG_PATH_DRAWING_CONFIG.staggerDelayMs,
          SVG_ANIMATION_LIMITS.minStaggerDelayMs,
          SVG_ANIMATION_LIMITS.maxStaggerDelayMs
        )
      ),
      loop: Boolean(pathDrawingConfig.loop),
    };
    const expandedRes = JsGeometryEngine.expandScene(wedges, symmetryParams, LOGICAL_CENTER);
    const expanded = expandedRes.ok ? expandedRes.value : [];
    const staggeredPrimitives = expanded
      .map((s, idx) => {
        const effectiveSlot = Math.min(idx, 96);
        const delayMs = effectiveSlot * mergedCfg.staggerDelayMs;
        return buildStrokeSvgPrimitive(
          s,
          scaleX,
          scaleY,
          strokeScale,
          true,
          undefined,
          delayMs
        );
      })
      .filter(Boolean)
      .join('\n');
    const pathDrawingSvg = wrapSvg(
      staggeredPrimitives,
      width,
      height,
      backgroundColor,
      undefined,
      buildPathDrawingStyleBlock(mergedCfg)
    );
    const drawingBytes = byteLength(pathDrawingSvg);
    return {
      svg: pathDrawingSvg,
      modeUsed: SvgSerializationMode.Absolute,
      absoluteBytes: drawingBytes,
      defsUseBytes: null,
      selectedBytes: drawingBytes,
    };
  }

  // (a) Absolute-coordinate expanded geometry
  const expandedRes = JsGeometryEngine.expandScene(wedges, symmetryParams, LOGICAL_CENTER);
  const expanded = expandedRes.ok ? expandedRes.value : [];

  const absolutePrimitives = expanded
    .map((s) => buildStrokeSvgPrimitive(s, scaleX, scaleY, strokeScale, true))
    .filter(Boolean)
    .join('\n');

  const absoluteSvg = wrapSvg(absolutePrimitives, width, height, backgroundColor);
  const absoluteBytes = byteLength(absoluteSvg);

  // (b) Compact <defs>/<use> instancing for pure rotational radial symmetry
  let defsUseSvg: string | null = null;
  let defsUseBytes: number | null = null;

  if (
    symmetryParams.strategyId === SymmetryStrategyKind.Radial ||
    symmetryParams.strategyId === SymmetryStrategyKind.Fractal
  ) {
    const order = symmetryParams.order;
    const defsLines: string[] = [];
    const useLines: string[] = [];
    const stepDeg = 360 / order;

    wedges.forEach((w, idx) => {
      const defId = `w${idx}`;
      const defPrim = buildStrokeSvgPrimitive(w, scaleX, scaleY, strokeScale, true, defId);
      if (!defPrim) return;
      defsLines.push(defPrim);
      for (let i = 0; i < order; i++) {
        const deg = (i * stepDeg).toFixed(2);
        if (i === 0) {
          useLines.push(`    <use href="#${defId}" />`);
        } else {
          useLines.push(`    <use href="#${defId}" transform="rotate(${deg})" />`);
        }
      }
    });

    defsUseSvg = wrapSvg(
      useLines.join('\n'),
      width,
      height,
      backgroundColor,
      defsLines.join('\n')
    );
    defsUseBytes = byteLength(defsUseSvg);
  }

  if (
    preference === SvgSerializationMode.Absolute ||
    defsUseSvg === null ||
    defsUseBytes === null
  ) {
    return {
      svg: absoluteSvg,
      modeUsed: SvgSerializationMode.Absolute,
      absoluteBytes,
      defsUseBytes,
      selectedBytes: absoluteBytes,
    };
  }

  if (preference === SvgSerializationMode.DefsUse || defsUseBytes < absoluteBytes) {
    return {
      svg: defsUseSvg,
      modeUsed: SvgSerializationMode.DefsUse,
      absoluteBytes,
      defsUseBytes,
      selectedBytes: defsUseBytes,
    };
  }

  return {
    svg: absoluteSvg,
    modeUsed: SvgSerializationMode.Absolute,
    absoluteBytes,
    defsUseBytes,
    selectedBytes: absoluteBytes,
  };
}

export function exportToSVG(
  wedges: readonly WedgeStroke[],
  symmetryParams: SymmetryParams,
  width: number = SVG_DEFAULT_EXPORT_SIZE,
  height: number = SVG_DEFAULT_EXPORT_SIZE,
  backgroundColor: string = CANVAS_THEME.backgroundHex
): string {
  return exportToSVGBenchmarked(
    wedges,
    symmetryParams,
    width,
    height,
    backgroundColor,
    SvgSerializationMode.Auto
  ).svg;
}
