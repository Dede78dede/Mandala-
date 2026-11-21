import { test, expect } from '@playwright/test';

test.describe('Phase 5 Strict CSP, Local Fonts & Threading Header Verification', () => {
  test('Production preview serves Strict CSP, excludes COOP/COEP, uses zero external font domains, and runs WASM Worker cleanly', async ({
    page,
  }, testInfo) => {
    const externalRequests: string[] = [];
    const cspViolations: string[] = [];

    page.on('request', (req) => {
      const url = new URL(req.url());
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
          externalRequests.push(req.url());
        }
      }
    });

    await page.addInitScript(() => {
      window.addEventListener('securitypolicyviolation', (ev) => {
        (window as unknown as { __cspViolations?: string[] }).__cspViolations ??= [];
        (window as unknown as { __cspViolations: string[] }).__cspViolations.push(
          `${ev.violatedDirective}:${ev.blockedURI}`
        );
      });
    });

    const response = await page.goto('/');
    expect(response).not.toBeNull();
    const headers = response!.headers();

    const csp = headers['content-security-policy'];
    expect(csp).toBeTruthy();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(csp).toContain("worker-src 'self'");
    expect(csp).toContain("font-src 'self'");
    expect(csp).not.toContain('fonts.googleapis.com');
    expect(csp).not.toContain('fonts.gstatic.com');

    // ADR PH4-THREADING: Explicitly verify NO COOP/COEP headers are emitted
    expect(headers['cross-origin-opener-policy']).toBeUndefined();
    expect(headers['cross-origin-embedder-policy']).toBeUndefined();

    // Wait for fonts & initial hydration
    await page.evaluate(() => document.fonts.ready);

    // Trigger WASM L-System worker execution under Strict CSP
    if (testInfo.project.name === 'chromium-mobile') {
      await page.getByRole('button', { name: 'Opzioni Simmetria e Stile' }).click();
    } else {
      await page.getByRole('button', { name: 'Apri menù principale' }).click();
    }
    await page.getByRole('button', { name: /Generatore Frattali L-System/i }).click();
    const dialog = page.getByRole('dialog', { name: /Generatore Procedurale/i });
    await dialog.locator('#lsys-gen').fill('5');
    await dialog.getByRole('button', { name: /Genera su Mandala/i }).click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    const recordedViolations = await page.evaluate(
      () => (window as unknown as { __cspViolations?: string[] }).__cspViolations ?? []
    );
    expect(recordedViolations).toEqual([]);
    expect(cspViolations).toEqual([]);
    expect(externalRequests).toEqual([]);
  });
});
