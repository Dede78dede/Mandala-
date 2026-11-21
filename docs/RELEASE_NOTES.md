# Mandala Studio — Release Notes (`v1.0.0-rc.1`, Phase 5 Release Candidate)

## Highlights

### Sprint 0: Accessibility, Structural Hardening & Clean Build
- **WCAG Viewport Compliance:** Unlocked `maximum-scale=1.0` / `user-scalable=no` from `index.html`; isolated `touch-action: none` strictly to the drawing canvas container.
- **Offline-First Local Typography:** Eliminated external Google Fonts requests; self-hosted `@fontsource/plus-jakarta-sans` & `@fontsource/jetbrains-mono` WOFF2 files inside the PWA precache.
- **Zero-Warning Bundle Hygiene:** Fixed Vite ESM `import.meta.dirname`, removed Rollup `[INEFFECTIVE_DYNAMIC_IMPORT]` on WASM loader flags, refined FSD barrel boundaries (`src/features/mandala/index.ts`), and split vendor chunks (`react-vendor`, `motion-vendor`, `icons-vendor`, `state-vendor`, `wasm-runtime`).
- **Valid ARIA Dialog Semantics:** Fixed `AppMenuDropdown` to use semantic `role="dialog"` without invalid nested menuitem children.

### Sprint 5.1: L-System WASM Port & Automated CI Quality Gates
- **L-System Linear-Memory WASM Kernel:** Implemented `sin_f64` (23rd-degree range-reduced Taylor approximation at `< 2e-16` error), `expand_lsystem_bytes`, and `interpret_lsystem_turtle_f64` inside `public/wasm/mandala_symmetry.wasm` (**2.2 KB raw**, `<= 1e-12` parity with JS across all 4 presets).
- **Off-Thread Worker Escalation:** `commitFractalGenerationSmart` automatically dispatches `generations >= 5` to the persistent Worker via zero-copy transferable buffers (cutting Sacred Blossom Gen 6 compute from ~99ms on main thread to `< 8 ms` in WASM), with automatic JS fallback.
- **Automated Quality Gates:**
  - Pure-compute JS/WASM Regression Gate (`benchmarks/baseline.json`, max `+15%` tolerance, GPU excluded)
  - Bundle Size Gates via `size-limit` (Entry `<= 200 kB`, React vendor `<= 120 kB`, Feature chunks `<= 100 kB`) & Raw WASM Budget Check (`<= 200 KB`)
  - Bundle Treemap (`ANALYZE=true npm run build`)
  - `@axe-core/playwright` WCAG 2.1 A/AA CI audit + expiring exemption validator (`benchmarks/accessibility-exemptions.json`)
  - Mobile Lighthouse CI Audit (`Performance >= 0.90`, `Accessibility >= 0.95`, `Best Practices >= 0.90`)

### Sprint 5.2: Chromium E2E, Staged Service Worker Verification & Strict CSP
- **Chromium Desktop & Mobile (Pixel 5) E2E Suite:** End-to-end tests covering pointer strokes, WASM L-System Gen 5, keyboard crosshair drawing, WebGL2 Hemispherical Lens preview + flat return, Zen/Kinetic Replay, and SVG/PNG/JSON export.
- **Staged SW Update Verification (`Build A -> Build B`):** Verifies prompt banner visibility, single-reload anti-loop protection, outdated cache cleanup, and full user canvas persistence across updates.
- **Strict CSP Verification:** Verifies `script-src 'self' 'wasm-unsafe-eval'`, `font-src 'self'`, zero external requests, and explicit omission of `COOP`/`COEP` headers on `vite preview`.

### Sprint 5.3: 4 Moduli Creativi Strategici (Stamps, Polar, Kaleidoscope WebGL2, Path-Drawing SVG, Kinetic Morphing)
- **Timbri Botanici & Armoniche Polari (`proceduralStamps.ts`, `polarGenerators.ts`):** Nuovo strumento interattivo `ToolId.Stamp` (`Petalo`, `Loto`, `Blob`, `Stella`) con orientamento/scala radiale live su Layer 2 e generatore parametrico `Armoniche Polari` (`Rodonea`, `Epitrocoide`, `Corona Poligonale`) compatibile con Undo/Redo, Gomma spicchio e persistenza v2.
- **Profilo Caleidoscopio WebGL2 & Texture Offline (`lensWebglPass.ts`, `ViewportLensHud.tsx`):** 5° profilo ottico `u_mode == 4` con pieghe speculari N-fold e torsione spirale, più upload immagine 100% offline via `createImageBitmap` con cap GPU e ripristino immediato **Usa Tela**.
- **Export SVG Path-Drawing con Anteprima Live (`svgExport.ts`, `ExportModal.tsx`):** Modalità CSS-only `pathLength="1"` con ritardi sfalsati, controllo durata/stagger, guardia `@media (prefers-reduced-motion: no-preference)` e anteprima CSP-safe via `data:image/svg+xml`.
- **Kinetic Morphing A/B su Canvas 2D (`morphInterpolator.ts`, `KineticReplayBar.tsx`):** Ricampionamento uniforme per lunghezza d'arco a 32 punti ed interpolazione colore/spessore tra Slot Prima/Dopo e preset armonici polari.
