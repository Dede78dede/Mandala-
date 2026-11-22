/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase A Camera 2D HUD & Actionable WebGL2 Hemispherical Lens Inspector Deck.
 * - Single-line controls (whitespace-nowrap, >= 40px desktop / >= 44px mobile touch targets)
 * - Dual-coded GPU VRAM / texture downgrade badge (Icon + explicit text)
 * - Segmented optical mode switcher (Cupola, Vetro, Iperbolico) + labeled numeric sliders
 */

import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  ZoomIn,
  ZoomOut,
  Hand,
  Compass,
  Globe,
  Pencil,
  ShieldCheck,
  ShieldAlert,
  RotateCcw,
  SlidersHorizontal,
  ChevronDown,
  Play,
  Pause,
  ImagePlus,
} from 'lucide-react';
import {
  CAMERA_LIMITS,
  KALEIDOSCOPE_LIMITS,
  LENS_LIMITS,
} from '../features/mandala/model/constants.ts';
import {
  LensProfile,
  LensTextureQuality,
} from '../features/mandala/model/types.ts';
import { useMandalaStore } from '../features/mandala/model/store.ts';
import { resolveEffectiveLensTextureSize } from '../features/mandala/lib/lensProjection.ts';
import { getResourceHealthSnapshot } from '../features/mandala/lib/resourceGuard.ts';
import {
  describeMotionPauseReason,
  useMotionLifecycle,
} from '../shared/lib/motionLifecycle.ts';
import { MANDALA_MESSAGES } from '../features/mandala/model/messages.ts';
import { withBlobUrlAsync, withImageBitmap } from '../shared/lib/contextManager.ts';
import {
  DiagnosticSeverity,
  DiagnosticSource,
  DomainErrorCode,
  reportDiagnostic,
} from '../shared/lib/diagnostics.ts';

interface ViewportLensHudProps {
  readonly displaySize: number;
  readonly maxGpuTextureSize: number;
  readonly onUploadCustomTexture?: (bitmap: ImageBitmap) => void;
  readonly onRestoreCanvasTexture?: () => void;
}

const LENS_PROFILE_OPTIONS: ReadonlyArray<{
  readonly id: LensProfile;
  readonly label: string;
}> = [
  { id: LensProfile.SphericalDome, label: 'Cupola' },
  { id: LensProfile.RefractiveGlass, label: 'Vetro' },
  { id: LensProfile.PoincareDisk, label: 'Iperbolico' },
  { id: LensProfile.StainedGlass, label: 'Vetrata' },
  { id: LensProfile.Kaleidoscope, label: 'Caleidoscopio' },
];

async function decodeOfflineImageBitmap(file: File): Promise<ImageBitmap> {
  if (typeof createImageBitmap === 'function') {
    return await createImageBitmap(file);
  }
  return await withBlobUrlAsync(file, async (objectUrl) => {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error(MANDALA_MESSAGES.media.imageDecodeFailed));
      el.src = objectUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.drawImage(img, 0, 0);
    return await createImageBitmap(canvas);
  });
}

