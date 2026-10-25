import { z } from 'zod';
import { EvidenceSession, type Evidence } from '../models/evidence.js';
import { canonicalize, sha256Hex } from './jcs.js';
import { verifySignature, type PublicJwk, type Signer } from './kms.js';
import type { LedgerHead } from './ledger.js';

// rentals/{rentalId}/manifests/{manifestId} (spec §6.1, §8.2). The manifest
// signs each photo's hash, not its bytes, so deleting a photo later (§8.3)
// leaves it verifiable.

export const Manifest = z.object({
  id: z.uuid(),
  kind: EvidenceSession,
  // RFC 8785 JCS of the body below; these are the signed bytes.
  canonicalJson: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  signatureB64: z.string().min(1),
  keyId: z.string().min(1),
  kmsKeyVersion: z.string().min(1),
  itemIds: z.array(z.string()),
  sealedAt: z.date(),
});
export type Manifest = z.infer<typeof Manifest>;

// One sealed capture record: §8.1 plus the server's receipt time.
function itemRecord(item: Evidence) {
  return {
    itemId: item.id,
    session: item.session,
    room: item.room,
    checklistItem: item.checklistItem,
    sha256: item.sha256,
    bytes: item.bytes,
    mime: item.mime,
    capturedAtDevice: item.capturedAtDevice,
    deviceUptimeMs: item.deviceUptimeAtCapture,
    source: item.source,
    appVersion: item.appVersion,
    receivedAtServer: item.receivedAtServer?.toISOString() ?? null,
  };
}

// Items in capture order, so the manifest reads like the walkthrough.
export async function sealManifest(
  signer: Signer,
  { id, rentalId, kind, items, head, at }: { id: string; rentalId: string; kind: Manifest['kind']; items: Evidence[]; head: LedgerHead | null; at: Date },
): Promise<Manifest> {
  const ordered = [...items].sort(
    (a, b) => Date.parse(a.capturedAtDevice) - Date.parse(b.capturedAtDevice) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const canonicalJson = canonicalize({
    version: 1,
    manifestId: id,
    rentalId,
    kind,
    sealedAt: at.toISOString(),
    // Ties this manifest to the ledger as it stood, so a later truncation
    // of the ledger shows.
    prevLedgerHead: head ? { seq: head.seq, entryHash: head.entryHash } : null,
    items: ordered.map(itemRecord),
  });
  const bytes = Buffer.from(canonicalJson, 'utf8');
  const signature = await signer.sign(bytes);
  return { id, kind, canonicalJson, sha256: sha256Hex(bytes), ...signature, itemIds: ordered.map((item) => item.id), sealedAt: at };
}

export type ManifestCheck = { ok: true } | { ok: false; reason: 'canonical' | 'hash' | 'key' | 'signature' };

export function verifyManifest(manifest: Pick<Manifest, 'canonicalJson' | 'sha256' | 'signatureB64' | 'keyId'>, keys: PublicJwk[]): ManifestCheck {
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifest.canonicalJson);
  } catch {
    return { ok: false, reason: 'canonical' };
  }
  if (canonicalize(parsed) !== manifest.canonicalJson) return { ok: false, reason: 'canonical' };
  const bytes = Buffer.from(manifest.canonicalJson, 'utf8');
  if (sha256Hex(bytes) !== manifest.sha256) return { ok: false, reason: 'hash' };
  const key = keys.find((k) => k.kid === manifest.keyId);
  if (!key) return { ok: false, reason: 'key' };
  return verifySignature(key, bytes, manifest.signatureB64) ? { ok: true } : { ok: false, reason: 'signature' };
}

export function manifestJson({ id, sealedAt, ...rest }: Manifest) {
  return { manifestId: id, ...rest, sealedAt: sealedAt.toISOString() };
}
