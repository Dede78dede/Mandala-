/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Centralized Italian UI, Guard, Persistence, Worker, and Export Message Catalog (SSOT).
 * Decouples pure geometry/store domain logic from hardcoded natural-language strings.
 */

import { MirrorMode, SvgSerializationMode } from './types.ts';

export const MANDALA_MESSAGES = {
  workspace: {
    defaultDocTitlePrefix: 'Mandala',
    sessionDocTitle: 'Mandala Studio Session',
    clearCanvasLabel: 'Pulisci tela',
    clearCanvasAnnouncement: 'Tela azzerata.',
    resetSettingsAnnouncement: 'Impostazioni predefinite ripristinate.',
    resetWorkspaceAnnouncement: 'Workspace completamente ripristinato.',
    drawPointLabel: 'Punto simmetrico',
    importedSessionAnnouncement: (title: string, wedgeCount: number) =>
      `Importato mandala "${title}" (${wedgeCount} tratti).`,
  },
  guards: {
    overSceneWedges: (nextCount: number, maxCount: number) =>
      `Limite sicurezza CPU/Scena raggiunto: ${nextCount} tratti superano il tetto massimo di ${maxCount}. Esegui Flush Cache o pulisci la tela.`,
    overScenePoints: (totalPoints: number, maxPoints: number) =>
      `Protezione Anti Over-Memory: ${totalPoints.toLocaleString()} punti superano il limite sicuro di ${maxPoints.toLocaleString()} punti.`,
    overMemoryHeap: (estimatedMb: string, hardMaxMb: string) =>
      `Protezione Anti Over-Memory: stima heap ${estimatedMb} MB oltre la soglia di ${hardMaxMb} MB.`,
    overCpuPrimitives: (expandedPrimitives: number, maxPrimitives: number) =>
      `Protezione Anti Over-CPU: ${expandedPrimitives.toLocaleString()} primitive simmetriche superano il budget massimo di ${maxPrimitives.toLocaleString()} per frame.`,
    overFractalSegments: (expandedSegments: number, maxSegments: number) =>
      `Sicurezza Anti Over-CPU: ${expandedSegments.toLocaleString()} segmenti frattali superano il limite operativo di ${maxSegments.toLocaleString()}. Riduci generazioni o ordine N.`,
    fractalPreviewOverflow: (expandedSegments: number, maxSegments: number) =>
      `Frattale non ammesso (${expandedSegments.toLocaleString()} > ${maxSegments.toLocaleString()} segmenti).`,
  },
  symmetry: {
    invalidOrder: (order: number) => `Ordine simmetria non valido: ${order}`,
    unknownStrategy: 'Strategia di simmetria sconosciuta',
    describeRadial: (order: number) => `simmetria radiale pura a ${order} ordini`,
    describeMirror: (order: number, mode: MirrorMode) =>
      `simmetria speculare (${mode === MirrorMode.Alternate ? 'alternata' : 'bilaterale'}) a ${order} ordini`,
    describeFractal: (preset: string, generations: number, order: number) =>
      `simmetria frattale L-System (${preset}, ${generations} gen.) a ${order} ordini`,
  },
  persistence: {
    storageQuotaWarning:
      'Memoria locale piena: sessione salvata in modalità estesa IndexedDB L3.',
    storageReadWarning:
      'Accesso a localStorage limitato dal browser: sessione gestita in memoria/L3.',
    oversizedSessionWarning: (sizeMb: string) =>
      `Sessione salvata oltre il limite sicuro (${sizeMb} MB): tela sicura ripristinata.`,
    hydrateErrorFallback:
      'Errore durante il ripristino della sessione: avviata tela sicura.',
    indexedDbUnavailable: 'IndexedDB non disponibile in questo ambiente.',
  },
  wasmWorker: {
    fallbackNotice:
      'Worker WebAssembly non disponibile: eseguito calcolo di precisione sul motore JavaScript.',
    timeoutError: (jobId: number) => `Timeout esecuzione job WASM #${jobId}.`,
    initTimeoutError: 'Timeout inizializzazione Web Worker WASM.',
    fetchNotAvailable: 'Fetch API non disponibile per caricamento WASM.',
    workerNotSupported: 'Web Worker non supportati in questo ambiente (fallback JS attivo).',
    workerCreationFailed: 'Creazione Web Worker fallita.',
    workerDisposed: 'Worker WASM già dismesso.',
    workerTerminatedBeforeDone: 'Worker terminato prima del completamento job.',
    fatalWorkerError: 'Errore fatale nel Web Worker WASM.',
    unexpectedReply: 'Risposta worker inattesa.',
    unexpectedLSystemReply: 'Risposta worker L-System inattesa.',
    useLSystemMethod: 'Usare expandLSystemZeroCopy per la strategia frattale.',
    fractalWasmAnnouncement: (computeMs: number, count: number) =>
      `Frattale L-System generato in WASM Worker (${computeMs.toFixed(1)} ms, ${count} polilinee base).`,
    fractalJsAnnouncement: (presetName: string, generations: number, count: number) =>
      `Frattale ${presetName} (G${generations}) aggiunto: ${count} polilinee.`,
  },
  webgl: {
    shaderCompileFailed: 'Compilazione shader WebGL2 fallita: attiva vista piana 2D.',
    programLinkFailed: 'Linking programma WebGL2 fallito: attiva vista piana 2D.',
    bufferAllocFailed: 'Allocazione vertex buffer WebGL2 fallita.',
    contextLostNotice: 'Contesto GPU WebGL2 temporaneamente perso: ripristino in corso.',
    contextRestoredNotice: 'Contesto GPU WebGL2 ripristinato.',
    pngLensFallbackNotice:
      'Export Lente WebGL2 non supportato su questa GPU: generato PNG piatto ad alta risoluzione.',
  },
  export: {
    pngUnavailable: 'Contesto Canvas non disponibile per esportazione PNG.',
    svgModeLabel: (mode: SvgSerializationMode.Absolute | SvgSerializationMode.DefsUse) =>
      mode === SvgSerializationMode.DefsUse ? '<defs>/<use>' : 'Coordinate Assolute',
    jsonReadFailed: 'Impossibile leggere il file selezionato.',
    jsonSavedToast: 'Documento JSON v2 (spazio mondo centrato) salvato.',
  },
  motion: {
    reducedMotion: 'Animazioni automatiche sospese (prefers-reduced-motion attivo).',
    tabHidden: 'Animazione in pausa automatica (scheda in background).',
    cpuProtected: 'Animazione sospesa dalla protezione CPU Anti-Saturazione.',
  },
  media: {
    imageTooLarge: 'Immagine troppo pesante (max 12 MB).',
    imageDecodeFailed: 'Formato immagine non supportato dal browser.',
  },
  distribution: {
    menuButtonWeb: 'Scarica App Android (.apk)',
    menuButtonAndroid: 'App Android & Aggiornamenti',
    menuButtonStylus: 'Tela Stilo Nativa (120Hz)',
    modalTitleWeb: 'App Android & Verifica Integrità',
    modalTitleAndroid: 'Host Android Ibrido & Aggiornamenti',
    modalSubtitleWeb:
      'APK standalone offline con WebViewAssetLoader, Tela Stilo 120Hz e Self-Updater verificato SHA-256.',
    modalSubtitleAndroid:
      'Esecuzione dentro l’app Android nativa con passaggio diretto verso Tela Stilo 120Hz e verifica aggiornamenti.',
    downloadApkCta: 'Scarica APK Android',
    openReleasesCta: 'Apri pagina GitHub Releases',
    checkUpdatesCta: 'Verifica aggiornamenti',
    installUpdateCta: 'Installa aggiornamento APK',
    openStylusCta: 'Apri Tela Stilo Nativa (120Hz)',
    copyShaCta: 'Copia SHA-256',
    copiedShaCta: 'SHA-256 copiato',
    shaPendingNotice:
      'Impronta SHA-256 generata automaticamente al primo rilascio CI firmato su GitHub Releases.',
    manifestLoadFailed:
      'Impossibile caricare il manifest locale della release: utilizzato collegamento diretto alle release.',
    nativeExportFallback:
      'Bridge nativo Android non disponibile per l’esportazione: utilizzato download browser standard.',
    stylusHandoverSent: 'Documento inviato alla Tela Stilo Nativa 120Hz.',
    stylusHandoverImported: (title: string) =>
      `Tratti dalla Tela Stilo Nativa importati in "${title}".`,
    stylusUnavailable: 'Tela Stilo Nativa disponibile solo dentro l’APK Android.',
    setupHelpToggle: 'Configurazione Release & Secrets · Azione Umana Richiesta',
    setupHelpCommand:
      'python3 scripts/setup_android_release.py --repo OWNER/REPO --generate-keystore ~/.android/mandala-release.p12 --apply-gh',
  },
} as const;
