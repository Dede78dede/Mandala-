/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 1 & Phase 2 Architecture Decision Records (ADRs) & Revised Android Studio Scaffold
 * Aligned with Kotlin 2.1 + Compose BOM 2024.12.01 + ViewModel/StateFlow + kotlinx.serialization + JUnit 5.
 */

import { AdrPhase, AdrStatus, type ADRRecord } from './types.ts';

export const PHASE1_ADRS: readonly ADRRecord[] = [
  {
    id: 'PH1-RENDER',
    phase: AdrPhase.Phase1,
    title: 'Pipeline di Rendering a Doppio Layer & Guide DOM Isolate',
    status: AdrStatus.Ratified,
    decision:
      'Layer Commesso separato da Layer Preview + Overlay Guide DOM/SVG. Spazio logico normalizzato 800×800.',
    rationale:
      'Elimina la ridisegnazione di centinaia di tratti durante il gesto attivo, previene la contaminazione delle guide negli export e mantiene il frame time <8ms a 120Hz.',
    revisitCondition:
      'Superamento soglia nodi (>2000 tratti simultanei) con attivazione escape-hatch pixel buffer in Fase 3.',
  },
  {
    id: 'PH1-WASM',
    phase: AdrPhase.Phase1,
    title: 'Soglia Empirica WASM / NDK C++ (Gate 10ms / 50ms)',
    status: AdrStatus.Ratified,
    decision:
      'Esecuzione JavaScript/Kotlin pura di default. Adozione WASM/NDK SIMD solo per operazioni con mediana >= 50ms e rifiuto sotto <= 10ms.',
    rationale:
      'Evita il sovraccarico di marshalling al confine FFI/Worker per tratti ordinari (N=3..24) mantenendo il bundle iniziale sotto 200KB.',
    revisitCondition:
      'Cambio hardware di riferimento o introduzione di frattali ricorsivi ad alta densità.',
  },
  {
    id: 'PH1-STATE',
    phase: AdrPhase.Phase1,
    title: 'Zustand Slice Pattern + Validazione Zod sui Confini',
    status: AdrStatus.Ratified,
    decision:
      'Store suddiviso in slice (scene, palette, tool) con selettori atomici e validazione Zod schemaVersion=1 su localStorage e JSON import/export.',
    rationale:
      'Previene re-render a cascata durante il tratto attivo e garantisce integrità dei documenti salvati o importati.',
    revisitCondition: 'Introduzione di collaborazione multi-utente CRDT in tempo reale.',
  },
  {
    id: 'PH1-A11Y',
    phase: AdrPhase.Phase1,
    title: 'Accessibilità CUD (Okabe-Ito) & Mirror Parametrico ARIA',
    status: AdrStatus.Ratified,
    decision:
      'Palette Okabe-Ito di default, stile tratto (Continuo/Tratteggiato/Punteggiato) indipendente dal colore, tastiera completa e descrizione parametrica live.',
    rationale:
      'Un <canvas> è opaco agli screen reader; il mirror parametrico e i controlli indipendenti dal colore rendono il mandala inclusivo.',
    revisitCondition:
      'Supporto universale nei browser Android/iOS di HTML-in-Canvas (<canvas content="drawable">).',
  },
  {
    id: 'PH2-HISTORY',
    phase: AdrPhase.Phase2,
    title: 'Stack Comandi Undo/Redo (do/undo Closures vs Snapshot Cloning)',
    status: AdrStatus.Ratified,
    decision:
      'Adozione di Command Stack esplicito (max 50 comandi tipizzati con label, do() e undo()) anziché snapshot cloning globale o middleware zundo.',
    rationale:
      'Mantiene lo stato effimero Layer 0 (punti del puntatore in corso, cursore tastiera) totalmente escluso dalla cronologia e supporta etichette parlanti per Undo/Redo.',
    revisitCondition: 'Richiesta di cronologia persistita su disco tra riavvii dell’app.',
  },
  {
    id: 'PH2-MOTION',
    phase: AdrPhase.Phase2,
    title: 'Predizione Movimento Stilo (androidx.input:input-motionprediction:1.0.0)',
    status: AdrStatus.Ratified,
    decision:
      'Aggiornamento da 1.0.0-beta05 alla release stabile 1.0.0 per il layer di predizione tattile Android su pannelli 120Hz/S-Pen.',
    rationale:
      'Riduce la latenza percepita dello stilo senza dipendere da API sperimentali, sfruttando campioni storici MotionEvent con fallback disattivabile dal pannello strumenti.',
    revisitCondition:
      'Divergenza driver OEM o regressione frame budget >2ms su dispositivi entry-level minSdk 28.',
  },
  {
    id: 'PH3-ENGINE',
    phase: AdrPhase.Phase3,
    title: 'Porta GeometryEngine & Web Worker WASM Transferable (`mandala_symmetry.wasm`)',
    status: AdrStatus.Ratified,
    decision:
      'Esecuzione `mandala_symmetry.wasm` isolata in Persistent Web Worker (`symmetryWorker.ts`) con buffer piatti Float64Array trasferiti a zero-copy O(1) e caricamento lazy escluso dal bundle critico.',
    rationale:
      'Disaccoppia il calcolo intensivo dal main thread React evitando marshalling di oggetti JS e garantendo fallback trasparente verso JsGeometryEngine.',
    revisitCondition:
      'Adozione di SharedArrayBuffer / worker pool solo in presenza di code concorrenti con COOP/COEP compatibili.',
  },
  {
    id: 'PH3-MEMORY',
    phase: AdrPhase.Phase3,
    title: 'Architettura Memoria 4-Livelli (L0 Float32Array · L1 LRU · L2 Heap · L3 IndexedDB Swap)',
    status: AdrStatus.Ratified,
    decision:
      'Buffer Float32Array (stride 3) per cattura puntatore zero-GC (L0), SymmetryLruCache O(1) limitata a 512 voci/4 MiB (L1), partizionamento hot/cold (L2) e SwapStoragePort asincrono su IndexedDB (L3) con Context Manager deterministici.',
    rationale:
      'Elimina allocazioni per-frame a 240Hz, evita il limite sincrono 5MB di localStorage e rilascia immediatamente backing buffer off-screen (fino a 64MB in export 4K).',
    revisitCondition:
      'Introduzione in Fase 3 di Tile Pyramids rasterizzati o SharedArrayBuffer cross-thread in Web Worker.',
  },
  {
    id: 'PH3-WASM-CALIBRATION',
    phase: AdrPhase.Phase3,
    title: 'Calibrazione Empirica Gate 10ms/50ms & Pixel-Buffer Escape Hatch (>=2.000 primitive)',
    status: AdrStatus.Ratified,
    decision:
      'Matrice benchmark dual-path JS vs WASM su N ∈ {8..48} con misura separata del costo no-op di confine; fallback predefinito a JS sotto <=10ms, WASM attivo sopra >=50ms (speedup >=20%) e rasterizzazione RGBA diretta (`Uint8ClampedArray`) oltre 2.000 primitive.',
    rationale:
      'Impedisce l’antipattern di pagare costi di trasferimento per scene ordinarie N=3..24 mantenendo >=50fps anche nell’angolo ad alta complessità N=48.',
    revisitCondition:
      'Variazione hardware di riferimento o introduzione di frattali ricorsivi densi in Fase 4.',
  },
  {
    id: 'PH4-STRATEGY-COMPOSITION',
    phase: AdrPhase.Phase4,
    title: 'Composizione FractalStrategy, Orchestrator Zero-Branch & A11y WCAG 2.1 AA',
    status: AdrStatus.Ratified,
    decision:
      'FractalStrategy espande grammatiche L-System pure + turtle graphics e delega la rotazione a RadialStrategy; l’orchestratore legge minWedgeComplexity/complexityMetric dal registro senza rami if specifici. Mirror parametrico throttled a 500ms e live region debounced a 300ms.',
    rationale:
      'Convalida l’estensibilità OCP del Strategy Pattern senza duplicare la matematica rotazionale né alterare il router, rendendo l’intero workflow accessibile via tastiera e screen reader.',
    revisitCondition:
      'Benchmark frattali >= 50ms su generazioni >= 5 con eventuale porting L-System in Rust/WASM in Fase 5.',
  },
  {
    id: 'PH4-THREADING',
    phase: AdrPhase.Phase4,
    title: 'Rinvio SharedArrayBuffer / WASM Threads (Esclusione Header COOP/COEP)',
    status: AdrStatus.Ratified,
    decision:
      'Mantenimento del Web Worker single-threaded con Float64Array Transferable; nessuna adozione di SharedArrayBuffer né header Cross-Origin-Opener-Policy/Cross-Origin-Embedder-Policy.',
    rationale:
      'I carichi frattali e di simmetria sono triggerati da singola interazione utente (non pipeline batch) e gli header COOP/COEP escluderebbero iframe terzi (auth/checkout/AI Studio).',
    revisitCondition:
      'Evidenza di coda bloccante nel Worker dai profili di produzione Fase 5 con revisione esplicita dei requisiti di embedding.',
  },
  {
    id: 'PH5-LSYSTEM-WASM',
    phase: AdrPhase.Phase5,
    title: 'Porting L-System in Memoria Lineare WASM & Escalation Off-Thread (Gen ≥ 5)',
    status: AdrStatus.Ratified,
    decision:
      'Implementazione kernel WASM `expand_lsystem_bytes` + `interpret_lsystem_turtle_f64` con polinomi Taylor IEEE-754 a precisione 1e-12, eseguito nel Web Worker persistente quando generations >= 5 o routingMode = force-wasm-worker, con fallback JS trasparente.',
    rationale:
      'Elimina lo stallo di 99ms sul main thread rilevato su Sacred Blossom G6 eseguendo riscrittura grammaticale, turtle stack ed espansione radiale interamente in memoria lineare.',
    revisitCondition:
      'Compilazione diretta via cargo/wasm-pack in CI dedicata mantenendo identico contratto ABI.',
  },
  {
    id: 'PH5-CSP-FONTS',
    phase: AdrPhase.Phase5,
    title: 'Strict Content Security Policy & Font WOFF2 Self-Hosted Offline-First',
    status: AdrStatus.Ratified,
    decision:
      "Rimozione totale di domini font esterni; font Plus Jakarta Sans e JetBrains Mono self-hosted via @fontsource sotto Strict CSP (`default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; font-src 'self'`) e assenza di COOP/COEP.",
    rationale:
      'Elimina dipendenze esterne al primo avvio offline, soddisfa Strict CSP senza unsafe-eval su script JS e preserva l’esecuzione dentro iframe iStudio/TWA.',
    revisitCondition:
      'Modifica delle policy di rete PWA/TWA o adozione di subresource integrity su CDN esterne.',
  },
  {
    id: 'PH5-QUALITY-GATES',
    phase: AdrPhase.Phase5,
    title: 'Pipeline CI Quality Gates (Benchmark +15%, Size-Limit, WASM ≤ 200KB, Axe & LHCI)',
    status: AdrStatus.Ratified,
    decision:
      'Suite di gate automatici pre-release: baseline performance su logica pura JS/WASM (max +15% regressione mediana, escluso rendering SwiftShader), budget bundle (`entry <= 200KB` gzip, `.wasm <= 200KB`), `@axe-core/playwright` WCAG 2.1 AA con registro esenzioni a scadenza e Lighthouse CI mobile (`Perf >= 0.90, A11y >= 0.95`).',
    rationale:
      'Previene regressioni silenti di prestazioni, dimensione bundle o accessibilità prima del rilascio PWA e del packaging Android TWA.',
    revisitCondition:
      'Aggiornamento baseline hardware CI o variazione delle soglie WCAG 2.2 AA.',
  },
  {
    id: 'PH5-WORLD-LENS',
    phase: AdrPhase.Phase5,
    title: 'Camera Spazio Mondo & Anteprima Lente Semisferica WebGL2 Sola-Visualizzazione',
    status: AdrStatus.Ratified,
    decision:
      'Spazio mondo esteso r=1200 con Camera (zoom 0.25x–8x ancorato al mondo) e compositore WebGL2 offscreen per Lente Semisferica (Cupola Sferica, Vetro Rifrattivo, Disco Iperbolico di Poincaré) in sola anteprima con ritorno automatico alla vista piana per il disegno.',
    rationale:
      'Evita distorsioni di precisione o parallasse inversa durante lo stilo garantendo al tempo stesso fedeltà ottica e protezione VRAM tramite fallback automatico 2048px -> 1024px.',
    revisitCondition:
      'Introduzione di interazione diretta su superfici curve con proiezione inversa differenziabile.',
  },
];

export {
  ANDROID_PHASE1_SCAFFOLD,
  PHASE3_WASM_SCAFFOLD,
  type AndroidScaffoldFile,
} from './androidScaffoldTemplates.ts';

