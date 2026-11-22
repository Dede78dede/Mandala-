package com.mandala.studio.domain

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

interface SymmetryStrategy {
    fun expandFlat(
        pointsXy: DoubleArray,
        cx: Double,
        cy: Double
    ): List<DoubleArray>
}

class RadialSymmetryStrategy(
    private val order: Int
) : SymmetryStrategy {
    override fun expandFlat(pointsXy: DoubleArray, cx: Double, cy: Double): List<DoubleArray> {
        val ptCount = pointsXy.size / 2
        if (ptCount == 0 || order <= 0) return emptyList()

        if (NativeRustKernel.isAvailable) {
            val nativeExpanded = runCatching {
                NativeRustKernel.nativeExpandRadial(pointsXy, order, cx, cy)
            }.getOrNull()
            if (nativeExpanded != null && nativeExpanded.size == order * ptCount * 2) {
                return splitFlatStrokes(nativeExpanded, order, ptCount)
            }
        }

        val step = (2.0 * PI) / order
        return List(order) { fold ->
            val theta = fold * step
            val cosA = cos(theta)
            val sinA = sin(theta)
            val out = DoubleArray(ptCount * 2)
            for (p in 0 until ptCount) {
                val dx = pointsXy[p * 2] - cx
                val dy = pointsXy[p * 2 + 1] - cy
                out[p * 2] = cx + (dx * cosA - dy * sinA)
                out[p * 2 + 1] = cy + (dx * sinA + dy * cosA)
            }
            out
        }
    }
}

class MirrorRadialSymmetryStrategy(
    private val order: Int,
    private val alternate: Boolean
) : SymmetryStrategy {
    override fun expandFlat(pointsXy: DoubleArray, cx: Double, cy: Double): List<DoubleArray> {
        val ptCount = pointsXy.size / 2
        if (ptCount == 0 || order <= 0) return emptyList()

        if (NativeRustKernel.isAvailable) {
            val nativeExpanded = runCatching {
                NativeRustKernel.nativeExpandMirrorRadial(pointsXy, order, cx, cy, alternate)
            }.getOrNull()
            if (nativeExpanded != null && nativeExpanded.size == order * 2 * ptCount * 2) {
                return splitFlatStrokes(nativeExpanded, order * 2, ptCount)
            }
        }

        val step = (2.0 * PI) / order
        val strokes = ArrayList<DoubleArray>(order * 2)
        for (i in 0 until order) {
            val baseAngle = i * step
            val mirrorAxis = baseAngle + if (alternate && i % 2 == 1) step / 4.0 else 0.0
            val cosA = cos(baseAngle)
            val sinA = sin(baseAngle)
            val cos2 = cos(2.0 * mirrorAxis)
            val sin2 = sin(2.0 * mirrorAxis)

            val rot = DoubleArray(ptCount * 2)
            val mir = DoubleArray(ptCount * 2)
            for (p in 0 until ptCount) {
                val dx = pointsXy[p * 2] - cx
                val dy = pointsXy[p * 2 + 1] - cy
                val rx = dx * cosA - dy * sinA
                val ry = dx * sinA + dy * cosA
                rot[p * 2] = cx + rx
                rot[p * 2 + 1] = cy + ry
                mir[p * 2] = cx + (rx * cos2 + ry * sin2)
                mir[p * 2 + 1] = cy + (rx * sin2 - ry * cos2)
            }
            strokes.add(rot)
            strokes.add(mir)
        }
        return strokes
    }
}

private fun splitFlatStrokes(
    flat: DoubleArray,
    strokeCount: Int,
    ptCount: Int
): List<DoubleArray> {
    val stride = ptCount * 2
    return List(strokeCount) { idx ->
        flat.copyOfRange(idx * stride, (idx + 1) * stride)
    }
}

fun buildSymmetryStrategy(params: SymmetryParamsDto): SymmetryStrategy = when (params) {
    is SymmetryParamsDto.Radial -> RadialSymmetryStrategy(params.order)
    is SymmetryParamsDto.MirrorRadial -> MirrorRadialSymmetryStrategy(
        order = params.order,
        alternate = params.mirrorMode == "alternate"
    )
    is SymmetryParamsDto.Fractal -> RadialSymmetryStrategy(params.order)
}
