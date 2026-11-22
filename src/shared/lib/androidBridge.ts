/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Typed Android Hybrid Host Bridge & Same-Origin Release Manifest Client.
 * Strictly zero `any`, zero non-const `as Type` casts, zero magic strings.
 */

import { ANDROID_DISTRIBUTION_DEFAULTS } from '../../features/mandala/model/constants.ts';
import { MANDALA_MESSAGES } from '../../features/mandala/model/messages.ts';
import {
  parseAndroidBridgeStatus,
  parseReleaseManifest,
} from '../../features/mandala/model/schemas.ts';
import {
  HostRuntimeKind,
  type AndroidBridgeStatusSnapshot,
  type ReleaseManifest,
} from '../../features/mandala/model/types.ts';
import {
  DiagnosticSeverity,
  DiagnosticSource,
  DomainErrorCode,
  reportDiagnostic,
} from './diagnostics.ts';
import { err, ok, type Result } from './result.ts';

export interface AndroidRawBridgeContract {
  getStatusJson?(): unknown;
  exportBase64File?(filename: string, mimeType: string, base64Data: string): unknown;
  exportTextFile?(filename: string, mimeType: string, content: string): unknown;
  openNativeStylusCanvas?(documentJson: string): unknown;
  checkForUpdates?(): unknown;
  installDownloadedUpdate?(): unknown;
}

declare global {
  interface Window {
    readonly __MANDALA_ANDROID_BRIDGE__?: AndroidRawBridgeContract;
  }
}

function resolveBridge(targetWindow: Window | undefined): AndroidRawBridgeContract | null {
  if (!targetWindow) return null;
  const candidate = targetWindow.__MANDALA_ANDROID_BRIDGE__;
  if (typeof candidate !== 'object' || candidate === null) return null;
  return candidate;
}

export function detectHostRuntime(
  targetWindow: Window | undefined = typeof window !== 'undefined' ? window : undefined,
  targetDocument: Document | undefined = typeof document !== 'undefined' ? document : undefined
): HostRuntimeKind {
  if (resolveBridge(targetWindow) !== null) {
    return HostRuntimeKind.AndroidHybridHost;
  }

  if (targetDocument && targetDocument.referrer.startsWith('android-app://')) {
    return HostRuntimeKind.TrustedWebActivity;
  }

  if (targetWindow && typeof targetWindow.matchMedia === 'function') {
    try {
      if (targetWindow.matchMedia('(display-mode: standalone)').matches) {
        return HostRuntimeKind.InstalledPwa;
      }
    } catch {
      // Ignore restricted matchMedia environments
    }
  }

  return HostRuntimeKind.WebBrowser;
}

export function isAndroidHybridHost(): boolean {
  return detectHostRuntime() === HostRuntimeKind.AndroidHybridHost;
}

function parseStatusJsonPayload(rawResult: unknown): AndroidBridgeStatusSnapshot | null {
  if (typeof rawResult !== 'string' || rawResult.trim().length === 0) {
    return null;
  }
  try {
    const parsedJson: unknown = JSON.parse(rawResult);
    const validated = parseAndroidBridgeStatus(parsedJson);
    if (!validated.ok) {
      reportDiagnostic({
        severity: DiagnosticSeverity.Warning,
        source: DiagnosticSource.AndroidBridge,
        code: DomainErrorCode.AndroidBridgeFailed,
        message: validated.error,
      });
      return null;
    }
    return validated.value;
  } catch (cause) {
    reportDiagnostic({
      severity: DiagnosticSeverity.Warning,
      source: DiagnosticSource.AndroidBridge,
      code: DomainErrorCode.AndroidBridgeFailed,
      message: 'Risposta JSON bridge Android non valida.',
      cause,
    });
    return null;
  }
}

export function queryAndroidBridgeStatus(): AndroidBridgeStatusSnapshot | null {
  const bridge = resolveBridge(typeof window !== 'undefined' ? window : undefined);
  if (!bridge || typeof bridge.getStatusJson !== 'function') {
    return null;
  }
  try {
    return parseStatusJsonPayload(bridge.getStatusJson());
  } catch (cause) {
    reportDiagnostic({
      severity: DiagnosticSeverity.Warning,
      source: DiagnosticSource.AndroidBridge,
      code: DomainErrorCode.AndroidBridgeFailed,
      message: 'Errore lettura stato host Android.',
      cause,
    });
    return null;
  }
}

export function exportTextViaAndroidBridge(
  content: string,
  filename: string,
  mimeType: string
): boolean {
  const bridge = resolveBridge(typeof window !== 'undefined' ? window : undefined);
  if (!bridge || typeof bridge.exportTextFile !== 'function') {
    return false;
  }
  try {
    return bridge.exportTextFile(filename, mimeType, content) === true;
  } catch (cause) {
    reportDiagnostic({
      severity: DiagnosticSeverity.Warning,
      source: DiagnosticSource.AndroidBridge,
      code: DomainErrorCode.AndroidBridgeFailed,
      message: MANDALA_MESSAGES.distribution.nativeExportFallback,
      userNotice: MANDALA_MESSAGES.distribution.nativeExportFallback,
      cause,
    });
    return false;
  }
}

