#!/usr/bin/env python3
"""Deterministic release manifest and Digital Asset Links generator for Mandala Studio.

Follows PEP 8, PEP 257, PEP 484, and PEP 591:
- Validates ``version.json`` using typed frozen dataclasses (zero untyped dicts).
- Computes monotonic Android ``versionCode`` deterministically from SemVer.
- Generates ``public/releases/update-manifest.json`` and optionally
  ``public/.well-known/assetlinks.json`` using atomic file replacement.
"""

from __future__ import annotations

import argparse
import contextlib
import dataclasses
import datetime
import hashlib
import json
import logging
import os
import re
from enum import StrEnum
from pathlib import Path
from typing import Final, Iterator, Sequence

LOGGER: Final[logging.Logger] = logging.getLogger("mandala.release_manifest")

SEMVER_PATTERN: Final[re.Pattern[str]] = re.compile(
    r"^(?P<major>0|[1-9]\d*)\.(?P<minor>0|[1-9]\d*)\.(?P<patch>0|[1-9]\d*)"
    r"(?:-(?P<prerelease>[0-9A-Za-z.-]+))?$"
)
SHA256_HEX_PATTERN: Final[re.Pattern[str]] = re.compile(r"^[0-9a-f]{64}$")
CERT_FINGERPRINT_PATTERN: Final[re.Pattern[str]] = re.compile(
    r"^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$"
)
PACKAGE_ID_PATTERN: Final[re.Pattern[str]] = re.compile(
    r"^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$"
)

MAX_SEMVER_COMPONENT: Final[int] = 99
HASH_CHUNK_BYTES: Final[int] = 65_536


class ReleaseChannel(StrEnum):
    """Supported distribution channels synchronized per release tag."""

    GITHUB_RELEASES = "github-releases"
    GITHUB_PAGES = "github-pages"


class DistributionFlavor(StrEnum):
    """Android distribution build flavors."""

    SIDELOAD = "sideload"
    PLAYSTORE = "playstore"


@dataclasses.dataclass(frozen=True, slots=True)
class VersionContract:
    """Validated contents of ``version.json``."""

    version: str
    version_code: int
    android_package_id: str
    twa_package_id: str
    repository_owner: str
    repository_name: str
    github_pages_url: str
    apk_asset_name: str
    min_sdk: int
    target_sdk: int
    compile_sdk: int


@dataclasses.dataclass(frozen=True, slots=True)
class ReleaseManifestPayload:
    """Canonical ``update-manifest.json`` payload shared between Web, Android, and CI."""

    schema_version: int
    version_name: str
    version_code: int
    channel: ReleaseChannel
    flavor: DistributionFlavor
    android_package_id: str
    twa_package_id: str
    min_sdk: int
    target_sdk: int
    apk_available: bool
    apk_download_url: str
    release_page_url: str
    sha256: str | None
    apk_size_bytes: int | None
    generated_at: str

    def to_json_dict(self) -> dict[str, object]:
        """Serialize to camelCase JSON structure expected by Web Zod and Kotlin serializers."""
        return {
            "schemaVersion": self.schema_version,
            "versionName": self.version_name,
            "versionCode": self.version_code,
            "channel": self.channel.value,
            "flavor": self.flavor.value,
            "androidPackageId": self.android_package_id,
            "twaPackageId": self.twa_package_id,
            "minSdk": self.min_sdk,
            "targetSdk": self.target_sdk,
            "apkAvailable": self.apk_available,
            "apkDownloadUrl": self.apk_download_url,
            "releasePageUrl": self.release_page_url,
            "sha256": self.sha256,
            "apkSizeBytes": self.apk_size_bytes,
            "generatedAt": self.generated_at,
        }


def compute_android_version_code(version: str) -> int:
    """Compute a strictly monotonic Android versionCode from a SemVer string."""
    match = SEMVER_PATTERN.match(version.strip())
    if not match:
        raise ValueError(f"Invalid SemVer string: {version!r}")

    major = int(match.group("major"))
    minor = int(match.group("minor"))
    patch = int(match.group("patch"))
    if minor > MAX_SEMVER_COMPONENT or patch > MAX_SEMVER_COMPONENT:
        raise ValueError(
            f"SemVer minor/patch must be <= {MAX_SEMVER_COMPONENT} for deterministic code: {version}"
        )
    return major * 10_000 + minor * 100 + patch


