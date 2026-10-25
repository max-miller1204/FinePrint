import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { AuthEnv } from '../auth.js';
import { ApiError } from '../errors.js';
import { newLedgerEntry } from '../integrity/ledger.js';
import type { Signer } from '../integrity/kms.js';
import type { Logger } from '../log.js';
import { CreateEvidenceInput, evidenceJson, evidenceStatus, newEvidence, sameCapture, type Evidence } from '../models/evidence.js';
import type { Rental } from '../models/rental.js';
import { modelCopyPath, originalPath, type EvidenceObjects } from '../storage/gcs.js';
import { isDocumentId, type Store } from '../storage/firestore.js';
import { guard, readBody } from './rentals.js';
import { available } from './seal.js';

// POST /v1/rentals/:id/evidence (spec §13) and its completion call (§8.2).
// The photo bytes never pass through the API (§5.3): the app PUTs them to
// the URL it gets here, then calls `complete`, and the server hashes what was
// stored before it records `receivedAtServer`.
export function createEvidence(store: Store, objects: EvidenceObjects, signer: Signer | null, now: () => Date = () => new Date()) {
  const evidence = new Hono<AuthEnv>();

  // Capture records only; the photos go straight to Cloud Storage. Mounted
  // next to the rentals routes, whose 16 KB limit covers these paths too.
  evidence.use(
    bodyLimit({
      maxSize: 16 * 1024,
      onError: () => {
        throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
      },
    }),
  );

  // Creates each item that is new and returns an upload target for every
  // item not yet received. Sending the same record again is how the app gets
  // a fresh URL after one expired, so it answers the same way.
  evidence.post('/:id/evidence', async (c) => {
    const rentalId = c.req.param('id');
    if (!isDocumentId(rentalId)) throw rentalNotFound();
    const { items } = await readBody(c, CreateEvidenceInput);
    await ownedRental(c, store, rentalId);

    const ids = items.map((item) => item.itemId.toLowerCase());
    const stored = await guard(store.getEvidence(rentalId, ids));
    const at = now();
    const created: Evidence[] = [];
    const all = items.map((input, i) => {
      const existing = stored[i];
      if (existing) {
        if (!sameCapture(existing, input)) throw new ApiError(409, 'CONFLICT', 'Another photo already has this itemId');
        return existing;
      }
      const item = newEvidence(input, originalPath(rentalId, input.itemId.toLowerCase()), at);
      created.push(item);
      return item;
    });
    if (created.length > 0) await guard(store.createEvidence(rentalId, created));

    const reply = await Promise.all(
      all.map(async (item) => ({
        ...evidenceJson(item),
        upload:
          evidenceStatus(item) === 'pending'
            ? await storageCall(c.get('log'), objects.uploadTarget(item.gcsPath, { contentType: item.mime, sha256: item.sha256, bytes: item.bytes }, at))
            : null,
      })),
    );
    c.get('log').info('evidence upload urls issued', { rentalId, items: all.length, created: created.length });
    return c.json({ items: reply }, created.length > 0 ? 201 : 200);
  });

  // The app uploaded the bytes. Size and SHA-256 must match the capture
  // record; otherwise the object is deleted and the item stays pending.
  // Calling it again after success changes nothing.
  evidence.post('/:id/evidence/:itemId/complete', async (c) => {
    const rentalId = c.req.param('id');
    const itemId = c.req.param('itemId').toLowerCase();
    if (!isDocumentId(rentalId)) throw rentalNotFound();
    await ownedRental(c, store, rentalId);
    const [item] = isDocumentId(itemId) ? await guard(store.getEvidence(rentalId, [itemId])) : [null];
    if (!item) throw new ApiError(404, 'NOT_FOUND', 'No such evidence item');
    if (item.deletedAt !== null) throw new ApiError(409, 'CONFLICT', 'This photo was deleted');
    if (item.receivedAtServer !== null) return c.json(evidenceJson(item));

    const log = c.get('log');
    const dependency = <T>(work: Promise<T>) => storageCall(log, work);
    const stat = await dependency(objects.stat(item.gcsPath));
    if (stat === null) throw new ApiError(409, 'CONFLICT', 'Upload the photo before completing it');
    const reject = async (reason: 'bytes' | 'contentType' | 'sha256') => {
      await dependency(objects.remove(item.gcsPath));
      log.warn('evidence rejected', { rentalId, itemId, reason });
      return new ApiError(422, 'HASH_MISMATCH', 'The uploaded photo does not match its capture record');
    };
    if (stat.bytes !== item.bytes) throw await reject('bytes');
    if (stat.contentType !== null && stat.contentType !== item.mime) throw await reject('contentType');
    if ((await dependency(objects.sha256(item.gcsPath))) !== item.sha256) throw await reject('sha256');

    const received = await guard(store.markEvidenceReceived(rentalId, itemId, now()));
    if (!received) throw new ApiError(404, 'NOT_FOUND', 'No such evidence item');
    log.info('evidence received', { rentalId, itemId, bytes: received.bytes });
    return c.json(evidenceJson(received));
  });

  // The tenant deletes a photo (spec §8.3): the bytes go, the record stays
  // with `deletedAt`, and the ledger gets `evidence_deleted`. A manifest that
  // sealed it still verifies, since it signed the hash. Deleting again
  // changes nothing. Mounted under the rental like `complete`, so ownership
  // is checked the same way.
  evidence.delete('/:id/evidence/:itemId', async (c) => {
    const rentalId = c.req.param('id');
    const itemId = c.req.param('itemId').toLowerCase();
    if (!isDocumentId(rentalId)) throw rentalNotFound();
    await ownedRental(c, store, rentalId);
    const [item] = isDocumentId(itemId) ? await guard(store.getEvidence(rentalId, [itemId])) : [null];
    if (!item) throw new ApiError(404, 'NOT_FOUND', 'No such evidence item');
    if (item.deletedAt !== null) return c.json(evidenceJson(item));

    const log = c.get('log');
    const sign = available(signer, log);
    // Bytes first: if the ledger write fails, a retry finds the record
    // undeleted and finishes the job.
    await storageCall(log, Promise.all([objects.remove(item.gcsPath), objects.remove(modelCopyPath(rentalId, itemId))]));
    const at = now();
    await guard(
      store.appendLedger(rentalId, async (head) => ({
        entry: await newLedgerEntry(sign, head, 'evidence_deleted', { itemId, sha256: item.sha256 }, at),
        items: [{ itemId, fields: { deletedAt: at } }],
      })),
    );
    log.info('evidence deleted', { rentalId, itemId });
    return c.json(evidenceJson({ ...item, deletedAt: at }));
  });

  return evidence;
}

export const rentalNotFound = () => new ApiError(404, 'NOT_FOUND', 'No such rental');

export async function ownedRental(c: Context<AuthEnv>, store: Store, rentalId: string): Promise<Rental> {
  const rental = await guard(store.getRental(rentalId));
  if (rental === null) throw rentalNotFound();
  if (rental.ownerUid !== c.get('user').uid) {
    c.get('log').info('evidence forbidden', { rentalId });
    throw new ApiError(403, 'FORBIDDEN', 'This rental belongs to another user');
  }
  return rental;
}

// A Cloud Storage failure is a 503 the app retries, like Firestore. Only
// the error class is logged: messages can name object paths.
async function storageCall<T>(log: Logger, work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    log.error('storage call failed', { errorName: (err as Error | null)?.name ?? 'unknown' });
    throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Storage is unavailable');
  }
}
