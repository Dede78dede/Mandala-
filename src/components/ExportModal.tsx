/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Export & Zod-Validated Document Import Modal composed via <ModalShell>.
 */

import React, { useState, useRef, useMemo, useEffect } from 'react';
import {
  Download,
  FileCode,
  Image,
  FileJson,
  Upload,
  Check,
  AlertCircle,
  Play,
  Sparkles,
} from 'lucide-react';
import {
  CANVAS_THEME,
  LENS_LIMITS,
  LOGICAL_CANVAS_SIZE,
  LOGICAL_CENTER,
  RESOURCE_GUARD_LIMITS,
  SVG_ANIMATION_LIMITS,
  SVG_DEFAULT_EXPORT_SIZE,
  WORLD_SPACE_LIMITS,
} from '../features/mandala/model/constants.ts';
import { MANDALA_MESSAGES } from '../features/mandala/model/messages.ts';
import {
  PngExportResolution,
  SvgAnimationMode,
  SvgSerializationMode,
  ExportFormat,
  type SvgPathDrawingConfig,
} from '../features/mandala/model/types.ts';
import { useMandalaStore } from '../features/mandala/model/store.ts';
import { formatExportAnnouncement } from '../features/mandala/lib/accessibility.ts';
import {
  DEFAULT_SVG_PATH_DRAWING_CONFIG,
  estimateExpandedSvgPrimitives,
  exportToSVGBenchmarked,
  sampleWedgesForPreview,
} from '../features/mandala/lib/svgExport.ts';
import {
  renderMandalaToPNGDataUrl,
  renderSupersampledLensSourceCanvas,
} from '../features/mandala/lib/canvasRenderer.ts';
import { measureWedgesMaxRadius } from '../features/mandala/lib/viewportCamera.ts';
import { buildMandalaDocument, flushPendingPersistence } from '../features/mandala/lib/persistence.ts';
import { downloadDataUrl, downloadTextFile } from '../shared/lib/browserExport.ts';
import {
  DiagnosticSeverity,
  DiagnosticSource,
  DomainErrorCode,
  reportDiagnostic,
} from '../shared/lib/diagnostics.ts';
import { ModalShell } from '../shared/ui/ModalShell.tsx';
import { OperationStatus, type OperationState } from '../shared/lib/result.ts';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SVG_ANIMATION_OPTIONS: ReadonlyArray<{
  readonly id: SvgAnimationMode;
  readonly label: string;
  readonly ariaLabel: string;
}> = [
  { id: SvgAnimationMode.None, label: 'Statico', ariaLabel: 'Statico: esportazione SVG statica' },
  {
    id: SvgAnimationMode.ConcentricRings,
    label: 'Anelli Zen',
    ariaLabel: 'Anelli Zen: animazione SVG anelli concentrici',
  },
  {
    id: SvgAnimationMode.PathDrawing,
    label: 'Progressivo',
    ariaLabel: 'Progressivo: animazione SVG disegno progressivo',
  },
];

const PNG_RESOLUTION_OPTIONS: ReadonlyArray<{
  size: PngExportResolution;
  label: string;
  sub: string;
}> = [
  { size: PngExportResolution.Standard1K, label: '1024px', sub: '1× Standard' },
  { size: PngExportResolution.Hd2K, label: '2048px', sub: '2× HD 2K' },
  { size: PngExportResolution.Ultra4K, label: '4096px', sub: '4× Ultra 4K' },
];

