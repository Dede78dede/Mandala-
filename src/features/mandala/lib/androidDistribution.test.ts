/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for Typed Android Hybrid Host Bridge, Release Manifest Schemas, and Runtime Detection.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AndroidUpdateState,
  DistributionFlavor,
  HostRuntimeKind,
  ReleaseChannel,
} from '../model/types.ts';
import { parseAndroidBridgeStatus, parseReleaseManifest } from '../model/schemas.ts';
import {
  detectHostRuntime,
  fetchSameOriginReleaseManifest,
  formatByteSizeMb,
  resolveSameOriginManifestUrl,
  type AndroidRawBridgeContract,
} from '../../../shared/lib/androidBridge.ts';

function createMockWindow(options: {
  bridge?: AndroidRawBridgeContract;
  standalone?: boolean;
}): Window {
  const base = {
    ...(options.bridge ? { __MANDALA_ANDROID_BRIDGE__: options.bridge } : {}),
    matchMedia: (query: string) => ({
      matches: Boolean(options.standalone) && query.includes('standalone'),
    }),
  };
  return base as unknown as Window;
}

function createMockDocument(referrer: string): Document {
  return { referrer } as unknown as Document;
}

describe('Android Distribution Schemas & Hybrid Host Bridge', () => {
  it('validates canonical ReleaseManifest payloads and rejects malformed sha256 digests', () => {
    const valid = parseReleaseManifest({
      schemaVersion: 1,
      versionName: '1.0.0',
      versionCode: 10_000,
      channel: ReleaseChannel.GitHubReleases,
      flavor: DistributionFlavor.Sideload,
      androidPackageId: 'com.mandala.studio',
      twaPackageId: 'com.mandala.studio.twa',
      minSdk: 28,
      targetSdk: 35,
      apkAvailable: true,
      apkDownloadUrl: 'https://github.com/mandala-studio/mandala-studio/releases/latest/download/app.apk',
      releasePageUrl: 'https://github.com/mandala-studio/mandala-studio/releases/latest',
      sha256: 'a'.repeat(64),
      apkSizeBytes: 12_582_912,
      generatedAt: '2026-11-22T00:00:00Z',
    });
    assert.equal(valid.ok, true);

    const badSha = parseReleaseManifest({
      schemaVersion: 1,
      versionName: '1.0.0',
      versionCode: 10_000,
      channel: ReleaseChannel.GitHubReleases,
      flavor: DistributionFlavor.Sideload,
      androidPackageId: 'com.mandala.studio',
      twaPackageId: 'com.mandala.studio.twa',
      minSdk: 28,
      targetSdk: 35,
      apkAvailable: true,
      apkDownloadUrl: 'https://example.com/a.apk',
      releasePageUrl: 'https://example.com',
      sha256: 'not-a-valid-hex',
      apkSizeBytes: 1024,
      generatedAt: '2026-11-22T00:00:00Z',
    });
    assert.equal(badSha.ok, false);
  });

  it('validates typed AndroidBridgeStatusSnapshot payloads', () => {
    const valid = parseAndroidBridgeStatus({
      hostVersionName: '1.0.0',
      hostVersionCode: 10_000,
      flavor: DistributionFlavor.Sideload,
      supportsNativeStylus: true,
      supportsSelfUpdate: true,
      supportsNativeExport: true,
      updateState: AndroidUpdateState.UpToDate,
      availableVersionName: null,
      availableVersionCode: null,
      errorMessage: null,
    });
    assert.equal(valid.ok, true);

    const invalid = parseAndroidBridgeStatus({
      hostVersionName: '1.0.0',
      hostVersionCode: -5,
      flavor: 'invalid-flavor',
      supportsNativeStylus: true,
      supportsSelfUpdate: true,
      supportsNativeExport: true,
      updateState: AndroidUpdateState.Idle,
      availableVersionName: null,
      availableVersionCode: null,
      errorMessage: null,
    });
    assert.equal(invalid.ok, false);
  });

  it('detects AndroidHybridHost, TrustedWebActivity, InstalledPwa, and WebBrowser accurately', () => {
    const hybrid = detectHostRuntime(
      createMockWindow({ bridge: { getStatusJson: () => '{}' } }),
      createMockDocument('')
    );
    assert.equal(hybrid, HostRuntimeKind.AndroidHybridHost);

    const twa = detectHostRuntime(
      createMockWindow({}),
      createMockDocument('android-app://com.mandala.studio.twa')
    );
    assert.equal(twa, HostRuntimeKind.TrustedWebActivity);

    const pwa = detectHostRuntime(
      createMockWindow({ standalone: true }),
      createMockDocument('https://mandala-studio.github.io/')
    );
    assert.equal(pwa, HostRuntimeKind.InstalledPwa);

    const web = detectHostRuntime(createMockWindow({}), createMockDocument(''));
    assert.equal(web, HostRuntimeKind.WebBrowser);
  });

  it('fetches and parses same-origin update-manifest.json and handles HTTP errors gracefully', async () => {
    const manifestUrl = resolveSameOriginManifestUrl();
    assert.equal(manifestUrl, '/releases/update-manifest.json');
    assert.equal(
      resolveSameOriginManifestUrl('/mandala-studio'),
      '/mandala-studio/releases/update-manifest.json'
    );

    const okResult = await fetchSameOriginReleaseManifest(async () =>
      new Response(
        JSON.stringify({
          schemaVersion: 1,
          versionName: '1.0.0',
          versionCode: 10_000,
          channel: ReleaseChannel.GitHubReleases,
          flavor: DistributionFlavor.Sideload,
          androidPackageId: 'com.mandala.studio',
          twaPackageId: 'com.mandala.studio.twa',
          minSdk: 28,
          targetSdk: 35,
          apkAvailable: false,
          apkDownloadUrl: 'https://github.com/mandala-studio/mandala-studio/releases/latest/download/app.apk',
          releasePageUrl: 'https://github.com/mandala-studio/mandala-studio/releases/latest',
          sha256: null,
          apkSizeBytes: null,
          generatedAt: '2026-11-22T00:00:00Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    assert.equal(okResult.ok, true);

    const notFound = await fetchSameOriginReleaseManifest(
      async () => new Response('missing', { status: 404 })
    );
    assert.equal(notFound.ok, false);
    assert.equal(formatByteSizeMb(null), 'N/D');
    assert.equal(formatByteSizeMb(10 * 1024 * 1024), '10.0 MB');
  });
});
