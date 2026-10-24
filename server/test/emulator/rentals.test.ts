import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { firebaseApp } from '../../src/firebase.js';

// Runs under `pnpm test:emulator`, with the Auth and Firestore emulators.
// The app uses its default verifier and store: the production path end to
// end, read back straight from Firestore.

const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;

async function signUpAnonymously(): Promise<{ idToken: string; localId: string }> {
  const res = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ returnSecureToken: true }),
  });
  if (!res.ok) throw new Error(`signUp: ${res.status}`);
  return res.json() as Promise<{ idToken: string; localId: string }>;
}

describe.runIf(authHost && process.env.FIRESTORE_EMULATOR_HOST)('rentals against the emulators', () => {
  const app = createApp({ logSink: () => {} });
  const db = () => getFirestore(firebaseApp());
  const send = (method: string, path: string, idToken: string, body: unknown) =>
    app.request(path, { method, headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  it('creates a rental, its owner, and patches it with purgeAfter', async () => {
    const { idToken, localId } = await signUpAnonymously();
    const created = await send('POST', '/v1/rentals', idToken, { jurisdiction: 'VA', county: 'Arlington', monthlyRent: 1800 });
    expect(created.status).toBe(201);
    const { id } = await created.json();

    const stored = (await db().doc(`rentals/${id}`).get()).data();
    expect(stored).toMatchObject({ ownerUid: localId, county: 'Arlington', phase: 'pre_signing', monthlyRent: 1800, purgeAfter: null });
    expect(stored?.createdAt).toBeInstanceOf(Timestamp);
    const user = (await db().doc(`users/${localId}`).get()).data();
    expect(user).toMatchObject({ authProvider: 'anonymous', impactOptIn: false, locale: null });

    const patched = await send('PATCH', `/v1/rentals/${id}`, idToken, { phase: 'move_in', tenancyEndDate: '2027-07-31' });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({ phase: 'move_in', monthlyRent: 1800, purgeAfter: '2028-07-30T00:00:00.000Z' });

    // A Timestamp, so a Firestore TTL policy on the field can purge it.
    const after = (await db().doc(`rentals/${id}`).get()).data();
    expect(after?.purgeAfter).toBeInstanceOf(Timestamp);
    expect((after?.purgeAfter as Timestamp | undefined)?.toDate().toISOString()).toBe('2028-07-30T00:00:00.000Z');
    expect(after?.ownerUid).toBe(localId);
  });

  it('gives another user 403 and leaves the rental unchanged', async () => {
    const owner = await signUpAnonymously();
    const other = await signUpAnonymously();
    const { id } = await (await send('POST', '/v1/rentals', owner.idToken, { jurisdiction: 'VA', city: 'Richmond' })).json();

    const res = await send('PATCH', `/v1/rentals/${id}`, other.idToken, { phase: 'ended', tenancyEndDate: '2026-01-01' });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect((await db().doc(`rentals/${id}`).get()).data()).toMatchObject({ phase: 'pre_signing', tenancyEndDate: null, purgeAfter: null });
  });

  it('is 404 for a rental that does not exist', async () => {
    const { idToken } = await signUpAnonymously();
    const res = await send('PATCH', '/v1/rentals/does-not-exist', idToken, { phase: 'living' });
    expect(res.status).toBe(404);
  });
});