export const ViewportLensHud: React.FC<ViewportLensHudProps> = memo(
  ({ displaySize, maxGpuTextureSize, onUploadCustomTexture, onRestoreCanvasTexture }) => {
    const wedges = useMandalaStore((s) => s.wedges);
    const symmetryParams = useMandalaStore((s) => s.symmetryParams);
    const camera = useMandalaStore((s) => s.camera);
    const isPanToolActive = useMandalaStore((s) => s.isPanToolActive);
    const lens = useMandalaStore((s) => s.lens);

    const setZoom = useMandalaStore((s) => s.setZoom);
    const setIsPanToolActive = useMandalaStore((s) => s.setIsPanToolActive);
    const resetViewport = useMandalaStore((s) => s.resetViewport);
    const setLensEnabled = useMandalaStore((s) => s.setLensEnabled);
    const setLensProfile = useMandalaStore((s) => s.setLensProfile);
    const setLensCurvature = useMandalaStore((s) => s.setLensCurvature);
    const setLensRefractiveIndex = useMandalaStore((s) => s.setLensRefractiveIndex);
    const setLensFresnel = useMandalaStore((s) => s.setLensFresnel);
    const setLensTextureQuality = useMandalaStore((s) => s.setLensTextureQuality);
    const setLensAnimating = useMandalaStore((s) => s.setLensAnimating);
    const setLensBreatheAmplitude = useMandalaStore((s) => s.setLensBreatheAmplitude);
    const setLensHueShiftSpeed = useMandalaStore((s) => s.setLensHueShiftSpeed);
    const setKaleidoscopeFolds = useMandalaStore((s) => s.setKaleidoscopeFolds);
    const setKaleidoscopeTwist = useMandalaStore((s) => s.setKaleidoscopeTwist);
    const resetLensTilt = useMandalaStore((s) => s.resetLensTilt);
    const exitLensForDrawing = useMandalaStore((s) => s.exitLensForDrawing);

    const imageUploadRef = useRef<HTMLInputElement>(null);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [isLensPanelCollapsed, setIsLensPanelCollapsed] = useState<boolean>(() =>
      typeof window !== 'undefined' ? window.innerWidth < 768 : false
    );

    useEffect(() => {
      if (lens.enabled && typeof window !== 'undefined' && window.innerWidth < 768) {
        setIsLensPanelCollapsed(true);
      }
    }, [lens.enabled]);

    const health = useMemo(
      () => getResourceHealthSnapshot(wedges, symmetryParams),
      [wedges, symmetryParams]
    );
    const motionGate = useMotionLifecycle(Boolean(lens.isAnimating), health.cpuLoadState);
    const motionNotice = describeMotionPauseReason(motionGate.pauseReason);

    const texturePlan = useMemo(
      () =>
        resolveEffectiveLensTextureSize({
          requestedQuality: lens.textureQuality,
          cpuLoadState: health.cpuLoadState,
          memoryPressure: health.memoryPressure,
          maxGpuTextureSize,
          currentSceneBytes: health.l1BytesUsed + health.l2WedgeHeapBytes,
        }),
      [
        lens.textureQuality,
        health.cpuLoadState,
        health.memoryPressure,
        health.l1BytesUsed,
        health.l2WedgeHeapBytes,
        maxGpuTextureSize,
      ]
    );

    const zoomPercent = Math.round(camera.zoom * 100);
    const isDefaultCamera =
      Math.abs(camera.zoom - 1) < 0.01 &&
      Math.abs(camera.panX) < 0.5 &&
      Math.abs(camera.panY) < 0.5;

    const handleOfflineImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      if (file.size > KALEIDOSCOPE_LIMITS.maxUploadFileBytes) {
        setUploadError(MANDALA_MESSAGES.media.imageTooLarge);
        reportDiagnostic({
          severity: DiagnosticSeverity.Warning,
          source: DiagnosticSource.WebGL2,
          code: DomainErrorCode.ImageDecodeFailed,
          message: `Upload immagine rifiutato (${file.size} B > ${KALEIDOSCOPE_LIMITS.maxUploadFileBytes} B).`,
          userNotice: MANDALA_MESSAGES.media.imageTooLarge,
        });
        return;
      }
      try {
        const bitmap = await decodeOfflineImageBitmap(file);
        await withImageBitmap(bitmap, (bmp) => {
          setUploadError(null);
          onUploadCustomTexture?.(bmp);
        });
      } catch (cause) {
        setUploadError(MANDALA_MESSAGES.media.imageDecodeFailed);
        reportDiagnostic({
          severity: DiagnosticSeverity.Warning,
          source: DiagnosticSource.WebGL2,
          code: DomainErrorCode.ImageDecodeFailed,
          message: 'Decodifica immagine locale fallita.',
          userNotice: MANDALA_MESSAGES.media.imageDecodeFailed,
          cause,
        });
      }
    };

    return (
      <>
        {/* Top-Right Compact Viewport & Lens Activation Bar */}
        <div
          className="absolute top-2.5 right-2.5 sm:right-4 z-30 flex flex-wrap items-center justify-end gap-1.5"
          role="region"
          aria-label="Controlli Zoom, Pan e Lente Semisferica"
        >
          <div className="flex items-center gap-1 p-1 bg-slate-900/95 backdrop-blur-md border border-slate-800 rounded-xl shadow-lg">
            <button
              type="button"
              onClick={() => setZoom(camera.zoom / CAMERA_LIMITS.buttonZoomFactor, displaySize)}
              disabled={camera.zoom <= CAMERA_LIMITS.minZoom}
              className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-35 transition"
              title="Riduci Zoom"
              aria-label="Riduci Zoom"
            >
              <ZoomOut className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={resetViewport}
              className={`min-h-[40px] px-2.5 rounded-lg font-mono text-xs font-medium tabular-nums transition whitespace-nowrap ${
                isDefaultCamera
                  ? 'text-slate-300 hover:bg-slate-800'
                  : 'text-cyan-300 bg-cyan-950/50 border border-cyan-800/60 hover:bg-cyan-900/50'
              }`}
              title="Reimposta Camera al 100% e centra"
              aria-label={`Zoom attuale ${zoomPercent} percento, clicca per centrare`}
            >
              {zoomPercent}%
            </button>

            <button
              type="button"
              onClick={() => setZoom(camera.zoom * CAMERA_LIMITS.buttonZoomFactor, displaySize)}
              disabled={camera.zoom >= CAMERA_LIMITS.maxZoom}
              className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-35 transition"
              title="Aumenta Zoom"
              aria-label="Aumenta Zoom"
            >
              <ZoomIn className="w-4 h-4" />
            </button>

            {!lens.enabled && (
              <button
                type="button"
                onClick={() => setIsPanToolActive(!isPanToolActive)}
                aria-pressed={isPanToolActive}
                className={`min-h-[40px] flex items-center gap-1.5 px-2.5 rounded-lg text-xs font-medium transition whitespace-nowrap ${
                  isPanToolActive
                    ? 'bg-cyan-500 text-slate-950 font-semibold'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800'
                }`}
                title="Sposta area di lavoro (oppure Spazio + Trascina)"
              >
                <Hand className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden sm:inline">Pan</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setLensEnabled(!lens.enabled)}
              aria-pressed={lens.enabled}
              data-testid="toggle-lens-button"
              className={`min-h-[40px] flex items-center gap-1.5 px-3 rounded-lg text-xs font-semibold transition whitespace-nowrap ${
                lens.enabled
                  ? 'bg-cyan-400 text-slate-950 hover:bg-cyan-300 shadow-sm'
                  : 'bg-slate-800 text-slate-100 hover:bg-slate-700 border border-slate-700'
              }`}
              title={
                lens.enabled
                  ? 'Torna alla Vista Piana per disegnare'
                  : 'Attiva anteprima Lente Semisferica WebGL2'
              }
            >
              {lens.enabled ? (
                <>
                  <Pencil className="w-3.5 h-3.5 shrink-0" />
                  <span>Vista Piana</span>
                </>
              ) : (
                <>
                  <Globe className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <span>Lente 3D</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Actionable WebGL2 Lens Optical Inspector Deck */}
        {lens.enabled && (
          <aside
            data-testid="lens-controls-panel"
            aria-label="Controlli ottici Lente Semisferica WebGL2"
            className="absolute right-2.5 sm:right-4 top-16 z-30 w-[calc(100%-1.25rem)] max-w-[20rem] bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl text-slate-200 overflow-hidden"
          >
            <div className="flex items-center justify-between px-3.5 py-2 border-b border-slate-800">
              <div className="flex items-center gap-2 min-w-0">
                <SlidersHorizontal className="w-4 h-4 text-cyan-400 shrink-0" />
                <span className="text-xs font-semibold text-white truncate">
                  Lente Semisferica WebGL2
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsLensPanelCollapsed((prev) => !prev)}
                className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                aria-label={isLensPanelCollapsed ? 'Espandi controlli lente' : 'Comprimi controlli lente'}
              >
                <ChevronDown
                  className={`w-4 h-4 transition-transform ${isLensPanelCollapsed ? '' : 'rotate-180'}`}
                />
              </button>
            </div>

            {!isLensPanelCollapsed && (
              <div className="p-3.5 space-y-3 text-xs max-h-[48dvh] sm:max-h-[68vh] overflow-y-auto">
                {/* Dual-Coded VRAM / Texture Status Line (No Pill Sandwich) */}
                <div className="flex items-center justify-between gap-2 text-[11px] pb-2 border-b border-slate-800/80">
                  <span className="flex items-center gap-1.5 text-slate-300">
                    {texturePlan.downgraded ? (
                      <ShieldAlert className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    ) : (
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    )}
                    <span className="font-mono tabular-nums">{texturePlan.label}</span>
                  </span>
                  <span className="font-mono text-slate-400 tabular-nums">
                    {(texturePlan.estimatedVramBytes / (1024 * 1024)).toFixed(1)} MB VRAM
                  </span>
                </div>

                {texturePlan.downgraded && texturePlan.reason && (
                  <p className="text-[11px] text-amber-200 bg-amber-950/40 border border-amber-800/60 rounded-lg px-2.5 py-1.5">
                    {texturePlan.reason}
                  </p>
                )}

                {/* Optical Profile Segmented Control (5 Profiles) */}
                <div className="space-y-1">
                  <span className="text-[11px] font-medium text-slate-400 block">
                    Profilo Ottico
                  </span>
                  <div className="grid grid-cols-3 gap-1 p-1 bg-slate-950 rounded-xl border border-slate-800">
                    {LENS_PROFILE_OPTIONS.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setLensProfile(opt.id)}
                        aria-pressed={lens.profile === opt.id}
                        className={`min-h-[38px] px-1.5 py-1 rounded-lg text-[11px] font-medium transition whitespace-nowrap ${
                          lens.profile === opt.id
                            ? 'bg-cyan-500 text-slate-950 font-semibold shadow-sm'
                            : 'text-slate-300 hover:text-white hover:bg-slate-800/70'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Source Texture Resolution Quality (Auto 2K vs HD 4K Guarded) */}
                <div className="space-y-1">
                  <span className="text-[11px] font-medium text-slate-400 block">
                    Risoluzione Texture Sorgente
                  </span>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setLensTextureQuality(LensTextureQuality.Auto2K)}
                      aria-pressed={lens.textureQuality === LensTextureQuality.Auto2K}
                      className={`min-h-[40px] px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition whitespace-nowrap ${
                        lens.textureQuality === LensTextureQuality.Auto2K
                          ? 'bg-slate-800 border-cyan-400 text-white'
                          : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Auto 2K (2048 px)
                    </button>
                    <button
                      type="button"
                      onClick={() => setLensTextureQuality(LensTextureQuality.Hd4K)}
                      aria-pressed={lens.textureQuality === LensTextureQuality.Hd4K}
                      className={`min-h-[40px] px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition whitespace-nowrap ${
                        lens.textureQuality === LensTextureQuality.Hd4K
                          ? 'bg-slate-800 border-cyan-400 text-white'
                          : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      HD 4K (4096 px)
                    </button>
                  </div>
                </div>

                {/* Labeled Optical Sliders */}
                <div className="space-y-2.5 pt-1">
                  <label className="block space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-300">Curvatura Cupola</span>
                      <span className="font-mono text-cyan-300 tabular-nums">
                        {lens.curvature.toFixed(2)}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={LENS_LIMITS.minCurvature}
                      max={LENS_LIMITS.maxCurvature}
                      step={0.02}
                      value={lens.curvature}
                      onChange={(e) => setLensCurvature(Number(e.target.value))}
                      className="w-full h-2 accent-cyan-400 cursor-pointer"
                    />
                  </label>

                  {lens.profile === LensProfile.RefractiveGlass && (
                    <label className="block space-y-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-300">Indice Rifrazione (n)</span>
                        <span className="font-mono text-cyan-300 tabular-nums">
                          {lens.refractiveIndex.toFixed(2)}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={LENS_LIMITS.minIor}
                        max={LENS_LIMITS.maxIor}
                        step={0.01}
                        value={lens.refractiveIndex}
                        onChange={(e) => setLensRefractiveIndex(Number(e.target.value))}
                        className="w-full h-2 accent-cyan-400 cursor-pointer"
                      />
                    </label>
                  )}

                  {lens.profile === LensProfile.Kaleidoscope && (
                    <>
                      <label className="block space-y-1">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-slate-300">Pieghe Speculari (N)</span>
                          <span className="font-mono text-cyan-300 tabular-nums">
                            {lens.kaleidoscopeFolds ?? KALEIDOSCOPE_LIMITS.defaultFolds}
                          </span>
                        </div>
                        <input
                          type="range"
                          min={KALEIDOSCOPE_LIMITS.minFolds}
                          max={KALEIDOSCOPE_LIMITS.maxFolds}
                          step={1}
                          value={lens.kaleidoscopeFolds ?? KALEIDOSCOPE_LIMITS.defaultFolds}
                          onChange={(e) => setKaleidoscopeFolds(Number(e.target.value))}
                          className="w-full h-2 accent-cyan-400 cursor-pointer"
                        />
                      </label>

                      <label className="block space-y-1">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-slate-300">Torsione Spirale</span>
                          <span className="font-mono text-cyan-300 tabular-nums">
                            {(lens.kaleidoscopeTwist ?? KALEIDOSCOPE_LIMITS.defaultTwist).toFixed(2)}
                          </span>
                        </div>
                        <input
                          type="range"
                          min={KALEIDOSCOPE_LIMITS.minTwist}
                          max={KALEIDOSCOPE_LIMITS.maxTwist}
                          step={0.05}
                          value={lens.kaleidoscopeTwist ?? KALEIDOSCOPE_LIMITS.defaultTwist}
                          onChange={(e) => setKaleidoscopeTwist(Number(e.target.value))}
                          className="w-full h-2 accent-cyan-400 cursor-pointer"
                        />
                      </label>
                    </>
                  )}

                  <label className="block space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-300">Riflesso Fresnel &amp; Luce</span>
                      <span className="font-mono text-cyan-300 tabular-nums">
                        {Math.round(lens.fresnelIntensity * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={LENS_LIMITS.minFresnel}
                      max={LENS_LIMITS.maxFresnel}
                      step={0.02}
                      value={lens.fresnelIntensity}
                      onChange={(e) => setLensFresnel(Number(e.target.value))}
                      className="w-full h-2 accent-cyan-400 cursor-pointer"
                    />
                  </label>
                </div>

                {/* Offline Local Image Texture Upload */}
                <div className="pt-2 border-t border-slate-800/80 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium text-slate-400">
                      Sorgente Texture Locale (Offline)
                    </span>
                    {lens.hasCustomTexture && (
                      <span className="text-[11px] font-medium text-emerald-300">
                        Immagine attiva
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      ref={imageUploadRef}
                      type="file"
                      accept="image/*"
                      onChange={(e) => void handleOfflineImageChange(e)}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => imageUploadRef.current?.click()}
                      className="flex-1 min-h-[38px] inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 rounded-lg transition whitespace-nowrap"
                    >
                      <ImagePlus className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                      <span>Carica Immagine</span>
                    </button>
                    {lens.hasCustomTexture && (
                      <button
                        type="button"
                        onClick={onRestoreCanvasTexture}
                        className="min-h-[38px] inline-flex items-center justify-center px-2.5 py-1.5 text-[11px] font-medium bg-slate-800 hover:bg-slate-700 border border-slate-700 text-amber-300 rounded-lg transition whitespace-nowrap"
                      >
                        Usa Tela
                      </button>
                    )}
                  </div>
                  {uploadError && (
                    <p className="text-[11px] text-rose-300">{uploadError}</p>
                  )}
                </div>

                {/* Kinetic WebGL2 Breathing & Hue Drift Controls */}
                <div className="pt-2 border-t border-slate-800/80 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium text-slate-300">
                      Animazione Ottica GPU
                    </span>
                    <button
                      type="button"
                      data-testid="lens-play-pause"
                      onClick={() => setLensAnimating(!lens.isAnimating)}
                      aria-pressed={Boolean(lens.isAnimating)}
                      className={`min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-semibold transition whitespace-nowrap ${
                        lens.isAnimating
                          ? 'bg-emerald-400 text-slate-950 hover:bg-emerald-300'
                          : 'bg-slate-800 text-slate-200 hover:bg-slate-700 border border-slate-700'
                      }`}
                    >
                      {lens.isAnimating ? (
                        <>
                          <Pause className="w-3.5 h-3.5 shrink-0" />
                          <span>Pausa</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5 shrink-0" />
                          <span>Play Respiro</span>
                        </>
                      )}
                    </button>
                  </div>

                  {motionNotice && (
                    <p className="text-[11px] text-amber-200 bg-amber-950/40 border border-amber-800/60 rounded-lg px-2.5 py-1.5">
                      {motionNotice}
                    </p>
                  )}

                  {lens.isAnimating && (
                    <>
                      <label className="block space-y-1">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-slate-300">Ampiezza Respiro</span>
                          <span className="font-mono text-cyan-300 tabular-nums">
                            {Math.round((lens.breatheAmplitude ?? LENS_LIMITS.defaultBreathe) * 100)}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min={LENS_LIMITS.minBreathe}
                          max={LENS_LIMITS.maxBreathe}
                          step={0.01}
                          value={lens.breatheAmplitude ?? LENS_LIMITS.defaultBreathe}
                          onChange={(e) => setLensBreatheAmplitude(Number(e.target.value))}
                          className="w-full h-2 accent-cyan-400 cursor-pointer"
                        />
                      </label>

                      <label className="block space-y-1">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-slate-300">Scorrimento Tinta</span>
                          <span className="font-mono text-cyan-300 tabular-nums">
                            {Math.round((lens.hueShiftSpeed ?? LENS_LIMITS.defaultHueSpeed) * 100)}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min={LENS_LIMITS.minHueSpeed}
                          max={LENS_LIMITS.maxHueSpeed}
                          step={0.05}
                          value={lens.hueShiftSpeed ?? LENS_LIMITS.defaultHueSpeed}
                          onChange={(e) => setLensHueShiftSpeed(Number(e.target.value))}
                          className="w-full h-2 accent-cyan-400 cursor-pointer"
                        />
                      </label>
                    </>
                  )}
                </div>

                {/* Quick Tilt Reset & Draw Return */}
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button
                    type="button"
                    onClick={resetLensTilt}
                    className="min-h-[40px] flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition whitespace-nowrap"
                  >
                    <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                    <span>Centra Luce</span>
                  </button>

                  <button
                    type="button"
                    onClick={exitLensForDrawing}
                    className="min-h-[40px] flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold text-slate-950 bg-cyan-400 hover:bg-cyan-300 rounded-lg transition whitespace-nowrap"
                  >
                    <Pencil className="w-3.5 h-3.5 shrink-0" />
                    <span>Disegna</span>
                  </button>
                </div>

                <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
                  <Compass className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <span>Trascina sulla lente per inclinare la luce</span>
                </p>
              </div>
            )}
          </aside>
        )}
      </>
    );
  }
);

ViewportLensHud.displayName = 'ViewportLensHud';
