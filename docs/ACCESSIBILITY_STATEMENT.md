# Mandala Studio — Accessibility Conformance Statement (WCAG 2.1 Level AA)

**Application:** Mandala Studio Web & Android Companion  
**Target Standard:** W3C WCAG 2.1 Level A & Level AA  
**Assessment Date:** Phase 5 Release Candidate (`v1.0.0-rc.1`)

---

## 1. Conformance Features Implemented

### 1.1 Perceivable & Color-Independent Controls (WCAG 1.4.1, 1.4.3, 1.4.4, 1.4.11)
- **Color-Universal Design (Okabe-Ito Default Palette):** High-contrast, protanopia/deuteranopia/tritanopia-safe palette selected by default, paired with semantic status badges using icon + text dual coding.
- **Color-Independent Stroke Encoding:** Continuous, Dashed, and Dotted stroke presets differentiate strokes structurally without relying solely on color.
- **Viewport Pinch-Zoom Unlocked:** `<meta name="viewport" content="width=device-width, initial-scale=1.0" />` removes `maximum-scale=1.0` / `user-scalable=no`. `touch-action: none` is strictly scoped to the active drawing surface (`MandalaCanvas`) so outer UI panels remain pinch-zoomable.
- **Self-Hosted Readable Typography:** `Plus Jakarta Sans` & `JetBrains Mono` bundled locally (`@fontsource`) with `tabular-nums` alignment on live HUD readouts.

### 1.2 Operable Canvas & Motion Safety (WCAG 2.1.1, 2.3.3, 2.4.7)
- **Full Keyboard Drawing Crosshair:** Focus the canvas (`role="application"`) and navigate using Arrow keys (`Shift` for coarse steps), commit points/strokes with `Space`/`Enter`, `Ctrl+Z` / `Ctrl+Y` for Undo/Redo, and `Escape` to exit modal overlays, WebGL2 Lens preview, or Kinetic Replay mode.
- **Modal Focus & Scroll Discipline:** All dialogs (`ExportModal`, `LSystemModal`, `AndroidAnalysisHub`, `AppMenuDropdown`) implement `role="dialog"`, `aria-modal="true"`, Escape-key dismissal, and visible `:focus-visible` focus rings.
- **Animation & Motion Safety:** Wraps UI transitions in `<MotionConfig reducedMotion="user">` and enforces `prefers-reduced-motion` + `document.visibilityState === 'hidden'` pausing for Kinetic Ring animations and WebGL2 Lens auto-tilt (`canRunContinuousAnimation`).

### 1.3 Robust Screen Reader Support (WCAG 4.1.2, 4.1.3)
- **Live Polite Regions (`#mandala-live-announcer`):** Debounced (`300 ms`) announcements communicate symmetry order changes, tool switches, undo/redo actions, L-System WASM completions, and cache maintenance results.
- **Parametric Canvas Mirror:** Dynamically reflects active symmetry strategy, order `N`, stroke count, palette safety metadata, and active stroke parameters at `500 ms` throttle intervals for opaque `<canvas>` content.
- **Valid Dialog/Menu ARIA Semantics:** Dropdown maintenance menu uses `aria-haspopup="dialog"` + `role="dialog"` rather than mixing non-menuitem widgets inside `role="menu"`.

---

## 2. Automated Verification & Expiring Exemption Governance

- **Automated CI Scan:** `@axe-core/playwright` (`e2e/smoke-and-a11y.spec.ts`) runs WCAG 2.1 A/AA checks on Desktop (`1280×800`) and Mobile (`Pixel 5`) across Initial Workspace, Main Menu / Mobile Options Sheet, L-System Modal, and Export Modal. Any unexempted `critical` or `serious` violation blocks release.
- **Lighthouse Accessibility Audit:** Mobile CI gate enforces category score `>= 0.95`.
- **Expiring Exemption Register (`benchmarks/accessibility-exemptions.json`):** No critical/serious core-flow UI defects are exempted. Any future temporary exemption requires `ruleId`, `scope`, `owner`, written justification, and an `expiresAt` ISO date enforced automatically by `npm run a11y:exemptions`.

---

## 3. Manual Verification Record (Phase 4 & Phase 5 Sign-Off)

| Verification Area | Method | Result |
| :--- | :--- | :--- |
| Keyboard-Only Mandala Creation & Export | Arrow keys + `Space` + `Tab` + `Enter` + `Escape` | Passed — Full workflow operable without pointer |
| Screen Reader Live Announcements & Modal Focus | DOM ARIA inspection + `#mandala-live-announcer` live updates | Passed — Announcements debounced without chatter |
| Mobile Pinch Zoom & Touch Isolation | Pixel 5 emulation + viewport meta validation | Passed — Outer shell scalable, canvas gesture smooth |
| Reduced Motion (`prefers-reduced-motion: reduce`) | Static fallback on Kinetic Rings & Lens auto-rotation | Passed — Continuous animations halted automatically |
