/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Layer 1/2 2D Canvas Render Pipeline + WebGL2 Lens Lifecycle + Kinetic Animation Loop Hook.
 */

import type React from 'react';
import { useCallback, useEffect, useRef } from 'react';
import {
  DiagnosticSeverity,
  DiagnosticSource,
  DomainErrorCode,
  reportDiagnostic,
} from '../../shared/lib/diagnostics.ts';
import type { MotionExecutionGate } from '../../shared/lib/motionLifecycle.ts';
import {
  KINETIC_LIMITS,
  LOGICAL_CANVAS_SIZE,
  LOGICAL_CENTER,
} from '../../features/mandala/model/constants.ts';
import {
  KineticMode,
  ToolId,
  type CameraTransform,
  type LensConfig,
  type Point,
  type StampArchetypeId,
  type SymmetryParams,
  type WedgeStroke,
} from '../../features/mandala/model/types.ts';
import {
  clearCanvasSurface,
  renderEraserReticle,
  renderKeyboardCrosshair,
  renderKineticWorldSceneOnContext,
  renderStampPreview,
  renderSupersampledLensSourceCanvas,
  renderTypedBufferPreview,
  renderWorldSceneOnContext,
} from '../../features/mandala/lib/canvasRenderer.ts';
import {
  computeStampPlacementVector,
  generateBotanicalStampStrokes,
} from '../../features/mandala/lib/proceduralStamps.ts';
import type { PreparedMorphPlan } from '../../features/mandala/lib/morphInterpolator.ts';
import { resolveEffectiveLensTextureSize } from '../../features/mandala/lib/lensProjection.ts';
import { getResourceHealthSnapshot } from '../../features/mandala/lib/resourceGuard.ts';
import { applyCameraTransformToContext } from '../../features/mandala/lib/viewportCamera.ts';
import type { LensCompositorInstance } from '../../features/mandala/lib/lensWebglPass.ts';
import type { TypedPointBuffer } from '../../features/mandala/memory/pointBuffer.ts';
import { resolveSafeBackingStoreDpr } from '../../features/mandala/lib/canvasPointerFsm.ts';

export interface ViewportDimensions {
  readonly width: number;
  readonly height: number;
  readonly displaySize: number;
}

export interface UseCanvasRenderPipelineArgs {
  readonly viewportSize: ViewportDimensions;
  readonly committedCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  readonly previewCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  readonly lensCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  readonly lensSourceCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  readonly customLensCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  readonly lensCompositorRef: React.MutableRefObject<LensCompositorInstance | null>;
  readonly lensSourceSigRef: React.MutableRefObject<string>;
  readonly pointBufferRef: React.MutableRefObject<TypedPointBuffer>;
  readonly stampAnchorRef: React.MutableRefObject<Point | null>;
  readonly stampTargetRef: React.MutableRefObject<Point | null>;
  readonly eraserHoverPtRef: React.MutableRefObject<Point | null>;
  readonly keyboardCursorRef: React.MutableRefObject<Point | null>;
  readonly isKeyboardModeRef: React.MutableRefObject<boolean>;
  readonly wedges: readonly WedgeStroke[];
  readonly sceneVersion: number;
  readonly symmetryParams: SymmetryParams;
  readonly camera: CameraTransform;
  readonly useEscapeHatch: boolean;
  readonly activeColor: string;
  readonly strokeWidth: number;
  readonly activeDash: readonly number[] | null;
  readonly activeTool: ToolId;
  readonly activeStampArchetype: StampArchetypeId;
  readonly stampScale: number;
  readonly eraserRadius: number;
  readonly lens: LensConfig;
  readonly lensMotionGate: MotionExecutionGate;
  readonly canvasMotionGate: MotionExecutionGate;
  readonly customTextureEpoch: number;
  readonly kineticMode: KineticMode;
  readonly kineticSpeed: number;
  readonly replayProgress: number;
  readonly concentricBreathing: number;
  readonly morphSourceStrokes: readonly WedgeStroke[];
  readonly morphTargetStrokes: readonly WedgeStroke[];
  readonly morphProgress: number;
  readonly preparedMorphPlan: PreparedMorphPlan | undefined;
  readonly setLensEnabled: (enabled: boolean) => void;
  readonly setMaxGpuTextureSize: (size: number) => void;
  readonly setLensWebglError: (msg: string | null) => void;
  readonly setReplayProgress: (p: number) => void;
  readonly setMorphProgress: (t: number) => void;
  readonly setKineticPlaying: (playing: boolean) => void;
}

