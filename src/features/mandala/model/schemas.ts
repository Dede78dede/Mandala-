/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Runtime Boundary Validation with Zod (MANDALA-PH6 §2.3 & §5.1).
 * No `as SomeType` assertions on persisted/imported boundaries.
 */

import { z } from 'zod';

// Ensure Strict CSP (`script-src 'self' 'wasm-unsafe-eval'`) never triggers `new Function()` JIT eval attempts
z.config({ jitless: true });

import { Result, ok, err } from '../../../shared/lib/result.ts';
import {
  CAMERA_LIMITS,
  LOGICAL_CENTER,
  MANDALA_LIMITS,
  WORLD_SPACE_LIMITS,
} from './constants.ts';
import {
  AndroidUpdateState,
  CoordinateSpaceOrigin,
  DistributionFlavor,
  LSystemPresetId,
  MirrorMode,
  ReleaseChannel,
  SymmetryStrategyKind,
  WorkerMsgType,
  type AndroidBridgeStatusSnapshot,
  type MandalaDocument,
  type MandalaDocumentV1,
  type MandalaDocumentV2,
  type Point,
  type ReleaseManifest,
  type WedgeStroke,
} from './types.ts';

let cachedDocumentSchema: z.ZodType<MandalaDocument> | null = null;
let cachedColdBatchSchema: z.ZodType<{
  batchId: string;
  wedges: WedgeStroke[];
  savedAt: string;
}> | null = null;

function buildPointAndWedgeSchemas() {
  const PointSchema = z.object({
    x: z.number().finite(),
    y: z.number().finite(),
    pressure: z.number().min(0).max(2).optional(),
  });

  const WedgeStrokeSchema = z.object({
    id: z.string().min(1),
    points: z.array(PointSchema),
    stroke: z.string().regex(/^#[0-9A-Fa-f]{3,8}$/, 'Colore esadecimale non valido'),
    strokeWidth: z.number().min(0.5).max(MANDALA_LIMITS.schemaMaxStrokeWidth),
    dash: z.array(z.number().positive()).nullable(),
    opacity: z.number().min(0).max(1),
  });

  return { PointSchema, WedgeStrokeSchema };
}

function getMandalaDocumentSchema(): z.ZodType<MandalaDocument> {
  if (cachedDocumentSchema) return cachedDocumentSchema;

  const { WedgeStrokeSchema } = buildPointAndWedgeSchemas();

  const SymmetryParamsSchema = z.discriminatedUnion('strategyId', [
    z.object({
      strategyId: z.literal(SymmetryStrategyKind.Radial),
      order: z.number().int().min(MANDALA_LIMITS.minOrder).max(MANDALA_LIMITS.maxOrder),
    }),
    z.object({
      strategyId: z.literal(SymmetryStrategyKind.MirrorRadial),
      order: z.number().int().min(MANDALA_LIMITS.minOrder).max(MANDALA_LIMITS.maxOrder),
      mirrorMode: z.enum(MirrorMode),
    }),
    z.object({
      strategyId: z.literal(SymmetryStrategyKind.Fractal),
      preset: z.enum(LSystemPresetId),
      order: z.number().int().min(MANDALA_LIMITS.minOrder).max(MANDALA_LIMITS.maxOrder),
      generations: z.number().int().min(1).max(MANDALA_LIMITS.lSystemCapGenerations),
      angle: z.number().min(1).max(360),
      stepLength: z.number().min(1).max(100),
    }),
  ]);

  const CameraTransformSchema = z.object({
    zoom: z.number().min(CAMERA_LIMITS.minZoom).max(CAMERA_LIMITS.maxZoom),
    panX: z.number().finite(),
    panY: z.number().finite(),
  });

  const MandalaDocumentV1Schema = z.object({
    schemaVersion: z.literal(1),
    title: z.string().min(1).max(120),
    symmetryParams: SymmetryParamsSchema,
    wedges: z.array(WedgeStrokeSchema),
    paletteId: z.string().min(1),
    activeColour: z.string().regex(/^#[0-9A-Fa-f]{3,8}$/),
    activeStrokeWidth: z.number().min(0.5).max(MANDALA_LIMITS.schemaDocMaxStrokeWidth),
    activeDash: z.array(z.number().positive()).nullable(),
    createdAt: z.string().min(1),
  });

  const MandalaDocumentV2Schema = z.object({
    schemaVersion: z.literal(2),
    title: z.string().min(1).max(120),
    coordinateOrigin: z.enum(CoordinateSpaceOrigin),
    worldRadius: z.number().min(WORLD_SPACE_LIMITS.baseRadius).max(4000),
    camera: CameraTransformSchema.optional(),
    symmetryParams: SymmetryParamsSchema,
    wedges: z.array(WedgeStrokeSchema),
    paletteId: z.string().min(1),
    activeColour: z.string().regex(/^#[0-9A-Fa-f]{3,8}$/),
    activeStrokeWidth: z.number().min(0.5).max(MANDALA_LIMITS.schemaDocMaxStrokeWidth),
    activeDash: z.array(z.number().positive()).nullable(),
    createdAt: z.string().min(1),
  });

  cachedDocumentSchema = z.discriminatedUnion('schemaVersion', [
    MandalaDocumentV1Schema,
    MandalaDocumentV2Schema,
  ]);
  return cachedDocumentSchema;
}

function getColdSwapBatchSchema() {
  if (cachedColdBatchSchema) return cachedColdBatchSchema;
  const { WedgeStrokeSchema } = buildPointAndWedgeSchemas();
  cachedColdBatchSchema = z.object({
    batchId: z.string().min(1),
    wedges: z.array(WedgeStrokeSchema),
    savedAt: z.string().default(''),
  });
  return cachedColdBatchSchema;
}

const Float64ArraySchema = z.custom<Float64Array>(
  (val) => val instanceof Float64Array,
  { message: 'Buffer Float64Array richiesto' }
);

const WorkerInboundMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal(WorkerMsgType.Init),
    wasmUrl: z.string().min(1),
  }),
  z.object({
    type: z.literal(WorkerMsgType.Expand),
    jobId: z.number().int().positive(),
    points: Float64ArraySchema,
    order: z.number().int().min(MANDALA_LIMITS.minOrder).max(MANDALA_LIMITS.maxOrder),
    strategyId: z.union([
      z.literal(SymmetryStrategyKind.Radial),
      z.literal(SymmetryStrategyKind.MirrorRadial),
    ]),
    mirrorMode: z.enum(MirrorMode),
    cx: z.number().finite(),
    cy: z.number().finite(),
  }),
  z.object({
    type: z.literal(WorkerMsgType.ExpandLSystem),
    jobId: z.number().int().positive(),
    axiom: z.string().min(1),
    rules: z.record(z.string(), z.string()),
    generations: z.number().int().min(1).max(MANDALA_LIMITS.lSystemCapGenerations),
    stepLength: z.number().positive().finite(),
    angleDegrees: z.number().finite(),
    order: z.number().int().min(1).max(MANDALA_LIMITS.maxOrder),
    cx: z.number().finite(),
    cy: z.number().finite(),
    baseOnly: z.boolean().optional(),
  }),
  z.object({
    type: z.literal(WorkerMsgType.InjectPanic),
    jobId: z.number().int().positive(),
  }),
]);

