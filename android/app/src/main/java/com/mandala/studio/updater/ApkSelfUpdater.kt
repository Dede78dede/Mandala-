package com.mandala.studio.updater

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.mandala.studio.BuildConfig
import com.mandala.studio.R
import com.mandala.studio.domain.AndroidBridgeStatusSnapshot
import com.mandala.studio.domain.AndroidUpdateState
import com.mandala.studio.domain.DistributionFlavor
import com.mandala.studio.domain.ReleaseContractEvaluator
import com.mandala.studio.domain.ReleaseManifest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.io.File
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

object ApkChecksumVerifier {
    private const val BUFFER_BYTES = 65_536

    fun sha256HexOfStream(input: InputStream): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(BUFFER_BYTES)
        while (true) {
            val read = input.read(buffer)
            if (read <= 0) break
            digest.update(buffer, 0, read)
        }
        return digest.digest().joinToString(separator = "") { byte ->
            "%02x".format(byte)
        }
    }

    fun verifyFileSha256(file: File, expectedHex: String): Boolean {
        if (!file.isFile) return false
        val actual = file.inputStream().use { stream -> sha256HexOfStream(stream) }
        return actual.equals(expectedHex.trim(), ignoreCase = true)
    }
}

class ApkDownloadWorker(
    appContext: Context,
    params: WorkerParameters
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        val downloadUrl = inputData.getString(KEY_DOWNLOAD_URL)
            ?.takeIf { it.startsWith("https://") }
            ?: return Result.failure(workDataError("URL download HTTPS mancante o non valido."))
        val expectedSha256 = inputData.getString(KEY_EXPECTED_SHA256)
            ?.takeIf { ReleaseContractEvaluator.isValidSha256Hex(it) }
            ?: return Result.failure(workDataError("Checksum SHA-256 atteso assente nel manifest."))

        val updatesDir = File(applicationContext.filesDir, "updates").apply { mkdirs() }
        val tempFile = File(updatesDir, "mandala-update.apk.part")
        val targetFile = File(updatesDir, APK_FILENAME)

        return runCatching {
            val connection = (URL(downloadUrl).openConnection() as HttpURLConnection).apply {
                connectTimeout = 15_000
                readTimeout = 30_000
                instanceFollowRedirects = true
            }
            connection.inputStream.use { input ->
                tempFile.outputStream().use { output ->
                    input.copyTo(output, bufferSize = 65_536)
                }
            }
            connection.disconnect()

            if (!ApkChecksumVerifier.verifyFileSha256(tempFile, expectedSha256)) {
                tempFile.delete()
                targetFile.delete()
                return Result.failure(workDataError("Verifica SHA-256 fallita: pacchetto scartato."))
            }

            if (targetFile.exists()) {
                targetFile.delete()
            }
            if (!tempFile.renameTo(targetFile)) {
                tempFile.copyTo(targetFile, overwrite = true)
                tempFile.delete()
            }

            Result.success(
                Data.Builder()
                    .putString(KEY_OUTPUT_PATH, targetFile.absolutePath)
                    .build()
            )
        }.getOrElse { err ->
            tempFile.delete()
            Result.failure(workDataError(err.message ?: "Errore download APK."))
        }
    }

    private fun workDataError(message: String): Data =
        Data.Builder().putString(KEY_ERROR_MESSAGE, message).build()

    companion object {
        const val WORK_NAME: String = "mandala_apk_self_update"
        const val APK_FILENAME: String = "mandala-update.apk"
        const val KEY_DOWNLOAD_URL: String = "download_url"
        const val KEY_EXPECTED_SHA256: String = "expected_sha256"
        const val KEY_OUTPUT_PATH: String = "output_path"
        const val KEY_ERROR_MESSAGE: String = "error_message"
    }
}

