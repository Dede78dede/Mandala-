/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Typed Browser Export & Clipboard Helpers using deterministic `withBlobUrl` Context Manager.
 */

import { withBlobUrl } from './contextManager.ts';
import { Result, ok, err } from './result.ts';

export function downloadDataUrl(dataUrl: string, filename: string): void {
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
