#!/usr/bin/env python3
"""Unit tests for ``scripts/setup_android_release.py``."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import setup_android_release as sar  # noqa: E402


class SetupAndroidReleaseTests(unittest.TestCase):
    """Covers slug validation, SSOT repo updates, keytool parsing, and help flags."""

    def test_compute_pages_url_project_and_org_sites(self) -> None:
        self.assertEqual(
            sar.compute_github_pages_url("AliceDev", "mandala-studio"),
            "https://alicedev.github.io/mandala-studio",
        )
        self.assertEqual(
            sar.compute_github_pages_url("AliceDev", "alicedev.github.io"),
            "https://alicedev.github.io",
        )

    def test_extract_cert_sha256_parses_keytool_output(self) -> None:
        sample = (
            "Certificate fingerprints:\n"
            "         SHA1: 11:22:33\n"
            "         SHA256: ab:cd:ef:01:23:45:67:89:ab:cd:ef:01:23:45:67:89:"
            "ab:cd:ef:01:23:45:67:89:ab:cd:ef:01:23:45:67:89\n"
        )
        parsed = sar.extract_cert_sha256_from_keytool_output(sample)
        self.assertTrue(parsed.startswith("AB:CD:EF:01"))
        self.assertEqual(len(parsed), 95)

    def test_apply_repository_slug_updates_version_constants_and_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "version.json").write_text(
                json.dumps(
                    {
                        "version": "1.0.0",
                        "versionCode": 10000,
                        "androidPackageId": "com.mandala.studio",
                        "twaPackageId": "com.mandala.studio.twa",
                        "repositoryOwner": "mandala-studio",
                        "repositoryName": "mandala-studio",
                        "githubPagesUrl": "https://mandala-studio.github.io/mandala-studio",
                        "apkAssetName": "mandala-studio-universal-release.apk",
                        "minSdk": 28,
                        "targetSdk": 35,
                        "compileSdk": 35,
                    }
                ),
                encoding="utf-8",
            )
            constants_dir = root / "src" / "features" / "mandala" / "model"
            constants_dir.mkdir(parents=True)
            (constants_dir / "constants.ts").write_text(
                "export const ANDROID_DISTRIBUTION_DEFAULTS = {\n"
                "  fallbackReleasePageUrl: 'https://github.com/mandala-studio/mandala-studio/releases/latest',\n"
                "  fallbackApkDownloadUrl:\n"
                "    'https://github.com/mandala-studio/mandala-studio/releases/latest/download/mandala-studio-universal-release.apk',\n"
                "} as const;\n",
                encoding="utf-8",
            )
            manifest_dir = root / "android" / "app" / "src" / "main"
            manifest_dir.mkdir(parents=True)
            (manifest_dir / "AndroidManifest.xml").write_text(
                '<data android:host="mandala-studio.github.io" android:pathPrefix="/mandala-studio" android:scheme="https" />\n',
                encoding="utf-8",
            )

            owner, repo, pages_url = sar.apply_repository_slug(root, "DedeLab/MandalaApp")
            self.assertEqual(owner, "DedeLab")
            self.assertEqual(repo, "MandalaApp")
            self.assertEqual(pages_url, "https://dedelab.github.io/MandalaApp")

            updated_ver = json.loads((root / "version.json").read_text(encoding="utf-8"))
            self.assertEqual(updated_ver["repositoryOwner"], "DedeLab")
            self.assertEqual(updated_ver["githubPagesUrl"], "https://dedelab.github.io/MandalaApp")

            updated_const = (constants_dir / "constants.ts").read_text(encoding="utf-8")
            self.assertIn("https://github.com/DedeLab/MandalaApp/releases/latest", updated_const)

            updated_xml = (manifest_dir / "AndroidManifest.xml").read_text(encoding="utf-8")
            self.assertIn('android:host="dedelab.github.io"', updated_xml)
            self.assertIn('android:pathPrefix="/MandalaApp"', updated_xml)

    def test_readiness_audit_flags_human_action_when_placeholder_or_missing_tools(self) -> None:
        items = sar.run_readiness_audit(Path(__file__).resolve().parent.parent)
        codes = {item.code: item for item in items}
        self.assertIn("REPO_SLUG", codes)
        self.assertIn("GITHUB_AUTH_AND_SECRETS", codes)
        self.assertEqual(codes["REPO_SLUG"].status, sar.CheckStatus.HUMAN_REQUIRED)


if __name__ == "__main__":
    unittest.main()
