import { z } from 'zod';

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

// What the API returns for an item. The bucket path stays on the server.
export function evidenceJson({ id, gcsPath: _, deviceUptimeAtCapture, receivedAtServer, deletedAt, createdAt, ...rest }: Evidence) {
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