export const ExportModal: React.FC<ExportModalProps> = ({ isOpen, onClose }) => {
  const wedges = useMandalaStore((s) => s.wedges);
  const symmetryParams = useMandalaStore((s) => s.symmetryParams);
  const activePalette = useMandalaStore((s) => s.activePalette);
  const activeColor = useMandalaStore((s) => s.activeColor);
  const strokeWidth = useMandalaStore((s) => s.strokeWidth);
  const activeDash = useMandalaStore((s) => s.activeDash);
  const camera = useMandalaStore((s) => s.camera);
  const worldRadius = useMandalaStore((s) => s.worldRadius);
  const lens = useMandalaStore((s) => s.lens);
  const importDocumentJSON = useMandalaStore((s) => s.importDocumentJSON);
  const announceLiveMessage = useMandalaStore((s) => s.announceLiveMessage);

  const [resolution, setResolution] = useState<PngExportResolution>(PngExportResolution.Hd2K);
  const [includeBackground, setIncludeBackground] = useState<boolean>(true);
  const [applyLensToPng, setApplyLensToPng] = useState<boolean>(lens.enabled);
  const [useExtendedWorld, setUseExtendedWorld] = useState<boolean>(false);
  const [svgAnimMode, setSvgAnimMode] = useState<SvgAnimationMode>(SvgAnimationMode.None);
  const [pathDrawingCfg, setPathDrawingCfg] = useState<SvgPathDrawingConfig>(
    DEFAULT_SVG_PATH_DRAWING_CONFIG
  );
  const [previewReplayKey, setPreviewReplayKey] = useState<number>(0);
  const [svgMode, setSvgMode] = useState<
    SvgSerializationMode.Auto | SvgSerializationMode.Absolute
  >(SvgSerializationMode.Auto);
  const [isExportingPng, setIsExportingPng] = useState<boolean>(false);
  const [opState, setOpState] = useState<OperationState<string, string>>({
    status: OperationStatus.Idle,
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const contentMaxRadius = useMemo(
    () => measureWedgesMaxRadius(wedges, LOGICAL_CENTER, WORLD_SPACE_LIMITS.baseRadius),
    [wedges]
  );

  useEffect(() => {
    if (isOpen) {
      setApplyLensToPng(lens.enabled);
      setUseExtendedWorld(contentMaxRadius > WORLD_SPACE_LIMITS.baseRadius + 16);
    }
  }, [isOpen, lens.enabled, contentMaxRadius]);

  const exportWorldSpan = useExtendedWorld
    ? Math.max(LOGICAL_CANVAS_SIZE, Math.min(worldRadius * 2, contentMaxRadius * 2))
    : LOGICAL_CANVAS_SIZE;

  const svgBg = includeBackground
    ? CANVAS_THEME.backgroundHex
    : CANVAS_THEME.transparentBackground;

  const expandedSvgPrimitives = useMemo(
    () => estimateExpandedSvgPrimitives(wedges, symmetryParams),
    [wedges, symmetryParams]
  );

  const isHeavySvgScene =
    wedges.length > RESOURCE_GUARD_LIMITS.svgPreviewMemoMaxWedges ||
    expandedSvgPrimitives > RESOURCE_GUARD_LIMITS.svgPreviewMemoMaxExpandedPrimitives;

  const svgPreviewReport = useMemo(() => {
    if (!isOpen || isHeavySvgScene) return null;
    return exportToSVGBenchmarked(
      wedges,
      symmetryParams,
      SVG_DEFAULT_EXPORT_SIZE,
      SVG_DEFAULT_EXPORT_SIZE,
      svgBg,
      svgMode,
      exportWorldSpan,
      svgAnimMode,
      pathDrawingCfg
    );
  }, [
    isOpen,
    isHeavySvgScene,
    wedges,
    symmetryParams,
    svgBg,
    svgMode,
    exportWorldSpan,
    svgAnimMode,
    pathDrawingCfg,
  ]);

  const previewWedges = useMemo(() => {
    if (!isOpen || svgAnimMode === SvgAnimationMode.None || wedges.length === 0) {
      return [];
    }
    const sampled = sampleWedgesForPreview(
      wedges,
      symmetryParams,
      RESOURCE_GUARD_LIMITS.svgLivePreviewMaxExpandedPrimitives
    );
    const spanScale = exportWorldSpan / LOGICAL_CANVAS_SIZE;
    if (spanScale <= 1.05) return sampled;
    return sampled.map((s) => ({
      ...s,
      strokeWidth: Math.max(s.strokeWidth, 3.2 * spanScale),
    }));
  }, [isOpen, svgAnimMode, wedges, symmetryParams, exportWorldSpan]);

  const ghostPreviewUri = useMemo(() => {
    if (previewWedges.length === 0) return null;
    const ghostReport = exportToSVGBenchmarked(
      previewWedges,
      symmetryParams,
      SVG_DEFAULT_EXPORT_SIZE,
      SVG_DEFAULT_EXPORT_SIZE,
      CANVAS_THEME.transparentBackground,
      svgMode,
      exportWorldSpan,
      SvgAnimationMode.None
    );
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(ghostReport.svg)}`;
  }, [previewWedges, symmetryParams, svgMode, exportWorldSpan]);

  const animatedPreviewUri = useMemo(() => {
    if (previewWedges.length === 0 || svgAnimMode === SvgAnimationMode.None) return null;
    const animReport = exportToSVGBenchmarked(
      previewWedges,
      symmetryParams,
      SVG_DEFAULT_EXPORT_SIZE,
      SVG_DEFAULT_EXPORT_SIZE,
      CANVAS_THEME.transparentBackground,
      svgMode,
      exportWorldSpan,
      svgAnimMode,
      pathDrawingCfg
    );
    const stamped = `${animReport.svg}\n<!-- replay:${previewReplayKey} -->`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(stamped)}`;
  }, [
    previewWedges,
    symmetryParams,
    svgMode,
    exportWorldSpan,
    svgAnimMode,
    pathDrawingCfg,
    previewReplayKey,
  ]);

  if (!isOpen) return null;

  const setTempSuccess = (msg: string) => {
    setOpState({ status: OperationStatus.Success, data: msg });
    setTimeout(() => setOpState({ status: OperationStatus.Idle }), 3500);
  };

  const handleExportPNG = async () => {
    if (isExportingPng) return;
    setIsExportingPng(true);
    try {
      // Yield one frame so disabled busy feedback paints cleanly before heavy raster/GPU pass
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 16);
      });

      let dataUrl: string | null = null;

      if (applyLensToPng) {
        let sourceCanvas: HTMLCanvasElement | null = null;
        try {
          const lensPass = await import('../features/mandala/lib/lensWebglPass.ts');
          sourceCanvas = document.createElement('canvas');
          const sourceTexRes = Math.min(
            LENS_LIMITS.standardTexturePx,
            Math.max(LENS_LIMITS.fallbackTexturePx, resolution)
          );
          renderSupersampledLensSourceCanvas(
            sourceCanvas,
            wedges,
            symmetryParams,
            camera,
            sourceTexRes,
            includeBackground
          );
          dataUrl = lensPass.renderLensCompositeToPNGDataUrl(
            sourceCanvas,
            lens,
            resolution,
            includeBackground
          );
        } catch (err) {
          reportDiagnostic({
            severity: DiagnosticSeverity.Warning,
            source: DiagnosticSource.WebGL2,
            code: DomainErrorCode.WebGl2ContextLost,
            message: MANDALA_MESSAGES.webgl.pngLensFallbackNotice,
            cause: err,
          });
          dataUrl = null;
        } finally {
          if (sourceCanvas) {
            sourceCanvas.width = 0;
            sourceCanvas.height = 0;
          }
        }
      }

      if (!dataUrl) {
        dataUrl = renderMandalaToPNGDataUrl(
          wedges,
          symmetryParams,
          resolution,
          includeBackground,
          exportWorldSpan
        );
      }

      if (!dataUrl) {
        setOpState({
          status: OperationStatus.Error,
          error: MANDALA_MESSAGES.export.pngUnavailable,
        });
        return;
      }

      const suffix = applyLensToPng ? `_lens_${lens.profile}` : '';
      downloadDataUrl(
        dataUrl,
        `mandala_${symmetryParams.order}fold_${resolution}x${resolution}${suffix}.png`
      );
      setTempSuccess(
        `PNG ${resolution}×${resolution}${applyLensToPng ? ' con Lente WebGL2' : ''} esportato.`
      );
      announceLiveMessage(
        formatExportAnnouncement(ExportFormat.Png, `${resolution} per ${resolution} pixel`)
      );
    } finally {
      setIsExportingPng(false);
    }
  };

  const handleExportSVG = () => {
    const report = exportToSVGBenchmarked(
      wedges,
      symmetryParams,
      SVG_DEFAULT_EXPORT_SIZE,
      SVG_DEFAULT_EXPORT_SIZE,
      svgBg,
      svgMode,
      exportWorldSpan,
      svgAnimMode,
      pathDrawingCfg
    );
    downloadTextFile(
      report.svg,
      `mandala_${symmetryParams.order}fold_${report.modeUsed}.svg`,
      'image/svg+xml;charset=utf-8'
    );

    const modeLabel = MANDALA_MESSAGES.export.svgModeLabel(report.modeUsed);
    const kb = (report.selectedBytes / 1024).toFixed(1);
    setTempSuccess(`SVG ${modeLabel} (${kb} KB) scaricato.`);
    announceLiveMessage(formatExportAnnouncement(ExportFormat.Svg, `${kb} kilobyte`));
  };

  const handleExportJSON = () => {
    flushPendingPersistence();
    const doc = buildMandalaDocument({
      symmetryParams,
      wedges,
      paletteId: activePalette.id,
      activeColour: activeColor,
      activeStrokeWidth: strokeWidth,
      activeDash,
      worldRadius,
      camera,
    });
    downloadTextFile(
      JSON.stringify(doc, null, 2),
      `mandala_doc_v2_${Date.now()}.json`,
      'application/json;charset=utf-8'
    );
    setTempSuccess(MANDALA_MESSAGES.export.jsonSavedToast);
    announceLiveMessage(formatExportAnnouncement(ExportFormat.Json, `${wedges.length} tratti`));
  };

  const handleImportJSON = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const res = importDocumentJSON(text);
      if (res.ok) {
        setTempSuccess(`Importato "${res.value.title}" (${res.value.wedges.length} tratti).`);
      } else {
        setOpState({ status: OperationStatus.Error, error: res.error });
      }
    } catch (err) {
      reportDiagnostic({
        severity: DiagnosticSeverity.Warning,
        source: DiagnosticSource.Export,
        code: DomainErrorCode.ValidationFailed,
        message: MANDALA_MESSAGES.export.jsonReadFailed,
        cause: err,
      });
      setOpState({ status: OperationStatus.Error, error: MANDALA_MESSAGES.export.jsonReadFailed });
    }
    e.target.value = '';
  };

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title="Esporta e Archivia"
      subtitle="PNG (Vista Piana o Lente WebGL2), SVG o JSON v2"
      icon={<Download className="w-4 h-4" />}
      maxWidthClassName="max-w-md"
      footer={
        <p className="text-[11px] text-slate-400 text-center">
          Le guide visive sono escluse. I JSON v1 e v2 sono entrambi compatibili.
        </p>
      }
    >
      <div className="p-6 space-y-4 text-xs text-slate-300 max-h-[75vh] overflow-y-auto">
        {opState.status === OperationStatus.Success && (
          <div className="p-3 bg-emerald-950/60 border border-emerald-800/80 rounded-xl text-emerald-300 flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{opState.data}</span>
          </div>
        )}

        {opState.status === OperationStatus.Error && (
          <div className="p-3 bg-rose-950/60 border border-rose-800/80 rounded-xl text-rose-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{opState.error}</span>
          </div>
        )}

        <div className="space-y-2">
          <span className="font-semibold text-slate-400 block">Risoluzione Raster PNG</span>
          <div className="grid grid-cols-3 gap-2">
            {PNG_RESOLUTION_OPTIONS.map((res) => (
              <button
                key={res.size}
                onClick={() => setResolution(res.size)}
                className={`p-2.5 rounded-xl border text-center transition ${
                  resolution === res.size
                    ? 'bg-cyan-950/40 border-cyan-400 text-white shadow-sm'
                    : 'bg-slate-800/40 border-slate-700/60 text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="font-bold tabular-nums">{res.label}</div>
                <div className="text-[11px] text-slate-400">{res.sub}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-slate-400">Serializzazione Vettoriale SVG</span>
            <span className="font-mono text-[11px] text-cyan-400 tabular-nums">
              {svgPreviewReport
                ? `${(svgPreviewReport.selectedBytes / 1024).toFixed(1)} KB (${
                    svgPreviewReport.modeUsed === SvgSerializationMode.DefsUse
                      ? '<defs>/<use>'
                      : 'Assoluto'
                  })`
                : 'Calcolo su richiesta (scena densa)'}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setSvgMode(SvgSerializationMode.Auto)}
              className={`p-2 rounded-xl border text-center transition ${
                svgMode === SvgSerializationMode.Auto
                  ? 'bg-purple-950/40 border-purple-400 text-white'
                  : 'bg-slate-800/40 border-slate-700/60 text-slate-400'
              }`}
            >
              <div className="font-semibold">Ottimizzato (Auto)</div>
              <div className="text-[11px] text-slate-400">Sceglie il file più leggero</div>
            </button>
            <button
              onClick={() => setSvgMode(SvgSerializationMode.Absolute)}
              className={`p-2 rounded-xl border text-center transition ${
                svgMode === SvgSerializationMode.Absolute
                  ? 'bg-purple-950/40 border-purple-400 text-white'
                  : 'bg-slate-800/40 border-slate-700/60 text-slate-400'
              }`}
            >
              <div className="font-semibold">Coordinate Assolute</div>
              <div className="text-[11px] text-slate-400">Portabilità universale</div>
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <label className="flex items-center justify-between p-3 bg-slate-800/40 border border-slate-700/60 rounded-xl cursor-pointer">
            <span>Includi sfondo scuro meditativo</span>
            <input
              type="checkbox"
              checked={includeBackground}
              onChange={(e) => setIncludeBackground(e.target.checked)}
              className="w-4 h-4 accent-cyan-400 rounded focus:ring-0 cursor-pointer"
            />
          </label>

          <label className="flex items-center justify-between p-3 bg-slate-800/40 border border-slate-700/60 rounded-xl cursor-pointer">
            <span>Applica Lente Semisferica (solo PNG)</span>
            <input
              type="checkbox"
              checked={applyLensToPng}
              onChange={(e) => setApplyLensToPng(e.target.checked)}
              className="w-4 h-4 accent-cyan-400 rounded focus:ring-0 cursor-pointer"
            />
          </label>

          <label className="flex items-center justify-between p-3 bg-slate-800/40 border border-slate-700/60 rounded-xl cursor-pointer">
            <span>Includi Spazio Mondo Esteso ({exportWorldSpan} px)</span>
            <input
              type="checkbox"
              checked={useExtendedWorld}
              onChange={(e) => setUseExtendedWorld(e.target.checked)}
              className="w-4 h-4 accent-cyan-400 rounded focus:ring-0 cursor-pointer"
            />
          </label>

          <div className="p-3 bg-slate-800/40 border border-slate-700/60 rounded-xl space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                <span>Animazione Vettoriale SVG</span>
              </span>
              {svgAnimMode === SvgAnimationMode.PathDrawing && (
                <button
                  type="button"
                  onClick={() => setPreviewReplayKey((prev) => prev + 1)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-purple-700 hover:bg-purple-500 text-white transition whitespace-nowrap"
                >
                  <Play className="w-3 h-3 shrink-0" />
                  <span>Riproduci</span>
                </button>
              )}
            </div>

            <div
              className="grid grid-cols-3 gap-1 p-1 bg-slate-950 rounded-xl border border-slate-800"
              role="group"
              aria-label="Modalità animazione esportazione SVG"
            >
              {SVG_ANIMATION_OPTIONS.map((opt) => {
                const active = svgAnimMode === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    aria-label={opt.ariaLabel}
                    aria-pressed={active}
                    onClick={() => {
                      setSvgAnimMode(opt.id);
                      setPreviewReplayKey((prev) => prev + 1);
                    }}
                    className={`min-h-[36px] px-1.5 py-1 rounded-lg text-[11px] font-medium transition whitespace-nowrap ${
                      active
                        ? 'bg-purple-700 text-white font-semibold'
                        : 'text-slate-300 hover:text-white hover:bg-slate-800'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            {svgAnimMode === SvgAnimationMode.PathDrawing && (
              <div className="grid grid-cols-2 gap-2.5 pt-1">
                <label className="space-y-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-400">Durata</span>
                    <span className="font-mono text-purple-300 tabular-nums">
                      {pathDrawingCfg.cycleDurationSec.toFixed(1)}s
                    </span>
                  </div>
                  <input
                    type="range"
                    min={SVG_ANIMATION_LIMITS.minCycleDurationSec}
                    max={SVG_ANIMATION_LIMITS.maxCycleDurationSec}
                    step={0.5}
                    value={pathDrawingCfg.cycleDurationSec}
                    onChange={(e) => {
                      setPathDrawingCfg((prev) => ({
                        ...prev,
                        cycleDurationSec: Number(e.target.value),
                      }));
                      setPreviewReplayKey((prev) => prev + 1);
                    }}
                    className="w-full h-1.5 accent-purple-400 cursor-pointer"
                  />
                </label>

                <label className="space-y-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-400">Sfasamento</span>
                    <span className="font-mono text-purple-300 tabular-nums">
                      {pathDrawingCfg.staggerDelayMs}ms
                    </span>
                  </div>
                  <input
                    type="range"
                    min={SVG_ANIMATION_LIMITS.minStaggerDelayMs}
                    max={SVG_ANIMATION_LIMITS.maxStaggerDelayMs}
                    step={15}
                    value={pathDrawingCfg.staggerDelayMs}
                    onChange={(e) => {
                      setPathDrawingCfg((prev) => ({
                        ...prev,
                        staggerDelayMs: Number(e.target.value),
                      }));
                      setPreviewReplayKey((prev) => prev + 1);
                    }}
                    className="w-full h-1.5 accent-purple-400 cursor-pointer"
                  />
                </label>
              </div>
            )}

            {svgAnimMode !== SvgAnimationMode.None && (
              <div
                data-testid="svg-live-preview"
                className="flex flex-col items-center justify-center p-2.5 bg-slate-950 border border-slate-800 rounded-xl"
              >
                {ghostPreviewUri && animatedPreviewUri ? (
                  <div className="flex flex-col items-center gap-1.5">
                    <div
                      className="relative w-44 h-44 rounded-lg overflow-hidden"
                      style={{ backgroundColor: CANVAS_THEME.backgroundHex }}
                    >
                      <img
                        src={ghostPreviewUri}
                        alt=""
                        aria-hidden="true"
                        className="w-full h-full object-contain opacity-20"
                      />
                      <img
                        key={previewReplayKey}
                        src={animatedPreviewUri}
                        alt="Anteprima animata vettoriale SVG"
                        className="absolute inset-0 w-full h-full object-contain"
                      />
                    </div>
                    {previewWedges.length < wedges.length && (
                      <p className="text-[10px] text-slate-400 text-center">
                        Anteprima leggera ({previewWedges.length}/{wedges.length} tracciati base); il file scaricato contiene 100% della geometria.
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-400 py-4 text-center">
                    Disegna o genera un motivo per vedere l’anteprima animata.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-2.5 pt-1">
          <button
            onClick={() => void handleExportPNG()}
            disabled={isExportingPng}
            className="w-full min-h-[44px] flex items-center justify-between p-3.5 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-60 text-slate-950 font-semibold rounded-xl shadow-md transition"
          >
            <span className="flex items-center gap-2">
              <Image className="w-4 h-4" />
              {isExportingPng
                ? 'Generazione PNG in corso...'
                : `Scarica PNG (${resolution}×${resolution}px)`}
            </span>
            <Download className="w-4 h-4" />
          </button>

          <button
            onClick={handleExportSVG}
            className="w-full min-h-[44px] flex items-center justify-between p-3.5 bg-slate-800 hover:bg-slate-700 text-white font-medium rounded-xl border border-slate-700 transition"
          >
            <span className="flex items-center gap-2">
              <FileCode className="w-4 h-4 text-purple-400" />
              Scarica Vettoriale SVG (Zero Perdita)
            </span>
            <Download className="w-4 h-4 text-slate-400" />
          </button>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={handleExportJSON}
              className="flex items-center justify-center gap-1.5 p-3 bg-slate-800/50 hover:bg-slate-800 text-slate-200 font-medium rounded-xl border border-slate-700/80 transition"
            >
              <FileJson className="w-3.5 h-3.5 text-amber-400" />
              <span>Salva JSON</span>
            </button>

            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center justify-center gap-1.5 p-3 bg-slate-800/50 hover:bg-slate-800 text-slate-200 font-medium rounded-xl border border-slate-700/80 transition"
            >
              <Upload className="w-3.5 h-3.5 text-emerald-400" />
              <span>Importa JSON</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              onChange={handleImportJSON}
              className="hidden"
            />
          </div>
        </div>
      </div>
    </ModalShell>
  );
};
