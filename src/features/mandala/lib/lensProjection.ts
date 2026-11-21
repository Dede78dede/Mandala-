/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure Optical Projection Math & VRAM-Safe Texture Resolution Planner
 * for the Hemispherical Lens (Cupola Sferica, Vetro Rifrattivo, Disco Iperbolico).
 *
 * Mirrors the WebGL2 GLSL Fragment Shader math in deterministic TypeScript so
 * optical invariants, boundary clamping, and anti-saturation downgrade policies
 * can be verified cleanly via unit tests without DOM/GPU dependencies.
 */

import { KALEIDOSCOPE_LIMITS, LENS_LIMITS } from '../model/constants.ts';
import {
  CpuLoadState,
  LensProfile,
  LensTextureQuality,
  MemoryPressureLevel,
  type LensConfig,
  type LensTextureResolutionPlan,
} from '../model/types.ts';

export const DEFAULT_LENS_CONFIG: LensConfig = {
  enabled: false,
  profile: LensProfile.RefractiveGlass,
  curvature: LENS_LIMITS.defaultCurvature,
  refractiveIndex: LENS_LIMITS.defaultIor,
  fresnelIntensity: LENS_LIMITS.defaultFresnel,
  tiltX: 0,
  tiltY: 0,
  textureQuality: LensTextureQuality.Auto2K,
  isAnimating: false,
  breatheAmplitude: LENS_LIMITS.defaultBreathe,
  hueShiftSpeed: LENS_LIMITS.defaultHueSpeed,
  kaleidoscopeFolds: KALEIDOSCOPE_LIMITS.defaultFolds,
  kaleidoscopeTwist: KALEIDOSCOPE_LIMITS.defaultTwist,
  hasCustomTexture: false,
};

