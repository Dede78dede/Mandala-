/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lazy-Loaded WebGL2 Hemispherical Optical Lens Compositor.
 * - Zero dependencies: pure fullscreen quad (TRIANGLE_STRIP, 4 static vertices)
 * - 3 GPU Fragment Profiles: Cupola Sferica, Vetro Rifrattivo (Snell + Schlick Fresnel), Disco Iperbolico
 * - Automatic Mipmap generation on supersampled 2048px / 4096px offscreen source textures
 * - Deterministic VRAM cleanup registered with `cacheService` for Flush Cache
 */

import { registerGpuTextureReclaimer } from '../../../shared/lib/cacheService.ts';
import {
  DiagnosticSeverity,
  DiagnosticSource,
  DomainErrorCode,
  reportDiagnostic,
} from '../../../shared/lib/diagnostics.ts';
import { KALEIDOSCOPE_LIMITS, LENS_LIMITS } from '../model/constants.ts';
import { MANDALA_MESSAGES } from '../model/messages.ts';
import { LensProfile, type LensConfig } from '../model/types.ts';
import { estimateRgbaTextureBytes, normalizeLensConfig } from './lensProjection.ts';

const VERTEX_SHADER_SOURCE = `#version 300 es
precision highp float;
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_sourceTex;
uniform int u_mode; // 0 = SphericalDome, 1 = RefractiveGlass, 2 = PoincareDisk, 3 = StainedGlass, 4 = Kaleidoscope
uniform float u_curvature;
uniform float u_ior;
uniform float u_fresnel;
uniform vec2 u_tilt;
uniform float u_bgOnlyAlpha;
uniform float u_time;
uniform float u_breathe;
uniform float u_hueSpeed;
uniform float u_folds;
uniform float u_twist;

float atanhApprox(float x) {
  float cx = clamp(x, -0.996, 0.996);
  return 0.5 * log((1.0 + cx) / max(0.0005, 1.0 - cx));
}

vec3 shiftHue(vec3 color, float angle) {
  const vec3 kAxis = vec3(0.57735, 0.57735, 0.57735);
  float cosAngle = cos(angle);
  return color * cosAngle + cross(kAxis, color) * sin(angle) + kAxis * dot(kAxis, color) * (1.0 - cosAngle);
}

void main() {
  vec2 p = v_uv;
  float rSq = dot(p, p);

  // Outside hemispherical lens disc: clean dark slate matte edge
  if (rSq > 1.0) {
    float edgeMask = smoothstep(1.0, 0.985, rSq);
    if (edgeMask <= 0.0) {
      outColor = vec4(0.035, 0.051, 0.086, u_bgOnlyAlpha);
      return;
    }
  }

  float r = sqrt(max(0.0, rSq));
  float nz = sqrt(max(0.0, 1.0 - min(1.0, rSq)));
  float k = clamp(u_curvature, 0.0, 1.0);
  float breatheScale = 1.0 - clamp(u_breathe, 0.0, 0.25) * 0.5 * (1.0 + sin(u_time * 1.35));

  vec3 N = normalize(vec3(p.x * k + u_tilt.x * nz, p.y * k + u_tilt.y * nz, max(0.001, nz)));
  vec3 V = vec3(0.0, 0.0, 1.0);
  float cosTheta = clamp(dot(N, V), 0.0, 1.0);

  // Schlick Fresnel + directional specular highlight
  float fresnelBase = 0.04;
  float fresnel = (fresnelBase + (1.0 - fresnelBase) * pow(1.0 - cosTheta, 5.0)) * u_fresnel;

  vec3 L = normalize(vec3(-0.38, -0.45, 0.80));
  vec3 H = normalize(L + V);
  float spec = pow(clamp(dot(N, H), 0.0, 1.0), 38.0) * 0.42 * u_fresnel;

  vec2 srcUv = p;
  float rimShade = 1.0;
  vec3 tintColor = vec3(0.0);
  float leadLine = 0.0;

  if (u_mode == 0) {
    // Spherical Dome (Orthographic hemisphere wrap)
    if (r > 1e-5) {
      float sphR = (2.0 / 3.14159265) * asin(clamp(r, 0.0, 1.0));
      float warpedR = mix(r, sphR, k);
      srcUv = p * (warpedR / r) + N.xy * 0.14 * u_tilt;
    }
    rimShade = mix(1.0, 0.72 + 0.28 * N.z, k);
    tintColor = vec3(0.22, 0.74, 0.97) * fresnel * 0.55;
  } else if (u_mode == 1) {
    // Refractive Cabochon Glass (Snell + Fresnel bevel + subtle edge dispersion)
    float eta = 1.0 / clamp(u_ior, 1.0, 1.75);
    vec3 refracted = refract(-V, N, eta);
    float magnification = mix(1.0, 1.0 - 0.34 * k * nz, k);
    srcUv = p * magnification + refracted.xy * (0.45 * k);
    rimShade = 0.86 + 0.14 * N.z;
    tintColor = vec3(0.45, 0.86, 1.0) * fresnel * 0.85;
  } else if (u_mode == 3) {
    // Stained Glass Cathedral Prism (faceted leaded cames + vibrant jewel transmission)
    float theta = atan(p.y, p.x);
    float sectors = 12.0;
    float sectorIdx = floor((theta + 3.14159265) * sectors / 6.2831853 + 0.5);
    float facetAngle = sectorIdx * (6.2831853 / sectors) - 3.14159265;
    float facetDelta = abs(theta - facetAngle) * r;
    float radialBand = abs(fract(r * 3.0) - 0.5);
    float cameRadial = 1.0 - smoothstep(0.0, 0.018, radialBand * 0.35);
    float cameAngular = 1.0 - smoothstep(0.0, 0.016, facetDelta);
    leadLine = clamp(max(cameRadial * 0.45, cameAngular * 0.65), 0.0, 1.0) * k * 0.55;

    float facetDrift = 0.045 * k * (1.0 - nz);
    srcUv = p * (1.0 - 0.14 * k * nz) + vec2(cos(facetAngle), sin(facetAngle)) * facetDrift + u_tilt * 0.12;
    rimShade = 0.84 + 0.16 * N.z;
    tintColor = (0.5 + 0.5 * cos(u_time * max(0.25, u_hueSpeed * 1.4) + facetAngle + vec3(0.0, 2.1, 4.2))) * fresnel * 0.52;
  } else if (u_mode == 4) {
    // N-Fold Mirror Kaleidoscope with radial twist warp & dome bevel
    if (r > 1e-5) {
      float folds = max(4.0, u_folds);
      float sector = 6.2831853 / folds;
      float animDrift = u_time * 0.22;
      float theta = atan(p.y, p.x) + r * u_twist * k + u_tilt.x * 0.85 + animDrift;
      float folded = mod(theta, sector);
      if (folded < 0.0) folded += sector;
      if (folded > sector * 0.5) folded = sector - folded;
      float sampleR = clamp(r * (1.0 - 0.12 * k * nz) + u_tilt.y * 0.08 * (1.0 - r), 0.0, 1.0);
      srcUv = vec2(cos(folded), sin(folded)) * sampleR;
    }
    rimShade = 0.84 + 0.16 * N.z;
    tintColor = vec3(0.35, 0.82, 0.98) * fresnel * 0.65;
  } else {
    // Poincare Hyperbolic Disk (conformal radial compression near rim)
    if (r > 1e-5) {
      float edgeLimit = ${LENS_LIMITS.poincareClampFactor.toFixed(2)};
      float denom = atanhApprox(edgeLimit);
      float hypR = atanhApprox(min(r * edgeLimit, 0.995)) / max(0.001, denom);
      float warpedR = mix(r, hypR, k);
      srcUv = p * (warpedR / r) + u_tilt * 0.10 * (1.0 - rSq);
    }
    rimShade = mix(1.0, 0.68 + 0.32 * N.z, k * 0.7);
    tintColor = vec3(0.65, 0.55, 0.98) * fresnel * 0.75;
  }

  vec2 texCoord = (srcUv * breatheScale) * 0.5 + 0.5;
  // WebGL texture vertical orientation flip
  texCoord.y = 1.0 - texCoord.y;

  float insideSource = step(0.0, texCoord.x) * step(texCoord.x, 1.0) * step(0.0, texCoord.y) * step(texCoord.y, 1.0);
  vec4 sampled = vec4(0.035, 0.051, 0.086, 1.0);

  if (insideSource > 0.5) {
    if (u_mode == 1 && k > 0.2) {
      // Micro optical dispersion near the rim in Refractive Glass mode
      float disp = 0.0032 * k * rSq;
      float rCh = texture(u_sourceTex, clamp(texCoord + vec2(disp, 0.0), 0.0, 1.0)).r;
      vec4 gCh = texture(u_sourceTex, texCoord);
      float bCh = texture(u_sourceTex, clamp(texCoord - vec2(disp, 0.0), 0.0, 1.0)).b;
      sampled = vec4(rCh, gCh.g, bCh, gCh.a);
    } else {
      sampled = texture(u_sourceTex, texCoord);
    }
  }

  // Smooth chromatic hue drift for strokes when hueShiftSpeed > 0 & time advancing
  float hueAngle = u_time * clamp(u_hueSpeed, 0.0, 1.0) * (u_mode == 3 ? 1.1 : 0.45);
  vec3 strokeRgb = hueAngle > 0.0001 ? clamp(shiftHue(sampled.rgb, hueAngle), 0.0, 1.0) : sampled.rgb;

  // Blend over dark meditative canvas background
  vec3 baseBg = vec3(0.0353, 0.0510, 0.0863);
  vec3 composite = mix(baseBg, strokeRgb, sampled.a);
  composite *= rimShade;
  composite = mix(composite, vec3(0.045, 0.065, 0.11), leadLine * (1.0 - sampled.a * 0.65));
  composite += tintColor + vec3(0.92, 0.97, 1.0) * spec;

  // Crisp subtle glass rim bevel
  float rimRing = smoothstep(0.965, 0.992, r) * (1.0 - smoothstep(0.992, 1.0, r));
  composite += vec3(0.32, 0.75, 0.95) * rimRing * (0.35 + 0.45 * u_fresnel);

  float discAlpha = 1.0 - smoothstep(0.992, 1.0, rSq);
  outColor = vec4(composite, max(discAlpha, u_bgOnlyAlpha));
}
`;

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const infoLog = gl.getShaderInfoLog(shader) ?? 'unknown shader error';
    reportDiagnostic({
      severity: DiagnosticSeverity.Error,
      source: DiagnosticSource.WebGL2,
      code: DomainErrorCode.WebGl2ShaderError,
      message: `WebGL2 shader compile error: ${infoLog}`,
      userNotice: MANDALA_MESSAGES.webgl.shaderCompileFailed,
    });
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