def compute_file_sha256_and_size(file_path: Path) -> tuple[str, int]:
    """Stream-hash a binary file to lowercase SHA-256 hex digest and byte length."""
    if not file_path.is_file():
        raise FileNotFoundError(f"APK file does not exist: {file_path}")

    digest = hashlib.sha256()
    total_bytes = 0
    with file_path.open("rb") as handle:
        while True:
            chunk = handle.read(HASH_CHUNK_BYTES)
            if not chunk:
                break
            digest.update(chunk)
            total_bytes += len(chunk)
    return digest.hexdigest(), total_bytes


def _require_non_empty_str(raw: dict[str, object], key: str) -> str:
    value = raw.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Missing or empty string field `{key}` in version.json")
    return value.strip()


def _require_positive_int(raw: dict[str, object], key: str) -> int:
    value = raw.get(key)
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ValueError(f"Field `{key}` must be a positive integer in version.json")
    return value


def load_version_contract(version_file: Path) -> VersionContract:
    """Load and strictly validate ``version.json``."""
    raw_obj: object = json.loads(version_file.read_text(encoding="utf-8"))
    if not isinstance(raw_obj, dict):
        raise ValueError("version.json must be a JSON object")

    raw: dict[str, object] = {str(k): v for k, v in raw_obj.items()}
    version = _require_non_empty_str(raw, "version")
    expected_code = compute_android_version_code(version)
    version_code = _require_positive_int(raw, "versionCode")
    if version_code < expected_code:
        raise ValueError(
            f"versionCode ({version_code}) cannot be lower than SemVer floor ({expected_code})"
        )

    android_pkg = _require_non_empty_str(raw, "androidPackageId")
    twa_pkg = _require_non_empty_str(raw, "twaPackageId")
    if not PACKAGE_ID_PATTERN.match(android_pkg) or not PACKAGE_ID_PATTERN.match(twa_pkg):
        raise ValueError("Package identifiers must be valid reverse-DNS Android IDs")

    return VersionContract(
        version=version,
        version_code=version_code,
        android_package_id=android_pkg,
        twa_package_id=twa_pkg,
        repository_owner=_require_non_empty_str(raw, "repositoryOwner"),
        repository_name=_require_non_empty_str(raw, "repositoryName"),
        github_pages_url=_require_non_empty_str(raw, "githubPagesUrl").rstrip("/"),
        apk_asset_name=_require_non_empty_str(raw, "apkAssetName"),
        min_sdk=_require_positive_int(raw, "minSdk"),
        target_sdk=_require_positive_int(raw, "targetSdk"),
        compile_sdk=_require_positive_int(raw, "compileSdk"),
    )


def build_release_manifest(
    contract: VersionContract,
    apk_path: Path | None = None,
    explicit_sha256: str | None = None,
    explicit_size: int | None = None,
    release_tag: str | None = None,
    repository_slug: str | None = None,
) -> ReleaseManifestPayload:
    """Construct the canonical ``ReleaseManifestPayload`` for Web and Android clients."""
    slug = (
        repository_slug.strip()
        if repository_slug and repository_slug.strip()
        else f"{contract.repository_owner}/{contract.repository_name}"
    )
    release_base = f"https://github.com/{slug}/releases"
    download_url = (
        f"{release_base}/download/{release_tag}/{contract.apk_asset_name}"
        if release_tag
        else f"{release_base}/latest/download/{contract.apk_asset_name}"
    )
    release_page_url = (
        f"{release_base}/tag/{release_tag}" if release_tag else f"{release_base}/latest"
    )

    sha256_value: str | None = None
    size_bytes: int | None = None
    apk_available = False

    if apk_path is not None:
        sha256_value, size_bytes = compute_file_sha256_and_size(apk_path)
        apk_available = True
    elif explicit_sha256 is not None:
        normalized = explicit_sha256.strip().lower()
        if not SHA256_HEX_PATTERN.match(normalized):
            raise ValueError(f"Invalid SHA-256 hex digest: {explicit_sha256!r}")
        if explicit_size is None or explicit_size <= 0:
            raise ValueError("--apk-size-bytes must be positive when --sha256 is supplied")
        sha256_value = normalized
        size_bytes = explicit_size
        apk_available = True

    timestamp = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat()
    return ReleaseManifestPayload(
        schema_version=1,
        version_name=contract.version,
        version_code=contract.version_code,
        channel=ReleaseChannel.GITHUB_RELEASES,
        flavor=DistributionFlavor.SIDELOAD,
        android_package_id=contract.android_package_id,
        twa_package_id=contract.twa_package_id,
        min_sdk=contract.min_sdk,
        target_sdk=contract.target_sdk,
        apk_available=apk_available,
        apk_download_url=download_url,
        release_page_url=release_page_url,
        sha256=sha256_value,
        apk_size_bytes=size_bytes,
        generated_at=timestamp.replace("+00:00", "Z"),
    )