class ApkSelfUpdater(
    private val appContext: Context,
    private val scope: CoroutineScope
) {
    private val currentFlavor: DistributionFlavor =
        if (BuildConfig.DISTRIBUTION_FLAVOR == "playstore") {
            DistributionFlavor.PLAYSTORE
        } else {
            DistributionFlavor.SIDELOAD
        }

    private val _status = MutableStateFlow(initialSnapshot())
    val status: StateFlow<AndroidBridgeStatusSnapshot> = _status.asStateFlow()

    private var latestManifest: ReleaseManifest? = null

    private fun initialSnapshot(): AndroidBridgeStatusSnapshot = AndroidBridgeStatusSnapshot(
        hostVersionName = BuildConfig.VERSION_NAME,
        hostVersionCode = BuildConfig.VERSION_CODE,
        flavor = currentFlavor,
        supportsNativeStylus = true,
        supportsSelfUpdate = BuildConfig.SELF_UPDATE_ENABLED,
        supportsNativeExport = true,
        updateState = AndroidUpdateState.IDLE,
        availableVersionName = null,
        availableVersionCode = null,
        errorMessage = null
    )

    fun checkForUpdatesAsync(): AndroidBridgeStatusSnapshot {
        if (!BuildConfig.SELF_UPDATE_ENABLED) {
            val next = _status.value.copy(
                updateState = AndroidUpdateState.UP_TO_DATE,
                errorMessage = null
            )
            _status.value = next
            return next
        }

        val checkingState = _status.value.copy(
            updateState = AndroidUpdateState.CHECKING,
            errorMessage = null
        )
        _status.value = checkingState

        scope.launch(Dispatchers.IO) {
            val manifestResult = runCatching { fetchManifestBlocking() }
            val manifest = manifestResult.getOrNull()
            if (manifest == null) {
                _status.value = _status.value.copy(
                    updateState = AndroidUpdateState.OFFLINE_OR_UNAVAILABLE,
                    errorMessage = manifestResult.exceptionOrNull()?.message
                        ?: "Manifest rilasci non raggiungibile."
                )
                return@launch
            }

            latestManifest = manifest
            val installedBasePackage = BuildConfig.APPLICATION_ID.removeSuffix(".debug")
            val newer = ReleaseContractEvaluator.isRemoteNewer(
                manifest = manifest,
                installedVersionCode = BuildConfig.VERSION_CODE,
                expectedPackageId = installedBasePackage
            )

            if (!newer) {
                _status.value = _status.value.copy(
                    updateState = AndroidUpdateState.UP_TO_DATE,
                    availableVersionName = manifest.versionName,
                    availableVersionCode = manifest.versionCode,
                    errorMessage = null
                )
                return@launch
            }

            val cachedApk = File(File(appContext.filesDir, "updates"), ApkDownloadWorker.APK_FILENAME)
            val expectedHash = manifest.sha256
            if (expectedHash != null && ApkChecksumVerifier.verifyFileSha256(cachedApk, expectedHash)) {
                _status.value = _status.value.copy(
                    updateState = AndroidUpdateState.READY_TO_INSTALL,
                    availableVersionName = manifest.versionName,
                    availableVersionCode = manifest.versionCode,
                    errorMessage = null
                )
            } else {
                _status.value = _status.value.copy(
                    updateState = AndroidUpdateState.UPDATE_AVAILABLE,
                    availableVersionName = manifest.versionName,
                    availableVersionCode = manifest.versionCode,
                    errorMessage = null
                )
                enqueueVerifiedDownload(manifest)
            }
        }

        return checkingState
    }

    private fun enqueueVerifiedDownload(manifest: ReleaseManifest) {
        val sha256 = manifest.sha256 ?: return
        _status.value = _status.value.copy(updateState = AndroidUpdateState.DOWNLOADING)

        val request = OneTimeWorkRequestBuilder<ApkDownloadWorker>()
            .setInputData(
                Data.Builder()
                    .putString(ApkDownloadWorker.KEY_DOWNLOAD_URL, manifest.apkDownloadUrl)
                    .putString(ApkDownloadWorker.KEY_EXPECTED_SHA256, sha256)
                    .build()
            )
            .build()

        val workManager = WorkManager.getInstance(appContext)
        workManager.enqueueUniqueWork(
            ApkDownloadWorker.WORK_NAME,
            ExistingWorkPolicy.REPLACE,
            request
        )

        scope.launch {
            workManager.getWorkInfoByIdFlow(request.id).collect { info ->
                if (info == null) return@collect
                when (info.state) {
                    WorkInfo.State.RUNNING, WorkInfo.State.ENQUEUED -> {
                        _status.value = _status.value.copy(
                            updateState = AndroidUpdateState.DOWNLOADING
                        )
                    }
                    WorkInfo.State.SUCCEEDED -> {
                        _status.value = _status.value.copy(
                            updateState = AndroidUpdateState.READY_TO_INSTALL,
                            errorMessage = null
                        )
                    }
                    WorkInfo.State.FAILED, WorkInfo.State.CANCELLED -> {
                        val err = info.outputData.getString(ApkDownloadWorker.KEY_ERROR_MESSAGE)
                            ?: "Download o verifica SHA-256 fallita."
                        _status.value = _status.value.copy(
                            updateState = AndroidUpdateState.ERROR,
                            errorMessage = err
                        )
                    }
                    else -> Unit
                }
            }
        }
    }

    fun triggerInstallOrDownload(): Boolean {
        if (!BuildConfig.SELF_UPDATE_ENABLED) return false
        val manifest = latestManifest
        val apkFile = File(File(appContext.filesDir, "updates"), ApkDownloadWorker.APK_FILENAME)
        val expectedSha = manifest?.sha256

        if (expectedSha == null || !ApkChecksumVerifier.verifyFileSha256(apkFile, expectedSha)) {
            if (manifest != null && ReleaseContractEvaluator.isRemoteNewer(
                    manifest,
                    BuildConfig.VERSION_CODE,
                    BuildConfig.APPLICATION_ID.removeSuffix(".debug")
                )
            ) {
                enqueueVerifiedDownload(manifest)
                return true
            }
            checkForUpdatesAsync()
            return false
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            !appContext.packageManager.canRequestPackageInstalls()
        ) {
            val permissionIntent = Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:${appContext.packageName}")
            ).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            appContext.startActivity(permissionIntent)
            return true
        }

        val contentUri = FileProvider.getUriForFile(
            appContext,
            "${appContext.packageName}.fileprovider",
            apkFile
        )
        val installIntent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(contentUri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        val chooser = Intent.createChooser(
            installIntent,
            appContext.getString(R.string.install_update_chooser)
        ).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        appContext.startActivity(chooser)
        return true
    }

    private fun fetchManifestBlocking(): ReleaseManifest {
        val manifestUrl = BuildConfig.RELEASE_MANIFEST_URL
        require(manifestUrl.startsWith("https://")) { "Manifest URL must use HTTPS" }
        val connection = (URL(manifestUrl).openConnection() as HttpURLConnection).apply {
            connectTimeout = 10_000
            readTimeout = 10_000
            setRequestProperty("Cache-Control", "no-cache")
        }
        return try {
            val code = connection.responseCode
            check(code in 200..299) { "HTTP $code dal manifest rilasci" }
            val jsonText = connection.inputStream.bufferedReader().use { it.readText() }
            ReleaseContractEvaluator.jsonCodec.decodeFromString(ReleaseManifest.serializer(), jsonText)
        } finally {
            connection.disconnect()
        }
    }
}
