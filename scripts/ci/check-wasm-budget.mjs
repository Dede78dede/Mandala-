#!/usr/bin/env node
/**
 * CI Quality Gate: WebAssembly binary size budget check (<= 200 KB / 204,800 bytes).
 */
import fs from 'node:fs';
import path from 'node:path';

const MAX_WASM_BYTES = 200 * 1024;
const ROOT = process.cwd();
const candidates = [
  path.resolve(ROOT, 'public/wasm/mandala_symmetry.wasm'),
  path.resolve(ROOT, 'dist/wasm/mandala_symmetry.wasm'),
];

let checked = 0;
let failed = false;

for (const filePath of candidates) {
  if (!fs.existsSync(filePath)) continue;
  checked += 1;
  const stat = fs.statSync(filePath);
  const rel = path.relative(ROOT, filePath);
  const kb = (stat.size / 1024).toFixed(2);
  if (stat.size > MAX_WASM_BYTES) {
    console.error(`[WASM-GATE FAIL] ${rel}: ${stat.size} B (${kb} KB) > 200 KB (${MAX_WASM_BYTES} B)`);
    failed = true;
  } else {
    console.log(`[WASM-GATE PASS] ${rel}: ${stat.size} B (${kb} KB) <= 200 KB (${MAX_WASM_BYTES} B)`);
  }
}

if (checked === 0) {
  console.error('[WASM-GATE FAIL] No mandala_symmetry.wasm binary found.');
  process.exit(1);
}

if (failed) {
  process.exit(1);
}
