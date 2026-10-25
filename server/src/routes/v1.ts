import { Hono } from 'hono';
import { requireAuth, type AuthEnv, type VerifyIdToken } from '../auth.js';
import type { Signer } from '../integrity/kms.js';
import type { Store } from '../storage/firestore.js';
import type { EvidenceObjects } from '../storage/gcs.js';
import type { Accounts } from '../accounts.js';
import { createEvidence } from './evidence.js';
import { createIssues, type IssueDeps } from './issues.js';
import { createMe } from './me.js';
import { createRentals } from './rentals.js';
import { createSeal } from './seal.js';
import { createTriageRoute } from './triage.js';

// Every /v1 route needs a Firebase ID token (spec §13). Auth runs before
// routing, so an unknown /v1 path without a token is 401, not 404.
export function createV1(verifyIdToken: VerifyIdToken, store: Store, objects: EvidenceObjects, signer: Signer | null, ai: IssueDeps, accounts: Accounts) {
  const v1 = new Hono<AuthEnv>();
  v1.use(requireAuth(verifyIdToken));

  // Who the token belongs to. The app calls it to confirm the server
  // accepts its token.
  v1.get('/me', (c) => {
    const { uid, provider } = c.get('user');
    return c.json({ uid, provider });
  });

  v1.route('/me', createMe(store, objects, accounts));
  v1.route('/rentals', createRentals(store));
  v1.route('/rentals', createEvidence(store, objects, signer));
  v1.route('/rentals', createSeal(store, signer));
  v1.route('/rentals', createIssues(store, ai));
  v1.route('/triage', createTriageRoute(ai.triage));

  return v1;
}
