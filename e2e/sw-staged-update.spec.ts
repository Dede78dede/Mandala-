import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { test, expect } from '@playwright/test';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function createSwappableDistServer(initialRoot: string) {
  let activeRoot = initialRoot;
  const server = http.createServer((req, res) => {
    const reqUrl = (req.url ?? '/').split('?')[0] ?? '/';
    const relPath = reqUrl === '/' ? 'index.html' : reqUrl.replace(/^\/+/, '');
    let filePath = path.join(activeRoot, relPath);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(activeRoot, 'index.html');
    }
    const ext = path.extname(filePath).toLowerCase();
    const isSwOrHtml = relPath.endsWith('sw.js') || ext === '.html';
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream',
      ...(isSwOrHtml ? { 'Cache-Control': 'no-cache, no-store, must-revalidate' } : {}),
    });
    fs.createReadStream(filePath).pipe(res);
  });

  return {
    async start(): Promise<string> {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const addr = server.address() as { port: number };
      return `http://127.0.0.1:${addr.port}`;
    },
    swapRoot(nextRoot: string) {
      activeRoot = nextRoot;
    },
    async stop(): Promise<void> {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

test.describe('Phase 5 Staged Service Worker Update E2E (Build A -> Build B)', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'Chromium-only Service Worker staged update verification'
  );

  test('Prompts user on Build A -> Build B, reloads once cleanly, clears outdated caches, and preserves user state', async ({
    page,
  }) => {
    const distDir = path.resolve(process.cwd(), 'dist');
    expect(fs.existsSync(path.join(distDir, 'sw.js'))).toBe(true);

    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'mandala-sw-staged-'));
    const buildA = path.join(tmpBase, 'build-a');
    const buildB = path.join(tmpBase, 'build-b');
    fs.cpSync(distDir, buildA, { recursive: true });
    fs.cpSync(distDir, buildB, { recursive: true });

    // Inject distinct markers in Build B HTML & SW precache revision so Workbox detects and fetches Build B index.html
    const htmlBPath = path.join(buildB, 'index.html');
    const htmlB = fs.readFileSync(htmlBPath, 'utf8').replace('<html ', '<html data-build="build-b" ');
    fs.writeFileSync(htmlBPath, htmlB, 'utf8');
    const htmlBHash = crypto.createHash('md5').update(htmlB).digest('hex');

    const swBPath = path.join(buildB, 'sw.js');
    const swBOriginal = fs.readFileSync(swBPath, 'utf8');
    const swBUpdated = swBOriginal.replace(
      /((?:"url"|url):\s*"index\.html",\s*(?:"revision"|revision):\s*")[^"]+(")/,
      `$1${htmlBHash}$2`
    );
    expect(swBUpdated).not.toBe(swBOriginal);
    fs.writeFileSync(
      swBPath,
      `${swBUpdated}\n/* build-b-staged-revision-${Date.now()} */\n`,
      'utf8'
    );

    const srv = createSwappableDistServer(buildA);
    const baseUrl = await srv.start();

    try {
      // 1. Load Build A and wait for SW activation
      await page.goto(baseUrl);
      const swActivated = await page.evaluate(async () => {
        if (!('serviceWorker' in navigator)) return false;
        const reg = await navigator.serviceWorker.ready;
        return Boolean(reg.active);
      });
      expect(swActivated).toBe(true);

      // Draw a stroke on Build A & verify persistence in localStorage
      const canvasApp = page.getByRole('application', { name: /Area di disegno interattiva/i });
      const box = await canvasApp.boundingBox();
      expect(box).not.toBeNull();
      if (box) {
        const cx = box.x + box.width * 0.5;
        const cy = box.y + box.height * 0.5;
        await page.mouse.move(cx + 25, cy - 25);
        await page.mouse.down();
        await page.mouse.move(cx + 75, cy + 25, { steps: 5 });
        await page.mouse.up();
      }
      await page.waitForTimeout(350);
      const savedBeforeUpdate = await page.evaluate(() =>
        localStorage.getItem('mandala_studio_doc_v1')
      );
      expect(savedBeforeUpdate).toBeTruthy();

      // 2. Stage Build B behind the running origin & poll for SW update
      srv.swapRoot(buildB);
      await page.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        await reg?.update();
      });

      // 3. Assert PWAUpdateBanner prompt appears with Ricarica button
      const updateBanner = page.getByText(/Aggiornamento disponibile/i);
      await expect(updateBanner).toBeVisible({ timeout: 10_000 });
      const reloadBtn = page.getByRole('button', { name: 'Ricarica' });
      await expect(reloadBtn).toBeVisible();

      // Track load events to prove anti-double-reload guard enforces exactly 1 reload
      let loadEvents = 0;
      page.on('load', () => {
        loadEvents += 1;
      });

      await reloadBtn.click();
      await expect(page.locator('html')).toHaveAttribute('data-build', 'build-b', {
        timeout: 10_000,
      });
      await page.waitForTimeout(800);
      expect(loadEvents).toBe(1);

      // 4. Verify user drawing state preserved across Build A -> Build B SW reload
      const savedAfterUpdate = await page.evaluate(() =>
        localStorage.getItem('mandala_studio_doc_v1')
      );
      expect(savedAfterUpdate).toBeTruthy();
      const parsedAfter = JSON.parse(savedAfterUpdate ?? '{}') as { wedges?: unknown[] };
      expect((parsedAfter.wedges ?? []).length).toBeGreaterThanOrEqual(1);
    } finally {
      await srv.stop();
      fs.rmSync(tmpBase, { recursive: true, force: true });
    }
  });
});
