#!/usr/bin/env node
/**
 * CI Quality Gate: Validates accessibility-exemptions.json schema and fails if any active exemption is expired.
 */
import fs from 'node:fs';
import path from 'node:path';

const REGISTRY_PATH = path.resolve(process.cwd(), 'benchmarks/accessibility-exemptions.json');

if (!fs.existsSync(REGISTRY_PATH)) {
  console.error(`[A11Y-EXEMPTIONS FAIL] Missing registry file: ${REGISTRY_PATH}`);
  process.exit(1);
}

let raw;
try {
  raw = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
} catch (err) {
  console.error(`[A11Y-EXEMPTIONS FAIL] Invalid JSON: ${err.message}`);
  process.exit(1);
}

if (!Array.isArray(raw.exemptions)) {
  console.error('[A11Y-EXEMPTIONS FAIL] Expected top-level `exemptions` array.');
  process.exit(1);
}

const now = Date.now();
let failed = false;

for (const entry of raw.exemptions) {
  for (const field of ['ruleId', 'scope', 'owner', 'reason', 'expiresAt']) {
    if (typeof entry[field] !== 'string' || entry[field].trim().length === 0) {
      console.error(`[A11Y-EXEMPTIONS FAIL] Exemption missing non-empty field "${field}": ${JSON.stringify(entry)}`);
      failed = true;
    }
  }

  const expiryMs = Date.parse(entry.expiresAt);
  if (Number.isNaN(expiryMs)) {
    console.error(`[A11Y-EXEMPTIONS FAIL] Invalid ISO date expiresAt "${entry.expiresAt}" for ${entry.ruleId}`);
    failed = true;
    continue;
  }

  if (expiryMs <= now) {
    console.error(
      `[A11Y-EXEMPTIONS FAIL] Expired WCAG exemption "${entry.ruleId}" (expired ${entry.expiresAt}, owner ${entry.owner}). Fix or renew with justification.`
    );
    failed = true;
  } else {
    console.log(
      `[A11Y-EXEMPTIONS OK] Active exemption "${entry.ruleId}" (owner: ${entry.owner}, expires: ${entry.expiresAt})`
    );
  }
}

console.log(`[A11Y-EXEMPTIONS] Validated ${raw.exemptions.length} exemption record(s).`);

if (failed) {
  process.exit(1);
}
