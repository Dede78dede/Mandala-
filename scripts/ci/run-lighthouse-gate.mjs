#!/usr/bin/env node
/**
 * CI Quality Gate: Runs Lighthouse CI mobile audit against production Vite preview
 * using preinstalled headless Chromium and asserts Perf >= 0.90, A11y >= 0.95, BP >= 0.90.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROMIUM_SHELL = '/ms-playwright/chrome-headless-shell-linux64/chrome-headless-shell';
const env = { ...process.env };
if (!env.CHROME_PATH && fs.existsSync(CHROMIUM_SHELL)) {
  env.CHROME_PATH = CHROMIUM_SHELL;
}

fs.mkdirSync(path.resolve(process.cwd(), 'reports/lighthouseci'), { recursive: true });

const result = spawnSync('npx', ['lhci', 'autorun', '--config=lighthouserc.json'], {
  stdio: 'inherit',
  env,
});

if (result.status !== 0) {
  console.error(`[LHCI-GATE FAIL] Lighthouse CI exited with status ${result.status ?? 1}`);
  process.exit(result.status ?? 1);
}

console.log('[LHCI-GATE PASS] Mobile Lighthouse thresholds verified (Perf >= 0.90, A11y >= 0.95, BP >= 0.90).');
