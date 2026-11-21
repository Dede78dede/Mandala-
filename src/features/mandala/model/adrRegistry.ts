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

export interface AndroidScaffoldFile {
  path: string;
  title: string;
  language: string;
  content: string;
}

export const ANDROID_PHASE1_SCAFFOLD: AndroidScaffoldFile[] = [
  {
    path: 'gradle/libs.versions.toml',
    title: 'Gradle Version Catalog Revisionato (Kotlin 2.1 + Compose + ViewModel + JUnit 5)',
    language: 'toml',
    content: `[versions]
agp = "8.7.2"
kotlin = "2.1.0"
composeBom = "2024.12.01"
coreKtx = "1.15.0"
lifecycle = "2.8.7"
activityCompose = "1.9.3"
kotlinxSerialization = "1.7.3"
kotlinxCoroutines = "1.9.0"
inputMotionPrediction = "1.0.0"
profileInstaller = "1.4.1"
junit5 = "5.11.3"
androidJunit5 = "2.0.2"
compileSdk = "35"
minSdk = "28"
targetSdk = "35"

[libraries]
androidx-core-ktx = { group = "androidx.core", name = "core-ktx", version.ref = "coreKtx" }
androidx-activity-compose = { group = "androidx.activity", name = "activity-compose", version.ref = "activityCompose" }

androidx-compose-bom = { group = "androidx.compose", name = "compose-bom", version.ref = "composeBom" }
androidx-compose-ui = { group = "androidx.compose.ui", name = "ui" }
androidx-compose-ui-graphics = { group = "androidx.compose.ui", name = "ui-graphics" }
androidx-compose-ui-tooling = { group = "androidx.compose.ui", name = "ui-tooling" }
androidx-compose-ui-tooling-preview = { group = "androidx.compose.ui", name = "ui-tooling-preview" }
androidx-compose-material3 = { group = "androidx.compose.material3", name = "material3" }

androidx-lifecycle-runtime-ktx = { group = "androidx.lifecycle", name = "lifecycle-runtime-ktx", version.ref = "lifecycle" }
androidx-lifecycle-runtime-compose = { group = "androidx.lifecycle", name = "lifecycle-runtime-compose", version.ref = "lifecycle" }
androidx-lifecycle-viewmodel-compose = { group = "androidx.lifecycle", name = "lifecycle-viewmodel-compose", version.ref = "lifecycle" }

kotlinx-serialization-json = { group = "org.jetbrains.kotlinx", name = "kotlinx-serialization-json", version.ref = "kotlinxSerialization" }
kotlinx-coroutines-android = { group = "org.jetbrains.kotlinx", name = "kotlinx-coroutines-android", version.ref = "kotlinxCoroutines" }

androidx-input-motionprediction = { group = "androidx.input", name = "input-motionprediction", version.ref = "inputMotionPrediction" }
androidx-profileinstaller = { group = "androidx.profileinstaller", name = "profileinstaller", version.ref = "profileInstaller" }

junit-jupiter = { group = "org.junit.jupiter", name = "junit-jupiter", version.ref = "junit5" }
androidx-compose-ui-test-junit4 = { group = "androidx.compose.ui", name = "ui-test-junit4" }
androidx-compose-ui-test-manifest = { group = "androidx.compose.ui", name = "ui-test-manifest" }

[bundles]
compose = [
  "androidx-compose-ui",
  "androidx-compose-ui-graphics",
  "androidx-compose-material3",
  "androidx-compose-ui-tooling-preview"
]
lifecycle = [
  "androidx-lifecycle-runtime-ktx",
  "androidx-lifecycle-runtime-compose",
  "androidx-lifecycle-viewmodel-compose"
]

[plugins]
android-application = { id = "com.android.application", version.ref = "agp" }
kotlin-android = { id = "org.jetbrains.kotlin.android", version.ref = "kotlin" }
kotlin-compose = { id = "org.jetbrains.kotlin.plugin.compose", version.ref = "kotlin" }
kotlin-serialization = { id = "org.jetbrains.kotlin.plugin.serialization", version.ref = "kotlin" }
android-junit5 = { id = "de.mannodermaus.android-junit5", version.ref = "androidJunit5" }`,
  },
  {
    path: 'app/build.gradle.kts',
    title: 'Modulo App Gradle KTS (BOM Platform + JUnit 5 + Serialization)',
    language: 'kotlin',
    content: `plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.android.junit5)
}

android {
    namespace = "com.mandala.studio"
    compileSdk = libs.versions.compileSdk.get().toInt()

    defaultConfig {
        applicationId = "com.mandala.studio"
        minSdk = libs.versions.minSdk.get().toInt()
        targetSdk = libs.versions.targetSdk.get().toInt()
        versionCode = 2
        versionName = "2.0.0-phase2"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)

    // Compose BOM come platform: nessuna versione esplicita sui moduli Compose
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.bundles.compose)
    implementation(libs.bundles.lifecycle)

    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.androidx.input.motionprediction)
    implementation(libs.androidx.profileinstaller)

    debugImplementation(libs.androidx.compose.ui.tooling)
    debugImplementation(libs.androidx.compose.ui.test.manifest)

    testImplementation(libs.junit.jupiter)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
}`,
  },
  {
    path: 'app/src/main/java/com/mandala/studio/domain/MandalaDocument.kt',
    title: 'Contratto @Serializable MandalaDocument v1',
    language: 'kotlin',
    content: `package com.mandala.studio.domain

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class Point2D(
    val x: Float,
    val y: Float,
    val pressure: Float = 0.5f
)

@Serializable
data class WedgeStroke(
    val id: String,
    val points: List<Point2D>,
    val stroke: String,
    val strokeWidth: Float,
    val dash: List<Float>? = null,
    val opacity: Float = 0.95f
)

@Serializable
sealed interface SymmetryParams {
    val order: Int

    @Serializable
    @SerialName("radial")
    data class Radial(override val order: Int) : SymmetryParams

    @Serializable
    @SerialName("mirror-radial")
    data class MirrorRadial(
        override val order: Int,
        val mirrorMode: String = "reflect"
    ) : SymmetryParams

    @Serializable
    @SerialName("fractal")
    data class Fractal(
        override val order: Int,
        val preset: String = "sacredFlower",
        val generations: Int = 3,
        val angle: Float = 36f,
        val stepLength: Float = 20f
    ) : SymmetryParams
}

@Serializable
data class MandalaDocument(
    val schemaVersion: Int = 1,
    val title: String,
    val symmetryParams: SymmetryParams,
    val wedges: List<WedgeStroke>,
    val paletteId: String = "okabe-ito",
    val activeColour: String = "#56B4E9",
    val activeStrokeWidth: Float = 3.5f,
    val activeDash: List<Float>? = null,
    val createdAt: String
)`,
  },
  {
    path: 'app/src/main/java/com/mandala/studio/domain/SymmetryStrategy.kt',
    title: 'Kotlin SymmetryStrategy (Radial & MirrorRadial Parity)',
    language: 'kotlin',
    content: `package com.mandala.studio.domain

import kotlin.math.cos
import kotlin.math.sin

interface SymmetryStrategy {
    val id: String
    fun expand(wedge: WedgeStroke, params: SymmetryParams, center: Point2D): List<WedgeStroke>
}

fun rotatePoint(p: Point2D, angleRad: Double, center: Point2D): Point2D {
    val cosA = cos(angleRad).toFloat()
    val sinA = sin(angleRad).toFloat()
    val dx = p.x - center.x
    val dy = p.y - center.y
    return Point2D(
        x = center.x + (dx * cosA - dy * sinA),
        y = center.y + (dx * sinA + dy * cosA),
        pressure = p.pressure
    )
}

fun reflectPoint(p: Point2D, axisRad: Double, center: Point2D): Point2D {
    val dx = p.x - center.x
    val dy = p.y - center.y
    val cos2 = cos(2.0 * axisRad).toFloat()
    val sin2 = sin(2.0 * axisRad).toFloat()
    return Point2D(
        x = center.x + (dx * cos2 + dy * sin2),
        y = center.y + (dx * sin2 - dy * cos2),
        pressure = p.pressure
    )
}

object RadialStrategy : SymmetryStrategy {
    override val id: String = "radial"

    override fun expand(
        wedge: WedgeStroke,
        params: SymmetryParams,
        center: Point2D
    ): List<WedgeStroke> {
        val n = params.order.coerceIn(1, 48)
        if (wedge.points.isEmpty()) return emptyList()
        val angleStep = (2.0 * Math.PI / n)

        return List(n) { i ->
            if (i == 0) return@List wedge
            val theta = i * angleStep
            wedge.copy(
                id = "\${wedge.id}_r\$i",
                points = wedge.points.map { rotatePoint(it, theta, center) }
            )
        }
    }
}

object MirrorRadialStrategy : SymmetryStrategy {
    override val id: String = "mirror-radial"

    override fun expand(
        wedge: WedgeStroke,
        params: SymmetryParams,
        center: Point2D
    ): List<WedgeStroke> {
        val n = params.order.coerceIn(1, 48)
        if (wedge.points.isEmpty()) return emptyList()
        val step = (2.0 * Math.PI / n)
        val alternate = params is SymmetryParams.MirrorRadial && params.mirrorMode == "alternate"

        return buildList(n * 2) {
            for (i in 0 until n) {
                val baseAngle = i * step
                val rotated = if (i == 0) wedge.points else wedge.points.map { rotatePoint(it, baseAngle, center) }
                add(wedge.copy(id = "\${wedge.id}_m\${i}_a", points = rotated))

                val mirrorAxis = baseAngle + if (alternate && i % 2 == 1) step / 4.0 else 0.0
                val reflected = rotated.map { reflectPoint(it, mirrorAxis, center) }
                add(wedge.copy(id = "\${wedge.id}_m\${i}_b", points = reflected))
            }
        }
    }
}

object FractalStrategy : SymmetryStrategy {
    override val id: String = "fractal"

    override fun expand(
        wedge: WedgeStroke,
        params: SymmetryParams,
        center: Point2D
    ): List<WedgeStroke> = RadialStrategy.expand(wedge, params, center)
}`,
  },
  {
    path: 'app/src/main/java/com/mandala/studio/ui/MandalaViewModel.kt',
    title: 'ViewModel + StateFlow + Command Stack (50 Comandi)',
    language: 'kotlin',
    content: `package com.mandala.studio.ui

import androidx.lifecycle.ViewModel
import com.mandala.studio.domain.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

data class HistoryCommand(
    val label: String,
    val redo: () -> Unit,
    val undo: () -> Unit
)

data class MandalaUiState(
    val wedges: List<WedgeStroke> = emptyList(),
    val symmetryParams: SymmetryParams = SymmetryParams.Radial(8),
    val activeColour: String = "#56B4E9",
    val activeStrokeWidth: Float = 3.5f,
    val activeDash: List<Float>? = null,
    val canUndo: Boolean = false,
    val canRedo: Boolean = false
)

class MandalaViewModel : ViewModel() {
    private val _uiState = MutableStateFlow(MandalaUiState())
    val uiState: StateFlow<MandalaUiState> = _uiState.asStateFlow()

    private val undoStack = ArrayDeque<HistoryCommand>()
    private val redoStack = ArrayDeque<HistoryCommand>()

    fun commitStroke(stroke: WedgeStroke) {
        val cmd = HistoryCommand(
            label = "Tratto (\${_uiState.value.symmetryParams.order} ordini)",
            redo = { _uiState.update { it.copy(wedges = it.wedges + stroke) } },
            undo = { _uiState.update { it.copy(wedges = it.wedges.filterNot { w -> w.id == stroke.id }) } }
        )
        executeCommand(cmd)
    }

    private fun executeCommand(cmd: HistoryCommand) {
        cmd.redo()
        if (undoStack.size >= 50) undoStack.removeFirst()
        undoStack.addLast(cmd)
        redoStack.clear()
        syncHistoryFlags()
    }

    fun undo() {
        val cmd = undoStack.removeLastOrNull() ?: return
        cmd.undo()
        redoStack.addLast(cmd)
        syncHistoryFlags()
    }

    fun redo() {
        val cmd = redoStack.removeLastOrNull() ?: return
        cmd.redo()
        undoStack.addLast(cmd)
        syncHistoryFlags()
    }

    private fun syncHistoryFlags() {
        _uiState.update {
            it.copy(canUndo = undoStack.isNotEmpty(), canRedo = redoStack.isNotEmpty())
        }
    }
}`,
  },
  {
    path: 'app/src/test/java/com/mandala/studio/domain/SymmetryStrategyTest.kt',
    title: 'JUnit 5 Geometric Invariants Test',
    language: 'kotlin',
    content: `package com.mandala.studio.domain

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class SymmetryStrategyTest {
    private val center = Point2D(400f, 400f)

    @Test
    fun \`radial expansion at N=8 produces 8 symmetric strokes\`() {
        val wedge = WedgeStroke(
            id = "w1",
            points = listOf(Point2D(400f, 300f), Point2D(420f, 320f)),
            stroke = "#56B4E9",
            strokeWidth = 4f
        )
        val expanded = RadialStrategy.expand(wedge, SymmetryParams.Radial(8), center)
        assertEquals(8, expanded.size)
    }

    @Test
    fun \`mirror radial at N=6 produces 12 symmetric strokes\`() {
        val wedge = WedgeStroke(
            id = "w2",
            points = listOf(Point2D(400f, 280f), Point2D(430f, 310f)),
            stroke = "#E69F00",
            strokeWidth = 3f
        )
        val expanded = MirrorRadialStrategy.expand(wedge, SymmetryParams.MirrorRadial(6), center)
        assertEquals(12, expanded.size)
    }

    @Test
    fun \`center point maps to itself under any rotation\`() {
        val wedge = WedgeStroke("c", listOf(center), "#000000", 2f)
        val expanded = RadialStrategy.expand(wedge, SymmetryParams.Radial(12), center)
        expanded.forEach { stroke ->
            assertEquals(center.x, stroke.points.first().x, 1e-4f)
            assertEquals(center.y, stroke.points.first().y, 1e-4f)
        }
    }
}`,
  },
  {
    path: 'app/src/main/java/com/mandala/studio/ui/MandalaCanvas.kt',
    title: 'Compose Hardware Canvas + MotionEventPredictor 1.0.0',
    language: 'kotlin',
    content: `package com.mandala.studio.ui

import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.view.MotionEvent
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.input.pointer.pointerInteropFilter
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.platform.LocalView
import androidx.input.motionprediction.MotionEventPredictor
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.mandala.studio.domain.*

@Composable
fun NativeMandalaCanvas(vm: MandalaViewModel = viewModel()) {
    val state by vm.uiState.collectAsStateWithLifecycle()
    val view = LocalView.current
    val predictor = remember(view) { MotionEventPredictor.newInstance(view) }
    var activePoints by remember { mutableStateOf<List<Point2D>>(emptyList()) }

    Canvas(
        modifier = Modifier
            .fillMaxSize()
            .semantics {
                liveRegion = LiveRegionMode.Polite
                contentDescription = "Mandala con \${state.symmetryParams.order} ordini, \${state.wedges.size} tratti."
            }
            .pointerInteropFilter { event ->
                predictor.record(event)
                when (event.actionMasked) {
                    MotionEvent.ACTION_DOWN -> {
                        activePoints = listOf(Point2D(event.x, event.y, event.pressure))
                        true
                    }
                    MotionEvent.ACTION_MOVE -> {
                        val batch = buildList {
                            for (h in 0 until event.historySize) {
                                add(Point2D(event.getHistoricalX(h), event.getHistoricalY(h), event.getHistoricalPressure(h)))
                            }
                            add(Point2D(event.x, event.y, event.pressure))
                        }
                        activePoints = activePoints + batch
                        true
                    }
                    MotionEvent.ACTION_UP -> {
                        if (activePoints.isNotEmpty()) {
                            vm.commitStroke(
                                WedgeStroke(
                                    id = "s_\${System.nanoTime()}",
                                    points = activePoints,
                                    stroke = state.activeColour,
                                    strokeWidth = state.activeStrokeWidth,
                                    dash = state.activeDash
                                )
                            )
                        }
                        activePoints = emptyList()
                        true
                    }
                    else -> false
                }
            }
    ) {
        val center = Point2D(size.width / 2f, size.height / 2f)
        val strategy: SymmetryStrategy = when (state.symmetryParams) {
            is SymmetryParams.MirrorRadial -> MirrorRadialStrategy
            is SymmetryParams.Fractal -> FractalStrategy
            is SymmetryParams.Radial -> RadialStrategy
        }
        val previewWedge = activePoints.takeIf { it.isNotEmpty() }?.let { pts ->
            WedgeStroke(
                id = "preview",
                points = pts,
                stroke = state.activeColour,
                strokeWidth = state.activeStrokeWidth,
                dash = state.activeDash,
                opacity = 0.9f
            )
        }

        drawIntoCanvas { canvas ->
            val native = canvas.nativeCanvas
            val strokePaint = Paint().apply {
                style = Paint.Style.STROKE
                strokeCap = Paint.Cap.ROUND
                strokeJoin = Paint.Join.ROUND
                isAntiAlias = true
            }
            val dotPaint = Paint().apply {
                style = Paint.Style.FILL
                isAntiAlias = true
            }

            val toRender = if (previewWedge != null) state.wedges + previewWedge else state.wedges
            for (wedge in toRender) {
                val argb = Color.parseColor(wedge.stroke)
                strokePaint.color = argb
                strokePaint.strokeWidth = wedge.strokeWidth
                dotPaint.color = argb

                for (sym in strategy.expand(wedge, state.symmetryParams, center)) {
                    if (sym.points.size == 1) {
                        val p = sym.points.first()
                        native.drawCircle(p.x, p.y, maxOf(1.5f, sym.strokeWidth / 2f), dotPaint)
                    } else if (sym.points.size > 1) {
                        val path = Path().apply {
                            sym.points.forEachIndexed { idx, p ->
                                if (idx == 0) moveTo(p.x, p.y) else lineTo(p.x, p.y)
                            }
                        }
                        native.drawPath(path, strokePaint)
                    }
                }
            }
        }
    }
}`,
  },
];

