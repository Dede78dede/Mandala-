/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase A + WebGL2 Hemispherical Lens Integrated Mandala Canvas:
 * - Full-bleed responsive viewport backed by 2D Camera (0.25x-8x Zoom & Pan across extended world)
 * - Layer 0 (`TypedPointBuffer` Float32Array): zero-GC inverse-zoom decimated pointer capture
 * - Layer 1 (`committedCanvasRef`): camera-transformed AABB-culled rendering + O(1) bitmap blit
 * - Layer 2 (`previewCanvasRef`): imperative rAF-coalesced active stroke, eraser reticle & crosshair
 * - Layer 3 (`MandalaGuides` React.memo): adaptive LOD SVG guides locked to CameraTransform viewBox
 * - WebGL2 Lens Overlay (`lensCanvasRef`): lazy-loaded on demand with 2048px/1024px/4096px GPU guard
 */

import React, { lazy, memo, Suspense, useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { Pencil, AlertCircle } from 'lucide-react';
import { registerBufferReclaimer } from '../shared/lib/cacheService.ts';
import {
  CAMERA_LIMITS,
  CANVAS_THEME,
  KINETIC_LIMITS,
  LENS_LIMITS,
  LOGICAL_CANVAS_SIZE,
  LOGICAL_CENTER,
  MANDALA_LIMITS,
  POLAR_LIMITS,
  RESOURCE_GUARD_LIMITS,
  WORLD_SPACE_LIMITS,
} from '../features/mandala/model/constants.ts';
import {
  KineticMode,
  MorphTargetKind,
  ToolId,
  type CameraTransform,
  type Point,
  type WedgeStroke,
} from '../features/mandala/model/types.ts';
import {
  useMandalaStore,
  buildParametricDescription,
} from '../features/mandala/model/store.ts';
import {
  formatCrosshairAnnouncement,
  useThrottledParametricMirror,
} from '../features/mandala/lib/accessibility.ts';
import { assessSceneComputeProfile } from '../features/mandala/engine/geometryEngine.ts';
import {
  clearCanvasSurface,
  computeEraserRadius,
  renderEraserReticle,
  renderKeyboardCrosshair,
  renderKineticWorldSceneOnContext,
  renderStampPreview,
  renderSupersampledLensSourceCanvas,
  renderTypedBufferPreview,
  renderWorldSceneOnContext,
} from '../features/mandala/lib/canvasRenderer.ts';
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
  applyCameraTransformToContext,
  computeWorldMinDistSq,
  screenToWorldPoint,
} from '../features/mandala/lib/viewportCamera.ts';
import { resolveEffectiveLensTextureSize } from '../features/mandala/lib/lensProjection.ts';
import { getResourceHealthSnapshot } from '../features/mandala/lib/resourceGuard.ts';
import { useMotionLifecycle } from '../shared/lib/motionLifecycle.ts';
import type { LensCompositorInstance } from '../features/mandala/lib/lensWebglPass.ts';
import { ViewportLensHud } from './ViewportLensHud.tsx';

const KineticReplayBar = lazy(() =>
  import('./KineticReplayBar.tsx').then((m) => ({ default: m.KineticReplayBar }))
);

interface MandalaGuidesProps {
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly displaySize: number;
  readonly camera: CameraTransform;
  readonly worldRadius: number;
  readonly order: number;
}

const EXTENDED_RING_STEPS: ReadonlyArray<number> = [600, 800, 1000, 1200];

