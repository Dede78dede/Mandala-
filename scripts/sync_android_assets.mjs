#!/usr/bin/env node
/**
 * Synchronizes Web `dist/` build artifacts and `version.json` manifest
 * into `android/app/src/main/assets/www/` for offline WebViewAssetLoader hosting.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const DIST_DIR = path.resolve(ROOT, 'dist');
const ANDROID_WWW_DIR = path.resolve(ROOT, 'android/app/src/main/assets/www');
const SKIP_EXTENSIONS = new Set(['.apk', '.aab', '.map']);

function copyDirClean(srcDir, dstDir) {
  fs.rmSync(dstDir, { recursive: true, force: true });
  fs.mkdirSync(dstDir, { recursive: true });

  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const dstPath = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      copyDirClean(srcPath, dstPath);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!SKIP_EXTENSIONS.has(ext)) {
        fs.copyFileSync(srcPath, dstPath);
      }
    }
  }
}

execFileSync('python3', ['scripts/release_manifest.py'], { stdio: 'inherit', cwd: ROOT });

if (!fs.existsSync(DIST_DIR) || process.argv.includes('--build')) {
  execFileSync('npm', ['run', 'build'], {
    stdio: 'inherit',
    cwd: ROOT,
    env: { ...process.env, VITE_PUBLIC_BASE: '/' },
  });
}

copyDirClean(DIST_DIR, ANDROID_WWW_DIR);
console.log(`[android:sync] Synchronized ${path.relative(ROOT, DIST_DIR)} -> ${path.relative(ROOT, ANDROID_WWW_DIR)}`);
