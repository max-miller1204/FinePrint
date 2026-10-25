import { OAuth2Client } from 'google-auth-library';
import { Hono } from 'hono';
import type { AppEnv } from '../app.js';
import { ApiError } from '../errors.js';
import { purgeExpired } from '../purge.js';
import type { Store } from '../storage/firestore.js';
import type { EvidenceObjects } from '../storage/gcs.js';

// Resolves when the request comes from the Cloud Scheduler job; throws
// otherwise. `audience` is the service URL the job's token was minted for.
export type VerifyScheduler = (idToken: string, audience: string) => Promise<void>;

// Cloud Scheduler signs in as a service account and sends a Google ID token.
// Cloud Run here allows unauthenticated calls (the app signs in with Firebase,
// not IAM), so the server checks the token itself: signed by Google, minted
// for this service, and issued to the one account in PURGE_CALLER_EMAIL.
export function googleSchedulerVerifier(env: NodeJS.ProcessEnv = process.env): VerifyScheduler | null {
  const email = env.PURGE_CALLER_EMAIL;
  if (!email) return null;
  const client = new OAuth2Client();
  return async (idToken, audience) => {
    const ticket = await client.verifyIdToken({ idToken, audience });
    const payload = ticket.getPayload();
    if (payload?.email !== email || payload.email_verified !== true) throw new Error('Not the purge caller');
  };
}

// POST /internal/purge: removes rentals past `purgeAfter` (spec §6.1, §9.2).
// Not under /v1, which needs a Firebase token. Off (404) unless a verifier is
// configured, so a server without a scheduler exposes nothing.
// `audience` is the service URL the job's token was minted for (PURGE_AUDIENCE,
// set by deploy.sh). Without it the request's Host header stands in.
export function createInternal(
  store: Store,
  objects: EvidenceObjects,
  verify: VerifyScheduler | null,
  now: () => Date = () => new Date(),
  audience: string | undefined = process.env.PURGE_AUDIENCE,
) {
  const internal = new Hono<AppEnv>();

  internal.post('/purge', async (c) => {
    if (verify === null) throw new ApiError(404, 'NOT_FOUND', 'No route matches this request');
    const token = c.req.header('Authorization')?.match(/^Bearer +([A-Za-z0-9._~+/-]+=*) *$/i)?.[1];
    if (!token) throw new ApiError(401, 'UNAUTHENTICATED', 'Missing ID token');
    const host = c.req.header('host');
    try {
      if (!audience && !host) throw new Error('No audience');
      await verify(token, audience ?? `https://${host}`);
    } catch {
      c.get('log').info('purge rejected');
      throw new ApiError(403, 'FORBIDDEN', 'Only the purge scheduler may call this');
    }
    const result = await purgeExpired(store, objects, now());
    c.get('log').info('purge finished', result);
    return c.json(result);
  });

  return internal;
}
