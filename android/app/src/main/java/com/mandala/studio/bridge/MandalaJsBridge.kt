package com.mandala.studio.bridge

import android.content.Context
import android.content.Intent
import android.util.Base64
import android.webkit.JavascriptInterface
import androidx.core.content.FileProvider
import com.mandala.studio.R
import com.mandala.studio.domain.ReleaseContractEvaluator
import com.mandala.studio.ui.MandalaViewModel
import java.io.File

/**
 * Typed JavaScript Interface exposed exclusively to the trusted local origin
 * (`https://appassets.androidplatform.net/`).
 * Method names and signatures mirror `AndroidRawBridgeContract` in `src/shared/lib/androidBridge.ts`.
 */
class MandalaJsBridge(
    private val context: Context,
    private val viewModel: MandalaViewModel
) {
    @JavascriptInterface
    fun getStatusJson(): String {
        val snapshot = viewModel.updater.status.value
        return ReleaseContractEvaluator.jsonCodec.encodeToString(
            com.mandala.studio.domain.AndroidBridgeStatusSnapshot.serializer(),
            snapshot
        )
    }

    @JavascriptInterface
    fun exportBase64File(filename: String, mimeType: String, base64Data: String): Boolean {
        val bytes = runCatching {
            val clean = base64Data.substringAfter("base64,", base64Data)
            Base64.decode(clean, Base64.DEFAULT)
        }.getOrNull() ?: return false
        return shareBytesViaFileProvider(filename, mimeType, bytes)
    }

    @JavascriptInterface
    fun exportTextFile(filename: String, mimeType: String, content: String): Boolean {
        return shareBytesViaFileProvider(
            filename = filename,
            mimeType = mimeType,
            bytes = content.toByteArray(Charsets.UTF_8)
        )
    }

    @JavascriptInterface
    fun openNativeStylusCanvas(documentJson: String): Boolean {
        viewModel.openNativeStylusSession(documentJson)
        return true
    }

    @JavascriptInterface
    fun checkForUpdates(): String {
        val snapshot = viewModel.updater.checkForUpdatesAsync()
        return ReleaseContractEvaluator.jsonCodec.encodeToString(
            com.mandala.studio.domain.AndroidBridgeStatusSnapshot.serializer(),
            snapshot
        )
    }

    @JavascriptInterface
    fun installDownloadedUpdate(): Boolean {
        return viewModel.updater.triggerInstallOrDownload()
    }

    private fun shareBytesViaFileProvider(
        filename: String,
        mimeType: String,
        bytes: ByteArray
    ): Boolean {
        val safeName = sanitizeFilename(filename)
        return runCatching {
            val exportsDir = File(context.cacheDir, "exports").apply { mkdirs() }
            val outFile = File(exportsDir, safeName)
            outFile.writeBytes(bytes)

            val uri = FileProvider.getUriForFile(
                context,
                "${context.packageName}.fileprovider",
                outFile
            )
            val sendIntent = Intent(Intent.ACTION_SEND).apply {
                type = mimeType.ifBlank { "*/*" }
                putExtra(Intent.EXTRA_STREAM, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            val chooser = Intent.createChooser(
                sendIntent,
                context.getString(R.string.share_export_chooser)
            ).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(chooser)
            true
        }.getOrDefault(false)
    }

    companion object {
        const val BRIDGE_NAME: String = "__MANDALA_ANDROID_BRIDGE__"

        fun sanitizeFilename(raw: String): String {
            val leaf = raw.substringAfterLast('/').substringAfterLast('\\')
            val cleaned = leaf.replace(Regex("[^a-zA-Z0-9._-]"), "_")
            return cleaned.take(96).ifBlank { "mandala_export.bin" }
        }
    }
}