def build_asset_links(
    contract: VersionContract,
    cert_fingerprints: Sequence[str],
) -> list[dict[str, object]]:
    """Build Android Digital Asset Links entries for TWA and Hybrid Host domain verification."""
    normalized_prints: list[str] = []
    for raw_fp in cert_fingerprints:
        upper = raw_fp.strip().upper()
        if not CERT_FINGERPRINT_PATTERN.match(upper):
            raise ValueError(
                f"Certificate fingerprint must match AA:BB:... (32 hex pairs), got {raw_fp!r}"
            )
        normalized_prints.append(upper)

    if not normalized_prints:
        raise ValueError("At least one SHA-256 certificate fingerprint is required")

    package_ids = sorted({contract.android_package_id, contract.twa_package_id})
    return [
        {
            "relation": ["delegate_permission/common.handle_all_urls"],
            "target": {
                "namespace": "android_app",
                "package_name": pkg_id,
                "sha256_cert_fingerprints": normalized_prints,
            },
        }
        for pkg_id in package_ids
    ]


@contextlib.contextmanager
def atomic_text_writer(output_path: Path) -> Iterator[Path]:
    """Yield a sibling temporary path and atomically replace ``output_path`` on clean exit."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = output_path.with_suffix(f"{output_path.suffix}.tmp")
    try:
        yield tmp_path
        os.replace(tmp_path, output_path)
    finally:
        if tmp_path.exists():
            tmp_path.unlink(missing_ok=True)


def write_json_atomic(output_path: Path, payload: object) -> None:
    """Serialize JSON deterministically and atomically onto disk."""
    serialized = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
    with atomic_text_writer(output_path) as tmp_path:
        tmp_path.write_text(serialized, encoding="utf-8")


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    """Parse CLI arguments."""
    parser = argparse.ArgumentParser(
        description="Generate Mandala Studio update-manifest.json and Digital Asset Links."
    )
    parser.add_argument(
        "--version-file",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "version.json",
        help="Path to canonical version.json contract.",
    )
    parser.add_argument(
        "--manifest-out",
        type=Path,
        default=Path(__file__).resolve().parent.parent
        / "public"
        / "releases"
        / "update-manifest.json",
        help="Output path for update-manifest.json.",
    )
    parser.add_argument(
        "--assetlinks-out",
        type=Path,
        default=Path(__file__).resolve().parent.parent
        / "public"
        / ".well-known"
        / "assetlinks.json",
        help="Output path for Digital Asset Links file when fingerprint is provided.",
    )
    parser.add_argument(
        "--apk",
        type=Path,
        default=None,
        help="Optional signed APK file to hash directly for release manifest.",
    )
    parser.add_argument("--sha256", type=str, default=None, help="Explicit 64-hex APK SHA-256.")
    parser.add_argument("--apk-size-bytes", type=int, default=None, help="Explicit APK byte size.")
    parser.add_argument("--tag", type=str, default=None, help="Release tag (e.g. v1.0.0).")
    parser.add_argument(
        "--repo",
        type=str,
        default=None,
        help="GitHub repository slug override (owner/name).",
    )
    parser.add_argument(
        "--cert-sha256",
        action="append",
        default=[],
        help="Signing certificate SHA-256 fingerprint (AA:BB:...) for assetlinks.json.",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    """CLI entrypoint."""
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    args = parse_args(argv)

    contract = load_version_contract(args.version_file)
    manifest = build_release_manifest(
        contract=contract,
        apk_path=args.apk,
        explicit_sha256=args.sha256,
        explicit_size=args.apk_size_bytes,
        release_tag=args.tag,
        repository_slug=args.repo,
    )
    write_json_atomic(args.manifest_out, manifest.to_json_dict())
    LOGGER.info(
        "Generated %s (v%s code=%d apkAvailable=%s)",
        args.manifest_out,
        manifest.version_name,
        manifest.version_code,
        manifest.apk_available,
    )

    fingerprints: list[str] = list(args.cert_sha256)
    env_fp = os.environ.get("ANDROID_CERT_SHA256", "").strip()
    if env_fp:
        fingerprints.extend(part.strip() for part in env_fp.split(",") if part.strip())

    if fingerprints:
        asset_links = build_asset_links(contract, fingerprints)
        write_json_atomic(args.assetlinks_out, asset_links)
        LOGGER.info("Generated %s (%d entries)", args.assetlinks_out, len(asset_links))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
