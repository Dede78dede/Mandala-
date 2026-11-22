package com.mandala.studio

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.mandala.studio.ui.HybridStudioScreen
import com.mandala.studio.ui.MandalaViewModel
import com.mandala.studio.ui.NativeStylusScreen
import com.mandala.studio.ui.StudioRoute
import com.mandala.studio.ui.encodeUpdateStatusJson

class MainActivity : ComponentActivity() {
    private val viewModel: MandalaViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        setContent {
            val route by viewModel.route.collectAsStateWithLifecycle()
            val stylusState by viewModel.stylusState.collectAsStateWithLifecycle()
            val pendingDocJson by viewModel.pendingReturnDocumentJson.collectAsStateWithLifecycle()
            val renderCrashed by viewModel.renderProcessCrashed.collectAsStateWithLifecycle()
            val updateStatus by viewModel.updater.status.collectAsStateWithLifecycle()

            when (route) {
                StudioRoute.HybridWebStudio -> {
                    HybridStudioScreen(
                        viewModel = viewModel,
                        pendingReturnDocumentJson = pendingDocJson,
                        renderProcessCrashed = renderCrashed,
                        updateStatusJson = encodeUpdateStatusJson(updateStatus)
                    )
                }
                StudioRoute.NativeStylusCanvas -> {
                    BackHandler {
                        viewModel.cancelStylusSession()
                    }
                    NativeStylusScreen(
                        uiState = stylusState,
                        onCommitStroke = viewModel::appendStylusStroke,
                        onUndo = viewModel::undoLastStylusStroke,
                        onCycleOrder = viewModel::cycleSymmetryOrder,
                        onSaveAndReturn = viewModel::commitStylusSessionAndReturn,
                        onCancel = viewModel::cancelStylusSession
                    )
                }
            }
        }
    }
}
