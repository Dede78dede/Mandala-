/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 4 Accessibility Helpers (MANDALA-PH4 §3.2.A–C):
 * - Throttled (500ms) synchronization of parametric canvas mirror during active strokes
 * - Pre-composed debounced announcement messages for crosshair, fractal parameters, and exports
 */

import { useEffect, useRef, useState } from 'react';
import { LOGICAL_CENTER, MANDALA_LIMITS } from '../model/constants.ts';
import { ExportFormat, type Point } from '../model/types.ts';
import { assertNever } from '../../../shared/lib/result.ts';

export function formatCrosshairAnnouncement(pt: Point, isEraser: boolean): string {
  const dx = pt.x - LOGICAL_CENTER.x;
  const dy = pt.y - LOGICAL_CENTER.y;
  const radius = Math.round(Math.hypot(dx, dy));
  const prefix = isEraser ? 'Cursore gomma' : 'Cursore';
  return `${prefix} a X ${Math.round(pt.x)}, Y ${Math.round(pt.y)}, raggio ${radius}px.`;
}

export function formatExportAnnouncement(format: ExportFormat, detail: string): string {
  switch (format) {
    case ExportFormat.Png:
      return `Esportazione immagine PNG completata: ${detail}.`;
    case ExportFormat.Svg:
      return `Esportazione vettoriale SVG completata: ${detail}.`;
    case ExportFormat.Json:
      return `Salvataggio documento JSON v1 completato: ${detail}.`;
    default:
      return assertNever(format);
  }
}

export function formatFractalParamsAnnouncement(
  presetName: string,
  generations: number,
  angle: number,
  stepLength: number
): string {
  const warning = generations >= MANDALA_LIMITS.fractalPerfWarningGenerations ? ' Avviso carico CPU elevato.' : '';
  return `Parametri frattale ${presetName}: ${generations} generazioni, angolo ${angle}°, passo ${stepLength}px.${warning}`;
}

/**
 * Synchronizes the parametric fallback mirror adjacent to the canvas (`aria-live="off"`),
 * throttling updates to 500ms during active high-frequency drawing and flushing immediately
 * upon commit or control changes.
 */
export function useThrottledParametricMirror(description: string, isDrawing: boolean): string {
  const [mirrored, setMirrored] = useState<string>(description);
  const lastFlushRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestDescRef = useRef<string>(description);
  latestDescRef.current = description;

  useEffect(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (!isDrawing) {
      lastFlushRef.current = Date.now();
      setMirrored(description);
      return;
    }

    const now = Date.now();
    const elapsed = now - lastFlushRef.current;
    if (elapsed >= MANDALA_LIMITS.parametricMirrorThrottleMs) {
      lastFlushRef.current = now;
      setMirrored(description);
      return;
    }

    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      lastFlushRef.current = Date.now();
      setMirrored(latestDescRef.current);
    }, MANDALA_LIMITS.parametricMirrorThrottleMs - elapsed);

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [description, isDrawing]);

  return mirrored;
}
