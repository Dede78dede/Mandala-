#!/usr/bin/env python3
"""Bootstrap and diagnostic CLI for Mandala Studio Android Release Signing & GitHub Pages.

Clearly separates what is automated in this repository from steps that strictly
require human credentials/authorization (Keystore custody, GitHub Repository
Secrets, and GitHub Pages enablement), exposing a ``--help`` flag and actionable
``[HELP - AZIONE UMANA RICHIESTA]`` flags wherever human intervention is needed.

Follows PEP 8, PEP 257, PEP 484, and PEP 591.
"""

from __future__ import annotations

import argparse
import base64
import dataclasses
import getpass
import json
import logging
import re
import shutil
import subprocess
import sys
from enum import StrEnum
from pathlib import Path
from typing import Final, Sequence

from release_manifest import atomic_text_writer, load_version_contract, write_json_atomic

LOGGER: Final[logging.Logger] = logging.getLogger("mandala.setup_release")

REPO_SLUG_PATTERN: Final[re.Pattern[str]] = re.compile(
    r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$"
)
SHA256_LINE_PATTERN: Final[re.Pattern[str]] = re.compile(
    r"SHA256:\s*((?:[0-9A-Fa-f]{2}:){31}[0-9A-Fa-f]{2})"
)

DEFAULT_PLACEHOLDER_OWNER: Final[str] = "mandala-studio"
DEFAULT_KEY_ALIAS: Final[str] = "mandala-release"
REQUIRED_GITHUB_SECRETS: Final[tuple[str, ...]] = (
    "ANDROID_KEYSTORE_BASE64",
    "ANDROID_KEYSTORE_PASSWORD",
    "ANDROID_KEY_ALIAS",
    "ANDROID_KEY_PASSWORD",
    "ANDROID_SIGNING_CERT_SHA256",
)


class CheckStatus(StrEnum):
    """Status flags for pre-release readiness checks."""

    AUTO_OK = "AUTO-OK"
    HUMAN_REQUIRED = "HELP-AZIONE-UMANA-RICHIESTA"


@dataclasses.dataclass(frozen=True, slots=True)
class ReadinessItem:
    """Single item in the release automation vs human-action audit."""

    code: str
    status: CheckStatus
    summary: str
    human_instruction: str | None = None


@dataclasses.dataclass(frozen=True, slots=True)
class SigningArtifacts:
    """Materialized non-logged signing outputs extracted from a local keystore."""

    keystore_path: Path
    key_alias: str
    keystore_base64: str
    cert_sha256: str


def parse_repo_slug(slug: str) -> tuple[str, str]:
    """Validate and split a ``owner/repo`` GitHub slug."""
    cleaned = slug.strip().strip("/")
    if not REPO_SLUG_PATTERN.match(cleaned):
        raise ValueError(
            f"Slug GitHub non valido '{slug}'. Formato atteso: owner/repository"
        )
    owner, repo = cleaned.split("/", 1)
    return owner, repo


def compute_github_pages_url(owner: str, repo: str) -> str:
    """Compute canonical GitHub Pages URL for project or user sites."""
    if repo.lower() == f"{owner.lower()}.github.io":
        return f"https://{owner.lower()}.github.io"
    return f"https://{owner.lower()}.github.io/{repo}"


def extract_cert_sha256_from_keytool_output(stdout: str) -> str:
    """Extract normalized ``AA:BB:...`` SHA-256 certificate fingerprint from keytool."""
    match = SHA256_LINE_PATTERN.search(stdout)
    if not match:
        raise ValueError(
            "Impronta SHA256 non trovata nell'output di keytool -list -v"
        )
    return match.group(1).upper()