export interface LensSampleOutput {
  readonly insideDisc: boolean;
  readonly srcU: number;
  readonly srcV: number;
  readonly normalZ: number;
  readonly fresnel: number;
  readonly specular: number;
  readonly rimShade: number;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function normalizeLensConfig(config: LensConfig): LensConfig {
  return {
    ...config,
    curvature: clamp(config.curvature, LENS_LIMITS.minCurvature, LENS_LIMITS.maxCurvature),
    refractiveIndex: clamp(config.refractiveIndex, LENS_LIMITS.minIor, LENS_LIMITS.maxIor),
    fresnelIntensity: clamp(
      config.fresnelIntensity,
      LENS_LIMITS.minFresnel,
      LENS_LIMITS.maxFresnel
    ),
    tiltX: clamp(config.tiltX, -LENS_LIMITS.maxTilt, LENS_LIMITS.maxTilt),
    tiltY: clamp(config.tiltY, -LENS_LIMITS.maxTilt, LENS_LIMITS.maxTilt),
    isAnimating: Boolean(config.isAnimating),
    breatheAmplitude: clamp(
      config.breatheAmplitude ?? LENS_LIMITS.defaultBreathe,
      LENS_LIMITS.minBreathe,
      LENS_LIMITS.maxBreathe
    ),
    hueShiftSpeed: clamp(
      config.hueShiftSpeed ?? LENS_LIMITS.defaultHueSpeed,
      LENS_LIMITS.minHueSpeed,
      LENS_LIMITS.maxHueSpeed
    ),
    kaleidoscopeFolds: Math.round(
      clamp(
        config.kaleidoscopeFolds ?? KALEIDOSCOPE_LIMITS.defaultFolds,
        KALEIDOSCOPE_LIMITS.minFolds,
        KALEIDOSCOPE_LIMITS.maxFolds
      )
    ),
    kaleidoscopeTwist: clamp(
      config.kaleidoscopeTwist ?? KALEIDOSCOPE_LIMITS.defaultTwist,
      KALEIDOSCOPE_LIMITS.minTwist,
      KALEIDOSCOPE_LIMITS.maxTwist
    ),
    hasCustomTexture: Boolean(config.hasCustomTexture),
  };
}

/**
 * Pure reference evaluation matching the WebGL2 fragment shader for normalized disc coordinates `u, v in [-1, 1]`.
 */
export function evaluateOpticalLensSample(
  u: number,
  v: number,
  rawConfig: LensConfig,
  timeSec: number = 0
): LensSampleOutput {
  const config = normalizeLensConfig(rawConfig);
  const rSq = u * u + v * v;
  if (rSq > 1.0) {
    return {
      insideDisc: false,
      srcU: u,
      srcV: v,
      normalZ: 0,
      fresnel: 0,
      specular: 0,
      rimShade: 0,
    };
  }

  const r = Math.sqrt(rSq);
  const nz = Math.sqrt(Math.max(0, 1.0 - rSq));
  const k = config.curvature;
  const breatheAmp = config.breatheAmplitude ?? LENS_LIMITS.defaultBreathe;
  const breatheScale =
    config.isAnimating && breatheAmp > 0
      ? 1.0 - breatheAmp * 0.5 * (1.0 + Math.sin(timeSec * 1.35))
      : 1.0;

  // Tilted unit surface normal
  const rawNx = u * k + config.tiltX * nz;
  const rawNy = v * k + config.tiltY * nz;
  const rawNz = nz;
  const nLen = Math.hypot(rawNx, rawNy, rawNz) || 1;
  const nx = rawNx / nLen;
  const ny = rawNy / nLen;
  const unitNz = rawNz / nLen;

  // View vector V = (0, 0, 1) -> cosTheta = unitNz
  const cosTheta = clamp(unitNz, 0, 1);
  const fresnelBase = 0.04;
  const schlick = fresnelBase + (1.0 - fresnelBase) * Math.pow(1.0 - cosTheta, 5);
  const fresnel = schlick * config.fresnelIntensity;

  // Directional soft studio light L = normalize(-0.38, -0.45, 0.80)
  const lx = -0.38;
  const ly = -0.45;
  const lz = 0.80;
  const lLen = Math.hypot(lx, ly, lz);
  const hx = lx / lLen;
  const hy = ly / lLen;
  const hz = (lz / lLen + 1.0);
  const hLen = Math.hypot(hx, hy, hz) || 1;
  const nDotH = clamp((nx * hx + ny * hy + unitNz * hz) / hLen, 0, 1);
  const specular = Math.pow(nDotH, 36.0) * 0.45 * config.fresnelIntensity;

  let srcU = u;
  let srcV = v;
  let rimShade = 1.0;

  if (config.profile === LensProfile.SphericalDome) {
    if (r > 1e-6) {
      const sphericalR = (2.0 / Math.PI) * Math.asin(clamp(r, 0, 1));
      const warpedR = mix(r, sphericalR, k);
      const scale = warpedR / r;
      srcU = u * scale + nx * 0.14 * config.tiltX;
      srcV = v * scale + ny * 0.14 * config.tiltY;
    }
    rimShade = mix(1.0, 0.72 + 0.28 * unitNz, k);
  } else if (config.profile === LensProfile.RefractiveGlass) {
    const eta = 1.0 / config.refractiveIndex;
    // Snell refraction approximation inside curved cabochon slab
    const kTerm = 1.0 - eta * eta * (1.0 - cosTheta * cosTheta);
    const cosT = Math.sqrt(Math.max(0, kTerm));
    const rx = -(eta * cosTheta - cosT) * nx;
    const ry = -(eta * cosTheta - cosT) * ny;
    const magnification = mix(1.0, 1.0 - 0.34 * k * nz, k);
    srcU = u * magnification + rx * (0.45 * k);
    srcV = v * magnification + ry * (0.45 * k);
    rimShade = 0.86 + 0.14 * unitNz;
  } else if (config.profile === LensProfile.StainedGlass) {
    // Stained Glass Cathedral Facets: gentle stepped radial prism bevels + luminous jewel tint
    const theta = Math.atan2(v, u);
    const facetAngle = Math.round((theta * 12) / (Math.PI * 2)) * ((Math.PI * 2) / 12);
    const facetDrift = 0.045 * k * (1.0 - nz);
    srcU = u * (1.0 - 0.14 * k * nz) + Math.cos(facetAngle) * facetDrift + config.tiltX * 0.12;
    srcV = v * (1.0 - 0.14 * k * nz) + Math.sin(facetAngle) * facetDrift + config.tiltY * 0.12;
    rimShade = 0.82 + 0.18 * unitNz;
  } else if (config.profile === LensProfile.Kaleidoscope) {
    // N-fold mirror kaleidoscope with radial twist warp & dome bevel
    if (r > 1e-6) {
      const folds = Math.max(
        KALEIDOSCOPE_LIMITS.minFolds,
        config.kaleidoscopeFolds ?? KALEIDOSCOPE_LIMITS.defaultFolds
      );
      const twist = config.kaleidoscopeTwist ?? KALEIDOSCOPE_LIMITS.defaultTwist;
      const sector = (Math.PI * 2) / folds;
      const animDrift = config.isAnimating ? timeSec * 0.22 : 0;
      const theta = Math.atan2(v, u) + r * twist * k + config.tiltX * 0.85 + animDrift;
      let folded = ((theta % sector) + sector) % sector;
      if (folded > sector * 0.5) {
        folded = sector - folded;
      }
      const sampleR = clamp(
        r * (1.0 - 0.12 * k * nz) + config.tiltY * 0.08 * (1.0 - r),
        0,
        1
      );
      srcU = sampleR * Math.cos(folded);
      srcV = sampleR * Math.sin(folded);
    }
    rimShade = 0.84 + 0.16 * unitNz;
  } else {
    // LensProfile.PoincareDisk: conformal hyperbolic warping compressing rim asymptotically
    if (r > 1e-6) {
      const edgeLimit = LENS_LIMITS.poincareClampFactor;
      const clampedR = Math.min(r * edgeLimit, 0.995);
      const denom = Math.atanh(edgeLimit);
      const hypR = denom > 1e-6 ? Math.atanh(clampedR) / denom : r;
      const warpedR = mix(r, hypR, k);
      const scale = warpedR / r;
      srcU = u * scale + config.tiltX * 0.1 * (1 - rSq);
      srcV = v * scale + config.tiltY * 0.1 * (1 - rSq);
    }
    rimShade = mix(1.0, 0.68 + 0.32 * unitNz, k * 0.7);
  }

  return {
    insideDisc: true,
    srcU: clamp(srcU * breatheScale, -1, 1),
    srcV: clamp(srcV * breatheScale, -1, 1),
    normalZ: unitNz,
    fresnel,
    specular,
    rimShade,
  };
}

export function estimateRgbaTextureBytes(dimensionPx: number): number {
  // Base RGBA level + ~33% overhead for GPU mipmap pyramid
  return Math.round(dimensionPx * dimensionPx * 4 * 1.33);
}

/**
 * Deterministic VRAM/CPU anti-saturation planner for the Lens offscreen source texture.
 * - Default Auto2K uses 2048px supersampled, stepping down to 1024px under CPU or memory pressure.
 * - HD 4096px requires GPU MAX_TEXTURE_SIZE >= 4096, Nominal/Normal pressure, and safe VRAM budget.
 */
export function resolveEffectiveLensTextureSize(params: {
  readonly requestedQuality: LensTextureQuality;
  readonly cpuLoadState: CpuLoadState;
  readonly memoryPressure: MemoryPressureLevel;
  readonly maxGpuTextureSize: number;
  readonly currentSceneBytes: number;
}): LensTextureResolutionPlan {
  const safeMaxTex = Math.max(512, params.maxGpuTextureSize);

  if (params.requestedQuality === LensTextureQuality.Hd4K) {
    const hdVram = estimateRgbaTextureBytes(LENS_LIMITS.hdTexturePx);
    const fitsGpuLimit = safeMaxTex >= LENS_LIMITS.hdTexturePx;
    const fitsVramBudget =
      params.currentSceneBytes + hdVram <= LENS_LIMITS.maxGpuVramBudgetBytes * 1.15;
    const healthySystem =
      params.cpuLoadState !== CpuLoadState.Protected &&
      params.memoryPressure !== MemoryPressureLevel.Critical;

    if (fitsGpuLimit && fitsVramBudget && healthySystem) {
      return {
        textureSizePx: LENS_LIMITS.hdTexturePx,
        estimatedVramBytes: hdVram,
        downgraded: false,
        label: 'HD 4K (4096 px)',
        reason: null,
      };
    }

    const fallbackPx =
      params.cpuLoadState === CpuLoadState.Protected ||
      params.memoryPressure === MemoryPressureLevel.Critical
        ? LENS_LIMITS.fallbackTexturePx
        : Math.min(LENS_LIMITS.standardTexturePx, safeMaxTex);

    return {
      textureSizePx: fallbackPx,
      estimatedVramBytes: estimateRgbaTextureBytes(fallbackPx),
      downgraded: true,
      label: `${fallbackPx} px (Protetto)`,
      reason: !fitsGpuLimit
        ? `GPU limitata a ${safeMaxTex} px: applicato downgrade automatico a ${fallbackPx} px.`
        : 'Pressione CPU/VRAM elevata: HD 4K ridotto automaticamente per stabilità.',
    };
  }

  // Standard Auto2K policy
  const isUnderPressure =
    params.cpuLoadState !== CpuLoadState.Nominal ||
    params.memoryPressure !== MemoryPressureLevel.Normal;

  if (isUnderPressure || safeMaxTex < LENS_LIMITS.standardTexturePx) {
    const downPx = Math.min(LENS_LIMITS.fallbackTexturePx, safeMaxTex);
    return {
      textureSizePx: downPx,
      estimatedVramBytes: estimateRgbaTextureBytes(downPx),
      downgraded: true,
      label: `${downPx} px (Auto-Protetto)`,
      reason: 'Carico CPU/Memoria elevato: texture Lente scalata automaticamente a 1024 px.',
    };
  }

  return {
    textureSizePx: LENS_LIMITS.standardTexturePx,
    estimatedVramBytes: estimateRgbaTextureBytes(LENS_LIMITS.standardTexturePx),
    downgraded: false,
    label: '2048 px (Auto 2K)',
    reason: null,
  };
}
