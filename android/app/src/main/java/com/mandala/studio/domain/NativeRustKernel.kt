package com.mandala.studio.domain

/**
 * JNI wrapper over `crates/mandala-core/src/jni_bridge.rs` (`libmandala_core.so`).
 * Degrades cleanly to `isAvailable = false` if native NDK binary is absent on an ABI.
 */
object NativeRustKernel {
    val isAvailable: Boolean = runCatching {
        System.loadLibrary("mandala_core")
        true
    }.getOrDefault(false)

    external fun nativeExpandRadial(
        pointsXy: DoubleArray,
        order: Int,
        cx: Double,
        cy: Double
    ): DoubleArray

    external fun nativeExpandMirrorRadial(
        pointsXy: DoubleArray,
        order: Int,
        cx: Double,
        cy: Double,
        alternate: Boolean
    ): DoubleArray

    external fun nativeGenerateLSystem(
        axiom: String,
        ruleSymbols: String,
        ruleReplacements: Array<String>,
        generations: Int,
        stepLength: Double,
        angleDegrees: Double,
        cx: Double,
        cy: Double
    ): DoubleArray
}
