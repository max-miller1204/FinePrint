import { createHash } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { firebaseApp } from '../../src/firebase.js';
import { evidenceBucket, originalPath } from '../../src/storage/gcs.js';

// Runs under `pnpm test:emulator`, with the Auth, Firestore, and Storage
// emulators. The app uses its real verifier, store, bucket, and accounts: the
// production path end to end, read back straight from the emulators.

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

const photo = Buffer.from('photo bytes for the delete-everything test');

describe.runIf(authHost && process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_STORAGE_EMULATOR_HOST)('delete everything and purge against the emulators', () => {
  const schedulerToken = 'scheduler-token';
  const app = createApp({
    logSink: () => {},
    verifyScheduler: async (token) => {
      if (token !== schedulerToken) throw new Error('rejected');
    },
  });
  const db = () => getFirestore(firebaseApp());
  const send = (method: string, path: string, idToken: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  // A rental with one received photo. Share links are not built yet, so the
  // tests write share documents by hand.
  async function rentalWithPhoto(idToken: string, extra: Record<string, unknown> = {}) {
    const created = await send('POST', '/v1/rentals', idToken, { jurisdiction: 'VA', city: 'Richmond', ...extra });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const itemId = crypto.randomUUID();
    const sha256 = createHash('sha256').update(photo).digest('hex');
    const registered = await send('POST', `/v1/rentals/${id}/evidence`, idToken, {
      items: [
        {
          itemId,
          room: 'Kitchen',
          checklistItem: 'Walls',
          sha256,
          bytes: photo.length,
          mime: 'image/heic',
          capturedAtDevice: '2026-08-14T15:12:03-04:00',
          deviceUptimeMs: 1,
          source: 'in_app_camera',
          appVersion: '1.0.0 (1)',
        },
      ],
    });
    expect(registered.status).toBe(201);
    const { items } = (await registered.json()) as { items: { upload: { url: string; headers: Record<string, string> } }[] };
    const put = await fetch(items[0]!.upload.url, { method: 'PUT', headers: items[0]!.upload.headers, body: photo });
    expect(put.status).toBe(200);
    expect((await send('POST', `/v1/rentals/${id}/evidence/${itemId}/complete`, idToken)).status).toBe(200);
    return { id, itemId };
  }

  const storedObjects = async (rentalId: string) => {
    const [files] = await evidenceBucket().getFiles({ prefix: `rentals/${rentalId}/` });
    return files.map((file) => file.name);
  };
  const exists = async (path: string) => (await db().doc(path).get()).exists;

  it('DELETE /v1/me leaves no server data for the user and removes the Firebase user', async () => {
    const alice = await signUpAnonymously();
    const bob = await signUpAnonymously();
    const first = await rentalWithPhoto(alice.idToken);
    const second = await rentalWithPhoto(alice.idToken, { tenancyEndDate: '2027-07-31' });
    const bobs = await rentalWithPhoto(bob.idToken);
    await db().doc(`shares/token-${first.id}`).set({ rentalId: first.id, scope: ['evidence'] });
    await db().doc(`shares/token-${first.id}/access/a1`).set({ at: new Date() });
    await db().doc(`shares/token-${bobs.id}`).set({ rentalId: bobs.id, scope: ['evidence'] });
    expect(await storedObjects(first.id)).toEqual([originalPath(first.id, first.itemId)]);
    expect(await exists(`users/${alice.localId}`)).toBe(true);

    const res = await send('DELETE', '/v1/me', alice.idToken);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deletedAt: expect.any(String), rentals: 2, evidenceItems: 2 });

    for (const { id, itemId } of [first, second]) {
      expect(await exists(`rentals/${id}`)).toBe(false);
      expect((await db().collection(`rentals/${id}/evidence`).get()).size).toBe(0);
      expect(await exists(`rentals/${id}/evidence/${itemId}`)).toBe(false);
      expect(await storedObjects(id)).toEqual([]);
    }
    expect(await exists(`shares/token-${first.id}`)).toBe(false);
    expect((await db().collection(`shares/token-${first.id}/access`).get()).size).toBe(0);
    expect(await exists(`users/${alice.localId}`)).toBe(false);
    expect((await db().collection('rentals').where('ownerUid', '==', alice.localId).get()).size).toBe(0);
    await expect(getAuth(firebaseApp()).getUser(alice.localId)).rejects.toMatchObject({ code: 'auth/user-not-found' });
    expect((await send('GET', '/v1/me', alice.idToken)).status).toBe(401);

    // Bob is untouched.
    expect(await exists(`rentals/${bobs.id}`)).toBe(true);
    expect(await exists(`shares/token-${bobs.id}`)).toBe(true);
    expect(await storedObjects(bobs.id)).toEqual([originalPath(bobs.id, bobs.itemId)]);
    expect((await send('GET', '/v1/me', bob.idToken)).status).toBe(200);
  });

  it('POST /internal/purge removes rentals past purgeAfter and keeps the rest', async () => {
    const owner = await signUpAnonymously();
    const expired = await rentalWithPhoto(owner.idToken, { tenancyEndDate: '2000-01-01' });
    const kept = await rentalWithPhoto(owner.idToken, { tenancyEndDate: '2999-01-01' });
    const open = await rentalWithPhoto(owner.idToken);
    await db().doc(`shares/token-${expired.id}`).set({ rentalId: expired.id, scope: ['evidence'] });
    expect((await db().doc(`rentals/${expired.id}`).get()).get('purgeAfter')).toBeTruthy();

    const purge = (token?: string) =>
      app.request('/internal/purge', { method: 'POST', headers: { host: 'fineprint.test', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
    expect((await purge()).status).toBe(401);
    expect((await purge(owner.idToken)).status).toBe(403);
    expect(await exists(`rentals/${expired.id}`)).toBe(true);

    const res = await purge(schedulerToken);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ more: false });

    expect(await exists(`rentals/${expired.id}`)).toBe(false);
    expect((await db().collection(`rentals/${expired.id}/evidence`).get()).size).toBe(0);
    expect(await storedObjects(expired.id)).toEqual([]);
    expect(await exists(`shares/token-${expired.id}`)).toBe(false);
    for (const survivor of [kept, open]) {
      expect(await exists(`rentals/${survivor.id}`)).toBe(true);
      expect(await storedObjects(survivor.id)).toEqual([originalPath(survivor.id, survivor.itemId)]);
    }
  });
});
