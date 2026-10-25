import { z } from 'zod';
import { DAMAGE_CONFIDENCES, DAMAGE_SEVERITIES, DAMAGE_TYPES, MAX_PROPOSALS, QUALITY_ISSUES } from '../ai/schemas/damage.js';

// rentals/{rentalId}/evidence/{itemId} (spec §6.1). The device makes the
// capture record at the shutter (§8.1); the server keeps it and adds
// `receivedAtServer` once the stored object matches it (§8.2).

export const EvidenceSession = z.enum(['move_in', 'move_out', 'incident']);
export type EvidenceSession = z.infer<typeof EvidenceSession>;
export const EvidenceSource = z.enum(['in_app_camera', 'imported']);
// What the capture pipeline writes. GPS is removed on device, so these are
// the exact bytes that were hashed.
export const EvidenceMime = z.enum(['image/heic', 'image/jpeg']);
export type EvidenceMime = z.infer<typeof EvidenceMime>;

// Lowercase hex, as the device and the signed URL header both carry it.
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
// A 48 MP HEIC is about 10 MB; anything near the cap is not a photo.
export const MAX_EVIDENCE_BYTES = 50 * 1024 * 1024;
const Bytes = z.number().int().positive().max(MAX_EVIDENCE_BYTES);
const Label = z.string().trim().min(1).max(100);
// The device clock with its UTC offset, as the tenant saw it.
const DeviceTime = z.iso.datetime({ offset: true });

// A box on the displayed original, as fractions of its width and height, so
// it fits any rendering size. Never burned into the photo.
export const NormalizedBox = z
  .strictObject({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().gt(0).max(1),
    height: z.number().gt(0).max(1),
  })
  .refine((b) => b.x + b.width <= 1 + 1e-9 && b.y + b.height <= 1 + 1e-9, { message: 'box leaves the photo' });
export type NormalizedBox = z.infer<typeof NormalizedBox>;

// One thing Gemma thinks it sees (spec §7.5). `repairPath` marks mold-like
// growth and pest signs: the label never asserts a diagnosis, and the app
// points to the repair request path (Va. Code § 55.1-1220).
export const DamageProposal = z.object({
  id: z.string().regex(/^p[0-9]{1,2}$/),
  type: z.enum(DAMAGE_TYPES),
  label: z.string().min(1).max(100),
  description: z.string().max(400),
  severity: z.enum(DAMAGE_SEVERITIES),
  confidence: z.enum(DAMAGE_CONFIDENCES),
  // Null when the model gave no usable box; the tenant can draw one.
  box: NormalizedBox.nullable(),
  repairPath: z.boolean(),
});
export type DamageProposal = z.infer<typeof DamageProposal>;

// The stored AI result. Kept as the model gave it, beside the tenant's
// decisions, so both are on record (spec §4.3 F2).
export const DamageAnalysis = z.object({
  imageQuality: z.object({ ok: z.boolean(), issues: z.array(z.enum(QUALITY_ISSUES)) }),
  proposals: z.array(DamageProposal).max(MAX_PROPOSALS),
  model: z.string().min(1),
  fallback: z.boolean(),
  // ISO 8601. A string, not a Date: Firestore keeps nested values as written.
  at: z.iso.datetime(),
});
export type DamageAnalysis = z.infer<typeof DamageAnalysis>;

export const ANNOTATION_DECISIONS = ['confirmed', 'adjusted', 'rejected', 'added'] as const;
export const MAX_ANNOTATIONS = 20;

// The tenant's call on a proposal, or a box they drew themselves. Stored
// apart from the original, whose hash and manifests never change.
export const TenantAnnotation = z.strictObject({
  // The proposal this decides; null for one the tenant added.
  proposalId: z.string().regex(/^p[0-9]{1,2}$/).nullable(),
  decision: z.enum(ANNOTATION_DECISIONS),
  box: NormalizedBox,
  label: z.string().trim().min(1).max(100),
  description: z.string().trim().max(400).default(''),
  severity: z.enum(DAMAGE_SEVERITIES).nullable().default(null),
});
export type TenantAnnotation = z.infer<typeof TenantAnnotation>;

// PATCH /v1/rentals/:id/evidence/:itemId replaces the whole list, so the app
// sends every decision it holds.
export const AnnotateEvidenceInput = z.strictObject({
  annotations: z
    .array(TenantAnnotation)
    .max(MAX_ANNOTATIONS)
    .refine((list) => {
      const ids = list.flatMap((a) => (a.proposalId === null ? [] : [a.proposalId]));
      return new Set(ids).size === ids.length;
    }, { message: 'one decision per proposal' })
    .refine((list) => list.every((a) => (a.decision === 'added') === (a.proposalId === null)), {
      message: 'added annotations have no proposalId; the rest name one',
    }),
});
export type AnnotateEvidenceInput = z.infer<typeof AnnotateEvidenceInput>;

