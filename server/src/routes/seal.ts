import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthEnv } from '../auth.js';
import { ApiError } from '../errors.js';
import { newLedgerEntry } from '../integrity/ledger.js';
import type { Signer } from '../integrity/kms.js';
import { manifestJson, sealManifest } from '../integrity/manifest.js';
import type { Logger } from '../log.js';
import { EvidenceSession, evidenceStatus } from '../models/evidence.js';
import { isDocumentId, type Store } from '../storage/firestore.js';
import { ownedRental, rentalNotFound } from './evidence.js';
import { guard, readBody } from './rentals.js';

const SealInput = z.strictObject({ session: EvidenceSession.default('move_in') });

// POST /v1/rentals/:id/seal (spec §8.2, §13), and the reads a verifier
// needs: the ledger and one manifest. Mounted next to the rentals routes,
// whose 16 KB body limit covers these paths too.
export function createSeal(store: Store, signer: Signer | null, now: () => Date = () => new Date()) {
  const seal = new Hono<AuthEnv>();

  // Signs every received photo of the session that is not deleted, then
  // appends `manifest_sealed`. Sealing again later signs a new manifest with
  // whatever has arrived since; an item keeps the first manifest that
  // sealed it. Photos still uploading are left out and counted.
  seal.post('/:id/seal', async (c) => {
    const rentalId = c.req.param('id');
    if (!isDocumentId(rentalId)) throw rentalNotFound();
    const { session } = await readBody(c, SealInput);
    await ownedRental(c, store, rentalId);
    const sign = available(signer, c.get('log'));

    const all = (await guard(store.listEvidence(rentalId, session))).filter((item) => item.deletedAt === null);
    const items = all.filter((item) => item.receivedAtServer !== null);
    const pending = all.length - items.length;
    if (items.length === 0) throw new ApiError(409, 'CONFLICT', 'No received photos to seal');

    const id = randomUUID();
    const at = now();
    const { entry, manifest } = await guard(
      store.appendLedger(rentalId, async (head) => {
        const manifest = await sealManifest(sign, { id, rentalId, kind: session, items, head, at });
        const entry = await newLedgerEntry(sign, head, 'manifest_sealed', { manifestId: id, kind: session, sha256: manifest.sha256, items: items.length }, at);
        const unsealed = items.filter((item) => evidenceStatus(item) === 'received');
        return { entry, manifest, items: unsealed.map((item) => ({ itemId: item.id, fields: { sealedManifestId: id } })) };
      }),
    );
    c.get('log').info('manifest sealed', { rentalId, manifestId: id, items: items.length, pending, seq: entry.seq });
    return c.json({ manifest: manifestJson(manifest!), ledgerEntry: entry, pending }, 201);
  });

  seal.get('/:id/ledger', async (c) => {
    const rentalId = c.req.param('id');
    if (!isDocumentId(rentalId)) throw rentalNotFound();
    await ownedRental(c, store, rentalId);
    return c.json({ entries: await guard(store.listLedger(rentalId)) });
  });

  seal.get('/:id/manifests/:manifestId', async (c) => {
    const rentalId = c.req.param('id');
    const manifestId = c.req.param('manifestId').toLowerCase();
    if (!isDocumentId(rentalId)) throw rentalNotFound();
    await ownedRental(c, store, rentalId);
    const manifest = isDocumentId(manifestId) ? await guard(store.getManifest(rentalId, manifestId)) : null;
    if (!manifest) throw new ApiError(404, 'NOT_FOUND', 'No such manifest');
    return c.json(manifestJson(manifest));
  });

  return seal;
}

// A signer whose failures are a 503 the app retries. Only the error class
// is logged: KMS messages name the key.
export function available(signer: Signer | null, log: Logger): Signer {
  if (!signer) throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Signing is not set up on this server');
  const call = async <T>(work: () => Promise<T>) => {
    try {
      return await work();
    } catch (err) {
      log.error('signing failed', { errorName: (err as Error | null)?.name ?? 'unknown' });
      throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Signing is unavailable');
    }
  };
  return { sign: (data) => call(() => signer.sign(data)), publicKeys: () => call(() => signer.publicKeys()) };
}