def apply_repository_slug(root_dir: Path, slug: str) -> tuple[str, str, str]:
    """Synchronize owner/repo and GitHub Pages URL across repo SSOT files."""
    owner, repo = parse_repo_slug(slug)
    pages_url = compute_github_pages_url(owner, repo)
    contract_path = root_dir / "version.json"
    raw_json: object = json.loads(contract_path.read_text(encoding="utf-8"))
    if not isinstance(raw_json, dict):
        raise ValueError("version.json must be a JSON object")

    updated_version: dict[str, object] = {str(k): v for k, v in raw_json.items()}
    updated_version["repositoryOwner"] = owner
    updated_version["repositoryName"] = repo
    updated_version["githubPagesUrl"] = pages_url
    apk_asset = str(
        updated_version.get("apkAssetName", "mandala-studio-universal-release.apk")
    )
    write_json_atomic(contract_path, updated_version)

    constants_path = root_dir / "src" / "features" / "mandala" / "model" / "constants.ts"
    constants_text = constants_path.read_text(encoding="utf-8")
    release_page = f"https://github.com/{owner}/{repo}/releases/latest"
    apk_url = f"https://github.com/{owner}/{repo}/releases/latest/download/{apk_asset}"

    constants_text = re.sub(
        r"fallbackReleasePageUrl:\s*'[^']*'",
        f"fallbackReleasePageUrl: '{release_page}'",
        constants_text,
    )
    constants_text = re.sub(
        r"fallbackApkDownloadUrl:\s*\n?\s*'[^']*'",
        f"fallbackApkDownloadUrl:\n    '{apk_url}'",
        constants_text,
    )
    with atomic_text_writer(constants_path) as tmp_constants:
        tmp_constants.write_text(constants_text, encoding="utf-8")

    manifest_path = root_dir / "android" / "app" / "src" / "main" / "AndroidManifest.xml"
    if manifest_path.is_file():
        manifest_text = manifest_path.read_text(encoding="utf-8")
        pages_host = f"{owner.lower()}.github.io"
        path_prefix = "/" if repo.lower() == f"{owner.lower()}.github.io" else f"/{repo}"
        manifest_text = re.sub(
            r'android:host="[^"]+\.github\.io"',
            f'android:host="{pages_host}"',
            manifest_text,
        )
        manifest_text = re.sub(
            r'android:pathPrefix="[^"]*"',
            f'android:pathPrefix="{path_prefix}"',
            manifest_text,
        )
        with atomic_text_writer(manifest_path) as tmp_manifest:
            tmp_manifest.write_text(manifest_text, encoding="utf-8")

    return owner, repo, pages_url


def run_readiness_audit(root_dir: Path) -> tuple[ReadinessItem, ...]:
    """Audit repository files and host toolchain for release readiness."""
    items: list[ReadinessItem] = []

    version_file = root_dir / "version.json"
    contract = load_version_contract(version_file)
    if contract.repository_owner == DEFAULT_PLACEHOLDER_OWNER:
        items.append(
            ReadinessItem(
                code="REPO_SLUG",
                status=CheckStatus.HUMAN_REQUIRED,
                summary=(
                    f"version.json punta ancora al repository placeholder "
                    f"`{contract.repository_owner}/{contract.repository_name}`."
                ),
                human_instruction=(
                    "Esegui `python3 scripts/setup_android_release.py --repo TUO_OWNER/TUO_REPO`."
                ),
            )
        )
    else:
        items.append(
            ReadinessItem(
                code="REPO_SLUG",
                status=CheckStatus.AUTO_OK,
                summary=(
                    f"Repository configurato: `{contract.repository_owner}/{contract.repository_name}` "
                    f"(Pages: {contract.github_pages_url})."
                ),
            )
        )

    workflow_path = root_dir / ".github" / "workflows" / "release-android.yml"
    if workflow_path.is_file():
        items.append(
            ReadinessItem(
                code="CI_WORKFLOW",
                status=CheckStatus.AUTO_OK,
                summary="Workflow `.github/workflows/release-android.yml` presente e pronto.",
            )
        )
    else:
        items.append(
            ReadinessItem(
                code="CI_WORKFLOW",
                status=CheckStatus.HUMAN_REQUIRED,
                summary="Workflow di release non trovato.",
                human_instruction="Ripristina `.github/workflows/release-android.yml`.",
            )
        )

    has_keytool = shutil.which("keytool") is not None
    items.append(
        ReadinessItem(
            code="LOCAL_KEYTOOL",
            status=CheckStatus.AUTO_OK if has_keytool else CheckStatus.HUMAN_REQUIRED,
            summary=(
                "JDK `keytool` rilevato su questa macchina."
                if has_keytool
                else "JDK `keytool` non installato in questo container/ambiente."
            ),
            human_instruction=(
                None
                if has_keytool
                else "Genera il keystore sulla tua workstation JDK con "
                "`python3 scripts/setup_android_release.py --generate-keystore --repo OWNER/REPO --apply-gh`."
            ),
        )
    )

    has_gh = shutil.which("gh") is not None
    gh_authed = False
    if has_gh:
        auth_proc = subprocess.run(
            ["gh", "auth", "status"],
            capture_output=True,
            text=True,
            check=False,
        )
        gh_authed = auth_proc.returncode == 0

    items.append(
        ReadinessItem(
            code="GITHUB_AUTH_AND_SECRETS",
            status=CheckStatus.AUTO_OK if gh_authed else CheckStatus.HUMAN_REQUIRED,
            summary=(
                "GitHub CLI autenticata: è possibile configurare i 5 Secrets e GitHub Pages."
                if gh_authed
                else "GitHub CLI non presente o non autenticata su questo host."
            ),
            human_instruction=(
                None
                if gh_authed
                else "Carica in Settings -> Secrets and variables -> Actions: "
                + ", ".join(REQUIRED_GITHUB_SECRETS)
                + "; imposta Settings -> Pages -> Source = GitHub Actions."
            ),
        )
    )

    return tuple(items)


