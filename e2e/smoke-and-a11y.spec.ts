import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

interface A11yExemption {
  ruleId: string;
  scope: string;
  owner: string;
  reason: string;
  expiresAt: string;
}

function loadActiveExemptions(): A11yExemption[] {
  const filePath = path.resolve(process.cwd(), 'benchmarks/accessibility-exemptions.json');
  if (!fs.existsSync(filePath)) return [];
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const list = Array.isArray(parsed.exemptions) ? (parsed.exemptions as A11yExemption[]) : [];
  const now = Date.now();
  return list.filter((e) => Date.parse(e.expiresAt) > now);
}

async function runWcagGateAudit(page: Page, contextLabel: string): Promise<void> {
  const exemptions = loadActiveExemptions();
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  const blockingViolations: Array<{
    id: string;
    impact: string;
    nodes: number;
    targets: string[];
    helpUrl: string;
  }> = [];

  for (const v of results.violations) {
    if (v.impact !== 'critical' && v.impact !== 'serious') continue;
    const unexemptedNodes = v.nodes.filter((node) => {
      const targetStr = node.target.join(' ');
      return !exemptions.some((ex) => ex.ruleId === v.id && targetStr.includes(ex.scope));
    });

    if (unexemptedNodes.length > 0) {
      blockingViolations.push({
        id: v.id,
        impact: v.impact ?? 'unknown',
        nodes: unexemptedNodes.length,
        targets: unexemptedNodes.map((n) => n.target.join(' ')),
        helpUrl: v.helpUrl,
      });
    }
  }

  expect(
    blockingViolations,
    `WCAG 2.1 A/AA critical/serious violations on "${contextLabel}": ${JSON.stringify(blockingViolations, null, 2)}`
  ).toEqual([]);
}

