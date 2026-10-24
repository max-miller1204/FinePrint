import { Hono } from 'hono';
import { requireAuth, type AuthEnv, type VerifyIdToken } from '../auth.js';
import type { Store } from '../storage/firestore.js';
import { createRentals } from './rentals.js';

// Every /v1 route needs a Firebase ID token (spec §13). Auth runs before
// routing, so an unknown /v1 path without a token is 401, not 404.
export function createV1(verifyIdToken: VerifyIdToken, store: Store) {
  const v1 = new Hono<AuthEnv>();
  v1.use(requireAuth(verifyIdToken));

  // Who the token belongs to. The app calls it to confirm the server
  // accepts its token.
  v1.get('/me', (c) => {
    const { uid, provider } = c.get('user');
    return c.json({ uid, provider });
  });

  v1.route('/rentals', createRentals(store));

  return v1;
}
