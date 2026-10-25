import { z } from 'zod';
import { canonicalBytes, canonicalize, sha256Hex } from './jcs.js';
import { verifySignature, type PublicJwk, type Signer } from './kms.js';

// rentals/{rentalId}/ledger/{seq} (spec §6.1, §8.2). Each entry names the
// hash of the one before it and is signed, so removing or reordering
// entries breaks the chain.

export const LedgerType = z.enum(['manifest_sealed', 'evidence_deleted', 'share_created', 'share_revoked']);
export type LedgerType = z.infer<typeof LedgerType>;

// The hash the first entry points back to.
export const GENESIS_HASH = '0'.repeat(64);

const Hex64 = z.string().regex(/^[0-9a-f]{64}$/);

export const LedgerEntry = z.object({
  // 1, 2, 3, ... with no gaps.
  seq: z.number().int().positive(),
  type: LedgerType,
  // Ids and hashes only, never user text.
  payload: z.record(z.string(), z.union([z.string(), z.number()])),
  payloadHash: Hex64,
  prevEntryHash: Hex64,
  // SHA-256 of the JCS form of `signedPart(entry)`, which is what is signed.
  entryHash: Hex64,
  signatureB64: z.string().min(1),
  keyId: z.string().min(1),
  kmsKeyVersion: z.string().min(1),
  at: z.iso.datetime(),
});
export type LedgerEntry = z.infer<typeof LedgerEntry>;

export type LedgerHead = Pick<LedgerEntry, 'seq' | 'entryHash'>;

const signedPart = ({ seq, type, payloadHash, prevEntryHash, at }: Pick<LedgerEntry, 'seq' | 'type' | 'payloadHash' | 'prevEntryHash' | 'at'>) => ({
  seq,
  type,
  payloadHash,
  prevEntryHash,
  at,
});

export async function newLedgerEntry(
  signer: Signer,
  head: LedgerHead | null,
  type: LedgerType,
  payload: LedgerEntry['payload'],
  at: Date,
): Promise<LedgerEntry> {
  const unsigned = { seq: (head?.seq ?? 0) + 1, type, payloadHash: sha256Hex(canonicalize(payload)), prevEntryHash: head?.entryHash ?? GENESIS_HASH, at: at.toISOString() };
  const bytes = canonicalBytes(signedPart(unsigned));
  const signature = await signer.sign(bytes);
  return { ...unsigned, payload, entryHash: sha256Hex(bytes), ...signature };
}

export type LedgerCheck = { ok: true } | { ok: false; seq: number; reason: 'sequence' | 'chain' | 'payload' | 'hash' | 'key' | 'signature' };

// What a third party runs: entries in stored order against the published
// keys. The first problem found is reported.
export function verifyLedger(entries: LedgerEntry[], keys: PublicJwk[]): LedgerCheck {
  let prev = GENESIS_HASH;
  for (const [i, entry] of entries.entries()) {
    const fail = (reason: Exclude<LedgerCheck, { ok: true }>['reason']): LedgerCheck => ({ ok: false, seq: entry.seq, reason });
    if (entry.seq !== i + 1) return fail('sequence');
    if (entry.prevEntryHash !== prev) return fail('chain');
    if (sha256Hex(canonicalize(entry.payload)) !== entry.payloadHash) return fail('payload');
    const bytes = canonicalBytes(signedPart(entry));
    if (sha256Hex(bytes) !== entry.entryHash) return fail('hash');
    const key = keys.find((k) => k.kid === entry.keyId);
    if (!key) return fail('key');
    if (!verifySignature(key, bytes, entry.signatureB64)) return fail('signature');
    prev = entry.entryHash;
  }
  return { ok: true };
}
