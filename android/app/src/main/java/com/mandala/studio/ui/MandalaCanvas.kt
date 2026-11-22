package com.mandala.studio.ui

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.view.MotionEvent
import android.view.View
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color as ComposeColor
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.input.motionprediction.MotionEventPredictor
import com.mandala.studio.R
import com.mandala.studio.domain.LogicalCanvasSpec
import com.mandala.studio.domain.MandalaPointDto
import com.mandala.studio.domain.SymmetryParamsDto
import com.mandala.studio.domain.WedgeStrokeDto
import com.mandala.studio.domain.buildSymmetryStrategy
import kotlin.math.min

/**
 * Low-latency 120Hz Native Stylus View backed by Jetpack `MotionEventPredictor`,
 * historical touch-batch coalescing recovery, and symmetric Rust/Kotlin expansion.
 */
private class StylusMandalaSurfaceView(
    context: Context,
    private val onCommitStroke: (List<MandalaPointDto>) -> Unit
) : View(context) {

    private val predictor: MotionEventPredictor = MotionEventPredictor.newInstance(this)
    private var committedWedges: List<WedgeStrokeDto> = emptyList()
    private var symmetryParams: SymmetryParamsDto = SymmetryParamsDto.Radial(order = 12)
    private var activeStrokeColorHex: String = "#38BDF8"
    private var activeStrokeWidth: Double = 2.5

    private val activePoints = ArrayList<MandalaPointDto>(128)
    private var predictedTail: List<MandalaPointDto> = emptyList()

    private val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }

    private val predictedPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        alpha = 115
    }

    private val guidePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(46, 56, 189, 248)
        style = Paint.Style.STROKE
        strokeWidth = 1.5f
    }

    private val centerDotPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(180, 245, 158, 11)
        style = Paint.Style.FILL
    }

    private val reusablePath = Path()

    fun updateScene(
        wedges: List<WedgeStrokeDto>,
        symmetry: SymmetryParamsDto,
        strokeColorHex: String,
        strokeWidth: Double
    ) {
        committedWedges = wedges
        symmetryParams = symmetry
        activeStrokeColorHex = strokeColorHex
        activeStrokeWidth = strokeWidth
        invalidate()
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        predictor.record(event)
        val viewport = computeSquareViewport()
        if (viewport.scale <= 0f) return false

        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                parent?.requestDisallowInterceptTouchEvent(true)
                activePoints.clear()
                predictedTail = emptyList()
                appendEventPoint(event.x, event.y, event.pressure, viewport)
                invalidate()
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                for (h in 0 until event.historySize) {
                    appendEventPoint(
                        event.getHistoricalX(h),
                        event.getHistoricalY(h),
                        event.getHistoricalPressure(h),
                        viewport
                    )
                }
                appendEventPoint(event.x, event.y, event.pressure, viewport)

                val predictedEvent = predictor.predict()
                if (predictedEvent != null) {
                    val predPoints = ArrayList<MandalaPointDto>(predictedEvent.pointerCount + 1)
                    predPoints.add(screenToLogicalPoint(predictedEvent.x, predictedEvent.y, predictedEvent.pressure, viewport))
                    predictedTail = predPoints
                    predictedEvent.recycle()
                } else {
                    predictedTail = emptyList()
                }
                invalidate()
                return true
            }
            MotionEvent.ACTION_UP -> {
                appendEventPoint(event.x, event.y, event.pressure, viewport)
                predictedTail = emptyList()
                if (activePoints.size >= 2) {
                    onCommitStroke(activePoints.toList())
                }
                activePoints.clear()
                invalidate()
                return true
            }
            MotionEvent.ACTION_CANCEL -> {
                activePoints.clear()
                predictedTail = emptyList()
                invalidate()
                return true
            }
        }
        return super.onTouchEvent(event)
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        canvas.drawColor(Color.rgb(8, 10, 15))

        val viewport = computeSquareViewport()
        val strategy = buildSymmetryStrategy(symmetryParams)

        // Subtle boundary circle and symmetry sector guides
        val radiusPx = (LogicalCanvasSpec.SIZE.toFloat() / 2f) * viewport.scale
        val centerX = viewport.offsetX + LogicalCanvasSpec.CENTER_X.toFloat() * viewport.scale
        val centerY = viewport.offsetY + LogicalCanvasSpec.CENTER_Y.toFloat() * viewport.scale
        canvas.drawCircle(centerX, centerY, radiusPx, guidePaint)
        canvas.drawCircle(centerX, centerY, 4.5f, centerDotPaint)

        for (wedge in committedWedges) {
            drawSymmetricStroke(
                canvas = canvas,
                points = wedge.points,
                colorHex = wedge.stroke,
                widthLogical = wedge.strokeWidth.toFloat(),
                paint = strokePaint,
                strategy = strategy,
                viewport = viewport
            )
        }

        if (activePoints.size >= 2) {
            drawSymmetricStroke(
                canvas = canvas,
                points = activePoints,
                colorHex = activeStrokeColorHex,
                widthLogical = activeStrokeWidth.toFloat(),
                paint = strokePaint,
                strategy = strategy,
                viewport = viewport
            )
        }

        if (activePoints.isNotEmpty() && predictedTail.isNotEmpty()) {
            val previewSegment = listOf(activePoints.last()) + predictedTail
            drawSymmetricStroke(
                canvas = canvas,
                points = previewSegment,
                colorHex = activeStrokeColorHex,
                widthLogical = activeStrokeWidth.toFloat(),
                paint = predictedPaint,
                strategy = strategy,
                viewport = viewport
            )
        }
    }

    private fun drawSymmetricStroke(
        canvas: Canvas,
        points: List<MandalaPointDto>,
        colorHex: String,
        widthLogical: Float,
        paint: Paint,
        strategy: com.mandala.studio.domain.SymmetryStrategy,
        viewport: SquareViewport
    ) {
        if (points.size < 2) return
        val flat = DoubleArray(points.size * 2)
        for (i in points.indices) {
            flat[i * 2] = points[i].x
            flat[i * 2 + 1] = points[i].y
        }
        val expanded = strategy.expandFlat(
            pointsXy = flat,
            cx = LogicalCanvasSpec.CENTER_X,
            cy = LogicalCanvasSpec.CENTER_Y
        )

        paint.color = parseSafeColor(colorHex)
        paint.strokeWidth = (widthLogical * viewport.scale).coerceAtLeast(1.2f)

        for (poly in expanded) {
            if (poly.size < 4) continue
            reusablePath.rewind()
            reusablePath.moveTo(
                viewport.offsetX + poly[0].toFloat() * viewport.scale,
                viewport.offsetY + poly[1].toFloat() * viewport.scale
            )
            var idx = 2
            while (idx + 1 < poly.size) {
                reusablePath.lineTo(
                    viewport.offsetX + poly[idx].toFloat() * viewport.scale,
                    viewport.offsetY + poly[idx + 1].toFloat() * viewport.scale
                )
                idx += 2
            }
            canvas.drawPath(reusablePath, paint)
        }
    }

    private fun appendEventPoint(
        rawX: Float,
        rawY: Float,
        pressure: Float,
        viewport: SquareViewport
    ) {
        val next = screenToLogicalPoint(rawX, rawY, pressure, viewport)
        val prev = activePoints.lastOrNull()
        if (prev != null) {
            val dx = next.x - prev.x
            val dy = next.y - prev.y
            if ((dx * dx + dy * dy) < 0.75) return
        }
        activePoints.add(next)
    }

    private fun screenToLogicalPoint(
        rawX: Float,
        rawY: Float,
        pressure: Float,
        viewport: SquareViewport
    ): MandalaPointDto {
        val lx = ((rawX - viewport.offsetX) / viewport.scale).toDouble()
            .coerceIn(0.0, LogicalCanvasSpec.SIZE)
        val ly = ((rawY - viewport.offsetY) / viewport.scale).toDouble()
            .coerceIn(0.0, LogicalCanvasSpec.SIZE)
        val normPressure = pressure.toDouble().coerceIn(0.1, 1.0)
        return MandalaPointDto(x = lx, y = ly, pressure = normPressure)
    }

    private fun computeSquareViewport(): SquareViewport {
        val side = min(width, height).toFloat().coerceAtLeast(1f)
        val scale = side / LogicalCanvasSpec.SIZE.toFloat()
        val offsetX = (width - side) / 2f
        val offsetY = (height - side) / 2f
        return SquareViewport(scale = scale, offsetX = offsetX, offsetY = offsetY)
    }

    private fun parseSafeColor(hex: String): Int =
        runCatching { Color.parseColor(hex) }.getOrDefault(Color.rgb(56, 189, 248))

    private data class SquareViewport(
        val scale: Float,
        val offsetX: Float,
        val offsetY: Float
    )
}

