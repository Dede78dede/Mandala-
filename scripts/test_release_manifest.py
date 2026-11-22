#!/usr/bin/env python3
"""Unit tests for Mandala Studio PEP release manifest & Digital Asset Links tooling."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from release_manifest import (
    VersionContract,
    build_asset_links,
    build_release_manifest,
    compute_android_version_code,
    load_version_contract,
)


class ReleaseManifestTests(unittest.TestCase):
    """Tests deterministic SemVer -> versionCode, SHA-256 hashing, and validation."""

    def test_compute_android_version_code_monotonic(self) -> None:
        self.assertEqual(compute_android_version_code("1.0.0"), 10_000)
        self.assertEqual(compute_android_version_code("1.2.15"), 10_215)
        self.assertEqual(compute_android_version_code("2.0.0-rc.1"), 20_000)
        with self.assertRaises(ValueError):
            compute_android_version_code("not-a-semver")
        with self.assertRaises(ValueError):
            compute_android_version_code("1.100.0")

    def test_load_version_contract_and_manifest_with_apk(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            version_path = root / "version.json"
            version_path.write_text(
                json.dumps(
                    {
                        "version": "1.2.3",
                        "versionCode": 10_203,
                        "androidPackageId": "com.mandala.studio",
                        "twaPackageId": "com.mandala.studio.twa",
                        "repositoryOwner": "acme",
                        "repositoryName": "mandala",
                        "githubPagesUrl": "https://acme.github.io/mandala/",
                        "apkAssetName": "mandala.apk",
                        "minSdk": 28,
                        "targetSdk": 35,
                        "compileSdk": 35,
                    }
                ),
                encoding="utf-8",
            )
            contract: VersionContract = load_version_contract(version_path)
            self.assertEqual(contract.version_code, 10_203)

            fake_apk = root / "mandala.apk"
            fake_apk.write_bytes(b"PK\x03\x04mandala-test-apk")

            manifest = build_release_manifest(
                contract=contract,
                apk_path=fake_apk,
                release_tag="v1.2.3",
            )
            self.assertTrue(manifest.apk_available)
            self.assertIsNotNone(manifest.sha256)
            self.assertEqual(len(manifest.sha256 or ""), 64)
            self.assertEqual(manifest.apk_size_bytes, len(b"PK\x03\x04mandala-test-apk"))
            self.assertEqual(
                manifest.apk_download_url,
                "https://github.com/acme/mandala/releases/download/v1.2.3/mandala.apk",
            )

    def test_build_asset_links_rejects_bad_fingerprint(self) -> None:
        contract = VersionContract(
            version="1.0.0",
            version_code=10_000,
            android_package_id="com.mandala.studio",
            twa_package_id="com.mandala.studio.twa",
            repository_owner="acme",
            repository_name="mandala",
            github_pages_url="https://acme.github.io/mandala",
            apk_asset_name="mandala.apk",
            min_sdk=28,
            target_sdk=35,
            compile_sdk=35,
        )
        valid_fp = ":".join(["AA"] * 32)
        links = build_asset_links(contract, [valid_fp])
        self.assertEqual(len(links), 2)
        with self.assertRaises(ValueError):
            build_asset_links(contract, ["INVALID"])


if __name__ == "__main__":
    unittest.main()