export type ValidatedWorkerInboundMessage = z.infer<typeof WorkerInboundMessageSchema>;

export function parseWorkerInboundMessage(
  raw: unknown
): Result<ValidatedWorkerInboundMessage, string> {
  const parsed = WorkerInboundMessageSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return err(`Messaggio worker non valido: ${issue?.message ?? 'schema mismatch'}`);
  }
  return ok(parsed.data);
}

export function parseColdSwapBatch(
  raw: unknown
): Result<{ batchId: string; wedges: WedgeStroke[]; savedAt: string }, string> {
  const parsed = getColdSwapBatchSchema().safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return err(`Batch cold-swap non valido: ${issue?.message ?? 'schema mismatch'}`);
  }
  return ok(parsed.data);
}

function translatePoint(pt: Point, dx: number, dy: number): Point {
  return {
    x: pt.x + dx,
    y: pt.y + dy,
    ...(pt.pressure !== undefined ? { pressure: pt.pressure } : {}),
  };
}

function translateWedges(wedges: readonly WedgeStroke[], dx: number, dy: number): WedgeStroke[] {
  return wedges.map((w) => ({
    ...w,
    points: w.points.map((p) => translatePoint(p, dx, dy)),
  }));
}

/**
 * Lossless pure migration from v1 ([0,800] around 400,400) to v2 (origin-centered world space).
 */
