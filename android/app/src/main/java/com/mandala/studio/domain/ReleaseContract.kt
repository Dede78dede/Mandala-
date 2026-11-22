package com.mandala.studio.domain

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
enum class ReleaseChannel {
    @SerialName("github-releases")
    GITHUB_RELEASES,

    @SerialName("github-pages")
    GITHUB_PAGES
}

@Serializable
enum class DistributionFlavor {
    @SerialName("sideload")
    SIDELOAD,

    @SerialName("playstore")
    PLAYSTORE
}

@Serializable
enum class AndroidUpdateState {
    @SerialName("idle")
    IDLE,

    @SerialName("checking")
    CHECKING,

    @SerialName("up-to-date")
    UP_TO_DATE,

    @SerialName("update-available")
    UPDATE_AVAILABLE,

    @SerialName("downloading")
    DOWNLOADING,

    @SerialName("ready-to-install")
    READY_TO_INSTALL,

    @SerialName("offline-or-unavailable")
    OFFLINE_OR_UNAVAILABLE,

    @SerialName("error")
    ERROR
}

@Serializable
data class ReleaseManifest(
    val schemaVersion: Int,
    val versionName: String,
    val versionCode: Int,
    val channel: ReleaseChannel,
    val flavor: DistributionFlavor,
    val androidPackageId: String,
    val twaPackageId: String,
    val minSdk: Int,
    val targetSdk: Int,
    val apkAvailable: Boolean,
    val apkDownloadUrl: String,
    val releasePageUrl: String,
    val sha256: String? = null,
    val apkSizeBytes: Long? = null,
    val generatedAt: String
)

@Serializable
data class AndroidBridgeStatusSnapshot(
    val hostVersionName: String,
    val hostVersionCode: Int,
    val flavor: DistributionFlavor,
    val supportsNativeStylus: Boolean,
    val supportsSelfUpdate: Boolean,
    val supportsNativeExport: Boolean,
    val updateState: AndroidUpdateState,
    val availableVersionName: String? = null,
    val availableVersionCode: Int? = null,
    val errorMessage: String? = null
)

object ReleaseContractEvaluator {
    private val sha256Regex = Regex("^[0-9a-fA-F]{64}$")

    val jsonCodec: Json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        explicitNulls = true
    }

    fun isValidSha256Hex(value: String?): Boolean =
        value != null && sha256Regex.matches(value.trim())

    fun isRemoteNewer(
        manifest: ReleaseManifest,
        installedVersionCode: Int,
        expectedPackageId: String
    ): Boolean {
        if (manifest.schemaVersion != 1) return false
        if (manifest.androidPackageId != expectedPackageId) return false
        if (!manifest.apkAvailable) return false
        if (!isValidSha256Hex(manifest.sha256)) return false
        if (!manifest.apkDownloadUrl.startsWith("https://")) return false
        return manifest.versionCode > installedVersionCode
    }
}