const LENS_PROFILE_MODE_INT: Readonly<Record<LensProfile, number>> = {
  [LensProfile.SphericalDome]: 0,
  [LensProfile.RefractiveGlass]: 1,
  [LensProfile.PoincareDisk]: 2,
  [LensProfile.StainedGlass]: 3,
  [LensProfile.Kaleidoscope]: 4,
};

function profileToModeInt(profile: LensProfile): number {
  return LENS_PROFILE_MODE_INT[profile] ?? 2;
}

export interface LensCompositorInstance {
  readonly maxTextureSize: number;
  uploadSourceCanvas(sourceCanvas: HTMLCanvasElement): void;
  render(config: LensConfig, bgAlpha?: number, timeSec?: number): void;
  resize(widthPx: number, heightPx: number): void;
  reclaimTextures(): number;
  dispose(): void;
}

const ACTIVE_COMPOSITORS = new Set<LensCompositorInstance>();

registerGpuTextureReclaimer(() => {
  let freedBytes = 0;
  for (const compositor of ACTIVE_COMPOSITORS) {
    freedBytes += compositor.reclaimTextures();
  }
  return freedBytes;
});

export function queryWebGL2MaxTextureSize(canvas?: HTMLCanvasElement): number {
  if (typeof document === 'undefined') return LENS_LIMITS.standardTexturePx;
  const target = canvas ?? document.createElement('canvas');
  const gl = target.getContext('webgl2');
  if (!gl) return LENS_LIMITS.fallbackTexturePx;
  const maxTex = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE));
  return Number.isFinite(maxTex) && maxTex > 0 ? maxTex : LENS_LIMITS.standardTexturePx;
}