@Composable
fun NativeStylusScreen(
    uiState: NativeStylusUiState,
    onCommitStroke: (List<MandalaPointDto>) -> Unit,
    onUndo: () -> Unit,
    onCycleOrder: () -> Unit,
    onSaveAndReturn: () -> Unit,
    onCancel: () -> Unit
) {
    var activeFoldLabel by remember(uiState.document.symmetryParams.order) {
        mutableStateOf("${uiState.document.symmetryParams.order}x")
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(ComposeColor(0xFF080A0F))
            .statusBarsPadding()
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(ComposeColor(0xFF0F172A))
                .padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                OutlinedButton(
                    onClick = onCancel,
                    modifier = Modifier.heightIn(min = 44.dp),
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Icon(
                        imageVector = Icons.Filled.Close,
                        contentDescription = stringResource(R.string.native_stylus_cancel),
                        tint = ComposeColor(0xFFCBD5E1)
                    )
                }

                Column {
                    Text(
                        text = stringResource(R.string.native_stylus_title),
                        color = ComposeColor(0xFFF8FAFC),
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                    Text(
                        text = "${uiState.logicalWedges.size} tratti · Ordine $activeFoldLabel",
                        color = ComposeColor(0xFF94A3B8),
                        fontSize = 12.sp
                    )
                }
            }

            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                OutlinedButton(
                    onClick = onCycleOrder,
                    modifier = Modifier.heightIn(min = 44.dp),
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Text(text = activeFoldLabel, color = ComposeColor(0xFF38BDF8))
                }

                OutlinedButton(
                    onClick = onUndo,
                    enabled = uiState.logicalWedges.isNotEmpty(),
                    modifier = Modifier.heightIn(min = 44.dp),
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.Undo,
                        contentDescription = "Annulla",
                        tint = ComposeColor(0xFFF8FAFC)
                    )
                }

                Button(
                    onClick = onSaveAndReturn,
                    modifier = Modifier.heightIn(min = 44.dp),
                    shape = RoundedCornerShape(8.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = ComposeColor(0xFF0EA5E9),
                        contentColor = ComposeColor(0xFF080A0F)
                    )
                ) {
                    Icon(
                        imageVector = Icons.Filled.Check,
                        contentDescription = null,
                        modifier = Modifier.padding(end = 6.dp)
                    )
                    Text(
                        text = stringResource(R.string.native_stylus_save),
                        fontWeight = FontWeight.SemiBold
                    )
                }
            }
        }

        Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { ctx ->
                    StylusMandalaSurfaceView(
                        context = ctx,
                        onCommitStroke = onCommitStroke
                    )
                },
                update = { surface ->
                    surface.updateScene(
                        wedges = uiState.logicalWedges,
                        symmetry = uiState.document.symmetryParams,
                        strokeColorHex = uiState.activeStrokeColor,
                        strokeWidth = uiState.activeStrokeWidth
                    )
                }
            )
        }
    }
}