def generate_pkcs12_keystore(
    keystore_path: Path,
    alias: str,
    keystore_password: str,
    key_password: str,
    dname: str,
) -> SigningArtifacts:
    """Create an RSA-4096 PKCS12 Android release keystore and extract CI secrets."""
    if shutil.which("keytool") is None:
        raise RuntimeError(
            "Comando `keytool` (JDK 17+) non trovato nel PATH."
        )
    if keystore_path.exists():
        raise FileExistsError(
            f"Il file keystore esiste già (protezione anti-sovrascrittura): {keystore_path}"
        )

    keystore_path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "keytool",
            "-genkeypair",
            "-v",
            "-keystore",
            str(keystore_path),
            "-storetype",
            "PKCS12",
            "-keyalg",
            "RSA",
            "-keysize",
            "4096",
            "-validity",
            "10000",
            "-alias",
            alias,
            "-storepass:env",
            "MANDALA_GEN_STOREPASS",
            "-keypass:env",
            "MANDALA_GEN_KEYPASS",
            "-dname",
            dname,
        ],
        env={
            **dict(**subprocess.os.environ),
            "MANDALA_GEN_STOREPASS": keystore_password,
            "MANDALA_GEN_KEYPASS": key_password,
        },
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    inspect_proc = subprocess.run(
        [
            "keytool",
            "-list",
            "-v",
            "-keystore",
            str(keystore_path),
            "-alias",
            alias,
            "-storepass:env",
            "MANDALA_GEN_STOREPASS",
        ],
        env={
            **dict(**subprocess.os.environ),
            "MANDALA_GEN_STOREPASS": keystore_password,
        },
        check=True,
        capture_output=True,
        text=True,
    )
    cert_sha256 = extract_cert_sha256_from_keytool_output(inspect_proc.stdout)
    keystore_b64 = base64.b64encode(keystore_path.read_bytes()).decode("ascii")
    return SigningArtifacts(
        keystore_path=keystore_path,
        key_alias=alias,
        keystore_base64=keystore_b64,
        cert_sha256=cert_sha256,
    )