test.describe('Phase 5 Chromium E2E Smoke & WCAG 2.1 AA Gate', () => {
  test('Core drawing, WASM L-System Gen 5, keyboard cursor, WebGL2 lens, Zen replay, export modal & Axe WCAG gate', async ({
    page,
  }, testInfo) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/');
    const canvasApp = page.getByRole('application', {
      name: /Area di disegno interattiva/i,
    });
    await expect(canvasApp).toBeVisible();
    await expect(page.getByTestId('mandala-canvas')).toBeVisible();

    // Verify viewport meta does not block zoom (WCAG 1.4.4 / Sprint 0)
    const viewportMeta = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect(viewportMeta).not.toContain('user-scalable=no');
    expect(viewportMeta).not.toContain('maximum-scale=1');

    // Audit 1: Initial workspace WCAG 2.1 A/AA
    await runWcagGateAudit(page, `Initial Workspace (${testInfo.project.name})`);

    // 1. Pointer drawing on canvas
    const box = await canvasApp.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      const cx = box.x + box.width * 0.5;
      const cy = box.y + box.height * 0.5;
      await page.mouse.move(cx + 30, cy - 20);
      await page.mouse.down();
      await page.mouse.move(cx + 85, cy + 40, { steps: 6 });
      await page.mouse.up();
    }

    // 2. Symmetry increment & keyboard crosshair placement
    const isMobile = testInfo.project.name === 'chromium-mobile';
    if (isMobile) {
      await page.getByRole('button', { name: 'Aumenta simmetria' }).click();
    } else {
      await page.getByRole('slider', { name: 'Ordine di simmetria radiale' }).fill('9');
    }
    await canvasApp.focus();
    await page.keyboard.press('ArrowRight'); // activate crosshair
    await page.keyboard.press('Enter'); // commit point 1
    await page.keyboard.press('ArrowUp'); // move crosshair
    await page.keyboard.press('Enter'); // commit point 2
    await page.keyboard.press('Space'); // commit stroke

    // Verify persistence written to localStorage after debounced flush
    await page.waitForTimeout(450);
    const savedRaw = await page.evaluate(() => localStorage.getItem('mandala_studio_doc_v1'));
    expect(savedRaw).toBeTruthy();
    const savedDoc = JSON.parse(savedRaw!);
    expect(savedDoc.wedges.length).toBeGreaterThanOrEqual(2);
    expect(savedDoc.symmetryParams.order).toBe(9);

    // 3. Botanical Stamp tool placement (Module 1A)
    await page.getByRole('button', { name: 'Strumento Timbro Botanico' }).click();
    await expect(page.getByTestId('stamp-archetype-tray')).toBeVisible();
    await page.getByRole('button', { name: 'Loto' }).click();
    if (box) {
      const cx = box.x + box.width * 0.5;
      const cy = box.y + box.height * 0.5;
      await page.mouse.move(cx + 60, cy);
      await page.mouse.down();
      await page.mouse.move(cx + 105, cy + 25, { steps: 4 });
      await page.mouse.up();
    }

    // 4. Open Main Menu or Mobile Options -> Open Procedural Modal & generate Gen 5 WASM + Polar (Module 1B)
    if (isMobile) {
      await page.getByRole('button', { name: 'Opzioni Simmetria e Stile' }).click();
      await runWcagGateAudit(page, 'Mobile Options Sheet');
      await page.getByRole('button', { name: /Generatore Frattali L-System/i }).click();
    } else {
      await page.getByRole('button', { name: 'Apri menù principale' }).click();
      await runWcagGateAudit(page, 'Desktop AppMenu Dialog');
      await page.getByRole('button', { name: /Generatore Frattali L-System/i }).click();
    }

    const fractalDialog = page.getByRole('dialog', { name: /Generatore Procedurale/i });
    await expect(fractalDialog).toBeVisible();
    await runWcagGateAudit(page, `L-System Modal (${testInfo.project.name})`);

    // Set generations to 5 (triggers Phase 5 WASM Worker off-thread escalation)
    await fractalDialog.locator('#lsys-gen').fill('5');
    await expect(fractalDialog).toContainText('WASM Worker');
    await fractalDialog.getByRole('button', { name: /Genera su Mandala/i }).click();
    await expect(fractalDialog).toBeHidden({ timeout: 10_000 });

    // 4B. Re-open Procedural Modal -> Armoniche Polari tab -> generate Rodonea
    if (isMobile) {
      await page.getByRole('button', { name: 'Opzioni Simmetria e Stile' }).click();
    } else {
      await page.getByRole('button', { name: 'Apri menù principale' }).click();
    }
    await page.getByRole('button', { name: /Generatore Frattali L-System/i }).click();
    await expect(fractalDialog).toBeVisible();
    await fractalDialog.getByRole('tab', { name: /Armoniche Polari/i }).click();
    await fractalDialog.getByRole('button', { name: /Rodonea/i }).click();
    await fractalDialog.getByRole('button', { name: /Genera su Mandala/i }).click();
    await expect(fractalDialog).toBeHidden({ timeout: 10_000 });

    // 5. WebGL2 Lens Preview + Kaleidoscope profile + offline image upload/restore (Module 2)
    await page.getByTestId('toggle-lens-button').click();
    await expect(page.getByTestId('mandala-lens-canvas')).toBeVisible();
    const expandLensBtn = page.getByRole('button', { name: 'Espandi controlli lente' });
    if (await expandLensBtn.isVisible()) {
      await expandLensBtn.click();
    }
    await page.getByRole('button', { name: 'Caleidoscopio' }).click();
    await expect(page.getByTestId('mandala-lens-canvas')).toHaveAttribute(
      'data-lens-profile',
      'kaleidoscope'
    );
    await expect(page.getByRole('button', { name: /Carica Immagine/i })).toBeVisible();
    const tinyPngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    await page.locator('input[type="file"][accept="image/*"]').setInputFiles({
      name: 'offline-tile.png',
      mimeType: 'image/png',
      buffer: Buffer.from(tinyPngBase64, 'base64'),
    });
    await expect(page.getByText('Immagine attiva')).toBeVisible();
    const restoreCanvasBtn = page.getByRole('button', { name: 'Usa Tela' });
    await expect(restoreCanvasBtn).toBeVisible();
    await runWcagGateAudit(page, `Kaleidoscope Lens HUD (${testInfo.project.name})`);
    await restoreCanvasBtn.click();
    await expect(page.getByText('Immagine attiva')).toBeHidden();
    // Return to flat view via toggle
    await page.getByTestId('toggle-lens-button').click();
    await expect(page.getByTestId('mandala-lens-canvas')).toBeHidden();

    // 6. Kinetic / Zen Replay + Morphing mode + WCAG audit (Module 4) & exit
    if (isMobile) {
      await page.getByRole('button', { name: 'Opzioni Simmetria e Stile' }).click();
    } else {
      await page.getByRole('button', { name: 'Apri menù principale' }).click();
    }
    await page.getByTestId('menu-zen-replay-button').click();
    const kineticBar = page.getByTestId('kinetic-replay-bar');
    await expect(kineticBar).toBeVisible();
    await kineticBar.getByRole('button', { name: 'Morphing' }).click();
    await expect(
      kineticBar.getByRole('combobox', { name: /Target Armonica Polare per Morphing/i })
    ).toBeVisible();
    await runWcagGateAudit(page, `Kinetic Morph Bar (${testInfo.project.name})`);
    await page.getByTestId('exit-kinetic-button').click();
    await expect(kineticBar).toBeHidden();

    // 7. Export Modal (SVG Path-Drawing Preview + Axe Audit + Escape close, Module 3)
    await page.getByRole('button', { name: 'Esporta', exact: true }).click();
    const exportDialog = page.getByRole('dialog', { name: /Esporta/i });
    await expect(exportDialog).toBeVisible();
    await exportDialog.getByRole('button', { name: /Progressivo/i }).click();
    const svgPreviewImg = exportDialog
      .getByTestId('svg-live-preview')
      .locator('img[alt="Anteprima animata vettoriale SVG"][src^="data:image/svg+xml"]');
    await expect(svgPreviewImg).toBeVisible();
    await runWcagGateAudit(page, `Export Modal (${testInfo.project.name})`);
    await page.keyboard.press('Escape');
    await expect(exportDialog).toBeHidden();

    expect(pageErrors).toEqual([]);
  });
});
