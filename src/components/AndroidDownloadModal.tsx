/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Dedicated Menu Modal for Android APK Download, SHA-256 Verification,
 * PWA Install Option, Hybrid Host Self-Updater, and 120Hz Native Stylus Handover.
 */

import React, { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  HelpCircle,
  PenTool,
  RefreshCw,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { ANDROID_DISTRIBUTION_DEFAULTS } from '../features/mandala/model/constants.ts';
import { MANDALA_MESSAGES } from '../features/mandala/model/messages.ts';
import {
  AndroidUpdateState,
  HostRuntimeKind,
  type AndroidBridgeStatusSnapshot,
  type ReleaseManifest,
} from '../features/mandala/model/types.ts';
import { buildMandalaDocument } from '../features/mandala/lib/persistence.ts';
import { useMandalaStore } from '../features/mandala/model/store.ts';
import { copyToClipboard } from '../shared/lib/browserExport.ts';
import {
  checkAndroidUpdateViaBridge,
  detectHostRuntime,
  fetchSameOriginReleaseManifest,
  formatByteSizeMb,
  openNativeStylusViaBridge,
  queryAndroidBridgeStatus,
  triggerAndroidInstallUpdateViaBridge,
} from '../shared/lib/androidBridge.ts';
import { usePWAInstall } from '../shared/pwa/usePWAInstall.ts';
import { ModalShell } from '../shared/ui/ModalShell.tsx';

interface AndroidDownloadModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

function resolveUpdateStateLabel(state: AndroidUpdateState): string {
  switch (state) {
    case AndroidUpdateState.Checking:
      return 'Verifica aggiornamenti in corso';
    case AndroidUpdateState.UpToDate:
      return 'App aggiornata alla build più recente';
    case AndroidUpdateState.UpdateAvailable:
      return 'Nuova versione APK disponibile';
    case AndroidUpdateState.Downloading:
      return 'Download APK verificato in corso';
    case AndroidUpdateState.ReadyToInstall:
      return 'APK pronto per l’installazione';
    case AndroidUpdateState.OfflineOrUnavailable:
      return 'Rete o release non raggiungibile';
    case AndroidUpdateState.Error:
      return 'Errore durante la verifica aggiornamenti';
    case AndroidUpdateState.Idle:
    default:
      return 'Pronto per la verifica aggiornamenti';
  }
}

export const AndroidDownloadModal: React.FC<AndroidDownloadModalProps> = ({ isOpen, onClose }) => {
  const [manifest, setManifest] = useState<ReleaseManifest | null>(null);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [isLoadingManifest, setIsLoadingManifest] = useState<boolean>(false);
  const [bridgeStatus, setBridgeStatus] = useState<AndroidBridgeStatusSnapshot | null>(null);
  const [copiedSha, setCopiedSha] = useState<boolean>(false);
  const [copiedHelpCmd, setCopiedHelpCmd] = useState<boolean>(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [showIosGuide, setShowIosGuide] = useState<boolean>(false);
  const [showSetupHelp, setShowSetupHelp] = useState<boolean>(false);

  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();

  const wedges = useMandalaStore((s) => s.wedges);
  const symmetryParams = useMandalaStore((s) => s.symmetryParams);
  const activePalette = useMandalaStore((s) => s.activePalette);
  const activeColor = useMandalaStore((s) => s.activeColor);
  const strokeWidth = useMandalaStore((s) => s.strokeWidth);
  const activeDash = useMandalaStore((s) => s.activeDash);
  const camera = useMandalaStore((s) => s.camera);
  const worldRadius = useMandalaStore((s) => s.worldRadius);

  const runtime = detectHostRuntime();
  const isAndroidHost = runtime === HostRuntimeKind.AndroidHybridHost;

  useEffect(() => {
    if (!isOpen) return;
    let active = true;

    setActionNotice(null);
    setBridgeStatus(isAndroidHost ? queryAndroidBridgeStatus() : null);

    setIsLoadingManifest(true);
    void fetchSameOriginReleaseManifest().then((res) => {
      if (!active) return;
      setIsLoadingManifest(false);
      if (res.ok) {
        setManifest(res.value);
        setManifestError(null);
      } else {
        setManifest(null);
        setManifestError(res.error);
      }
    });

    const handleBridgeUpdate = () => {
      if (!active) return;
      setBridgeStatus(queryAndroidBridgeStatus());
    };
    window.addEventListener(
      ANDROID_DISTRIBUTION_DEFAULTS.androidUpdateStatusEvent,
      handleBridgeUpdate
    );

    return () => {
      active = false;
      window.removeEventListener(
        ANDROID_DISTRIBUTION_DEFAULTS.androidUpdateStatusEvent,
        handleBridgeUpdate
      );
    };
  }, [isOpen, isAndroidHost]);

  if (!isOpen) return null;

  const displayVersion =
    bridgeStatus?.hostVersionName ??
    manifest?.versionName ??
    ANDROID_DISTRIBUTION_DEFAULTS.defaultVersionName;
  const displayCode =
    bridgeStatus?.hostVersionCode ??
    manifest?.versionCode ??
    ANDROID_DISTRIBUTION_DEFAULTS.defaultVersionCode;
  const minSdk = manifest?.minSdk ?? ANDROID_DISTRIBUTION_DEFAULTS.minSdk;
  const apkUrl = manifest?.apkDownloadUrl ?? ANDROID_DISTRIBUTION_DEFAULTS.fallbackApkDownloadUrl;
  const releasePageUrl =
    manifest?.releasePageUrl ?? ANDROID_DISTRIBUTION_DEFAULTS.fallbackReleasePageUrl;

  const handleCopySha = async () => {
    if (!manifest?.sha256) return;
    const res = await copyToClipboard(manifest.sha256);
    if (res.ok) {
      setCopiedSha(true);
      setTimeout(() => setCopiedSha(false), 2000);
    }
  };

  const handleCopyHelpCmd = async () => {
    const res = await copyToClipboard(MANDALA_MESSAGES.distribution.setupHelpCommand);
    if (res.ok) {
      setCopiedHelpCmd(true);
      setTimeout(() => setCopiedHelpCmd(false), 2000);
    }
  };

  const handleCheckUpdates = () => {
    const next = checkAndroidUpdateViaBridge();
    if (next) {
      setBridgeStatus(next);
      setActionNotice(resolveUpdateStateLabel(next.updateState));
    }
  };

  const handleInstallUpdate = () => {
    const started = triggerAndroidInstallUpdateViaBridge();
    if (started) {
      setActionNotice('Installer di sistema avviato per il pacchetto verificato.');
    }
  };

  const handleOpenNativeStylus = () => {
    const docPayload = buildMandalaDocument({
      title: `${MANDALA_MESSAGES.workspace.defaultDocTitlePrefix} Stylus`,
      symmetryParams,
      wedges,
      paletteId: activePalette.id,
      activeColour: activeColor,
      activeStrokeWidth: strokeWidth,
      activeDash,
      worldRadius,
      camera,
    });
    const launched = openNativeStylusViaBridge(JSON.stringify(docPayload));
    setActionNotice(
      launched
        ? MANDALA_MESSAGES.distribution.stylusHandoverSent
        : MANDALA_MESSAGES.distribution.stylusUnavailable
    );
  };

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title={
        isAndroidHost
          ? MANDALA_MESSAGES.distribution.modalTitleAndroid
          : MANDALA_MESSAGES.distribution.modalTitleWeb
      }
      subtitle={
        isAndroidHost
          ? MANDALA_MESSAGES.distribution.modalSubtitleAndroid
          : MANDALA_MESSAGES.distribution.modalSubtitleWeb
      }
      ariaLabel={
        isAndroidHost
          ? MANDALA_MESSAGES.distribution.modalTitleAndroid
          : MANDALA_MESSAGES.distribution.modalTitleWeb
      }
      closeButtonAriaLabel="Chiudi scheda Android"
      icon={<Smartphone className="w-5 h-5" />}
      iconContainerClassName="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
      maxWidthClassName="max-w-xl"
      footer={
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span className="font-mono tabular-nums">
            {ANDROID_DISTRIBUTION_DEFAULTS.androidPackageId} · API {minSdk}+
          </span>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] px-4 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition"
          >
            Chiudi
          </button>
        </div>
      }
    >
      <div className="p-6 space-y-6 text-sm text-slate-200 overflow-y-auto">
        {/* Clean Unboxed Version Metadata Strip */}
        <div className="pb-4 border-b border-slate-800 space-y-1.5">
          <p className="text-xs text-slate-400">Versione di riferimento e requisiti</p>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm font-medium text-white tabular-nums">
            <span className="font-mono text-cyan-300">v{displayVersion}</span>
            <span className="text-slate-600" aria-hidden="true">
              ·
            </span>
            <span className="font-mono text-slate-300">Build {displayCode}</span>
            <span className="text-slate-600" aria-hidden="true">
              ·
            </span>
            <span>Android 9+ (SDK {minSdk})</span>
            {manifest?.apkSizeBytes && (
              <>
                <span className="text-slate-600" aria-hidden="true">
                  ·
                </span>
                <span className="font-mono text-slate-300">
                  {formatByteSizeMb(manifest.apkSizeBytes)}
                </span>
              </>
            )}
          </div>
          {isLoadingManifest && (
            <p className="text-xs text-slate-400">Lettura manifest release in corso...</p>
          )}
          {manifestError && (
            <p className="text-xs text-amber-300">{manifestError}</p>
          )}
        </div>

        {/* Android Hybrid Host Native Controls */}
        {isAndroidHost ? (
          <div className="space-y-5">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">
                  Motore Stilo Nativo &amp; Aggiornamenti
                </h3>
                <span className="text-xs font-mono text-emerald-300 tabular-nums">
                  {bridgeStatus
                    ? resolveUpdateStateLabel(bridgeStatus.updateState)
                    : 'Bridge attivo'}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={handleOpenNativeStylus}
                  disabled={bridgeStatus ? !bridgeStatus.supportsNativeStylus : false}
                  className="min-h-[44px] flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-slate-950 bg-cyan-400 hover:bg-cyan-300 disabled:opacity-40 rounded-xl transition whitespace-nowrap"
                >
                  <PenTool className="w-4 h-4 shrink-0" />
                  <span>{MANDALA_MESSAGES.distribution.openStylusCta}</span>
                </button>

                <button
                  type="button"
                  onClick={handleCheckUpdates}
                  disabled={bridgeStatus ? !bridgeStatus.supportsSelfUpdate : false}
                  className="min-h-[44px] flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-slate-100 bg-slate-800 hover:bg-slate-700 border border-slate-700 disabled:opacity-40 rounded-xl transition whitespace-nowrap"
                >
                  <RefreshCw className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>{MANDALA_MESSAGES.distribution.checkUpdatesCta}</span>
                </button>
              </div>

              {bridgeStatus &&
                (bridgeStatus.updateState === AndroidUpdateState.UpdateAvailable ||
                  bridgeStatus.updateState === AndroidUpdateState.ReadyToInstall) && (
                  <button
                    type="button"
                    onClick={handleInstallUpdate}
                    className="w-full min-h-[44px] flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-slate-950 bg-emerald-400 hover:bg-emerald-300 rounded-xl transition whitespace-nowrap"
                  >
                    <Download className="w-4 h-4 shrink-0" />
                    <span>
                      {MANDALA_MESSAGES.distribution.installUpdateCta}
                      {bridgeStatus.availableVersionName
                        ? ` (v${bridgeStatus.availableVersionName})`
                        : ''}
                    </span>
                  </button>
                )}
            </div>
          </div>
        ) : (
          /* Web / PWA / TWA Distribution Surface */
          <div className="space-y-5">
            <div className="flex flex-col sm:flex-row gap-3">
              <a
                href={apkUrl}
                download={ANDROID_DISTRIBUTION_DEFAULTS.apkAssetName}
                rel="noopener noreferrer"
                className="flex-1 min-h-[44px] flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-slate-950 bg-cyan-400 hover:bg-cyan-300 rounded-xl transition whitespace-nowrap"
              >
                <Download className="w-4 h-4 shrink-0" />
                <span>{MANDALA_MESSAGES.distribution.downloadApkCta}</span>
              </a>

              <a
                href={releasePageUrl}
                rel="noopener noreferrer"
                className="min-h-[44px] flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl transition whitespace-nowrap"
              >
                <ExternalLink className="w-4 h-4 text-slate-400 shrink-0" />
                <span>{MANDALA_MESSAGES.distribution.openReleasesCta}</span>
              </a>
            </div>

            {/* SHA-256 Verification Block */}
            <div className="pt-4 border-t border-slate-800 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
                  <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                  Verifica Integrità SHA-256
                </span>
                {manifest?.sha256 && (
                  <button
                    type="button"
                    onClick={() => void handleCopySha()}
                    className="min-h-[36px] flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-cyan-300 hover:text-cyan-200 bg-slate-800 hover:bg-slate-700 rounded-lg transition whitespace-nowrap"
                  >
                    {copiedSha ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>
                      {copiedSha
                        ? MANDALA_MESSAGES.distribution.copiedShaCta
                        : MANDALA_MESSAGES.distribution.copyShaCta}
                    </span>
                  </button>
                )}
              </div>

              {manifest?.sha256 ? (
                <code className="block p-3 bg-slate-950 border border-slate-800 rounded-xl text-[11px] font-mono text-cyan-300 break-all select-all">
                  {manifest.sha256}
                </code>
              ) : (
                <div className="space-y-2.5">
                  <p className="text-xs text-slate-400 leading-relaxed">
                    {MANDALA_MESSAGES.distribution.shaPendingNotice}
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowSetupHelp((v) => !v)}
                    aria-expanded={showSetupHelp}
                    className="min-h-[40px] w-full flex items-center justify-between gap-2 px-3 py-2 text-xs font-medium text-amber-200 bg-amber-950/30 hover:bg-amber-950/50 border border-amber-500/30 rounded-xl transition"
                  >
                    <span className="flex items-center gap-2 text-left">
                      <HelpCircle className="w-4 h-4 text-amber-400 shrink-0" />
                      <span>{MANDALA_MESSAGES.distribution.setupHelpToggle}</span>
                    </span>
                    <span className="font-mono text-[11px] text-amber-300">
                      {showSetupHelp ? 'Nascondi' : 'Help'}
                    </span>
                  </button>
                  {showSetupHelp && (
                    <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl space-y-2.5 text-xs text-slate-300 leading-relaxed">
                      <p className="text-slate-200 font-medium">
                        Passaggi che richiedono credenziali umane (non eseguibili dal sandbox):
                      </p>
                      <ol className="list-decimal pl-4 space-y-1 text-slate-400">
                        <li>
                          Genera il keystore sul tuo PC con JDK 17+ e carica i 5 Secrets su GitHub (
                          <code className="text-cyan-300">ANDROID_KEYSTORE_BASE64</code>,{' '}
                          <code className="text-cyan-300">ANDROID_KEYSTORE_PASSWORD</code>,{' '}
                          <code className="text-cyan-300">ANDROID_KEY_ALIAS</code>,{' '}
                          <code className="text-cyan-300">ANDROID_KEY_PASSWORD</code>,{' '}
                          <code className="text-cyan-300">ANDROID_SIGNING_CERT_SHA256</code>).
                        </li>
                        <li>
                          Abilita GitHub Pages con sorgente{' '}
                          <strong className="text-slate-200">GitHub Actions</strong> (o usa{' '}
                          <code className="text-cyan-300">--apply-gh</code>).
                        </li>
                        <li>
                          Esegui <code className="text-cyan-300">git tag v1.0.0 &amp;&amp; git push origin v1.0.0</code>.
                        </li>
                      </ol>
                      <div className="flex items-center justify-between gap-2 pt-1">
                        <code className="flex-1 p-2 bg-slate-900 border border-slate-800 rounded-lg text-[11px] font-mono text-cyan-300 overflow-x-auto">
                          {MANDALA_MESSAGES.distribution.setupHelpCommand}
                        </code>
                        <button
                          type="button"
                          onClick={() => void handleCopyHelpCmd()}
                          className="min-h-[36px] px-2.5 py-1 text-xs font-medium text-cyan-300 bg-slate-800 hover:bg-slate-700 rounded-lg transition shrink-0"
                        >
                          {copiedHelpCmd ? 'Copiato' : 'Copia'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Secondary PWA Install Path */}
            {!isInstalled && (isInstallable || isIOS) && (
              <div className="pt-4 border-t border-slate-800 space-y-2.5">
                <p className="text-xs text-slate-400">
                  Alternativa senza pacchetto APK: installazione diretta come Web App offline.
                </p>
                {isInstallable && (
                  <button
                    type="button"
                    onClick={() => void install()}
                    className="min-h-[44px] w-full flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium text-slate-100 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl transition"
                  >
                    <Download className="w-4 h-4 text-cyan-400" />
                    <span>Installa come Web App (PWA)</span>
                  </button>
                )}
                {isIOS && (
                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={() => setShowIosGuide((v) => !v)}
                      className="min-h-[44px] w-full flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium text-slate-100 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl transition"
                    >
                      <span>Guida installazione iPhone / iPad (Safari)</span>
                    </button>
                    {showIosGuide && (
                      <p className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-300 leading-relaxed">
                        Tocca <strong>Condividi</strong> nella barra di Safari e scegli{' '}
                        <strong>Aggiungi alla schermata Home</strong>.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {actionNotice && (
          <p
            role="status"
            aria-live="polite"
            className="pt-3 border-t border-slate-800 text-xs text-cyan-300"
          >
            {actionNotice}
          </p>
        )}
      </div>
    </ModalShell>
  );
};
