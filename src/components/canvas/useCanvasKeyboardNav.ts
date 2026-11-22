/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Keyboard Cursor Navigation, Zoom Hotkeys & Accessibility Announcements for MandalaCanvas.
 */

import type React from 'react';
import { useCallback, useEffect } from 'react';
import {
  CAMERA_LIMITS,
  LOGICAL_CENTER,
} from '../../features/mandala/model/constants.ts';
import {
  KineticMode,
  ToolId,
  type Point,
} from '../../features/mandala/model/types.ts';
import { formatCrosshairAnnouncement } from '../../features/mandala/lib/accessibility.ts';
import type { TypedPointBuffer } from '../../features/mandala/memory/pointBuffer.ts';

export interface UseCanvasKeyboardNavArgs {
  readonly lensEnabled: boolean;
  readonly kineticMode: KineticMode;
  readonly zoom: number;
  readonly displaySize: number;
  readonly worldRadius: number;
  readonly activeTool: ToolId;
  readonly eraserRadius: number;
  readonly pointBufferRef: React.MutableRefObject<TypedPointBuffer>;
  readonly keyboardCursorRef: React.MutableRefObject<Point | null>;
  readonly isKeyboardModeRef: React.MutableRefObject<boolean>;
  readonly isSpaceHeldRef: React.MutableRefObject<boolean>;
  readonly stampAnchorRef: React.MutableRefObject<Point | null>;
  readonly stampTargetRef: React.MutableRefObject<Point | null>;
  readonly setZoom: (zoom: number, displaySize: number) => void;
  readonly resetViewport: () => void;
  readonly exitLensForDrawing: () => void;
  readonly exitKineticMode: () => void;
  readonly announceLiveMessage: (msg: string) => void;
  readonly eraseAtPoint: (pt: Point, radius: number) => number;
  readonly stampSinglePoint: (pt: Point) => void;
  readonly commitCurrentStamp: () => void;
  readonly commitCurrentStroke: () => void;
  readonly schedulePreviewFrame: () => void;
}

export function useCanvasKeyboardNav(args: UseCanvasKeyboardNavArgs) {
  const {
    lensEnabled,
    kineticMode,
    zoom,
    displaySize,
    worldRadius,
    activeTool,
    eraserRadius,
    pointBufferRef,
    keyboardCursorRef,
    isKeyboardModeRef,
    isSpaceHeldRef,
    stampAnchorRef,
    stampTargetRef,
    setZoom,
    resetViewport,
    exitLensForDrawing,
    exitKineticMode,
    announceLiveMessage,
    eraseAtPoint,
    stampSinglePoint,
    commitCurrentStamp,
    commitCurrentStroke,
    schedulePreviewFrame,
  } = args;

  useEffect(() => {
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        isSpaceHeldRef.current = false;
      }
    };
    window.addEventListener('keyup', onKeyUp);
    return () => window.removeEventListener('keyup', onKeyUp);
  }, [isSpaceHeldRef]);

  return useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.code === 'Space' && !isKeyboardModeRef.current && !lensEnabled) {
        isSpaceHeldRef.current = true;
      }

      if (e.key === '+' || e.key === '=') {
        setZoom(zoom * CAMERA_LIMITS.buttonZoomFactor, displaySize);
        e.preventDefault();
        return;
      }
      if (e.key === '-' || e.key === '_') {
        setZoom(zoom / CAMERA_LIMITS.buttonZoomFactor, displaySize);
        e.preventDefault();
        return;
      }
      if (e.key === '0' && (e.ctrlKey || e.metaKey)) {
        resetViewport();
        e.preventDefault();
        return;
      }

      if (lensEnabled && (e.key === 'Escape' || e.key === 'Enter')) {
        exitLensForDrawing();
        e.preventDefault();
        return;
      }

      if (kineticMode !== KineticMode.Off && (e.key === 'Escape' || e.key === 'Enter')) {
        exitKineticMode();
        e.preventDefault();
        return;
      }

      if (!isKeyboardModeRef.current) {
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
          if (lensEnabled) {
            exitLensForDrawing();
          }
          isKeyboardModeRef.current = true;
          const initialCursor: Point = { x: LOGICAL_CENTER.x, y: LOGICAL_CENTER.y };
          keyboardCursorRef.current = initialCursor;
          announceLiveMessage(
            formatCrosshairAnnouncement(initialCursor, activeTool === ToolId.Eraser)
          );
          schedulePreviewFrame();
          e.preventDefault();
          return;
        }
      }

      const cursor = keyboardCursorRef.current;
      if (!cursor) return;

      const step = (e.shiftKey ? 24 : 8) / Math.max(0.5, zoom);
      const minBound = LOGICAL_CENTER.x - worldRadius;
      const maxBound = LOGICAL_CENTER.x + worldRadius;
      let nextX = cursor.x;
      let nextY = cursor.y;

      if (e.key === 'ArrowUp') nextY = Math.max(minBound, nextY - step);
      else if (e.key === 'ArrowDown') nextY = Math.min(maxBound, nextY + step);
      else if (e.key === 'ArrowLeft') nextX = Math.max(minBound, nextX - step);
      else if (e.key === 'ArrowRight') nextX = Math.min(maxBound, nextX + step);
      else if (e.key === 'Enter') {
        if (activeTool === ToolId.Point) {
          stampSinglePoint({ x: nextX, y: nextY, pressure: 0.5 });
        } else if (activeTool === ToolId.Stamp) {
          stampAnchorRef.current = { x: nextX, y: nextY };
          stampTargetRef.current = null;
          commitCurrentStamp();
        } else if (activeTool === ToolId.Eraser) {
          eraseAtPoint({ x: nextX, y: nextY }, eraserRadius);
        } else {
          pointBufferRef.current.push(nextX, nextY, 0.5);
          announceLiveMessage(
            `Nodo aggiunto al tratto a X ${Math.round(nextX)}, Y ${Math.round(nextY)}.`
          );
          schedulePreviewFrame();
        }
        e.preventDefault();
        return;
      } else if (e.key === ' ') {
        commitCurrentStroke();
        e.preventDefault();
        return;
      } else if (e.key === 'Escape') {
        pointBufferRef.current.reset();
        isKeyboardModeRef.current = false;
        announceLiveMessage('Modalità cursore tastiera chiusa.');
        schedulePreviewFrame();
        e.preventDefault();
        return;
      }

      const movedCursor: Point = { x: nextX, y: nextY };
      keyboardCursorRef.current = movedCursor;
      announceLiveMessage(
        formatCrosshairAnnouncement(movedCursor, activeTool === ToolId.Eraser)
      );
      schedulePreviewFrame();
      e.preventDefault();
    },
    [
      lensEnabled,
      kineticMode,
      zoom,
      displaySize,
      worldRadius,
      activeTool,
      eraserRadius,
      pointBufferRef,
      keyboardCursorRef,
      isKeyboardModeRef,
      isSpaceHeldRef,
      stampAnchorRef,
      stampTargetRef,
      setZoom,
      resetViewport,
      exitLensForDrawing,
      exitKineticMode,
      announceLiveMessage,
      eraseAtPoint,
      stampSinglePoint,
      commitCurrentStamp,
      commitCurrentStroke,
      schedulePreviewFrame,
    ]
  );
}
