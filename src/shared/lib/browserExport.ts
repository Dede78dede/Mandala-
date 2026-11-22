/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Typed Browser Export & Clipboard Helpers using deterministic `withBlobUrl` Context Manager.
 */

import { withBlobUrl } from './contextManager.ts';
import {
  exportBase64ViaAndroidBridge,
  exportTextViaAndroidBridge,
  isAndroidHybridHost,
} from './androidBridge.ts';
import { Result, ok, err } from './result.ts';

function extractBase64Payload(dataUrl: string): { mimeType: string; base64Data: string } | null {
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx < 0) return null;
  const header = dataUrl.slice(0, commaIdx);
  if (!header.includes(';base64')) return null;
  const mimeMatch = header.match(/^data:([^;]+)/);
  const mimeType = mimeMatch?.[1] ?? 'application/octet-stream';
  return { mimeType, base64Data: dataUrl.slice(commaIdx + 1) };
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
  if (isAndroidHybridHost()) {
    const parsed = extractBase64Payload(dataUrl);
    if (parsed && exportBase64ViaAndroidBridge(parsed.base64Data, filename, parsed.mimeType)) {
      return;
    }
  }
  const link = document.createElement('a');
  link.download = filename;
  link.href = dataUrl;
  link.click();
}

export function downloadBlob(blob: Blob, filename: string): void {
  withBlobUrl(blob, (url) => {
    downloadDataUrl(url, filename);
  });
}

export function downloadTextFile(
  content: string,
  filename: string,
  mimeType: string = 'text/plain;charset=utf-8'
): void {
  if (isAndroidHybridHost() && exportTextViaAndroidBridge(content, filename, mimeType)) {
    return;
  }
  const blob = new Blob([content], { type: mimeType });
  downloadBlob(blob, filename);
}

export async function copyToClipboard(text: string): Promise<Result<void, string>> {
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      return err('Clipboard non disponibile in questo contesto.');
    }
    await navigator.clipboard.writeText(text);
    return ok(undefined);
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Impossibile copiare negli appunti.');
  }
}