export const PHASE3_WASM_SCAFFOLD: AndroidScaffoldFile[] = [
  {
    path: 'crate/Cargo.toml',
    title: 'Crate Rust Fase 3 — Release Profile Ottimizzato (opt-level="z", LTO, abort)',
    language: 'toml',
    content: `[package]
name = "mandala-wasm"
version = "0.3.0"
edition = "2021"

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
wasm-bindgen = "=0.2.95"

[profile.release]
opt-level = "z"
lto = true
codegen-units = 1
panic = "abort"
strip = true`,
  },
  {
    path: 'crate/src/lib.rs',
    title: 'Core Rust #[wasm_bindgen] — Parità 1e-12 & L-System Linear-Memory Kernel (Fase 5)',
    language: 'rust',
    content: `use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn expand_radial_flat(
    points_xy: &[f64],
    order: usize,
    cx: f64,
    cy: f64,
) -> Vec<f64> {
    let pt_count = points_xy.len() / 2;
    if pt_count == 0 || order == 0 {
        return Vec::new();
    }
    let mut out = Vec::with_capacity(order * points_xy.len());
    let step = std::f64::consts::TAU / (order as f64);

    for fold in 0..order {
        let angle = (fold as f64) * step;
        let (sin_a, cos_a) = angle.sin_cos();
        for p in 0..pt_count {
            let dx = points_xy[p * 2] - cx;
            let dy = points_xy[p * 2 + 1] - cy;
            out.push(cx + (dx * cos_a - dy * sin_a));
            out.push(cy + (dx * sin_a + dy * cos_a));
        }
    }
    out
}

/// Phase 5 L-System grammar rewrite + turtle graphics interpreter in linear memory.
/// Matches binary ABI exported by public/wasm/mandala_symmetry.wasm (interpret_lsystem_turtle_f64).
#[wasm_bindgen]
pub fn expand_lsystem_turtle_flat(
    axiom: &[u8],
    rules: &[(u8, &[u8])],
    generations: u8,
    step_length: f64,
    angle_deg: f64,
    cx: f64,
    cy: f64,
) -> Vec<f64> {
    let mut current = axiom.to_vec();
    for _ in 0..generations.clamp(1, 6) {
        let mut next = Vec::with_capacity(current.len() * 2);
        for &ch in &current {
            if let Some((_, repl)) = rules.iter().find(|(k, _)| *k == ch) {
                next.extend_from_slice(repl);
            } else {
                next.push(ch);
            }
        }
        current = next;
    }

    let rad_step = angle_deg.to_radians();
    let mut x = cx;
    let mut y = cy;
    let mut angle = -std::f64::consts::FRAC_PI_2;
    let mut stack = Vec::with_capacity(256);
    let mut out = Vec::with_capacity(current.len() * 2);
    out.push(x);
    out.push(y);

    for &cmd in &current {
        match cmd {
            b'F' | b'A' | b'B' | b'G' => {
                x += step_length * angle.cos();
                y += step_length * angle.sin();
                out.push(x);
                out.push(y);
            }
            b'+' => angle += rad_step,
            b'-' => angle -= rad_step,
            b'[' => stack.push((x, y, angle)),
            b']' => {
                if let Some((sx, sy, sa)) = stack.pop() {
                    x = sx;
                    y = sy;
                    angle = sa;
                }
            }
            _ => {}
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn radial_n4_matches_exact_quadrants() {
        let out = expand_radial_flat(&[410.0, 400.0], 4, 400.0, 400.0);
        assert_eq!(out.len(), 8);
        assert!((out[2] - 400.0).abs() < 1e-12);
        assert!((out[3] - 410.0).abs() < 1e-12);
    }
}`,
  },
];

