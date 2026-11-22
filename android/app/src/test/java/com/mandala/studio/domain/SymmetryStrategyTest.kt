package com.mandala.studio.domain

import com.mandala.studio.bridge.MandalaJsBridge
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import kotlin.math.abs

class SymmetryStrategyTest {

    @Test
    fun `radial symmetry order 4 rotates points within 1e-12`() {
        val strategy = RadialSymmetryStrategy(order = 4)
        val input = doubleArrayOf(410.0, 400.0)
        val result = strategy.expandFlat(input, cx = 400.0, cy = 400.0)

        assertEquals(4, result.size)
        assertTrue(abs(result[1][0] - 400.0) < 1e-12)
        assertTrue(abs(result[1][1] - 410.0) < 1e-12)
        assertTrue(abs(result[2][0] - 390.0) < 1e-12)
        assertTrue(abs(result[2][1] - 400.0) < 1e-12)
    }

    @Test
    fun `mirror radial symmetry produces double folds`() {
        val strategy = MirrorRadialSymmetryStrategy(order = 6, alternate = true)
        val result = strategy.expandFlat(doubleArrayOf(425.0, 385.0), cx = 400.0, cy = 400.0)
        assertEquals(12, result.size)
    }

    @Test
    fun `v2 centered-zero document converts losslessly to logical 800 and back`() {
        val doc = MandalaDocumentPayload.defaultBlank("2026-11-22T00:00:00Z").copy(
            wedges = listOf(
                WedgeStrokeDto(
                    id = "s1",
                    points = listOf(
                        MandalaPointDto(x = 15.0, y = -20.0, pressure = 0.8),
                        MandalaPointDto(x = 30.0, y = 10.0, pressure = 0.9)
                    ),
                    stroke = "#38BDF8",
                    strokeWidth = 2.0
                )
            )
        )

        val logical = doc.toLogical800Wedges()
        assertEquals(415.0, logical[0].points[0].x, 1e-12)
        assertEquals(380.0, logical[0].points[0].y, 1e-12)

        val roundTripped = doc.withUpdatedLogicalWedges(logical)
        assertEquals(15.0, roundTripped.wedges[0].points[0].x, 1e-12)
        assertEquals(-20.0, roundTripped.wedges[0].points[0].y, 1e-12)
    }

    @Test
    fun `bridge filename sanitizer blocks path traversal characters`() {
        val safe = MandalaJsBridge.sanitizeFilename("../../secret/evil:file?.svg")
        assertEquals("evil_file_.svg", safe)
    }
}