export function exportBase64ViaAndroidBridge(
  base64Data: string,
  filename: string,
  mimeType: string
): boolean {
  const bridge = resolveBridge(typeof window !== 'undefined' ? window : undefined);
  if (!bridge || typeof bridge.exportBase64File !== 'function') {
    return false;
  }
  try {
    return bridge.exportBase64File(filename, mimeType, base64Data) === true;
  } catch (cause) {
    reportDiagnostic({
      severity: DiagnosticSeverity.Warning,
      source: DiagnosticSource.AndroidBridge,
      code: DomainErrorCode.AndroidBridgeFailed,
      message: MANDALA_MESSAGES.distribution.nativeExportFallback,
      userNotice: MANDALA_MESSAGES.distribution.nativeExportFallback,
      cause,
    });
    return false;
  }
}

export function openNativeStylusViaBridge(documentJson: string): boolean {
  const bridge = resolveBridge(typeof window !== 'undefined' ? window : undefined);
  if (!bridge || typeof bridge.openNativeStylusCanvas !== 'function') {
    return false;
  }
  try {
    return bridge.openNativeStylusCanvas(documentJson) === true;
  } catch (cause) {
    reportDiagnostic({
      severity: DiagnosticSeverity.Warning,
      source: DiagnosticSource.AndroidBridge,
      code: DomainErrorCode.AndroidBridgeFailed,
      message: 'Avvio Tela Stilo Nativa non riuscito.',
      cause,
    });
    return false;
  }
}

export function checkAndroidUpdateViaBridge(): AndroidBridgeStatusSnapshot | null {
  const bridge = resolveBridge(typeof window !== 'undefined' ? window : undefined);
  if (!bridge || typeof bridge.checkForUpdates !== 'function') {
    return null;
  }
  try {
    return parseStatusJsonPayload(bridge.checkForUpdates());
  } catch (cause) {
    reportDiagnostic({
      severity: DiagnosticSeverity.Warning,
      source: DiagnosticSource.AndroidBridge,
      code: DomainErrorCode.AndroidBridgeFailed,
      message: 'Controllo aggiornamenti Android fallito.',
      cause,
    });
    return null;
  }
}

export function triggerAndroidInstallUpdateViaBridge(): boolean {
  const bridge = resolveBridge(typeof window !== 'undefined' ? window : undefined);
  if (!bridge || typeof bridge.installDownloadedUpdate !== 'function') {
    return false;
  }
  try {
    return bridge.installDownloadedUpdate() === true;
  } catch (cause) {
    reportDiagnostic({
      severity: DiagnosticSeverity.Warning,
      source: DiagnosticSource.AndroidBridge,
      code: DomainErrorCode.AndroidBridgeFailed,
      message: 'Avvio installer APK Android fallito.',
      cause,
    });
    return false;
  }
}

export function resolveSameOriginManifestUrl(
  baseUrlOverride: string | undefined = import.meta.env?.BASE_URL
): string {
  const basePath = baseUrlOverride ?? '/';
  const normalizedBase = basePath.endsWith('/') ? basePath : `${basePath}/`;
  const relativeManifest = ANDROID_DISTRIBUTION_DEFAULTS.releaseManifestPath.replace(/^\/+/, '');
  return `${normalizedBase}${relativeManifest}`;
}

export async function fetchSameOriginReleaseManifest(
  fetchImpl: typeof fetch | undefined = typeof fetch === 'function' ? fetch : undefined
): Promise<Result<ReleaseManifest, string>> {
  if (!fetchImpl) {
    return err(MANDALA_MESSAGES.distribution.manifestLoadFailed);
  }
  try {
    const response = await fetchImpl(resolveSameOriginManifestUrl(), {
      cache: 'no-store',
    });
    if (!response.ok) {
      return err(`${MANDALA_MESSAGES.distribution.manifestLoadFailed} (HTTP ${response.status})`);
    }
    const rawJson: unknown = await response.json();
    const parsed = parseReleaseManifest(rawJson);
    if (!parsed.ok) {
      reportDiagnostic({
        severity: DiagnosticSeverity.Warning,
        source: DiagnosticSource.AndroidBridge,
        code: DomainErrorCode.ReleaseManifestUnavailable,
        message: parsed.error,
      });
      return err(parsed.error);
    }
    return ok(parsed.value);
  } catch (cause) {
    reportDiagnostic({
      severity: DiagnosticSeverity.Info,
      source: DiagnosticSource.AndroidBridge,
      code: DomainErrorCode.ReleaseManifestUnavailable,
      message: MANDALA_MESSAGES.distribution.manifestLoadFailed,
      cause,
    });
    return err(MANDALA_MESSAGES.distribution.manifestLoadFailed);
  }
}

export function formatByteSizeMb(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes <= 0) {
    return 'N/D';
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