export function migrateDocumentV1ToV2(doc: MandalaDocumentV1): MandalaDocumentV2 {
  return {
    schemaVersion: 2,
    title: doc.title,
    coordinateOrigin: CoordinateSpaceOrigin.CenteredZero,
    worldRadius: WORLD_SPACE_LIMITS.extendedRadius,
    camera: { zoom: CAMERA_LIMITS.defaultZoom, panX: 0, panY: 0 },
    symmetryParams: doc.symmetryParams,
    wedges: translateWedges(doc.wedges, -LOGICAL_CENTER.x, -LOGICAL_CENTER.y),
    paletteId: doc.paletteId,
    activeColour: doc.activeColour,
    activeStrokeWidth: doc.activeStrokeWidth,
    activeDash: doc.activeDash,
    createdAt: doc.createdAt,
  };
}

/**
 * Normalizes any loaded MandalaDocument (v1 or v2) to active logical-800 pivot coordinates
 * for lossless store hydration across all existing symmetry/SVG modules.
 */
export function resolveDocumentToActiveWedges(doc: MandalaDocument): {
  wedges: WedgeStroke[];
  worldRadius: number;
  camera: { zoom: number; panX: number; panY: number };
} {
  if (doc.schemaVersion === 1) {
    return {
      wedges: doc.wedges,
      worldRadius: WORLD_SPACE_LIMITS.extendedRadius,
      camera: { zoom: CAMERA_LIMITS.defaultZoom, panX: 0, panY: 0 },
    };
  }

  const normalizedWedges =
    doc.coordinateOrigin === CoordinateSpaceOrigin.CenteredZero
      ? translateWedges(doc.wedges, LOGICAL_CENTER.x, LOGICAL_CENTER.y)
      : doc.wedges;

  return {
    wedges: normalizedWedges,
    worldRadius: doc.worldRadius,
    camera: doc.camera ?? { zoom: CAMERA_LIMITS.defaultZoom, panX: 0, panY: 0 },
  };
}

export function parseMandalaDocument(raw: unknown): Result<MandalaDocument, string> {
  const parsed = getMandalaDocumentSchema().safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path?.join('.') || 'root';
    return err(`Documento non valido (${path}): ${issue?.message ?? 'schema mismatch'}`);
  }
  return ok(parsed.data);
}

export function parseMandalaDocumentJSON(jsonText: string): Result<MandalaDocument, string> {
  try {
    const parsedJson: unknown = JSON.parse(jsonText);
    return parseMandalaDocument(parsedJson);
  } catch (e) {
    return err(e instanceof Error ? `JSON malformato: ${e.message}` : 'Errore di parsing JSON');
  }
}

const ReleaseManifestSchema = z.object({
  schemaVersion: z.literal(1),
  versionName: z.string().min(1),
  versionCode: z.number().int().positive(),
  channel: z.enum(ReleaseChannel),
  flavor: z.enum(DistributionFlavor),
  androidPackageId: z.string().min(3),
  twaPackageId: z.string().min(3),
  minSdk: z.number().int().min(21).max(60),
  targetSdk: z.number().int().min(28).max(60),
  apkAvailable: z.boolean(),
  apkDownloadUrl: z.string().min(1),
  releasePageUrl: z.string().min(1),
  sha256: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/)
    .nullable(),
  apkSizeBytes: z.number().int().positive().nullable(),
  generatedAt: z.string().min(1),
});

const AndroidBridgeStatusSchema = z.object({
  hostVersionName: z.string().min(1),
  hostVersionCode: z.number().int().positive(),
  flavor: z.enum(DistributionFlavor),
  supportsNativeStylus: z.boolean(),
  supportsSelfUpdate: z.boolean(),
  supportsNativeExport: z.boolean(),
  updateState: z.enum(AndroidUpdateState),
  availableVersionName: z.string().min(1).nullable(),
  availableVersionCode: z.number().int().positive().nullable(),
  errorMessage: z.string().nullable(),
});

export function parseReleaseManifest(raw: unknown): Result<ReleaseManifest, string> {
  const parsed = ReleaseManifestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return err(`Manifest release non valido: ${issue?.message ?? 'schema mismatch'}`);
  }
  return ok(parsed.data);
}

export function parseAndroidBridgeStatus(
  raw: unknown
): Result<AndroidBridgeStatusSnapshot, string> {
  const parsed = AndroidBridgeStatusSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return err(`Stato bridge Android non valido: ${issue?.message ?? 'schema mismatch'}`);
  }
  return ok(parsed.data);
}

