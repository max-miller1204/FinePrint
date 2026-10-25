import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { AuthEnv } from '../auth.js';
import { ApiError } from '../errors.js';
import type { Signer } from '../integrity/kms.js';
import { isDocumentId, type Store } from '../storage/firestore.js';
import { capability, hashPin, tokenHash } from '../shares/security.js';
import { shareJson, type Share, type Shares } from '../shares/store.js';
import { readBody } from './rentals.js';
const Input = z.strictObject({
  expiresAt: z.iso.datetime().optional(),
  pin: z.string().regex(/^[0-9]{6,12}$/).optional(),
  scope: z.array(z.enum(['lease', 'evidence'])).min(1).max(2).default(['lease', 'evidence']),
});
export function createShares(store: Store, shares: Shares, signer: Signer | null) {
  const route = new Hono<AuthEnv>();
  route.use('/rentals/:id/shares', async (c, next) => { c.header('Cache-Control', 'private, no-store'); await next(); });
  route.use('/shares/*', async (c, next) => { c.header('Cache-Control', 'private, no-store'); await next(); });
  route.use('/rentals/:id/shares', bodyLimit({ maxSize: 4096, onError: () => { throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large'); } }));
  const ownedRental = async (id: string, uid: string) => {
    const rental = isDocumentId(id) ? await store.getRental(id) : null;
    if (!rental || rental.ownerUid !== uid) throw new ApiError(404, 'NOT_FOUND', 'No such rental');
  };
  const ownedShare = async (id: string, uid: string) => {
    const share = /^[a-f0-9]{64}$/.test(id) ? await shares.get(id) : null;
    if (!share) throw new ApiError(404, 'NOT_FOUND', 'No such share');
    await ownedRental(share.rentalId, uid);
    return share;
  };
  route.post('/rentals/:id/shares', async c => {
    const rentalId = c.req.param('id');
    await ownedRental(rentalId, c.get('user').uid);
    const input = await readBody(c, Input);
    const now = Date.now();
    const expires = input.expiresAt ? Date.parse(input.expiresAt) : now + 30 * 86400_000;
    if (expires <= now || expires > now + 30 * 86400_000) throw new ApiError(400, 'BAD_REQUEST', 'Expiry must be within the next 30 days');
    if (!signer) throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Signing is unavailable');
    const token = capability();
    const share: Share = { id: tokenHash(token), rentalId, scope: [...new Set(input.scope)], createdAt: new Date(now).toISOString(), expiresAt: new Date(expires).toISOString(), revokedAt: null, pinHash: input.pin ? await hashPin(input.pin) : null };
    await shares.change(share, c.get('user').uid, signer, false);
    return c.json({ ...shareJson(share), path: `/r/${token}` }, 201);
  });
  route.get('/rentals/:id/shares', async c => {
    await ownedRental(c.req.param('id'), c.get('user').uid);
    return c.json({ shares: (await shares.list(c.req.param('id'))).map(shareJson) });
  });
  route.delete('/shares/:id', async c => {
    const share = await ownedShare(c.req.param('id'), c.get('user').uid);
    if (!signer) throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Signing is unavailable');
    await shares.change(share, c.get('user').uid, signer, true);
    return c.json({ status: 'revoked' });
  });
  route.get('/shares/:id/access', async c => {
    const share = await ownedShare(c.req.param('id'), c.get('user').uid);
    const before = c.req.query('before');
    const [at, cursorId, extra] = before?.split('~') ?? [];
    if (before && (!at || !cursorId || extra || !isDocumentId(cursorId) || !z.iso.datetime().safeParse(at).success)) throw new ApiError(400, 'BAD_REQUEST', 'Invalid cursor');
    return c.json(await shares.access(share.id, at && cursorId ? { at, id: cursorId } : undefined));
  });
  return route;
}
