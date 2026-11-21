# Mandala Studio — Operational Release & CI Runbook

This runbook documents the recurring maintenance and release procedures for Mandala Studio (`v1.0.0-rc.1`).

---

## 1. Local Quality Gate Commands

Run individual or full pre-release verification commands from the repository root:

```bash
# 1. Regenerate deterministic WASM binary & verify size <= 200 KB
npm run wasm:build
npm run wasm:check

# 2. Unit & parity test suite (TypeScript + linear-memory WASM)
npm test

# 3. Pure-compute JS/WASM regression benchmark (max +15% over baseline.json)
npm run bench:gate

# 4. Production build + bundle treemap (ANALYZE=true) + size-limit checks
npm run build:analyze
npm run size:check

# 5. Validate WCAG exemption expiry dates
npm run a11y:exemptions

# 6. Chromium Desktop & Pixel 5 Mobile E2E + Axe WCAG + SW Update + Strict CSP
npm run e2e

# 7. Lighthouse CI Mobile Audit (Perf >= 0.90, A11y >= 0.95, BP >= 0.90)
npm run lhci:check
```

---

## 2. Regenerating the Performance Baseline (`benchmarks/baseline.json`)

**Policy:** `scripts/ci/run-benchmark-gate.ts` enforces a strict **+15% median regression ceiling** on pure computational JS/WASM cells (`>= 5 ms` noise floor) and enforces `< 50 ms` on Sacred Blossom G6 WASM. WebGL2 / Canvas GPU paint paths are intentionally excluded to avoid headless SwiftShader CI noise.

When hardware upgrades or intentional algorithm changes shift medians legitimately:
1. Ensure no unrelated background CPU saturation is running.
2. Run:
   ```bash
   npm run bench:update
   ```
3. Inspect `git diff benchmarks/baseline.json` to confirm changes match expected kernel improvements.
4. Commit `benchmarks/baseline.json` in the same PR with benchmark notes.

---

## 3. Bundle Size Budget & WASM Binary Amendments

- **Raw WASM Budget:** Fixed at **200 KB (`204,800 B`)** in both `src/features/mandala/model/constants.ts` (`WASM_CONFIG.sizeBudgetBytes`) and `scripts/ci/check-wasm-budget.mjs`. Current binary footprint is ~2.1 KB.
- **Chunk Budgets (`.size-limit.json`):**
  - Entry bundle (`dist/assets/index-*.js`): `<= 200 kB`
  - React vendor (`dist/assets/react-vendor-*.js`): `<= 120 kB`
  - Motion, State & Lazy Feature chunks (`AndroidAnalysisHub`, `ExportModal`, `LSystemModal`, `lensWebglPass`, `wasm-runtime`): `<= 100 kB` each
- **Debugging Regressions:** Run `npm run build:analyze` and inspect `reports/bundle-stats.html` treemap. Never import `benchmark.ts`, `wasmLoader.ts`, `adrRegistry.ts`, or `lensWebglPass.ts` synchronously into entry modules or the synchronous `src/features/mandala/index.ts` barrel.

---

## 4. Service Worker Controlled Update & Emergency Rollback (`registerType: 'prompt'`)

Mandala Studio deliberately disables silent `skipWaiting()` so mid-stroke user canvases are never blown away by an unexpected controller reload.

### Normal Staged Rollout (Build A -> Build B)
1. Deploy updated assets + new `sw.js` with `Cache-Control: no-cache, no-store, must-revalidate` on `sw.js` and `index.html`.
2. Active users receive the accessible `PWAUpdateBanner` (`"Aggiornamento disponibile — ricarica per la nuova build"`).
3. Clicking **Ricarica** invokes the Workbox `updateSW(true)` flow protected by a single-reload guard (`controllerchange` runs once) while preserving `localStorage['mandala_studio_doc_v1']` and IndexedDB swap state.

### Emergency Rollback Procedure
1. Re-publish previous known-good `dist/` artifacts and previous `sw.js`.
2. Because `workbox.cleanupOutdatedCaches: true` is active and HTML/manifest use `NetworkFirst` (3s timeout), the next navigation or `registration.update()` queues the rollback `sw.js` cleanly via the standard update prompt.
3. Users can also clear transient caches immediately from TopBar -> **Flush Cache** (`flushAllApplicationCaches()`), which preserves saved canvas documents (`clearSavedSessionStorage()` is only invoked by explicit double-confirmed Workspace Reset).

---

## 5. Accessibility Exemption Cadence

`benchmarks/accessibility-exemptions.json` is validated on every CI run by `scripts/ci/validate-a11y-exemptions.mjs`:
- Every entry **must** contain `ruleId`, `scope`, `owner`, `reason`, and a future ISO date `expiresAt`.
- Expired exemptions cause an immediate CI failure (`exit 1`).
- Prior to each sprint planning review, resolve expired items or renew with updated owner sign-off and remediation target date.
