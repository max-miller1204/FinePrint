import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { guard, readBody } from './rentals.js';
import { Hono } from 'hono';
import type { Accounts } from '../accounts.js';
import type { AuthEnv } from '../auth.js';
import { ApiError } from '../errors.js';
import { deleteEverything, type Receipt } from '../purge.js';
import type { Store } from '../storage/firestore.js';
import type { EvidenceObjects } from '../storage/gcs.js';

// DELETE /v1/me: "Delete everything" (spec §9.2, §13). Removes the caller's
// Firestore documents, Cloud Storage objects, share links, and Firebase
// user, and answers with the receipt the app shows.
export function createMe(store: Store, objects: EvidenceObjects, accounts: Accounts, now: () => Date = () => new Date()) {
  const me = new Hono<AuthEnv>();

  me.patch('/impact', bodyLimit({ maxSize: 1024, onError: () => { throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large'); } }), async (c) => {
    const { impactOptIn } = await readBody(c, z.strictObject({ impactOptIn: z.boolean() }));
    await guard(store.setImpactOptIn(c.get('user'), impactOptIn));
    c.header('Cache-Control', 'no-store');
    return c.json({ impactOptIn });
  });

  me.delete('/', async (c) => {
    const { uid } = c.get('user');
    const log = c.get('log');
    let receipt: Receipt;
    try {
      receipt = await deleteEverything(store, objects, uid, now());
      await accounts.deleteUser(uid);
    } catch (err) {
      // Only the class: messages can name object paths. Nothing is lost by
      // retrying: the Firebase user goes last, so the token still works.
      log.error('delete everything failed', { errorName: (err as Error | null)?.name ?? 'unknown' });
      throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Storage is unavailable');
    }
    log.info('deleted everything', { rentals: receipt.rentals, evidenceItems: receipt.evidenceItems });
    return c.json(receipt);
  });

  return me;
}