export const Evidence = z.object({
  // The device's UUID for the capture, lowercased.
  id: z.uuid(),
  session: EvidenceSession,
  room: Label,
  checklistItem: Label,
  sha256: Sha256,
  gcsPath: z.string().min(1),
  bytes: Bytes,
  mime: EvidenceMime,
  capturedAtDevice: DeviceTime,
  // Milliseconds since the device booted, at the shutter.
  deviceUptimeAtCapture: z.number().int().nonnegative(),
  source: EvidenceSource,
  appVersion: z.string().min(1).max(50),
  // Set once the stored object's size and SHA-256 matched the record.
  receivedAtServer: z.date().nullable(),
  // The first manifest that sealed this item.
  sealedManifestId: z.string().nullable(),
  // Set when the tenant deleted the photo (§8.3). The record stays, so the
  // report can say what was deleted and when; the bytes are gone.
  deletedAt: z.date().nullable().default(null),
  // Gemma's damage proposals (spec §7.5), once the app asked for them.
  aiProposal: DamageAnalysis.nullable().default(null),
  // The tenant's decisions on them. The report shows only these.
  tenantAnnotations: z.array(TenantAnnotation).default([]),
  annotatedAt: z.date().nullable().default(null),
  createdAt: z.date(),
});
export type Evidence = z.infer<typeof Evidence>;

// One capture record (§8.1) as the device sends it. `rentalId` is the
// device's own id for the rental, so the URL names the rental instead.
export const EvidenceItemInput = z.strictObject({
  itemId: z.uuid(),
  session: EvidenceSession.default('move_in'),
  room: Label,
  checklistItem: Label,
  sha256: Sha256,
  bytes: Bytes,
  mime: EvidenceMime,
  capturedAtDevice: DeviceTime,
  deviceUptimeMs: z.number().int().nonnegative(),
  source: EvidenceSource,
  appVersion: z.string().min(1).max(50),
});
export type EvidenceItemInput = z.infer<typeof EvidenceItemInput>;

// POST /v1/rentals/:id/evidence. A few at a time, so one request stays well
// inside the signing and transaction limits.
export const MAX_ITEMS_PER_REQUEST = 20;
export const CreateEvidenceInput = z.strictObject({
  items: z
    .array(EvidenceItemInput)
    .min(1)
    .max(MAX_ITEMS_PER_REQUEST)
    .refine((items) => new Set(items.map((item) => item.itemId.toLowerCase())).size === items.length, { message: 'duplicate itemId' }),
});
export type CreateEvidenceInput = z.infer<typeof CreateEvidenceInput>;

export function newEvidence(input: EvidenceItemInput, gcsPath: string, now: Date): Evidence {
  return {
    id: input.itemId.toLowerCase(),
    session: input.session,
    room: input.room,
    checklistItem: input.checklistItem,
    sha256: input.sha256,
    gcsPath,
    bytes: input.bytes,
    mime: input.mime,
    capturedAtDevice: input.capturedAtDevice,
    deviceUptimeAtCapture: input.deviceUptimeMs,
    source: input.source,
    appVersion: input.appVersion,
    receivedAtServer: null,
    sealedManifestId: null,
    deletedAt: null,
    aiProposal: null,
    tenantAnnotations: [],
    annotatedAt: null,
    createdAt: now,
  };
}

// A retry of the same capture, as opposed to a different photo reusing an id.
export function sameCapture(stored: Evidence, input: EvidenceItemInput): boolean {
  return stored.sha256 === input.sha256 && stored.bytes === input.bytes && stored.mime === input.mime;
}

export type EvidenceStatus = 'pending' | 'received' | 'sealed' | 'deleted';

export function evidenceStatus({ receivedAtServer, sealedManifestId, deletedAt }: Pick<Evidence, 'receivedAtServer' | 'sealedManifestId' | 'deletedAt'>): EvidenceStatus {
  if (deletedAt !== null) return 'deleted';
  if (sealedManifestId !== null) return 'sealed';
  return receivedAtServer === null ? 'pending' : 'received';
}

// What the API returns for an item. The bucket path stays on the server, and
// the damage review has its own shape (damageJson).
export function evidenceJson({
  id,
  gcsPath: _,
  deviceUptimeAtCapture,
  receivedAtServer,
  deletedAt,
  createdAt,
  aiProposal: _proposal,
  tenantAnnotations: _annotations,
  annotatedAt: _annotatedAt,
  ...rest
}: Evidence) {
  return {
    itemId: id,
    ...rest,
    deviceUptimeMs: deviceUptimeAtCapture,
    status: evidenceStatus({ receivedAtServer, sealedManifestId: rest.sealedManifestId, deletedAt }),
    receivedAtServer: receivedAtServer?.toISOString() ?? null,
    deletedAt: deletedAt?.toISOString() ?? null,
    createdAt: createdAt.toISOString(),
  };
}

// The damage review of one item: what Gemma proposed and what the tenant
// decided. `sha256` is the original's, unchanged by either.
export function damageJson(item: Evidence) {
  return {
    itemId: item.id,
    sha256: item.sha256,
    analysis: item.aiProposal,
    annotations: item.tenantAnnotations,
    annotatedAt: item.annotatedAt?.toISOString() ?? null,
  };
}
