#!/usr/bin/env node
/**
 * CI Quality Gate:
 * 1. Scans production TypeScript modules (`src/**`, excluding `*.test.ts`) for banned patterns:
 *    - `: any`, `as any`, `<any>`
 *    - Non-const `as Type` assertions (outside safe `satisfies` or `as const` or `schema.ts` documented exception)
 *    - Non-null postfix assertions (`!.`, `!;`, `!)`, `![`)
 * 2. Verifies Python PEP script syntax (`py_compile`) & ABI constant parity between
 *    `scripts/build_wasm.py` (`WasmAbiSpec`) and `src/features/mandala/model/constants.ts` (`WASM_ABI_SPEC`).
 * 3. Verifies modular decomposition targets remain bounded under line-count thresholds.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const SRC_DIR = path.resolve(ROOT, 'src');
const PY_WASM_PATH = path.resolve(ROOT, 'scripts/build_wasm.py');
const TS_CONSTANTS_PATH = path.resolve(ROOT, 'src/features/mandala/model/constants.ts');

const errors = [];

function walkTsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkTsFiles(full));
    } else if (
      (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.test.tsx') &&
      !entry.name.endsWith('.d.ts')
    ) {
      out.push(full);
    }
  }
  return out;
}

function stripCommentsAndStrings(code) {
  // Replace block comments, line comments, and quoted/template string interiors to avoid false positives on regex/prose
  return code
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1 ')
    .replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, '$1$1');
}

const files = walkTsFiles(SRC_DIR);
const ANY_RE = /(?::\s*any\b|\bas\s+any\b|<any>|any\[\])/;
const AS_TYPE_RE = /\bas\s+(?!const\b)[A-Za-z_][A-Za-z0-9_<>{}[\].,\s|&]*(?=[);,\n}\]])/g;
const NON_NULL_RE = /[A-Za-z0-9_)\]]!(?:\.|\[|;|,|\))/;

for (const filePath of files) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const rel = path.relative(ROOT, filePath);
  const sanitized = stripCommentsAndStrings(raw);
  const lines = sanitized.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    if (ANY_RE.test(line)) {
      errors.push(`[ANY] ${rel}:${lineNo}: banned \`any\` usage detected`);
    }

    const asMatches = line.match(AS_TYPE_RE);
    if (asMatches) {
      errors.push(`[AS_CAST] ${rel}:${lineNo}: disallowed type assertion (${asMatches[0].trim()})`);
    }

    if (NON_NULL_RE.test(line)) {
      errors.push(`[NON_NULL] ${rel}:${lineNo}: disallowed postfix non-null \`!\` assertion`);
    }
  }
}

// Python py_compile + ABI parity check
const PY_MANIFEST_PATH = path.resolve(ROOT, 'scripts/release_manifest.py');
const PY_SETUP_PATH = path.resolve(ROOT, 'scripts/setup_android_release.py');
for (const pyScript of [PY_WASM_PATH, PY_MANIFEST_PATH, PY_SETUP_PATH]) {
  try {
    execFileSync('python3', ['-m', 'py_compile', pyScript], { stdio: 'pipe' });
  } catch (err) {
    errors.push(
      `[PYTHON] ${path.relative(ROOT, pyScript)} failed py_compile: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

const pyText = fs.readFileSync(PY_WASM_PATH, 'utf8');
const tsConstantsText = fs.readFileSync(TS_CONSTANTS_PATH, 'utf8');

const ABI_PAIRS = [
  ['heap_base_offset_bytes', 'heapBaseOffsetBytes'],
  ['initial_memory_pages', 'initialMemoryPages'],
  ['max_memory_pages', 'maxMemoryPages'],
  ['rules_table_bytes', 'rulesTableBytes'],
  ['rule_entry_stride_bytes', 'ruleEntryStrideBytes'],
  ['turtle_stack_max_depth', 'turtleStackMaxDepth'],
  ['turtle_stack_frame_bytes', 'turtleStackFrameBytes'],
  ['out_meta_bytes', 'outMetaBytes'],
  ['point_stride_f64_bytes', 'pointStrideF64Bytes'],
  ['poly_length_stride_bytes', 'polyLengthStrideBytes'],
];

for (const [pyField, tsField] of ABI_PAIRS) {
  const pyMatch = pyText.match(new RegExp(`${pyField}\\s*:\\s*int\\s*=\\s*(\\d+)`));
  const tsMatch = tsConstantsText.match(new RegExp(`${tsField}\\s*:\\s*(\\d+)`));
  if (!pyMatch || !tsMatch) {
    errors.push(`[ABI] Missing ABI field pair: python=${pyField}, ts=${tsField}`);
  } else if (Number(pyMatch[1]) !== Number(tsMatch[1])) {
    errors.push(`[ABI] Mismatch ${pyField}=${pyMatch[1]} vs ${tsField}=${tsMatch[1]}`);
  }
}

// Version & Android distribution SSOT parity check (`version.json` vs `package.json`, TS constants, Rust Cargo.toml)
const versionJson = JSON.parse(fs.readFileSync(path.resolve(ROOT, 'version.json'), 'utf8'));
const pkgJson = JSON.parse(fs.readFileSync(path.resolve(ROOT, 'package.json'), 'utf8'));
if (pkgJson.version !== versionJson.version) {
  errors.push(`[VERSION] package.json version=${pkgJson.version} != version.json version=${versionJson.version}`);
}
const cargoTomlText = fs.readFileSync(path.resolve(ROOT, 'crates/mandala-core/Cargo.toml'), 'utf8');
const cargoVersionMatch = cargoTomlText.match(/^version\s*=\s*"([^"]+)"/m);
if (!cargoVersionMatch || cargoVersionMatch[1] !== versionJson.version) {
  errors.push(`[VERSION] crates/mandala-core/Cargo.toml version mismatch vs version.json (${versionJson.version})`);
}
const tsVersionMatch = tsConstantsText.match(/defaultVersionName\s*:\s*'([^']+)'/);
const tsPkgMatch = tsConstantsText.match(/androidPackageId\s*:\s*'([^']+)'/);
if (!tsVersionMatch || tsVersionMatch[1] !== versionJson.version) {
  errors.push(`[VERSION] ANDROID_DISTRIBUTION_DEFAULTS.defaultVersionName != version.json (${versionJson.version})`);
}
if (!tsPkgMatch || tsPkgMatch[1] !== versionJson.androidPackageId) {
  errors.push(`[VERSION] ANDROID_DISTRIBUTION_DEFAULTS.androidPackageId != version.json (${versionJson.androidPackageId})`);
}

// Decomposed module line-count sanity checks
const MODULE_LINE_BUDGETS = [
  ['src/features/mandala/model/store.ts', 200],
  ['src/features/mandala/model/adrRegistry.ts', 220],
  ['src/components/MandalaControls.tsx', 100],
  ['src/components/AndroidAnalysisHub.tsx', 360],
  ['src/components/MandalaCanvas.tsx', 920],
];

for (const [relPath, maxLines] of MODULE_LINE_BUDGETS) {
  const abs = path.resolve(ROOT, relPath);
  const lineCount = fs.readFileSync(abs, 'utf8').split(/\r?\n/).length;
  if (lineCount > maxLines) {
    errors.push(`[SIZE] ${relPath} has ${lineCount} lines (budget <= ${maxLines})`);
  }
}

if (errors.length > 0) {
  console.error(`[QUALITY-GATE FAIL] ${errors.length} violation(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(
  `[QUALITY-GATE PASS] Scanned ${files.length} production TS files, verified Python ABI + version.json SSOT parity, and confirmed module decomposition budgets.`
);
