package com.mandala.studio.ui

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.view.ViewGroup
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.webkit.WebViewAssetLoader
import com.mandala.studio.R
import com.mandala.studio.bridge.MandalaJsBridge
import com.mandala.studio.domain.ReleaseContractEvaluator
import org.json.JSONObject

private const val LOCAL_APP_ORIGIN_HOST = "appassets.androidplatform.net"
private const val LOCAL_APP_ENTRY_URL = "https://appassets.androidplatform.net/index.html"

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun HybridStudioScreen(
    viewModel: MandalaViewModel,
    pendingReturnDocumentJson: String?,
    renderProcessCrashed: Boolean,
    updateStatusJson: String
) {
    val context = LocalContext.current
    var webViewRef by remember { mutableStateOf<WebView?>(null) }
    var webViewGeneration by remember { mutableIntStateOf(0) }

    LaunchedEffect(pendingReturnDocumentJson, webViewRef) {
        val docJson = pendingReturnDocumentJson ?: return@LaunchedEffect
        val webView = webViewRef ?: return@LaunchedEffect
        val quotedPayload = JSONObject.quote(docJson)
        val js = "window.dispatchEvent(new CustomEvent('mandala:android-document-return', { detail: $quotedPayload }));"
        webView.evaluateJavascript(js) {
            viewModel.consumePendingReturnDocumentJson()
        }
    }

    LaunchedEffect(updateStatusJson, webViewRef) {
        val webView = webViewRef ?: return@LaunchedEffect
        val quoted = JSONObject.quote(updateStatusJson)
        val js = "window.dispatchEvent(new CustomEvent('mandala:android-update-status', { detail: JSON.parse($quoted) }));"
        webView.evaluateJavascript(js, null)
    }

    LaunchedEffect(renderProcessCrashed) {
        if (renderProcessCrashed) {
            webViewGeneration += 1
            viewModel.onWebRenderProcessRecovered()
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF080A0F))
    ) {
        key(webViewGeneration) {
            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { ctx ->
                    val assetLoader = WebViewAssetLoader.Builder()
                        .setDomain(LOCAL_APP_ORIGIN_HOST)
                        .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(ctx))
                        .build()

                    WebView(ctx).apply {
                        layoutParams = ViewGroup.LayoutParams(
                            ViewGroup.LayoutParams.MATCH_PARENT,
                            ViewGroup.LayoutParams.MATCH_PARENT
                        )
                        setBackgroundColor(android.graphics.Color.rgb(8, 10, 15))

                        settings.apply {
                            javaScriptEnabled = true
                            domStorageEnabled = true
                            databaseEnabled = true
                            allowFileAccess = false
                            allowContentAccess = false
                            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                            mediaPlaybackRequiresUserGesture = true
                            setSupportZoom(false)
                        }

                        val bridge = MandalaJsBridge(ctx, viewModel)
                        addJavascriptInterface(bridge, MandalaJsBridge.BRIDGE_NAME)

                        webViewClient = object : WebViewClient() {
                            override fun shouldInterceptRequest(
                                view: WebView?,
                                request: WebResourceRequest?
                            ): WebResourceResponse? {
                                val url = request?.url ?: return null
                                val response = assetLoader.shouldInterceptRequest(url) ?: return null
                                val path = url.path.orEmpty()
                                if (path.endsWith(".wasm")) {
                                    response.mimeType = "application/wasm"
                                } else if (path.endsWith(".mjs") || path.endsWith(".js")) {
                                    response.mimeType = "application/javascript"
                                }
                                return response
                            }

                            override fun shouldOverrideUrlLoading(
                                view: WebView?,
                                request: WebResourceRequest?
                            ): Boolean {
                                val target: Uri = request?.url ?: return false
                                if (target.host == LOCAL_APP_ORIGIN_HOST) {
                                    return false
                                }
                                if (target.scheme == "https") {
                                    runCatching {
                                        val externalIntent = Intent(Intent.ACTION_VIEW, target).apply {
                                            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                                        }
                                        ctx.startActivity(externalIntent)
                                    }
                                }
                                return true
                            }

                            override fun onRenderProcessGone(
                                view: WebView?,
                                detail: RenderProcessGoneDetail?
                            ): Boolean {
                                view?.destroy()
                                webViewRef = null
                                viewModel.onWebRenderProcessGone()
                                return true
                            }
                        }

                        loadUrl(LOCAL_APP_ENTRY_URL)
                        webViewRef = this
                    }
                }
            )
        }

        if (renderProcessCrashed) {
            Box(
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .padding(16.dp)
                    .background(Color(0xFF0F172A))
                    .padding(horizontal = 14.dp, vertical = 10.dp)
            ) {
                Text(
                    text = stringResource(R.string.webview_recovery_banner),
                    color = Color(0xFF38BDF8),
                    fontSize = 13.sp
                )
            }
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            webViewRef?.let { view ->
                view.removeJavascriptInterface(MandalaJsBridge.BRIDGE_NAME)
                view.destroy()
            }
            webViewRef = null
        }
    }
}

fun encodeUpdateStatusJson(snapshot: com.mandala.studio.domain.AndroidBridgeStatusSnapshot): String =
    ReleaseContractEvaluator.jsonCodec.encodeToString(
        com.mandala.studio.domain.AndroidBridgeStatusSnapshot.serializer(),
        snapshot
    )
