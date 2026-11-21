# Mandala Studio — Architecture Overview & Consolidated ADRs (Phases 1–5)

**Release Baseline:** `v1.0.0-rc.1`  
**Stack:** React 19 · TypeScript · Zustand Slice Pattern · Tailwind CSS v4 · WebAssembly Linear-Memory (`public/wasm/mandala_symmetry.wasm`) · WebGL2 Offscreen Lens Compositor · Workbox PWA (`registerType: 'prompt'`) · Android Kotlin 2.1 / Jetpack Compose Companion Scaffold

---

## 1. System Architecture Summary

### 1.1 Dual-Layer & World-Space Canvas Pipeline (`PH1-RENDER`, `PH5-WORLD-LENS`)
- **Committed Layer + Preview Layer + Isolated SVG/DOM Guides:** Eliminates per-frame re-tessellation of prior paths during 120Hz–240Hz pointer/stylus input while keeping visual symmetry guides excluded from PNG/SVG exports.
- **Extended World Space (`r = 1200`) & Anchored Camera:** Continuous pan/zoom (`0.25×` to `8.0×`) mapped to logical world coordinates; world-anchored stroke widths maintain proportional line fidelity across zoom levels.
- **Preview-Only WebGL2 Hemispherical Lens (`lensWebglPass.ts`):** Supports **Spherical Dome**, **Refractive Glass**, **Poincaré Hyperbolic Disk**, and **Stained Glass** optical shaders. Defaults to **2048px supersampled source canvas** with dynamic VRAM downgrade to `1024px` under CPU/heap protection, and opt-in **4096px HD** mode. Automatically returns to flat 2D view when drawing tools are activated (`exitLensForDrawing`).

### 1.2 Symmetry Strategies, L-System WASM Kernel & Zero-Copy Worker (`PH3-ENGINE`, `PH4-STRATEGY-COMPOSITION`, `PH5-LSYSTEM-WASM`)
- **Strategy Registry (`STRATEGY_REGISTRY`):** Zero strategy-specific `if`-branches in the compute router. Three strategies are active: `RadialStrategy`, `MirrorRadialStrategy` (Reflect / Alternate), and `FractalStrategy` (L-System grammar + turtle interpreter).
- **WASM Escalation:** `public/wasm/mandala_symmetry.wasm` (~2.1 KB raw, strict budget `<= 200 KB`) runs in a persistent `symmetryWorker.ts` using transferable `Float64Array` / `Uint32Array` ownership passing (`postMessage` zero-copy O(1)):
  - **Radial & MirrorRadial:** Invoked off-thread when `routingMode === 'force-wasm-worker'` or workload hits empirical 10ms/50ms thresholds.
  - **Fractal L-System (Phase 5 Port):** `expand_lsystem_bytes` + `interpret_lsystem_turtle_f64` (23rd-degree Taylor `sin_f64` achieving `<= 1e-12` parity with JS) automatically execute in the WASM Worker when `generations >= 5`, reducing Sacred Blossom Gen 6 main-thread stall from ~99ms to `< 8 ms` off-thread.

### 1.3 Threading, Font Self-Hosting & Strict CSP (`PH4-THREADING`, `PH5-CSP-FONTS`)
- **No `COOP`/`COEP` Headers:** Intentionally omitted so the application functions inside AI Studio iframes and TWA contexts while keeping `Float64Array` transferable communication in single-threaded Workers.
- **Zero External Font Network Calls:** Google Fonts links removed; `Plus Jakarta Sans` and `JetBrains Mono` WOFF2 assets are bundled locally via `@fontsource`.
- **Strict CSP (`vite.config.ts` preview headers):**
  `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'`

---

## 2. Consolidated ADR Register (`PH1` – `PH5`)

| ADR ID | Phase | Decision | Status |
| :--- | :--- | :--- | :--- |
| `PH1-RENDER` | Fase 1 | Dual-Layer Canvas + Isolated SVG Guides (`800×800` logical space) | Ratificato |
| `PH1-WASM` | Fase 1 | Empirical 10ms / 50ms JS vs WASM Gate Rule | Ratificato |
| `PH1-STATE` | Fase 1 | Zustand Slice Pattern + Zod `schemaVersion` boundary validation | Ratificato |
| `PH1-A11Y` | Fase 1 | Okabe-Ito CUD palette, dash patterns & live parametric ARIA mirror | Ratificato |
| `PH2-HISTORY` | Fase 2 | Explicit 50-command `do()`/`undo()` stack excluding ephemeral pointer points | Ratificato |
| `PH2-MOTION` | Fase 2 | Stable `androidx.input:input-motionprediction:1.0.0` stylus prediction | Ratificato |
| `PH3-ENGINE` | Fase 3 | Persistent Web Worker WASM with zero-copy `Float64Array` Transferables | Ratificato |
| `PH3-MEMORY` | Fase 3 | 4-Tier Memory Hierarchy (`L0` Float32 · `L1` LRU · `L2` Heap · `L3` IndexedDB) | Ratificato |
| `PH3-WASM-CALIBRATION` | Fase 3 | Dual-path calibration & `Uint8ClampedArray` Escape Hatch (`>= 2,000` primitives) | Ratificato |
| `PH4-STRATEGY-COMPOSITION` | Fase 4 | `FractalStrategy` composition + zero-branch orchestrator + WCAG 2.1 AA | Ratificato |
| `PH4-THREADING` | Fase 4 | Single-threaded transferable Worker without `COOP`/`COEP` | Ratificato |
| `PH5-LSYSTEM-WASM` | Fase 5 | Linear-memory L-System grammar/turtle WASM kernel + Worker escalation (Gen >= 5) | Ratificato |
| `PH5-CSP-FONTS` | Fase 5 | Strict CSP (`'wasm-unsafe-eval'`, `'self'` fonts) + local WOFF2 `@fontsource` bundle | Ratificato |
| `PH5-QUALITY-GATES` | Fase 5 | Automated CI gates (Bench `+15%`, Size-Limit, WASM `<=200KB`, Axe, LHCI) | Ratificato |
| `PH5-WORLD-LENS` | Fase 5 | World-space Camera + Preview-only WebGL2 Hemispherical Lens compositor | Ratificato |
