package com.mandala.studio.domain

import com.mandala.studio.updater.ApkChecksumVerifier
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.ByteArrayInputStream

class ReleaseContractTest {

    @Test
    fun `manifest update evaluator accepts strictly newer signed https release`() {
        val validHash = "a".repeat(64)
        val manifest = ReleaseManifest(
            schemaVersion = 1,
            versionName = "1.1.0",
            versionCode = 10100,
            channel = ReleaseChannel.GITHUB_RELEASES,
            flavor = DistributionFlavor.SIDELOAD,
            androidPackageId = "com.mandala.studio",
            twaPackageId = "com.mandala.studio.twa",
            minSdk = 28,
            targetSdk = 35,
            apkAvailable = true,
            apkDownloadUrl = "https://github.com/mandala-studio/mandala-studio/releases/download/v1.1.0/mandala.apk",
            releasePageUrl = "https://github.com/mandala-studio/mandala-studio/releases/tag/v1.1.0",
            sha256 = validHash,
            apkSizeBytes = 10_485_760L,
            generatedAt = "2026-11-22T00:00:00Z"
        )

        assertTrue(ReleaseContractEvaluator.isRemoteNewer(manifest, 10000, "com.mandala.studio"))
        assertFalse(ReleaseContractEvaluator.isRemoteNewer(manifest, 10100, "com.mandala.studio"))
        assertFalse(ReleaseContractEvaluator.isRemoteNewer(manifest, 10000, "com.other.app"))
        assertFalse(
            ReleaseContractEvaluator.isRemoteNewer(
                manifest.copy(apkDownloadUrl = "http://insecure.example.com/a.apk"),
                10000,
                "com.mandala.studio"
            )
        )
    }

    @Test
    fun `checksum verifier computes deterministic lowercase sha256 digest`() {
        val payload = "mandala-apk-payload".toByteArray(Charsets.UTF_8)
        val digest = ApkChecksumVerifier.sha256HexOfStream(ByteArrayInputStream(payload))
        assertEquals(64, digest.length)
        assertTrue(ReleaseContractEvaluator.isValidSha256Hex(digest))
    }

    @Test
    fun `bridge status snapshot serializes exact typed fields expected by typescript schema`() {
        val status = AndroidBridgeStatusSnapshot(
            hostVersionName = "1.0.0",
            hostVersionCode = 10000,
            flavor = DistributionFlavor.SIDELOAD,
            supportsNativeStylus = true,
            supportsSelfUpdate = true,
            supportsNativeExport = true,
            updateState = AndroidUpdateState.UP_TO_DATE,
            availableVersionName = null,
            availableVersionCode = null,
            errorMessage = null
        )

        val encoded = ReleaseContractEvaluator.jsonCodec.encodeToString(
            AndroidBridgeStatusSnapshot.serializer(),
            status
        )
        assertTrue(encoded.contains("\"flavor\":\"sideload\""))
        assertTrue(encoded.contains("\"updateState\":\"up-to-date\""))
        val decoded = ReleaseContractEvaluator.jsonCodec.decodeFromString(
            AndroidBridgeStatusSnapshot.serializer(),
            encoded
        )
        assertEquals(status, decoded)
    }
}