const MandalaGuides: React.FC<MandalaGuidesProps> = memo(
  ({ viewportWidth, viewportHeight, displaySize, camera, worldRadius, order }) => {
    const viewBoxInfo = useMemo(() => {
      const topLeft = screenToWorldPoint(
        { x: 0, y: 0 },
        camera,
        displaySize,
        viewportWidth,
        viewportHeight
      );
      const bottomRight = screenToWorldPoint(
        { x: viewportWidth, y: viewportHeight },
        camera,
        displaySize,
        viewportWidth,
        viewportHeight
      );
      const vbW = Math.max(1, bottomRight.x - topLeft.x);
      const vbH = Math.max(1, bottomRight.y - topLeft.y);
      return {
        viewBox: `${topLeft.x.toFixed(2)} ${topLeft.y.toFixed(2)} ${vbW.toFixed(2)} ${vbH.toFixed(2)}`,
        strokeUnit: vbW / Math.max(1, viewportWidth),
      };
    }, [camera, displaySize, viewportWidth, viewportHeight]);

    const spokeRadius = Math.max(WORLD_SPACE_LIMITS.baseRadius, worldRadius);

    const spokes = useMemo(() => {
      return Array.from({ length: order }, (_, i) => {
        const angle = (i * 2 * Math.PI) / order - Math.PI / 2;
        return {
          x2: LOGICAL_CENTER.x + spokeRadius * Math.cos(angle),
          y2: LOGICAL_CENTER.y + spokeRadius * Math.sin(angle),
        };
      });
    }, [order, spokeRadius]);

    const activeExtendedRings = useMemo(
      () => EXTENDED_RING_STEPS.filter((r) => r <= worldRadius + 1),
      [worldRadius]
    );

    const su = viewBoxInfo.strokeUnit;

    return (
      <svg
        className="absolute inset-0 pointer-events-none z-10 transition-opacity duration-200"
        width={viewportWidth}
        height={viewportHeight}
        viewBox={viewBoxInfo.viewBox}
        aria-hidden="true"
      >
        {/* Classic canonical base rings */}
        {CANVAS_THEME.guideRingRatios.map((ratio, idx) => (
          <circle
            key={`ring-${idx}`}
            cx={LOGICAL_CENTER.x}
            cy={LOGICAL_CENTER.y}
            r={WORLD_SPACE_LIMITS.baseRadius * ratio}
            fill="none"
            stroke={CANVAS_THEME.guideStrokeHex}
            strokeWidth={(idx === CANVAS_THEME.guideRingRatios.length - 1 ? 1.5 : 1.1) * su}
            strokeDasharray={
              idx === CANVAS_THEME.guideRingRatios.length - 1
                ? undefined
                : `${(idx % 2 === 0 ? 6 : 3) * su},${(idx % 2 === 0 ? 6 : 9) * su}`
            }
            opacity={idx === CANVAS_THEME.guideRingRatios.length - 1 ? '0.35' : '0.24'}
          />
        ))}

        {/* Adaptive Phase A extended world rings (appear smoothly around classic bounds) */}
        {activeExtendedRings.map((radius, idx) => (
          <circle
            key={`ext-ring-${radius}`}
            cx={LOGICAL_CENTER.x}
            cy={LOGICAL_CENTER.y}
            r={radius}
            fill="none"
            stroke={CANVAS_THEME.guideStrokeHex}
            strokeWidth={(idx === activeExtendedRings.length - 1 ? 1.4 : 1.0) * su}
            strokeDasharray={`${8 * su},${8 * su}`}
            opacity={camera.zoom < 0.85 ? '0.32' : '0.16'}
          />
        ))}

        {/* Adaptive LOD symmetry spokes */}
        {spokes.map((s, i) => (
          <line
            key={`spoke-${i}`}
            x1={LOGICAL_CENTER.x}
            y1={LOGICAL_CENTER.y}
            x2={s.x2}
            y2={s.y2}
            stroke={CANVAS_THEME.guideStrokeHex}
            strokeWidth={(i === 0 ? 1.8 : 1.0) * su}
            strokeDasharray={i === 0 ? undefined : `${5 * su},${7 * su}`}
            opacity={i === 0 ? '0.45' : '0.22'}
          />
        ))}

        <circle
          cx={LOGICAL_CENTER.x}
          cy={LOGICAL_CENTER.y}
          r={4.5 * su}
          fill={CANVAS_THEME.guideStrokeHex}
          opacity="0.7"
        />
        <circle
          cx={LOGICAL_CENTER.x}
          cy={LOGICAL_CENTER.y}
          r={12 * su}
          fill="none"
          stroke={CANVAS_THEME.guideStrokeHex}
          strokeWidth={1.4 * su}
          opacity="0.4"
        />
      </svg>
    );
  }
);

