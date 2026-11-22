/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Structured Diagnostic Channel & Typed Domain Error Infrastructure.
 * Eliminates silent swallowed `catch {}` blocks while keeping UI notifications discrete.
 */

export enum DiagnosticSeverity {
  Info = 'info',
  Warning = 'warning',
  Error = 'error',
}

export enum DiagnosticSource {
  Storage = 'storage',
  WasmWorker = 'wasm-worker',
  WebGL2 = 'webgl2',
  Export = 'export',
  Audio = 'audio',
  Viewport = 'viewport',
  AndroidBridge = 'android-bridge',
}

export enum DomainErrorCode {
  StorageQuotaExceeded = 'STORAGE_QUOTA_EXCEEDED',
  StorageAccessDenied = 'STORAGE_ACCESS_DENIED',
  StorageCorrupted = 'STORAGE_CORRUPTED',
  StorageWriteFailed = 'STORAGE_WRITE_FAILED',
  ValidationFailed = 'VALIDATION_FAILED',
  IndexedDbUnavailable = 'INDEXEDDB_UNAVAILABLE',
  WasmInitFailed = 'WASM_INIT_FAILED',
  WasmWorkerTimeout = 'WASM_WORKER_TIMEOUT',
  WasmWorkerCrash = 'WASM_WORKER_CRASH',
  WasmFallbackToJs = 'WASM_FALLBACK_TO_JS',
  WebGl2Unavailable = 'WEBGL2_UNAVAILABLE',
  WebGl2ContextLost = 'WEBGL2_CONTEXT_LOST',
  WebGl2ShaderError = 'WEBGL2_SHADER_ERROR',
  ImageDecodeFailed = 'IMAGE_DECODE_FAILED',
  PointerCaptureDenied = 'POINTER_CAPTURE_DENIED',
  AudioBlocked = 'AUDIO_BLOCKED',
  ClipboardUnavailable = 'CLIPBOARD_UNAVAILABLE',
  AndroidBridgeFailed = 'ANDROID_BRIDGE_FAILED',
  ReleaseManifestUnavailable = 'RELEASE_MANIFEST_UNAVAILABLE',
  Unknown = 'UNKNOWN',
}

export interface DomainError {
  readonly code: DomainErrorCode;
  readonly source: DiagnosticSource;
  readonly message: string;
  readonly recoverable: boolean;
  readonly cause?: unknown;
}

export interface DiagnosticEntry {
  readonly id: string;
  readonly timestampIso: string;
  readonly severity: DiagnosticSeverity;
  readonly source: DiagnosticSource;
  readonly code: DomainErrorCode;
  readonly message: string;
  readonly userNotice?: string;
}

const MAX_DIAGNOSTIC_ENTRIES = 32;
const diagnosticEntries: DiagnosticEntry[] = [];
const listeners = new Set<(entry: DiagnosticEntry) => void>();
let entryCounter = 0;

export function toDomainError(
  code: DomainErrorCode,
  source: DiagnosticSource,
  message: string,
  cause?: unknown,
  recoverable: boolean = true
): DomainError {
  return {
    code,
    source,
    message,
    recoverable,
    ...(cause !== undefined ? { cause } : {}),
  };
}

export function extractErrorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message.trim().length > 0) {
    return cause.message;
  }
  if (typeof cause === 'string' && cause.trim().length > 0) {
    return cause;
  }
  return fallback;
}

export function reportDiagnostic(input: {
  readonly severity: DiagnosticSeverity;
  readonly source: DiagnosticSource;
  readonly code: DomainErrorCode;
  readonly message: string;
  readonly userNotice?: string;
  readonly cause?: unknown;
}): DiagnosticEntry {
  const entry: DiagnosticEntry = {
    id: `diag_${Date.now()}_${++entryCounter}`,
    timestampIso: new Date().toISOString(),
    severity: input.severity,
    source: input.source,
    code: input.code,
    message: input.cause
      ? `${input.message} (${extractErrorMessage(input.cause, 'dettaglio non disponibile')})`
      : input.message,
    ...(input.userNotice ? { userNotice: input.userNotice } : {}),
  };

  diagnosticEntries.push(entry);
  if (diagnosticEntries.length > MAX_DIAGNOSTIC_ENTRIES) {
    diagnosticEntries.splice(0, diagnosticEntries.length - MAX_DIAGNOSTIC_ENTRIES);
  }

  for (const listener of listeners) {
    try {
      listener(entry);
    } catch {
      // Diagnostic listener isolation prevents cascading errors
    }
  }

  return entry;
}

export function subscribeDiagnostics(
  listener: (entry: DiagnosticEntry) => void
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getDiagnosticHistory(): readonly DiagnosticEntry[] {
  return [...diagnosticEntries];
}

export function clearDiagnosticHistory(): void {
  diagnosticEntries.length = 0;
}
