/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase A + WebGL2 Hemispherical Lens Integrated Mandala Canvas:
 * Modular orchestrator delegating guides, render pipeline, keyboard nav, and pointer FSM.
 */

import React, { lazy, Suspense, useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { Pencil, AlertCircle } from 'lucide-react';
import { registerBufferReclaimer } from '../shared/lib/cacheService.ts';
import {
  safelyAcquirePointerCapture,
  safelyReleasePointerCapture,
} from '../shared/lib/contextManager.ts';
import {
  CAMERA_LIMITS,
  CANVAS_THEME,
  LENS_LIMITS,
  LOGICAL_CENTER,
  MANDALA_LIMITS,
  MORPH_LIMITS,
  POLAR_LIMITS,
  RESOURCE_GUARD_LIMITS,
} from '../features/mandala/model/constants.ts';
import {
  KineticMode,
  MorphTargetKind,
  ToolId,
  type Point,
  type WedgeStroke,
} from '../features/mandala/model/types.ts';
import {
  useMandalaStore,
  buildParametricDescription,
} from '../features/mandala/model/store.ts';
import { useThrottledParametricMirror } from '../features/mandala/lib/accessibility.ts';
import { assessSceneComputeProfile } from '../features/mandala/engine/geometryEngine.ts';
import { computeEraserRadius } from '../features/mandala/lib/canvasRenderer.ts';
import {
  computeStampPlacementVector,
  generateBotanicalStampStrokes,
  resolveStampArchetype,
} from '../features/mandala/lib/proceduralStamps.ts';
import {
  generatePolarHarmonicStrokes,
  resolvePolarGenerator,
} from '../features/mandala/lib/polarGenerators.ts';
import { TypedPointBuffer } from '../features/mandala/memory/pointBuffer.ts';
import {
  computeWorldMinDistSq,
  screenToWorldPoint,
} from '../features/mandala/lib/viewportCamera.ts';
import { prepareMorphPlan } from '../features/mandala/lib/morphInterpolator.ts';
import { STRATEGY_REGISTRY } from '../features/mandala/strategies/symmetry.ts';
import { getResourceHealthSnapshot } from '../features/mandala/lib/resourceGuard.ts';
import { useMotionLifecycle } from '../shared/lib/motionLifecycle.ts';
import type { LensCompositorInstance } from '../features/mandala/lib/lensWebglPass.ts';
import {
  CanvasInteractionMode,
  computePinchMetrics,
  resolvePointerDownMode,
} from '../features/mandala/lib/canvasPointerFsm.ts';
import { MandalaGuides } from './canvas/MandalaGuides.tsx';
import { useCanvasRenderPipeline } from './canvas/useCanvasRenderPipeline.ts';
import { useCanvasKeyboardNav } from './canvas/useCanvasKeyboardNav.ts';
import { ViewportLensHud } from './ViewportLensHud.tsx';

const KineticReplayBar = lazy(() =>
  import('./KineticReplayBar.tsx').then((m) => ({ default: m.KineticReplayBar }))
);

export const MandalaCanvas: React.FC = () => {
  const wedges = useMandalaStore((s) => s.wedges);
  const sceneVersion = useMandalaStore((s) => s.sceneVersion);
  const symmetryParams = useMandalaStore((s) => s.symmetryParams);
  const activePalette = useMandalaStore((s) => s.activePalette);
  const activeColor = useMandalaStore((s) => s.activeColor);
  const strokeWidth = useMandalaStore((s) => s.strokeWidth);
  const activeDash = useMandalaStore((s) => s.activeDash);
  const activeTool = useMandalaStore((s) => s.activeTool);
  const activeStampArchetype = useMandalaStore((s) => s.activeStampArchetype);
  const stampScale = useMandalaStore((s) => s.stampScale);
  const showGuides = useMandalaStore((s) => s.showGuides);
  const pressureEnabled = useMandalaStore((s) => s.pressureEnabled);
  const routingMode = useMandalaStore((s) => s.routingMode);
  const forceEscapeHatch = useMandalaStore((s) => s.forceEscapeHatch);

  const camera = useMandalaStore((s) => s.camera);
  const worldRadius = useMandalaStore((s) => s.worldRadius);
  const isPanToolActive = useMandalaStore((s) => s.isPanToolActive);
  const lens = useMandalaStore((s) => s.lens);
  const kineticMode = useMandalaStore((s) => s.kineticMode);
  const kineticPlaying = useMandalaStore((s) => s.kineticPlaying);
  const kineticSpeed = useMandalaStore((s) => s.kineticSpeed);
  const replayProgress = useMandalaStore((s) => s.replayProgress);
  const concentricBreathing = useMandalaStore((s) => s.concentricBreathing);
  const morphSlotA = useMandalaStore((s) => s.morphSlotA);
  const morphSlotB = useMandalaStore((s) => s.morphSlotB);
  const morphTargetKind = useMandalaStore((s) => s.morphTargetKind);
  const morphTargetPolarPreset = useMandalaStore((s) => s.morphTargetPolarPreset);
  const morphProgress = useMandalaStore((s) => s.morphProgress);

  const commitStroke = useMandalaStore((s) => s.commitStroke);
  const commitStampStrokes = useMandalaStore((s) => s.commitStampStrokes);
  const eraseAtPoint = useMandalaStore((s) => s.eraseAtPoint);
  const announceLiveMessage = useMandalaStore((s) => s.announceLiveMessage);
  const setZoom = useMandalaStore((s) => s.setZoom);
  const zoomAtScreenPoint = useMandalaStore((s) => s.zoomAtScreenPoint);
  const panByScreenDelta = useMandalaStore((s) => s.panByScreenDelta);
  const resetViewport = useMandalaStore((s) => s.resetViewport);
  const setLensTilt = useMandalaStore((s) => s.setLensTilt);
  const setLensEnabled = useMandalaStore((s) => s.setLensEnabled);
  const setHasCustomTexture = useMandalaStore((s) => s.setHasCustomTexture);
  const exitLensForDrawing = useMandalaStore((s) => s.exitLensForDrawing);
  const exitKineticMode = useMandalaStore((s) => s.exitKineticMode);
  const setKineticPlaying = useMandalaStore((s) => s.setKineticPlaying);
  const setReplayProgress = useMandalaStore((s) => s.setReplayProgress);
  const setMorphProgress = useMandalaStore((s) => s.setMorphProgress);

  const [isActivelyDrawing, setIsActivelyDrawing] = useState<boolean>(false);
  const [maxGpuTextureSize, setMaxGpuTextureSize] = useState<number>(
    LENS_LIMITS.standardTexturePx
  );
  const [lensWebglError, setLensWebglError] = useState<string | null>(null);
  const [customTextureEpoch, setCustomTextureEpoch] = useState<number>(0);

  const computeProfile = useMemo(
    () => assessSceneComputeProfile(wedges, symmetryParams, undefined, routingMode),
    [wedges, symmetryParams, routingMode]
  );
  const resourceHealth = useMemo(
    () => getResourceHealthSnapshot(wedges, symmetryParams),
    [wedges, symmetryParams]
  );
  const lensMotionGate = useMotionLifecycle(
    Boolean(lens.enabled && lens.isAnimating),
    resourceHealth.cpuLoadState
  );
  const canvasMotionGate = useMotionLifecycle(
    kineticMode !== KineticMode.Off && !lens.enabled && kineticPlaying,
    resourceHealth.cpuLoadState
  );
  const useEscapeHatch =
    (forceEscapeHatch || computeProfile.requiresPixelBufferEscapeHatch) && wedges.length > 0;

  const rawParametricDescription = useMemo(
    () =>
      buildParametricDescription(
        symmetryParams,
        wedges.length,
        activePalette,
        activeColor,
        strokeWidth,
        activeDash
      ),
    [symmetryParams, wedges.length, activePalette, activeColor, strokeWidth, activeDash]
  );
  const parametricDescription = useThrottledParametricMirror(
    rawParametricDescription,
    isActivelyDrawing
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const committedCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const lensCanvasRef = useRef<HTMLCanvasElement>(null);
  const lensSourceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const customLensCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lensCompositorRef = useRef<LensCompositorInstance | null>(null);
  const lensSourceSigRef = useRef<string>('');

  const [viewportSize, setViewportSize] = useState(() => {
    if (typeof window === 'undefined') {
      return { width: 800, height: 640, displaySize: 600 };
    }
    const w = Math.max(280, window.innerWidth);
    const h = Math.max(280, window.innerHeight - 136);
    const pad = w < 640 ? 16 : 56;
    return {
      width: w,
      height: h,
      displaySize: Math.max(240, Math.floor(Math.min(w - pad, h - pad))),
    };
  });

  const pointBufferRef = useRef<TypedPointBuffer>(new TypedPointBuffer());
  const eraserHoverPtRef = useRef<Point | null>(null);
  const stampAnchorRef = useRef<Point | null>(null);
  const stampTargetRef = useRef<Point | null>(null);
  const keyboardCursorRef = useRef<Point | null>(null);
  const isKeyboardModeRef = useRef<boolean>(false);
  const interactionModeRef = useRef<CanvasInteractionMode>(CanvasInteractionMode.Idle);
  const isSpaceHeldRef = useRef<boolean>(false);
  const lastPanScreenRef = useRef<Point | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const activePointersRef = useRef<Map<number, Point>>(new Map());
  const prevPinchDistRef = useRef<number | null>(null);
  const prevPinchMidRef = useRef<Point | null>(null);

  const morphSourceStrokes = useMemo<readonly WedgeStroke[]>(
    () => morphSlotA?.strokes ?? wedges,
    [morphSlotA, wedges]
  );

  const morphTargetStrokes = useMemo<readonly WedgeStroke[]>(() => {
    if (morphTargetKind === MorphTargetKind.UserSlotB && morphSlotB) {
      return morphSlotB.strokes;
    }
    const presetDesc = resolvePolarGenerator(morphTargetPolarPreset);
    return generatePolarHarmonicStrokes(
      {
        generatorId: presetDesc.id,
        amplitudeRadius: presetDesc.defaultRadius,
        numerator: presetDesc.defaultNumerator,
        denominator: presetDesc.defaultDenominator,
        sampleSteps: POLAR_LIMITS.defaultSampleSteps,
        strokeColor: activeColor,
        strokeWidth,
        dash: activeDash,
      },
      LOGICAL_CENTER,
      `morph_${presetDesc.id}`
    );
  }, [morphTargetKind, morphSlotB, morphTargetPolarPreset, activeColor, strokeWidth, activeDash]);

  const preparedMorphPlan = useMemo(() => {
    if (kineticMode !== KineticMode.Morph) return undefined;
    const strategy = STRATEGY_REGISTRY[symmetryParams.strategyId];
    const multiplier = Math.max(
      1,
      strategy ? strategy.expansionMultiplier(symmetryParams.order) : symmetryParams.order
    );
    const adaptiveCap = Math.max(
      MORPH_LIMITS.minAdaptiveMorphStrokes,
      Math.floor(MORPH_LIMITS.maxExpandedMorphPrimitivesPerFrame / multiplier)
    );
    return prepareMorphPlan(
      morphSourceStrokes,
      morphTargetStrokes,
      LOGICAL_CENTER,
      MORPH_LIMITS.resampledPointCount,
      adaptiveCap
    );
  }, [kineticMode, morphSourceStrokes, morphTargetStrokes, symmetryParams]);

  const eraserRadius = useMemo(() => computeEraserRadius(strokeWidth), [strokeWidth]);

  useEffect(() => {
    if (!lens.hasCustomTexture && customLensCanvasRef.current) {
      customLensCanvasRef.current.width = 0;
      customLensCanvasRef.current.height = 0;
      customLensCanvasRef.current = null;
      lensSourceSigRef.current = '';
    }
  }, [lens.hasCustomTexture]);

  const handleUploadCustomLensBitmap = useCallback(
    (bitmap: ImageBitmap) => {
      const targetSize = Math.min(2048, Math.max(512, maxGpuTextureSize));
      if (!customLensCanvasRef.current) {
        customLensCanvasRef.current = document.createElement('canvas');
      }
      const canvas = customLensCanvasRef.current;
      canvas.width = targetSize;
      canvas.height = targetSize;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = CANVAS_THEME.backgroundHex;
        ctx.fillRect(0, 0, targetSize, targetSize);
        const side = Math.min(bitmap.width, bitmap.height);
        const sx = Math.max(0, Math.floor((bitmap.width - side) / 2));
        const sy = Math.max(0, Math.floor((bitmap.height - side) / 2));
        ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, targetSize, targetSize);
      }
      lensSourceSigRef.current = '';
      setHasCustomTexture(true);
      setCustomTextureEpoch((prev) => prev + 1);
      announceLiveMessage('Immagine locale caricata nella Lente WebGL2.');
    },
    [maxGpuTextureSize, setHasCustomTexture, announceLiveMessage]
  );

  const handleRestoreCanvasLensTexture = useCallback(() => {
    if (customLensCanvasRef.current) {
      customLensCanvasRef.current.width = 0;
      customLensCanvasRef.current.height = 0;
      customLensCanvasRef.current = null;
    }
    lensSourceSigRef.current = '';
    setHasCustomTexture(false);
    setCustomTextureEpoch((prev) => prev + 1);
    announceLiveMessage('Ripristinata tela Mandala come sorgente Lente.');
  }, [setHasCustomTexture, announceLiveMessage]);

  useEffect(() => {
    return registerBufferReclaimer(() => pointBufferRef.current.reclaim());
  }, []);

  useEffect(() => {
    const updateSize = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const width = Math.max(280, Math.floor(rect.width));
      const height = Math.max(280, Math.floor(rect.height));
      const pad = width < 640 ? 16 : 56;
      const displaySize = Math.max(240, Math.floor(Math.min(width - pad, height - pad)));
      setViewportSize((prev) =>
        prev.width === width && prev.height === height && prev.displaySize === displaySize
          ? prev
          : { width, height, displaySize }
      );
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    if (containerRef.current) observer.observe(containerRef.current);
    window.addEventListener('resize', updateSize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateSize);
    };
  }, []);

  const { schedulePreviewFrame } = useCanvasRenderPipeline({
    viewportSize,
    committedCanvasRef,
    previewCanvasRef,
    lensCanvasRef,
    lensSourceCanvasRef,
    customLensCanvasRef,
    lensCompositorRef,
    lensSourceSigRef,
    pointBufferRef,
    stampAnchorRef,
    stampTargetRef,
    eraserHoverPtRef,
    keyboardCursorRef,
    isKeyboardModeRef,
    wedges,
    sceneVersion,
    symmetryParams,
    camera,
    useEscapeHatch,
    activeColor,
    strokeWidth,
    activeDash,
    activeTool,
    activeStampArchetype,
    stampScale,
    eraserRadius,
    lens,
    lensMotionGate,
    canvasMotionGate,
    customTextureEpoch,
    kineticMode,
    kineticSpeed,
    replayProgress,
    concentricBreathing,
    morphSourceStrokes,
    morphTargetStrokes,
    morphProgress,
    preparedMorphPlan,
    setLensEnabled,
    setMaxGpuTextureSize,
    setLensWebglError,
    setReplayProgress,
    setMorphProgress,
    setKineticPlaying,
  });

  const toScreenLocalPoint = useCallback(
    (clientX: number, clientY: number, pressure: number): Point => {
      const container = containerRef.current;
      if (!container) {
        return { x: viewportSize.width / 2, y: viewportSize.height / 2, pressure };
      }
      const rect = container.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top, pressure };
    },
    [viewportSize.width, viewportSize.height]
  );

  const toWorldPoint = useCallback(
    (clientX: number, clientY: number, pressure: number): Point => {
      return screenToWorldPoint(
        toScreenLocalPoint(clientX, clientY, pressure),
        camera,
        viewportSize.displaySize,
        viewportSize.width,
        viewportSize.height
      );
    },
    [toScreenLocalPoint, camera, viewportSize.displaySize, viewportSize.width, viewportSize.height]
  );

  const stampSinglePoint = useCallback(
    (pt: Point) => {
      const effectiveWidth = pressureEnabled
        ? Math.max(2, strokeWidth * (0.65 + (pt.pressure ?? 0.5)))
        : strokeWidth;
      commitStroke({
        id: `point_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        points: [pt],
        stroke: activeColor,
        strokeWidth: effectiveWidth,
        dash: null,
        opacity: MANDALA_LIMITS.defaultOpacity,
      });
    },
    [activeColor, strokeWidth, pressureEnabled, commitStroke]
  );

  const commitCurrentStroke = useCallback(() => {
    const buf = pointBufferRef.current;
    if (buf.length >= 2) {
      const avgPressure = buf.averagePressure();
      const effectiveWidth = pressureEnabled
        ? Math.max(1, strokeWidth * (0.5 + avgPressure))
        : strokeWidth;
      commitStroke({
        id: `stroke_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        points: buf.toPoints(),
        stroke: activeColor,
        strokeWidth: effectiveWidth,
        dash: activeDash,
        opacity: MANDALA_LIMITS.defaultOpacity,
      });
    }
    buf.reset();
    interactionModeRef.current = CanvasInteractionMode.Idle;
    setIsActivelyDrawing(false);
    activePointerIdRef.current = null;
    schedulePreviewFrame();
  }, [activeColor, strokeWidth, activeDash, pressureEnabled, commitStroke, schedulePreviewFrame]);

  const commitCurrentStamp = useCallback(() => {
    const anchor = stampAnchorRef.current;
    if (!anchor) return;
    const vec = computeStampPlacementVector(
      anchor,
      stampTargetRef.current,
      stampScale,
      LOGICAL_CENTER
    );
    const descriptor = resolveStampArchetype(activeStampArchetype);
    const strokes = generateBotanicalStampStrokes(
      {
        archetype: activeStampArchetype,
        anchor,
        radius: vec.radius,
        angleRad: vec.angleRad,
        strokeColor: activeColor,
        strokeWidth,
        dash: activeDash,
      },
      `stamp_${Date.now()}`
    );
    commitStampStrokes(strokes, descriptor.label);
    stampAnchorRef.current = null;
    stampTargetRef.current = null;
    interactionModeRef.current = CanvasInteractionMode.Idle;
    setIsActivelyDrawing(false);
    activePointerIdRef.current = null;
    schedulePreviewFrame();
  }, [stampScale, activeStampArchetype, activeColor, strokeWidth, activeDash, commitStampStrokes, schedulePreviewFrame]);

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      e.preventDefault();
      const factor =
        e.deltaY < 0 ? CAMERA_LIMITS.wheelZoomFactor : 1 / CAMERA_LIMITS.wheelZoomFactor;
      const anchor = toScreenLocalPoint(e.clientX, e.clientY, 0.5);
      zoomAtScreenPoint(
        camera.zoom * factor,
        anchor,
        viewportSize.displaySize,
        viewportSize.width,
        viewportSize.height
      );
    },
    [camera.zoom, toScreenLocalPoint, viewportSize.displaySize, viewportSize.width, viewportSize.height, zoomAtScreenPoint]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const pressure = pressureEnabled && e.pressure > 0 ? e.pressure : 0.5;
      const screenPt = toScreenLocalPoint(e.clientX, e.clientY, pressure);
      activePointersRef.current.set(e.pointerId, screenPt);

      safelyAcquirePointerCapture(e.currentTarget, e.pointerId);

      const nextMode = resolvePointerDownMode({
        activePointerCount: activePointersRef.current.size,
        lensEnabled: lens.enabled,
        kineticMode,
        button: e.button,
        pointerType: e.pointerType,
        isPanToolActive,
        isSpaceHeld: isSpaceHeldRef.current,
        activeTool,
      });

      if (nextMode === CanvasInteractionMode.Pinching) {
        pointBufferRef.current.reset();
        setIsActivelyDrawing(false);
        interactionModeRef.current = CanvasInteractionMode.Pinching;
        const pinch = computePinchMetrics(Array.from(activePointersRef.current.values()));
        if (pinch) {
          prevPinchDistRef.current = pinch.dist;
          prevPinchMidRef.current = pinch.mid;
        }
        schedulePreviewFrame();
        return;
      }

      if (nextMode === CanvasInteractionMode.Idle) return;

      activePointerIdRef.current = e.pointerId;
      interactionModeRef.current = nextMode;

      if (
        nextMode === CanvasInteractionMode.LensTilting ||
        nextMode === CanvasInteractionMode.KineticPanning ||
        nextMode === CanvasInteractionMode.Panning
      ) {
        lastPanScreenRef.current = screenPt;
        return;
      }

      isKeyboardModeRef.current = false;
      const worldPt = toWorldPoint(e.clientX, e.clientY, pressure);

      if (activeTool === ToolId.Point) {
        stampSinglePoint(worldPt);
        interactionModeRef.current = CanvasInteractionMode.Idle;
        return;
      }

      setIsActivelyDrawing(true);

      if (nextMode === CanvasInteractionMode.Stamping) {
        stampAnchorRef.current = worldPt;
        stampTargetRef.current = null;
        schedulePreviewFrame();
        return;
      }

      if (nextMode === CanvasInteractionMode.Erasing) {
        eraserHoverPtRef.current = worldPt;
        schedulePreviewFrame();
        eraseAtPoint(worldPt, eraserRadius);
        return;
      }

      pointBufferRef.current.reset();
      pointBufferRef.current.push(worldPt.x, worldPt.y, pressure);
      schedulePreviewFrame();
    },
    [
      pressureEnabled,
      toScreenLocalPoint,
      lens.enabled,
      kineticMode,
      isPanToolActive,
      activeTool,
      toWorldPoint,
      stampSinglePoint,
      schedulePreviewFrame,
      eraseAtPoint,
      eraserRadius,
    ]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const pressure = pressureEnabled && e.pressure > 0 ? e.pressure : 0.5;
      const screenPt = toScreenLocalPoint(e.clientX, e.clientY, pressure);
      if (activePointersRef.current.has(e.pointerId)) {
        activePointersRef.current.set(e.pointerId, screenPt);
      }

      if (activePointersRef.current.size === 2) {
        const pinch = computePinchMetrics(Array.from(activePointersRef.current.values()));
        if (!pinch) return;
        if (prevPinchMidRef.current) {
          panByScreenDelta(
            pinch.mid.x - prevPinchMidRef.current.x,
            pinch.mid.y - prevPinchMidRef.current.y,
            viewportSize.displaySize
          );
        }
        if (prevPinchDistRef.current && prevPinchDistRef.current > 8 && pinch.dist > 8) {
          zoomAtScreenPoint(
            camera.zoom * (pinch.dist / prevPinchDistRef.current),
            pinch.mid,
            viewportSize.displaySize,
            viewportSize.width,
            viewportSize.height
          );
        }
        prevPinchDistRef.current = pinch.dist;
        prevPinchMidRef.current = pinch.mid;
        return;
      }

      const mode = interactionModeRef.current;
      if (lens.enabled) {
        if (mode === CanvasInteractionMode.LensTilting && lastPanScreenRef.current) {
          const denom = Math.max(120, viewportSize.displaySize);
          setLensTilt(
            lens.tiltX + ((screenPt.x - lastPanScreenRef.current.x) / denom) * 0.6,
            lens.tiltY + ((screenPt.y - lastPanScreenRef.current.y) / denom) * 0.6
          );
          lastPanScreenRef.current = screenPt;
        }
        return;
      }

      if (
        (mode === CanvasInteractionMode.Panning || mode === CanvasInteractionMode.KineticPanning) &&
        lastPanScreenRef.current
      ) {
        panByScreenDelta(
          screenPt.x - lastPanScreenRef.current.x,
          screenPt.y - lastPanScreenRef.current.y,
          viewportSize.displaySize
        );
        lastPanScreenRef.current = screenPt;
        return;
      }

      const worldPt = toWorldPoint(e.clientX, e.clientY, pressure);

      if (activeTool === ToolId.Eraser) {
        eraserHoverPtRef.current = worldPt;
        schedulePreviewFrame();
        if (mode === CanvasInteractionMode.Erasing) {
          eraseAtPoint(worldPt, eraserRadius);
        }
        return;
      }

      if (mode === CanvasInteractionMode.Stamping && stampAnchorRef.current) {
        stampTargetRef.current = worldPt;
        schedulePreviewFrame();
        return;
      }

      if (mode !== CanvasInteractionMode.DrawingStroke || activeTool !== ToolId.Brush) return;
      const worldMinDistSq = computeWorldMinDistSq(
        RESOURCE_GUARD_LIMITS.pointerMinDistanceSq,
        camera.zoom
      );
      if (pointBufferRef.current.pushIfMoved(worldPt.x, worldPt.y, pressure, worldMinDistSq)) {
        schedulePreviewFrame();
      }
    },
    [
      pressureEnabled,
      toScreenLocalPoint,
      viewportSize.displaySize,
      viewportSize.width,
      viewportSize.height,
      camera.zoom,
      zoomAtScreenPoint,
      panByScreenDelta,
      lens.enabled,
      lens.tiltX,
      lens.tiltY,
      setLensTilt,
      toWorldPoint,
      activeTool,
      schedulePreviewFrame,
      eraseAtPoint,
      eraserRadius,
    ]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      activePointersRef.current.delete(e.pointerId);
      if (activePointersRef.current.size < 2) {
        prevPinchDistRef.current = null;
        prevPinchMidRef.current = null;
      }

      if (activePointerIdRef.current === e.pointerId) {
        lastPanScreenRef.current = null;
        const mode = interactionModeRef.current;
        if (!lens.enabled && mode === CanvasInteractionMode.DrawingStroke) {
          commitCurrentStroke();
        } else if (!lens.enabled && mode === CanvasInteractionMode.Stamping) {
          commitCurrentStamp();
        } else {
          interactionModeRef.current = CanvasInteractionMode.Idle;
          setIsActivelyDrawing(false);
          activePointerIdRef.current = null;
        }
      }

      safelyReleasePointerCapture(e.currentTarget, e.pointerId);
    },
    [lens.enabled, commitCurrentStroke, commitCurrentStamp]
  );

  const handlePointerCancel = useCallback(() => {
    activePointersRef.current.clear();
    prevPinchDistRef.current = null;
    prevPinchMidRef.current = null;
    pointBufferRef.current.reset();
    stampAnchorRef.current = null;
    stampTargetRef.current = null;
    eraserHoverPtRef.current = null;
    interactionModeRef.current = CanvasInteractionMode.Idle;
    lastPanScreenRef.current = null;
    setIsActivelyDrawing(false);
    activePointerIdRef.current = null;
    schedulePreviewFrame();
  }, [schedulePreviewFrame]);

  const handleKeyDown = useCanvasKeyboardNav({
    lensEnabled: lens.enabled,
    kineticMode,
    zoom: camera.zoom,
    displaySize: viewportSize.displaySize,
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
  });

  const cursorClass =
    lens.enabled || kineticMode !== KineticMode.Off || isPanToolActive
      ? 'cursor-grab active:cursor-grabbing'
      : 'cursor-crosshair';

  return (
    <div
      ref={containerRef}
      className={`relative flex items-center justify-center w-full h-full overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 ${cursorClass}`}
      tabIndex={0}
      role="application"
      aria-label="Area di disegno interattiva e vista Lente Semisferica per Mandala"
      onKeyDown={handleKeyDown}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onPointerLeave={() => {
        eraserHoverPtRef.current = null;
        if (
          interactionModeRef.current === CanvasInteractionMode.LensTilting ||
          interactionModeRef.current === CanvasInteractionMode.Panning ||
          interactionModeRef.current === CanvasInteractionMode.KineticPanning
        ) {
          interactionModeRef.current = CanvasInteractionMode.Idle;
        }
        schedulePreviewFrame();
      }}
      style={{ touchAction: 'none' }}
    >
      <div
        className={`absolute inset-0 transition-opacity duration-150 ${
          lens.enabled ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
      >
        {showGuides && (
          <MandalaGuides
            viewportWidth={viewportSize.width}
            viewportHeight={viewportSize.height}
            displaySize={viewportSize.displaySize}
            camera={camera}
            worldRadius={worldRadius}
            order={symmetryParams.order}
          />
        )}

        <canvas
          ref={committedCanvasRef}
          data-testid="mandala-canvas"
          data-render-mode={useEscapeHatch ? 'pixel-buffer' : 'vector'}
          data-kinetic-mode={kineticMode}
          className="absolute inset-0 z-20"
          role="img"
          aria-label="Tela geometrica del Mandala"
          aria-describedby="mandala-parametric-desc"
        >
          {parametricDescription}
        </canvas>

        <canvas
          ref={previewCanvasRef}
          data-testid="mandala-preview-canvas"
          className="absolute inset-0 z-20 pointer-events-none"
          aria-hidden="true"
        />
      </div>

      {lens.enabled && (
        <div
          className="relative z-20 flex items-center justify-center rounded-full shadow-2xl shadow-cyan-950/30"
          style={{
            width: `${viewportSize.displaySize}px`,
            height: `${viewportSize.displaySize}px`,
          }}
          onDoubleClick={exitLensForDrawing}
        >
          <canvas
            ref={lensCanvasRef}
            data-testid="mandala-lens-canvas"
            data-lens-profile={lens.profile}
            data-lens-animating={lensMotionGate.canAnimate ? 'true' : 'false'}
            className="w-full h-full rounded-full"
            aria-label="Anteprima ottica su lente semisferica WebGL2"
          />

          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1.5 bg-slate-900/90 backdrop-blur-md border border-slate-700 rounded-xl shadow-lg whitespace-nowrap">
            <span className="text-[11px] text-slate-300">Anteprima Lente attiva</span>
            <button
              type="button"
              onClick={exitLensForDrawing}
              className="min-h-[40px] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-cyan-400 hover:bg-cyan-300 text-slate-950 rounded-lg transition whitespace-nowrap"
            >
              <Pencil className="w-3.5 h-3.5" />
              <span>Disegna</span>
            </button>
          </div>
        </div>
      )}

      {lensWebglError && (
        <div
          role="alert"
          className="absolute top-16 left-4 z-30 flex items-center gap-2 px-3 py-2 bg-rose-950/90 border border-rose-700 rounded-xl text-xs text-rose-200"
        >
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{lensWebglError}</span>
        </div>
      )}

      {!lens.enabled && kineticMode !== KineticMode.Off && (
        <Suspense fallback={null}>
          <KineticReplayBar />
        </Suspense>
      )}

      <div onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
        <ViewportLensHud
          displaySize={viewportSize.displaySize}
          maxGpuTextureSize={maxGpuTextureSize}
          onUploadCustomTexture={handleUploadCustomLensBitmap}
          onRestoreCanvasTexture={handleRestoreCanvasLensTexture}
        />
      </div>

      <div id="mandala-parametric-desc" className="sr-only">
        {parametricDescription}
      </div>
    </div>
  );
};