export function createWebGL2LensCompositor(
  canvas: HTMLCanvasElement
): LensCompositorInstance | null {
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: true,
    powerPreference: 'high-performance',
  });
  if (!gl) return null;

  const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE);
  if (!vs || !fs) {
    if (vs) gl.deleteShader(vs);
    if (fs) gl.deleteShader(fs);
    return null;
  }

  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return null;
  }
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const linkLog = gl.getProgramInfoLog(program) ?? 'unknown link error';
    reportDiagnostic({
      severity: DiagnosticSeverity.Error,
      source: DiagnosticSource.WebGL2,
      code: DomainErrorCode.WebGl2ShaderError,
      message: `WebGL2 program link error: ${linkLog}`,
      userNotice: MANDALA_MESSAGES.webgl.programLinkFailed,
    });
    gl.deleteProgram(program);
    return null;
  }

  const quadBuffer = gl.createBuffer();
  if (!quadBuffer) {
    reportDiagnostic({
      severity: DiagnosticSeverity.Error,
      source: DiagnosticSource.WebGL2,
      code: DomainErrorCode.WebGl2ShaderError,
      message: MANDALA_MESSAGES.webgl.bufferAllocFailed,
      userNotice: MANDALA_MESSAGES.webgl.bufferAllocFailed,
    });
    gl.deleteProgram(program);
    return null;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW
  );

  const posLoc = gl.getAttribLocation(program, 'a_pos');
  const uSourceTex = gl.getUniformLocation(program, 'u_sourceTex');
  const uMode = gl.getUniformLocation(program, 'u_mode');
  const uCurvature = gl.getUniformLocation(program, 'u_curvature');
  const uIor = gl.getUniformLocation(program, 'u_ior');
  const uFresnel = gl.getUniformLocation(program, 'u_fresnel');
  const uTilt = gl.getUniformLocation(program, 'u_tilt');
  const uBgOnlyAlpha = gl.getUniformLocation(program, 'u_bgOnlyAlpha');
  const uTime = gl.getUniformLocation(program, 'u_time');
  const uBreathe = gl.getUniformLocation(program, 'u_breathe');
  const uHueSpeed = gl.getUniformLocation(program, 'u_hueSpeed');
  const uFolds = gl.getUniformLocation(program, 'u_folds');
  const uTwist = gl.getUniformLocation(program, 'u_twist');

  let texture: WebGLTexture | null = null;
  let allocatedTextureBytes = 0;
  let hasUploadedTexture = false;

  const maxTexRaw = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE));
  const maxTextureSize =
    Number.isFinite(maxTexRaw) && maxTexRaw > 0 ? maxTexRaw : LENS_LIMITS.standardTexturePx;

  const ensureTexture = (): WebGLTexture | null => {
    if (texture) return texture;
    texture = gl.createTexture();
    if (!texture) return null;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return texture;
  };

  const instance: LensCompositorInstance = {
    maxTextureSize,

    uploadSourceCanvas(sourceCanvas: HTMLCanvasElement) {
      const tex = ensureTexture();
      if (!tex || sourceCanvas.width <= 0 || sourceCanvas.height <= 0) return;

      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        sourceCanvas
      );
      gl.generateMipmap(gl.TEXTURE_2D);
      allocatedTextureBytes = estimateRgbaTextureBytes(
        Math.max(sourceCanvas.width, sourceCanvas.height)
      );
      hasUploadedTexture = true;
    },

    render(rawConfig: LensConfig, bgAlpha: number = 0, timeSec: number = 0) {
      if (!hasUploadedTexture || !texture) return;
      const cfg = normalizeLensConfig(rawConfig);

      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(uSourceTex, 0);
      gl.uniform1i(uMode, profileToModeInt(cfg.profile));
      gl.uniform1f(uCurvature, cfg.curvature);
      gl.uniform1f(uIor, cfg.refractiveIndex);
      gl.uniform1f(uFresnel, cfg.fresnelIntensity);
      gl.uniform2f(uTilt, cfg.tiltX, cfg.tiltY);
      gl.uniform1f(uBgOnlyAlpha, bgAlpha);
      gl.uniform1f(uTime, cfg.isAnimating ? timeSec : 0);
      gl.uniform1f(
        uBreathe,
        cfg.isAnimating ? cfg.breatheAmplitude ?? LENS_LIMITS.defaultBreathe : 0
      );
      gl.uniform1f(
        uHueSpeed,
        cfg.isAnimating ? cfg.hueShiftSpeed ?? LENS_LIMITS.defaultHueSpeed : 0
      );
      gl.uniform1f(uFolds, cfg.kaleidoscopeFolds ?? KALEIDOSCOPE_LIMITS.defaultFolds);
      gl.uniform1f(uTwist, cfg.kaleidoscopeTwist ?? KALEIDOSCOPE_LIMITS.defaultTwist);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },

    resize(widthPx: number, heightPx: number) {
      const safeW = Math.max(1, Math.round(widthPx));
      const safeH = Math.max(1, Math.round(heightPx));
      if (canvas.width !== safeW || canvas.height !== safeH) {
        canvas.width = safeW;
        canvas.height = safeH;
      }
      gl.viewport(0, 0, safeW, safeH);
    },

    reclaimTextures(): number {
      const freed = allocatedTextureBytes;
      if (texture) {
        gl.deleteTexture(texture);
        texture = null;
      }
      hasUploadedTexture = false;
      allocatedTextureBytes = 0;
      return freed;
    },

    dispose() {
      ACTIVE_COMPOSITORS.delete(instance);
      instance.reclaimTextures();
      if (quadBuffer) {
        gl.deleteBuffer(quadBuffer);
      }
      gl.deleteProgram(program);
    },
  };

  ACTIVE_COMPOSITORS.add(instance);
  return instance;
}

/**
 * Offscreen PNG export pass with the active WebGL2 Hemispherical Lens applied.
 */
export function renderLensCompositeToPNGDataUrl(
  sourceCanvas: HTMLCanvasElement,
  lensConfig: LensConfig,
  outputResolutionPx: number,
  includeBackground: boolean
): string | null {
  if (typeof document === 'undefined') return null;
  const outCanvas = document.createElement('canvas');
  const clampedOut = Math.min(4096, Math.max(256, Math.round(outputResolutionPx)));
  outCanvas.width = clampedOut;
  outCanvas.height = clampedOut;

  const compositor = createWebGL2LensCompositor(outCanvas);
  if (!compositor) {
    outCanvas.width = 0;
    outCanvas.height = 0;
    return null;
  }

  try {
    const safeDim = Math.max(256, Math.min(clampedOut, compositor.maxTextureSize));
    if (safeDim !== clampedOut) {
      compositor.resize(safeDim, safeDim);
    }
    compositor.uploadSourceCanvas(sourceCanvas);
    compositor.render(lensConfig, includeBackground ? 1.0 : 0.0);
    return outCanvas.toDataURL('image/png');
  } finally {
    compositor.dispose();
    outCanvas.width = 0;
    outCanvas.height = 0;
  }
}
