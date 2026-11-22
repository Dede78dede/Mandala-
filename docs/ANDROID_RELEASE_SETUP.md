# Configurazione Release Android & GitHub Pages

Questa guida separa ciò che è **già automatizzato** nel repository da ciò che richiede un'**azione umana** (custodia chiave privata di firma e permessi sul repository GitHub).

## Flag di stato (`--check` / `--help`)

Esegui dalla root del progetto:

```bash
python3 scripts/setup_android_release.py --help
python3 scripts/setup_android_release.py --check
```

## Cosa richiede Azione Umana (`[HELP-AZIONE-UMANA-RICHIESTA]`)

1. **Collegare il tuo repository GitHub** (aggiorna `version.json`, `constants.ts` e Android App Links):
   ```bash
   python3 scripts/setup_android_release.py --repo TUO_OWNER/TUO_REPO
   ```

2. **Generare il Keystore di firma Android e caricare i 5 Secrets + GitHub Pages** (su macchina con JDK 17+ e `gh auth login`):
   ```bash
   python3 scripts/setup_android_release.py \
     --repo TUO_OWNER/TUO_REPO \
     --generate-keystore ~/.android/mandala-release.p12 \
     --apply-gh
   ```
   > **Sicurezza**: non committare mai il file `.p12` né le password nel repository Git.

   In alternativa, se preferisci configurare manualmente in **GitHub -> Settings**:
   - **Secrets and variables -> Actions -> New repository secret**:
     - `ANDROID_KEYSTORE_BASE64`: `base64 -w 0 ~/.android/mandala-release.p12`
     - `ANDROID_KEYSTORE_PASSWORD`: password dello store
     - `ANDROID_KEY_ALIAS`: `mandala-release` (o alias scelto)
     - `ANDROID_KEY_PASSWORD`: password della chiave
     - `ANDROID_SIGNING_CERT_SHA256`: impronta `SHA256` (`AA:BB:...`) estratta con `keytool -list -v -keystore ~/.android/mandala-release.p12`
   - **Pages -> Build and deployment -> Source**: seleziona **GitHub Actions**.

3. **Pubblicare la prima release sincronizzata Web + APK**:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```
   La pipeline `.github/workflows/release-android.yml` verifica i 5 secrets (mostrando `::error::[HELP - AZIONE UMANA RICHIESTA]` se manca qualcosa), compila l'APK firmato, pubblica su **GitHub Releases** e deploya **GitHub Pages** con `update-manifest.json` e `assetlinks.json`.