def push_secrets_and_enable_pages_via_gh(
    repo_slug: str,
    artifacts: SigningArtifacts,
    keystore_password: str,
    key_password: str,
) -> None:
    """Push all 5 signing secrets via stdin (`gh secret set`) and enable Pages workflow source."""
    if shutil.which("gh") is None:
        raise RuntimeError("GitHub CLI (`gh`) non installata.")

    secret_map: dict[str, str] = {
        "ANDROID_KEYSTORE_BASE64": artifacts.keystore_base64,
        "ANDROID_KEYSTORE_PASSWORD": keystore_password,
        "ANDROID_KEY_ALIAS": artifacts.key_alias,
        "ANDROID_KEY_PASSWORD": key_password,
        "ANDROID_SIGNING_CERT_SHA256": artifacts.cert_sha256,
    }
    for name, value in secret_map.items():
        subprocess.run(
            ["gh", "secret", "set", name, "--repo", repo_slug],
            input=value,
            text=True,
            check=True,
        )
        LOGGER.info("Configured GitHub Secret: %s", name)

    owner, repo = parse_repo_slug(repo_slug)
    create_pages = subprocess.run(
        [
            "gh",
            "api",
            "-X",
            "POST",
            f"/repos/{owner}/{repo}/pages",
            "-f",
            "build_type=workflow",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if create_pages.returncode != 0:
        subprocess.run(
            [
                "gh",
                "api",
                "-X",
                "PUT",
                f"/repos/{owner}/{repo}/pages",
                "-f",
                "build_type=workflow",
            ],
            check=True,
            capture_output=True,
            text=True,
        )
    LOGGER.info("Enabled GitHub Pages (build_type=workflow) on %s/%s", owner, repo)


def render_human_help_banner() -> str:
    """Return bilingual-clear checklist flagging steps requiring human intervention."""
    return (
        "\n======================================================================\n"
        "  [HELP FLAG - AZIONE UMANA RICHIESTA / HUMAN ACTION CHECKLIST]\n"
        "======================================================================\n"
        "  Per ragioni di sicurezza (custodia chiave privata di firma APK e\n"
        "  autenticazione GitHub), questo script automatizza la preparazione del\n"
        "  repository, ma i segreti devono essere creati dalla tua macchina:\n\n"
        "  1) Imposta il tuo repository nel contratto SSOT:\n"
        "       python3 scripts/setup_android_release.py --repo OWNER/REPO\n\n"
        "  2) Su una macchina con JDK 17+ e GitHub CLI (`gh auth login`), esegui:\n"
        "       python3 scripts/setup_android_release.py \\\n"
        "         --repo OWNER/REPO \\\n"
        "         --generate-keystore ~/.android/mandala-release.p12 \\\n"
        "         --apply-gh\n"
        "     Questo creera il keystore RSA-4096, carichera i 5 Repository Secrets\n"
        "     (ANDROID_KEYSTORE_BASE64, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS,\n"
        "      ANDROID_KEY_PASSWORD, ANDROID_SIGNING_CERT_SHA256) e abiliterà\n"
        "     GitHub Pages con sorgente GitHub Actions.\n\n"
        "  3) Conserva il file .p12 e le password in un password manager sicuro\n"
        "     (MAI nel repository Git), poi crea il tag di rilascio:\n"
        "       git tag v1.0.0 && git push origin v1.0.0\n"
        "======================================================================\n"
    )


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    """Parse CLI arguments with detailed human-help epilog."""
    parser = argparse.ArgumentParser(
        prog="setup_android_release.py",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        description=(
            "Audit, sincronizzazione repository e bootstrap segreti/GitHub Pages\n"
            "per le release firmate Android APK + PWA di Mandala Studio."
        ),
        epilog=render_human_help_banner(),
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=Path(__file__).resolve().parent.parent,
        help="Root del progetto (default: parent di scripts/).",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Verifica stato file repo, keytool e gh auth mostrando i flag [HELP].",
    )
    parser.add_argument(
        "--repo",
        type=str,
        default=None,
        help="Aggiorna version.json, constants.ts e AndroidManifest.xml con owner/repo.",
    )
    parser.add_argument(
        "--generate-keystore",
        type=Path,
        default=None,
        help="Percorso di destinazione del nuovo keystore PKCS12 (.p12) fuori dal repo.",
    )
    parser.add_argument(
        "--alias",
        type=str,
        default=DEFAULT_KEY_ALIAS,
        help=f"Alias chiave di firma Android (default: {DEFAULT_KEY_ALIAS}).",
    )
    parser.add_argument(
        "--dname",
        type=str,
        default="CN=Mandala Studio Release, O=Mandala Studio, L=Milan, C=IT",
        help="Distinguished Name certificato X.509.",
    )
    parser.add_argument(
        "--apply-gh",
        action="store_true",
        help="Carica i 5 Secrets su GitHub via `gh secret set` e abilita Pages (workflow).",
    )
    parser.add_argument(
        "--human-checklist",
        action="store_true",
        help="Stampa la checklist dettagliata per intervento umano.",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    """CLI entrypoint."""
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    args = parse_args(argv)
    root_dir: Path = args.root.resolve()

    if args.repo:
        owner, repo, pages_url = apply_repository_slug(root_dir, args.repo)
        LOGGER.info(
            "Updated SSOT for %s/%s (GitHub Pages: %s)", owner, repo, pages_url
        )

    if args.generate_keystore is not None:
        ks_path: Path = args.generate_keystore.expanduser().resolve()
        if root_dir in ks_path.parents or ks_path == root_dir:
            LOGGER.error(
                "[HELP] Non salvare il keystore dentro il repository Git (%s). "
                "Usa un percorso esterno es. ~/.android/mandala-release.p12",
                ks_path,
            )
            return 2

        ks_pass = getpass.getpass("Password Keystore (min 8 caratteri): ")
        if len(ks_pass) < 8:
            LOGGER.error("Password keystore troppo corta (min 8 caratteri).")
            return 2
        key_pass = getpass.getpass("Password Chiave (invio per usare la stessa): ") or ks_pass

        artifacts = generate_pkcs12_keystore(
            keystore_path=ks_path,
            alias=args.alias,
            keystore_password=ks_pass,
            key_password=key_pass,
            dname=args.dname,
        )
        LOGGER.info("Keystore generato: %s", artifacts.keystore_path)
        LOGGER.info("ANDROID_SIGNING_CERT_SHA256 = %s", artifacts.cert_sha256)

        if args.apply_gh:
            contract = load_version_contract(root_dir / "version.json")
            slug = args.repo or f"{contract.repository_owner}/{contract.repository_name}"
            push_secrets_and_enable_pages_via_gh(slug, artifacts, ks_pass, key_pass)
        else:
            print(render_human_help_banner())
        return 0

    if args.apply_gh:
        LOGGER.error(
            "[HELP] `--apply-gh` richiede `--generate-keystore` (o usa i comandi `gh secret set` manuali)."
        )
        print(render_human_help_banner())
        return 2

    if args.check or args.human_checklist or not args.repo:
        items = run_readiness_audit(root_dir)
        has_human_pending = False
        for item in items:
            print(f"[{item.status.value}] {item.code}: {item.summary}")
            if item.human_instruction:
                has_human_pending = True
                print(f"    -> {item.human_instruction}")
        if has_human_pending or args.human_checklist:
            print(render_human_help_banner())

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