MandalaGuides.displayName = 'MandalaGuides';

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
  const hasCommittedPaintRef = useRef<boolean>(false);
  const hasPreviewPaintRef = useRef<boolean>(false);

  const [viewportSize, setViewportSize] = useState<{
    width: number;
    height: number;
    displaySize: number;
  }>(() => {
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

  // Tier L0 Contiguous Float32Array Buffer + Multi-Pointer Pinch/Pan Tracker
  const pointBufferRef = useRef<TypedPointBuffer>(new TypedPointBuffer());
  const eraserHoverPtRef = useRef<Point | null>(null);
  const stampAnchorRef = useRef<Point | null>(null);
  const stampTargetRef = useRef<Point | null>(null);
  const keyboardCursorRef = useRef<Point | null>(null);
  const isKeyboardModeRef = useRef<boolean>(false);
  const isDrawingRef = useRef<boolean>(false);
  const isPanningRef = useRef<boolean>(false);
  const isSpaceHeldRef = useRef<boolean>(false);
  const isTiltingLensRef = useRef<boolean>(false);
  const lastPanScreenRef = useRef<Point | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const activePointersRef = useRef<Map<number, Point>>(new Map());
  const prevPinchDistRef = useRef<number | null>(null);
  const prevPinchMidRef = useRef<Point | null>(null);
  const previewRafIdRef = useRef<number | null>(null);
  const lensConfigRef = useRef(lens);
  lensConfigRef.current = lens;
  const lensAnimTimeRef = useRef<number>(0);
  const kineticClockRef = useRef<number>(0);
  const replayProgressRef = useRef<number>(replayProgress);
  replayProgressRef.current = replayProgress;
  const morphProgressRef = useRef<number>(morphProgress);
  morphProgressRef.current = morphProgress;

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
  }, [
    morphTargetKind,
    morphSlotB,
    morphTargetPolarPreset,
    activeColor,
    strokeWidth,
    activeDash,
  ]);

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

  // Track container dimensions dynamically for full-bleed Phase A viewport
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

  // Spacebar temporary Pan modifier on Desktop
  useEffect(() => {
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        isSpaceHeldRef.current = false;
      }
    };
    window.addEventListener('keyup', onKeyUp);
    return () => window.removeEventListener('keyup', onKeyUp);
  }, []);

  const toScreenLocalPoint = useCallback(
    (clientX: number, clientY: number, pressure: number): Point => {
      const container = containerRef.current;
      if (!container) return { x: viewportSize.width / 2, y: viewportSize.height / 2, pressure };
      const rect = container.getBoundingClientRect();
      return {
        x: clientX - rect.left,
        y: clientY - rect.top,
        pressure,
      };
    },
    [viewportSize.width, viewportSize.height]
  );

  const toWorldPoint = useCallback(
    (clientX: number, clientY: number, pressure: number): Point => {
      const screenPt = toScreenLocalPoint(clientX, clientY, pressure);
      return screenToWorldPoint(
        screenPt,
        camera,
        viewportSize.displaySize,
        viewportSize.width,
        viewportSize.height
      );
    },
    [toScreenLocalPoint, camera, viewportSize.displaySize, viewportSize.width, viewportSize.height]
  );

  // LAYER 1: Committed geometry transformed by Phase A Camera 2D (or static Kinetic snapshot)
  const renderCommittedLayer = useCallback(() => {
    const canvas = committedCanvasRef.current;
    if (!canvas) return;
    if (wedges.length === 0 && kineticMode === KineticMode.Off && !hasCommittedPaintRef.current) {
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    clearCanvasSurface(ctx, canvas.width, canvas.height);
    if (kineticMode !== KineticMode.Off && !lens.enabled) {
      hasCommittedPaintRef.current =
        wedges.length > 0 ||
        (kineticMode === KineticMode.Morph &&
          (morphSourceStrokes.length > 0 || morphTargetStrokes.length > 0));
      renderKineticWorldSceneOnContext(
        ctx,
        wedges,
        symmetryParams,
        camera,
        viewportSize.displaySize,
        dpr,
        viewportSize.width,
        viewportSize.height,
        kineticMode,
        kineticClockRef.current,
        kineticSpeed,
        replayProgress,
        concentricBreathing,
        kineticMode === KineticMode.Morph
          ? {
              fromStrokes: morphSourceStrokes,
              toStrokes: morphTargetStrokes,
              morphProgress,
            }
          : undefined
      );
      return;
    }

    if (wedges.length === 0) {
      hasCommittedPaintRef.current = false;
      return;
    }

    hasCommittedPaintRef.current = true;
    renderWorldSceneOnContext(
      ctx,
      wedges,
      symmetryParams,
      camera,
      viewportSize.displaySize,
      dpr,
      forceEscapeHatch,
      sceneVersion,
      viewportSize.width,
      viewportSize.height
    );
  }, [
    wedges,
    symmetryParams,
    camera,
    viewportSize.displaySize,
    viewportSize.width,
    viewportSize.height,
    forceEscapeHatch,
    sceneVersion,
    kineticMode,
    lens.enabled,
    kineticSpeed,
    replayProgress,
    concentricBreathing,
    morphSourceStrokes,
    morphTargetStrokes,
    morphProgress,
  ]);

  // LAYER 2: Imperative rAF-coalesced preview from L0 Float32Array
  const renderPreviewLayer = useCallback(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    const hasBrushPreview = pointBufferRef.current.length >= 2 && activeTool === ToolId.Brush;
    const stampAnchor = stampAnchorRef.current;
    const hasStampPreview = activeTool === ToolId.Stamp && Boolean(stampAnchor);
    const hoverPt = eraserHoverPtRef.current;
    const kbCursor = keyboardCursorRef.current;
    const hasOverlay =
      (activeTool === ToolId.Eraser && Boolean(hoverPt)) ||
      (isKeyboardModeRef.current && Boolean(kbCursor));
    if (!hasBrushPreview && !hasStampPreview && !hasOverlay && !hasPreviewPaintRef.current) {
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const scaleFactor = (viewportSize.displaySize * dpr) / LOGICAL_CANVAS_SIZE;

    clearCanvasSurface(ctx, canvas.width, canvas.height);
    hasPreviewPaintRef.current = hasBrushPreview || hasStampPreview || hasOverlay;

    if (hasBrushPreview) {
      renderTypedBufferPreview(
        ctx,
        pointBufferRef.current,
        symmetryParams,
        activeColor,
        strokeWidth,
        activeDash,
        scaleFactor,
        camera,
        viewportSize.displaySize,
        dpr,
        viewportSize.width,
        viewportSize.height
      );
    }

    if (hasStampPreview && stampAnchor) {
      const vec = computeStampPlacementVector(
        stampAnchor,
        stampTargetRef.current,
        stampScale,
        LOGICAL_CENTER
      );
      const previewStrokes = generateBotanicalStampStrokes(
        {
          archetype: activeStampArchetype,
          anchor: stampAnchor,
          radius: vec.radius,
          angleRad: vec.angleRad,
          strokeColor: activeColor,
          strokeWidth,
          dash: activeDash,
        },
        'stamp_preview'
      );
      renderStampPreview(
        ctx,
        previewStrokes,
        symmetryParams,
        camera,
        viewportSize.displaySize,
        dpr,
        viewportSize.width,
        viewportSize.height
      );
    }

    if (hasOverlay) {
      ctx.save();
      applyCameraTransformToContext(
        ctx,
        camera,
        viewportSize.displaySize,
        dpr,
        viewportSize.width,
        viewportSize.height
      );
      if (activeTool === ToolId.Eraser && hoverPt) {
        renderEraserReticle(ctx, hoverPt, eraserRadius);
      }
      if (isKeyboardModeRef.current && kbCursor) {
        renderKeyboardCrosshair(ctx, kbCursor, activeTool === ToolId.Eraser);
      }
      ctx.restore();
    }
  }, [
    viewportSize.displaySize,
    viewportSize.width,
    viewportSize.height,
    camera,
    symmetryParams,
    activeColor,
    strokeWidth,
    activeDash,
    activeTool,
    activeStampArchetype,
    stampScale,
    eraserRadius,
  ]);

  const schedulePreviewFrame = useCallback(() => {
    if (previewRafIdRef.current !== null) return;
    previewRafIdRef.current = requestAnimationFrame(() => {
      previewRafIdRef.current = null;
      renderPreviewLayer();
    });
  }, [renderPreviewLayer]);

  useEffect(() => {
    return () => {
      if (previewRafIdRef.current !== null) {
        cancelAnimationFrame(previewRafIdRef.current);
      }
    };
  }, []);

  // Size interactive Canvas 2D backing stores to viewport only when dimensions change
  useEffect(() => {
    const dpr = window.devicePixelRatio || 1;
    const targetW = Math.round(viewportSize.width * dpr);
    const targetH = Math.round(viewportSize.height * dpr);
    for (const canvas of [committedCanvasRef.current, previewCanvasRef.current]) {
      if (!canvas) continue;
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
        canvas.style.width = `${viewportSize.width}px`;
        canvas.style.height = `${viewportSize.height}px`;
      }
    }
  }, [viewportSize.width, viewportSize.height]);

  useEffect(() => {
    renderCommittedLayer();
  }, [renderCommittedLayer]);

  useEffect(() => {
    renderPreviewLayer();
  }, [renderPreviewLayer]);

  // Lazy-Loaded WebGL2 Hemispherical Lens Lifecycle
  useEffect(() => {
    if (!lens.enabled) {
      if (lensCompositorRef.current) {
        lensCompositorRef.current.dispose();
        lensCompositorRef.current = null;
      }
      lensSourceSigRef.current = '';
      setLensWebglError(null);
      return;
    }

    const canvas = lensCanvasRef.current;
    if (!canvas) return;
    let cancelled = false;

    const handleContextLost = (e: Event) => {
      e.preventDefault();
      setLensWebglError('Contesto GPU WebGL2 perso: ripristinata la Vista Piana.');
      setLensEnabled(false);
    };
    canvas.addEventListener('webglcontextlost', handleContextLost);

    const renderLensPass = (compositor: LensCompositorInstance) => {
      const dpr = window.devicePixelRatio || 1;
      compositor.resize(
        Math.round(viewportSize.displaySize * dpr),
        Math.round(viewportSize.displaySize * dpr)
      );

      const health = getResourceHealthSnapshot(wedges, symmetryParams);
      const texPlan = resolveEffectiveLensTextureSize({
        requestedQuality: lens.textureQuality,
        cpuLoadState: health.cpuLoadState,
        memoryPressure: health.memoryPressure,
        maxGpuTextureSize: compositor.maxTextureSize,
        currentSceneBytes: health.l1BytesUsed + health.l2WedgeHeapBytes,
      });

      const sourceSig = lens.hasCustomTexture && customLensCanvasRef.current
        ? `custom|${customTextureEpoch}`
        : `${sceneVersion}|${symmetryParams.strategyId}|${symmetryParams.order}|${camera.zoom.toFixed(3)}|${camera.panX.toFixed(1)}|${camera.panY.toFixed(1)}|${texPlan.textureSizePx}`;

      if (!lensSourceCanvasRef.current) {
        lensSourceCanvasRef.current = document.createElement('canvas');
      }

      if (lensSourceSigRef.current !== sourceSig) {
        if (lens.hasCustomTexture && customLensCanvasRef.current) {
          compositor.uploadSourceCanvas(customLensCanvasRef.current);
        } else {
          renderSupersampledLensSourceCanvas(
            lensSourceCanvasRef.current,
            wedges,
            symmetryParams,
            camera,
            texPlan.textureSizePx,
            true
          );
          compositor.uploadSourceCanvas(lensSourceCanvasRef.current);
        }
        lensSourceSigRef.current = sourceSig;
      }

      compositor.render(lens, 0, lensMotionGate.canAnimate ? lensAnimTimeRef.current : 0);
    };

    if (lensCompositorRef.current) {
      renderLensPass(lensCompositorRef.current);
    } else {
      void import('../features/mandala/lib/lensWebglPass.ts').then((mod) => {
        if (cancelled) return;
        const instance = mod.createWebGL2LensCompositor(canvas);
        if (!instance) {
          setLensWebglError('WebGL2 non disponibile su questo dispositivo.');
          setLensEnabled(false);
          return;
        }
        lensCompositorRef.current = instance;
        setMaxGpuTextureSize(instance.maxTextureSize);
        setLensWebglError(null);
        renderLensPass(instance);
      });
    }

    return () => {
      cancelled = true;
      canvas.removeEventListener('webglcontextlost', handleContextLost);
    };
  }, [
    lens,
    wedges,
    sceneVersion,
    symmetryParams,
    camera,
    viewportSize.displaySize,
    setLensEnabled,
    lensMotionGate.canAnimate,
    customTextureEpoch,
  ]);

  // GPU-Only rAF Loop for WebGL2 Lens Breathing & Hue Drift (Zero Texture Re-Upload, Paused on hidden/reduced-motion)
  useEffect(() => {
    if (!lens.enabled || !lensMotionGate.canAnimate) {
      return;
    }

    let rafId = 0;
    let lastTs = performance.now();
    const minFrameIntervalMs = 1000 / Math.max(15, lensMotionGate.targetFps);

    const tick = (now: number) => {
      const dtMs = now - lastTs;
      if (dtMs >= minFrameIntervalMs) {
        lastTs = now;
        lensAnimTimeRef.current += dtMs / 1000;
        const compositor = lensCompositorRef.current;
        if (compositor) {
          compositor.render(lensConfigRef.current, 0, lensAnimTimeRef.current);
        }
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [lens.enabled, lensMotionGate.canAnimate, lensMotionGate.targetFps]);

  // Accessible Canvas 2D Kinetic Loop (Stroke Replay & Concentric Bands, gated by visibility/reduced-motion/CPU)
  useEffect(() => {
    if (kineticMode === KineticMode.Off || lens.enabled || !canvasMotionGate.canAnimate) {
      return;
    }

    let rafId = 0;
    let lastTs = performance.now();
    let lastSyncTs = lastTs;
    const minFrameIntervalMs = 1000 / Math.max(15, canvasMotionGate.targetFps);

    const tick = (now: number) => {
      const dtMs = now - lastTs;
      if (dtMs >= minFrameIntervalMs) {
        const dtSec = dtMs / 1000;
        lastTs = now;
        kineticClockRef.current += dtSec;

        let activeProgress = replayProgressRef.current;
        let activeMorphT = morphProgressRef.current;
        if (kineticMode === KineticMode.StrokeReplay) {
          const durationSec = KINETIC_LIMITS.replayBaseDurationSec / Math.max(0.25, kineticSpeed);
          activeProgress = Math.min(1, activeProgress + dtSec / durationSec);
          replayProgressRef.current = activeProgress;

          if (now - lastSyncTs >= 100 || activeProgress >= 1) {
            lastSyncTs = now;
            setReplayProgress(activeProgress);
            if (activeProgress >= 1) {
              setKineticPlaying(false);
            }
          }
        } else if (kineticMode === KineticMode.Morph) {
          const cycleSec = KINETIC_LIMITS.morphBaseDurationSec / Math.max(0.25, kineticSpeed);
          const omega = (Math.PI * 2) / cycleSec;
          activeMorphT = 0.5 - 0.5 * Math.cos(kineticClockRef.current * omega);
          morphProgressRef.current = activeMorphT;

          if (now - lastSyncTs >= 120) {
            lastSyncTs = now;
            setMorphProgress(activeMorphT);
          }
        }

        const canvas = committedCanvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (canvas && ctx) {
          const dpr = window.devicePixelRatio || 1;
          clearCanvasSurface(ctx, canvas.width, canvas.height);
          renderKineticWorldSceneOnContext(
            ctx,
            wedges,
            symmetryParams,
            camera,
            viewportSize.displaySize,
            dpr,
            viewportSize.width,
            viewportSize.height,
            kineticMode,
            kineticClockRef.current,
            kineticSpeed,
            activeProgress,
            concentricBreathing,
            kineticMode === KineticMode.Morph
              ? {
                  fromStrokes: morphSourceStrokes,
                  toStrokes: morphTargetStrokes,
                  morphProgress: activeMorphT,
                }
              : undefined
          );
        }
      }
      if (kineticMode !== KineticMode.StrokeReplay || replayProgressRef.current < 1) {
        rafId = requestAnimationFrame(tick);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [
    kineticMode,
    lens.enabled,
    canvasMotionGate.canAnimate,
    canvasMotionGate.targetFps,
    kineticSpeed,
    wedges,
    symmetryParams,
    camera,
    viewportSize.displaySize,
    viewportSize.width,
    viewportSize.height,
    concentricBreathing,
    morphSourceStrokes,
    morphTargetStrokes,
    setReplayProgress,
    setMorphProgress,
    setKineticPlaying,
  ]);

  // Clean up WebGL2 compositor completely on unmount
  useEffect(() => {
    return () => {
      if (lensCompositorRef.current) {
        lensCompositorRef.current.dispose();
        lensCompositorRef.current = null;
      }
      if (lensSourceCanvasRef.current) {
        lensSourceCanvasRef.current.width = 0;
        lensSourceCanvasRef.current.height = 0;
        lensSourceCanvasRef.current = null;
      }
      if (customLensCanvasRef.current) {
        customLensCanvasRef.current.width = 0;
        customLensCanvasRef.current.height = 0;
        customLensCanvasRef.current = null;
      }
    };
  }, []);

  const stampSinglePoint = useCallback(
    (pt: Point) => {
      const effectiveWidth = pressureEnabled
        ? Math.max(2, strokeWidth * (0.65 + (pt.pressure ?? 0.5)))
        : strokeWidth;
      const pointStroke: WedgeStroke = {
        id: `point_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        points: [pt],
        stroke: activeColor,
        strokeWidth: effectiveWidth,
        dash: null,
        opacity: MANDALA_LIMITS.defaultOpacity,
      };
      commitStroke(pointStroke);
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

      const newStroke: WedgeStroke = {
        id: `stroke_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        points: buf.toPoints(),
        stroke: activeColor,
        strokeWidth: effectiveWidth,
        dash: activeDash,
        opacity: MANDALA_LIMITS.defaultOpacity,
      };
      commitStroke(newStroke);
    }
    buf.reset();
    isDrawingRef.current = false;
    setIsActivelyDrawing(false);
    activePointerIdRef.current = null;
    schedulePreviewFrame();
  }, [activeColor, strokeWidth, activeDash, pressureEnabled, commitStroke, schedulePreviewFrame]);

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      e.preventDefault();
      const factor =
        e.deltaY < 0
          ? CAMERA_LIMITS.wheelZoomFactor
          : 1 / CAMERA_LIMITS.wheelZoomFactor;
      const anchor = toScreenLocalPoint(e.clientX, e.clientY, 0.5);
      zoomAtScreenPoint(
        camera.zoom * factor,
        anchor,
        viewportSize.displaySize,
        viewportSize.width,
        viewportSize.height
      );
    },
    [
      camera.zoom,
      toScreenLocalPoint,
      viewportSize.displaySize,
      viewportSize.width,
      viewportSize.height,
      zoomAtScreenPoint,
    ]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const screenPt = toScreenLocalPoint(
        e.clientX,
        e.clientY,
        pressureEnabled && e.pressure > 0 ? e.pressure : 0.5
      );
      activePointersRef.current.set(e.pointerId, screenPt);

      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic pointer fallback
      }

      // 2-Finger Pinch-to-Zoom + Two-Finger Pan
      if (activePointersRef.current.size === 2) {
        pointBufferRef.current.reset();
        isDrawingRef.current = false;
        setIsActivelyDrawing(false);
        isPanningRef.current = false;
        isTiltingLensRef.current = false;
        const pts = Array.from(activePointersRef.current.values());
        prevPinchDistRef.current = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        prevPinchMidRef.current = {
          x: (pts[0].x + pts[1].x) / 2,
          y: (pts[0].y + pts[1].y) / 2,
        };
        schedulePreviewFrame();
        return;
      }

      // Preview-only WebGL2 Lens mode: drag tilts light smoothly
      if (lens.enabled) {
        isTiltingLensRef.current = true;
        activePointerIdRef.current = e.pointerId;
        lastPanScreenRef.current = screenPt;
        return;
      }

      // Preview-only Zen & Replay mode: pan or let double-click / Disegna return to Flat drawing
      if (kineticMode !== KineticMode.Off) {
        isPanningRef.current = true;
        activePointerIdRef.current = e.pointerId;
        lastPanScreenRef.current = screenPt;
        return;
      }

      // Panning via Middle Click, Pan Tool, or Space+Drag
      const wantsPan =
        e.button === 1 || isPanToolActive || isSpaceHeldRef.current;
      if (wantsPan) {
        isPanningRef.current = true;
        activePointerIdRef.current = e.pointerId;
        lastPanScreenRef.current = screenPt;
        return;
      }

      if (e.button !== 0 && e.pointerType === 'mouse') return;

      activePointerIdRef.current = e.pointerId;
      isDrawingRef.current = true;
      setIsActivelyDrawing(true);
      isKeyboardModeRef.current = false;

      const pressure = pressureEnabled && e.pressure > 0 ? e.pressure : 0.5;
      const pt = toWorldPoint(e.clientX, e.clientY, pressure);

      if (activeTool === ToolId.Point) {
        stampSinglePoint(pt);
        isDrawingRef.current = false;
        setIsActivelyDrawing(false);
        return;
      }

      if (activeTool === ToolId.Stamp) {
        stampAnchorRef.current = pt;
        stampTargetRef.current = null;
        schedulePreviewFrame();
        return;
      }

      if (activeTool === ToolId.Eraser) {
        eraserHoverPtRef.current = pt;
        schedulePreviewFrame();
        eraseAtPoint(pt, eraserRadius);
        return;
      }

      pointBufferRef.current.reset();
      pointBufferRef.current.push(pt.x, pt.y, pressure);
      schedulePreviewFrame();
    },
    [
      toScreenLocalPoint,
      pressureEnabled,
      lens.enabled,
      kineticMode,
      isPanToolActive,
      toWorldPoint,
      activeTool,
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

      // Handle Multi-Touch Pinch-to-Zoom + Pan
      if (activePointersRef.current.size === 2) {
        const pts = Array.from(activePointersRef.current.values());
        const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        const mid = {
          x: (pts[0].x + pts[1].x) / 2,
          y: (pts[0].y + pts[1].y) / 2,
        };

        if (prevPinchMidRef.current) {
          panByScreenDelta(
            mid.x - prevPinchMidRef.current.x,
            mid.y - prevPinchMidRef.current.y,
            viewportSize.displaySize
          );
        }
        if (prevPinchDistRef.current && prevPinchDistRef.current > 8 && dist > 8) {
          const ratio = dist / prevPinchDistRef.current;
          zoomAtScreenPoint(
            camera.zoom * ratio,
            mid,
            viewportSize.displaySize,
            viewportSize.width,
            viewportSize.height
          );
        }

        prevPinchDistRef.current = dist;
        prevPinchMidRef.current = mid;
        return;
      }

      // Handle interactive Tilt while in WebGL2 Lens preview mode
      if (lens.enabled) {
        if (isTiltingLensRef.current && lastPanScreenRef.current) {
          const dx = (screenPt.x - lastPanScreenRef.current.x) / Math.max(120, viewportSize.displaySize);
          const dy = (screenPt.y - lastPanScreenRef.current.y) / Math.max(120, viewportSize.displaySize);
          setLensTilt(lens.tiltX + dx * 0.6, lens.tiltY + dy * 0.6);
          lastPanScreenRef.current = screenPt;
        }
        return;
      }

      // Handle Viewport Panning
      if (isPanningRef.current && lastPanScreenRef.current) {
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
        if (isDrawingRef.current) {
          eraseAtPoint(worldPt, eraserRadius);
        }
        return;
      }

      if (activeTool === ToolId.Stamp && isDrawingRef.current && stampAnchorRef.current) {
        stampTargetRef.current = worldPt;
        schedulePreviewFrame();
        return;
      }

      if (!isDrawingRef.current || activeTool !== ToolId.Brush) return;
      const worldMinDistSq = computeWorldMinDistSq(
        RESOURCE_GUARD_LIMITS.pointerMinDistanceSq,
        camera.zoom
      );
      const pushed = pointBufferRef.current.pushIfMoved(
        worldPt.x,
        worldPt.y,
        pressure,
        worldMinDistSq
      );
      if (pushed) {
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
    isDrawingRef.current = false;
    setIsActivelyDrawing(false);
    activePointerIdRef.current = null;
    schedulePreviewFrame();
  }, [
    stampScale,
    activeStampArchetype,
    activeColor,
    strokeWidth,
    activeDash,
    commitStampStrokes,
    schedulePreviewFrame,
  ]);

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      activePointersRef.current.delete(e.pointerId);
      if (activePointersRef.current.size < 2) {
        prevPinchDistRef.current = null;
        prevPinchMidRef.current = null;
      }

      if (activePointerIdRef.current === e.pointerId) {
        isPanningRef.current = false;
        isTiltingLensRef.current = false;
        lastPanScreenRef.current = null;

        if (!lens.enabled && isDrawingRef.current && activeTool === ToolId.Brush) {
          commitCurrentStroke();
        } else if (!lens.enabled && isDrawingRef.current && activeTool === ToolId.Stamp) {
          commitCurrentStamp();
        } else {
          isDrawingRef.current = false;
          setIsActivelyDrawing(false);
          activePointerIdRef.current = null;
        }
      }

      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore if already released
      }
    },
    [lens.enabled, activeTool, commitCurrentStroke, commitCurrentStamp]
  );

  const handlePointerCancel = useCallback(() => {
    activePointersRef.current.clear();
    prevPinchDistRef.current = null;
    prevPinchMidRef.current = null;
    pointBufferRef.current.reset();
    stampAnchorRef.current = null;
    stampTargetRef.current = null;
    eraserHoverPtRef.current = null;
    isDrawingRef.current = false;
    isPanningRef.current = false;
    isTiltingLensRef.current = false;
    lastPanScreenRef.current = null;
    setIsActivelyDrawing(false);
    activePointerIdRef.current = null;
    schedulePreviewFrame();
  }, [schedulePreviewFrame]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.code === 'Space' && !isKeyboardModeRef.current && !lens.enabled) {
        isSpaceHeldRef.current = true;
      }

      if (e.key === '+' || e.key === '=') {
        setZoom(camera.zoom * CAMERA_LIMITS.buttonZoomFactor, viewportSize.displaySize);
        e.preventDefault();
        return;
      }
      if (e.key === '-' || e.key === '_') {
        setZoom(camera.zoom / CAMERA_LIMITS.buttonZoomFactor, viewportSize.displaySize);
        e.preventDefault();
        return;
      }
      if (e.key === '0' && (e.ctrlKey || e.metaKey)) {
        resetViewport();
        e.preventDefault();
        return;
      }

      if (lens.enabled && (e.key === 'Escape' || e.key === 'Enter')) {
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
          if (lens.enabled) {
            exitLensForDrawing();
          }
          isKeyboardModeRef.current = true;
          const initialCursor = { x: LOGICAL_CENTER.x, y: LOGICAL_CENTER.y };
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

      const step = (e.shiftKey ? 24 : 8) / Math.max(0.5, camera.zoom);
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

      const movedCursor = { x: nextX, y: nextY };
      keyboardCursorRef.current = movedCursor;
      announceLiveMessage(
        formatCrosshairAnnouncement(movedCursor, activeTool === ToolId.Eraser)
      );
      schedulePreviewFrame();
      e.preventDefault();
    },
    [
      lens.enabled,
      kineticMode,
      camera.zoom,
      viewportSize.displaySize,
      worldRadius,
      setZoom,
      resetViewport,
      exitLensForDrawing,
      exitKineticMode,
      activeTool,
      announceLiveMessage,
      commitCurrentStroke,
      eraseAtPoint,
      eraserRadius,
      schedulePreviewFrame,
      stampSinglePoint,
      commitCurrentStamp,
    ]
  );

  const cursorClass =
    lens.enabled || kineticMode !== KineticMode.Off
      ? 'cursor-grab active:cursor-grabbing'
      : isPanToolActive
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
        isTiltingLensRef.current = false;
        isPanningRef.current = false;
        schedulePreviewFrame();
      }}
      style={{ touchAction: 'none' }}
    >
      {/* Flat View Layer Stack (Full-Bleed Phase A World Viewport) */}
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

      {/* Preview-Only WebGL2 Hemispherical Lens Compositor */}
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

      {/* WebGL Error Recovery Notice */}
      {lensWebglError && (
        <div
          role="alert"
          className="absolute top-16 left-4 z-30 flex items-center gap-2 px-3 py-2 bg-rose-950/90 border border-rose-700 rounded-xl text-xs text-rose-200"
        >
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{lensWebglError}</span>
        </div>
      )}

      {/* Zen & Time-Lapse Replay Floating Transport Bar */}
      {!lens.enabled && kineticMode !== KineticMode.Off && (
        <Suspense fallback={null}>
          <KineticReplayBar />
        </Suspense>
      )}

      {/* Phase A Viewport + WebGL2 Lens Controls HUD */}
      <div onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
        <ViewportLensHud
          displaySize={viewportSize.displaySize}
          maxGpuTextureSize={maxGpuTextureSize}
          onUploadCustomTexture={handleUploadCustomLensBitmap}
          onRestoreCanvasTexture={handleRestoreCanvasLensTexture}
        />
      </div>

      {/* Synchronized Parametric Accessibility Mirror */}
      <div id="mandala-parametric-desc" className="sr-only">
        {parametricDescription}
      </div>
    </div>
  );
};
