package com.mandala.studio.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.mandala.studio.domain.MandalaDocumentPayload
import com.mandala.studio.domain.MandalaPointDto
import com.mandala.studio.domain.SymmetryParamsDto
import com.mandala.studio.domain.WedgeStrokeDto
import com.mandala.studio.updater.ApkSelfUpdater
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.time.Instant
import java.util.UUID

sealed interface StudioRoute {
    data object HybridWebStudio : StudioRoute
    data object NativeStylusCanvas : StudioRoute
}

data class NativeStylusUiState(
    val document: MandalaDocumentPayload,
    val logicalWedges: List<WedgeStrokeDto>,
    val activeStrokeColor: String,
    val activeStrokeWidth: Double
)

class MandalaViewModel(application: Application) : AndroidViewModel(application) {
    val updater: ApkSelfUpdater = ApkSelfUpdater(application, viewModelScope)

    private val _route = MutableStateFlow<StudioRoute>(StudioRoute.HybridWebStudio)
    val route: StateFlow<StudioRoute> = _route.asStateFlow()

    private val _stylusState = MutableStateFlow(
        NativeStylusUiState(
            document = MandalaDocumentPayload.defaultBlank(Instant.now().toString()),
            logicalWedges = emptyList(),
            activeStrokeColor = "#38BDF8",
            activeStrokeWidth = 2.5
        )
    )
    val stylusState: StateFlow<NativeStylusUiState> = _stylusState.asStateFlow()

    private val _pendingReturnDocumentJson = MutableStateFlow<String?>(null)
    val pendingReturnDocumentJson: StateFlow<String?> = _pendingReturnDocumentJson.asStateFlow()

    private val _renderProcessCrashed = MutableStateFlow(false)
    val renderProcessCrashed: StateFlow<Boolean> = _renderProcessCrashed.asStateFlow()

    fun openNativeStylusSession(documentJson: String) {
        val doc = MandalaDocumentPayload.decodeOrDefault(
            rawJson = documentJson,
            fallbackIso = Instant.now().toString()
        )
        _stylusState.value = NativeStylusUiState(
            document = doc,
            logicalWedges = doc.toLogical800Wedges(),
            activeStrokeColor = doc.activeColour.ifBlank { "#38BDF8" },
            activeStrokeWidth = doc.activeStrokeWidth.coerceIn(0.8, 24.0)
        )
        _route.value = StudioRoute.NativeStylusCanvas
    }

    fun appendStylusStroke(points: List<MandalaPointDto>) {
        if (points.size < 2) return
        val current = _stylusState.value
        val newStroke = WedgeStrokeDto(
            id = "stylus_${UUID.randomUUID().toString().take(8)}",
            points = points,
            stroke = current.activeStrokeColor,
            strokeWidth = current.activeStrokeWidth,
            dash = current.document.activeDash,
            opacity = 1.0
        )
        _stylusState.value = current.copy(
            logicalWedges = current.logicalWedges + newStroke
        )
    }

    fun undoLastStylusStroke() {
        val current = _stylusState.value
        if (current.logicalWedges.isEmpty()) return
        _stylusState.value = current.copy(
            logicalWedges = current.logicalWedges.dropLast(1)
        )
    }

    fun cycleSymmetryOrder() {
        val current = _stylusState.value
        val doc = current.document
        val orders = listOf(6, 8, 12, 16, 24)
        val curOrder = doc.symmetryParams.order
        val nextOrder = orders[(orders.indexOf(curOrder) + 1) % orders.size]
        val nextSymmetry = when (val sym = doc.symmetryParams) {
            is SymmetryParamsDto.Radial -> sym.copy(order = nextOrder)
            is SymmetryParamsDto.MirrorRadial -> sym.copy(order = nextOrder)
            is SymmetryParamsDto.Fractal -> sym.copy(order = nextOrder)
        }
        _stylusState.value = current.copy(
            document = doc.copy(symmetryParams = nextSymmetry)
        )
    }

    fun commitStylusSessionAndReturn() {
        val current = _stylusState.value
        val updatedDoc = current.document.withUpdatedLogicalWedges(current.logicalWedges)
        val jsonOut = MandalaDocumentPayload.jsonCodec.encodeToString(
            MandalaDocumentPayload.serializer(),
            updatedDoc
        )
        _pendingReturnDocumentJson.value = jsonOut
        _route.value = StudioRoute.HybridWebStudio
    }

    fun cancelStylusSession() {
        _route.value = StudioRoute.HybridWebStudio
    }

    fun consumePendingReturnDocumentJson() {
        _pendingReturnDocumentJson.value = null
    }

    fun onWebRenderProcessGone() {
        _renderProcessCrashed.value = true
    }

    fun onWebRenderProcessRecovered() {
        _renderProcessCrashed.value = false
    }
}