export function useCanvasRenderPipeline(args: UseCanvasRenderPipelineArgs) {
  const {
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
  } = args;

  const hasCommittedPaintRef = useRef<boolean>(false);
  const hasPreviewPaintRef = useRef<boolean>(false);
  const previewRafIdRef = useRef<number | null>(null);
  const lensConfigRef = useRef(lens);
  lensConfigRef.current = lens;
  const lensAnimTimeRef = useRef<number>(0);
  const kineticClockRef = useRef<number>(0);
  const replayProgressRef = useRef<number>(replayProgress);
  replayProgressRef.current = replayProgress;
  const morphProgressRef = useRef<number>(morphProgress);
  morphProgressRef.current = morphProgress;

  const renderCommittedLayer = useCallback(() => {
    const canvas = committedCanvasRef.current;
    if (!canvas) return;
    if (wedges.length === 0 && kineticMode === KineticMode.Off && !hasCommittedPaintRef.current) {
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = resolveSafeBackingStoreDpr(viewportSize.width, viewportSize.height);
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
              preparedPlan: preparedMorphPlan,
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
      useEscapeHatch,
      sceneVersion,
      viewportSize.width,
      viewportSize.height
    );
  }, [
    committedCanvasRef,
    wedges,
    symmetryParams,
    camera,
    viewportSize.displaySize,
    viewportSize.width,
    viewportSize.height,
    useEscapeHatch,
    sceneVersion,
    kineticMode,
    lens.enabled,
    kineticSpeed,
    replayProgress,
    concentricBreathing,
    morphSourceStrokes,
    morphTargetStrokes,
    morphProgress,
    preparedMorphPlan,
  ]);

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

    const dpr = resolveSafeBackingStoreDpr(viewportSize.width, viewportSize.height);
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
          dash: activeDash ? [...activeDash] : null,
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
    previewCanvasRef,
    pointBufferRef,
    stampAnchorRef,
    stampTargetRef,
    eraserHoverPtRef,
    keyboardCursorRef,
    isKeyboardModeRef,
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

  useEffect(() => {
    const dpr = resolveSafeBackingStoreDpr(viewportSize.width, viewportSize.height);
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
  }, [committedCanvasRef, previewCanvasRef, viewportSize.width, viewportSize.height]);

  useEffect(() => {
    if (kineticMode !== KineticMode.Off && !lens.enabled && canvasMotionGate.canAnimate) {
      return;
    }
    renderCommittedLayer();
  }, [renderCommittedLayer, kineticMode, lens.enabled, canvasMotionGate.canAnimate]);

  useEffect(() => {
    renderPreviewLayer();
  }, [renderPreviewLayer]);

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
      const msg = 'Contesto GPU WebGL2 perso: ripristinata la Vista Piana.';
      setLensWebglError(msg);
      reportDiagnostic({
        severity: DiagnosticSeverity.Warning,
        source: DiagnosticSource.WebGL2,
        code: DomainErrorCode.WebGl2ContextLost,
        message: msg,
        userNotice: msg,
      });
      setLensEnabled(false);
    };
    canvas.addEventListener('webglcontextlost', handleContextLost);

    const renderLensPass = (compositor: LensCompositorInstance) => {
      const dpr = resolveSafeBackingStoreDpr(viewportSize.displaySize, viewportSize.displaySize);
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

      const sourceSig =
        lens.hasCustomTexture && customLensCanvasRef.current
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
      void import('../../features/mandala/lib/lensWebglPass.ts').then((mod) => {
        if (cancelled) return;
        const instance = mod.createWebGL2LensCompositor(canvas);
        if (!instance) {
          const msg = 'WebGL2 non disponibile su questo dispositivo.';
          setLensWebglError(msg);
          reportDiagnostic({
            severity: DiagnosticSeverity.Warning,
            source: DiagnosticSource.WebGL2,
            code: DomainErrorCode.WebGl2Unavailable,
            message: msg,
            userNotice: msg,
          });
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
    lensCanvasRef,
    lensCompositorRef,
    lensSourceCanvasRef,
    customLensCanvasRef,
    lensSourceSigRef,
    setMaxGpuTextureSize,
    setLensWebglError,
  ]);

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
  }, [lens.enabled, lensMotionGate.canAnimate, lensMotionGate.targetFps, lensCompositorRef]);

  useEffect(() => {
    if (kineticMode === KineticMode.Off || lens.enabled || !canvasMotionGate.canAnimate) {
      return;
    }

    let rafId = 0;
    const minFrameIntervalMs = 1000 / Math.max(15, canvasMotionGate.targetFps);
    let lastTs = performance.now() - minFrameIntervalMs;
    let lastSyncTs = lastTs;

    const tick = (now: number) => {
      const dtMs = now - lastTs;
      if (dtMs >= minFrameIntervalMs) {
        const dtSec = Math.min(0.05, Math.max(0, dtMs / 1000));
        const frameStart = performance.now();
        kineticClockRef.current += dtSec;

        let activeProgress = replayProgressRef.current;
        let activeMorphT = morphProgressRef.current;
        if (kineticMode === KineticMode.StrokeReplay) {
          const durationSec = KINETIC_LIMITS.replayBaseDurationSec / Math.max(0.25, kineticSpeed);
          activeProgress = Math.min(1, activeProgress + dtSec / durationSec);
          replayProgressRef.current = activeProgress;

          if (now - lastSyncTs >= 120 || activeProgress >= 1) {
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

          if (now - lastSyncTs >= 180) {
            lastSyncTs = now;
            setMorphProgress(activeMorphT);
          }
        }

        const canvas = committedCanvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (canvas && ctx) {
          const dpr = resolveSafeBackingStoreDpr(viewportSize.width, viewportSize.height);
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
                  preparedPlan: preparedMorphPlan,
                }
              : undefined
          );
        }

        const renderCostMs = performance.now() - frameStart;
        lastTs = renderCostMs > minFrameIntervalMs * 0.75 ? performance.now() : now;
      }
      if (kineticMode !== KineticMode.StrokeReplay || replayProgressRef.current < 1) {
        rafId = requestAnimationFrame(tick);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [
    committedCanvasRef,
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
    preparedMorphPlan,
    setReplayProgress,
    setMorphProgress,
    setKineticPlaying,
  ]);

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
  }, [lensCompositorRef, lensSourceCanvasRef, customLensCanvasRef]);

  return { schedulePreviewFrame };
}
