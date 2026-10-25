import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Accounts } from '../src/accounts.js';
import { createApp } from '../src/app.js';
import { InvalidTokenError, type VerifyIdToken } from '../src/auth.js';
import { purgeExpired } from '../src/purge.js';
import type { VerifyScheduler } from '../src/routes/internal.js';
import { originalPath } from '../src/storage/gcs.js';
import { memoryObjects } from './memory-objects.js';
import { memoryStore } from './memory-store.js';

// Tokens are the uid, so each test can act as any user.
const fakeVerifier: VerifyIdToken = async (token) => {
  if (token === 'alice' || token === 'bob') return { uid: token, provider: 'anonymous' };
  throw new InvalidTokenError('invalid');
};

const photo = Buffer.from('not really a HEIC, but bytes all the same');
const sha256 = createHash('sha256').update(photo).digest('hex');

function setup(verifyScheduler: VerifyScheduler | null = null, purgeAudience?: string) {
  const memory = memoryStore();
  const objects = memoryObjects();
  const deletedUsers: string[] = [];
  const accounts: Accounts = { deleteUser: async (uid) => void deletedUsers.push(uid) };
  const app = createApp({ logSink: () => {}, verifyIdToken: fakeVerifier, store: memory.store, objects: objects.store, accounts, verifyScheduler, purgeAudience });
  const send = (method: string, path: string, as: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { Authorization: `Bearer ${as}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  // A rental with one stored photo.
  const rentalWithPhoto = async (as: string, itemId: string, extra: Record<string, unknown> = {}) => {
    const { id } = (await (await send('POST', '/v1/rentals', as, { jurisdiction: 'VA', city: 'Richmond', ...extra })).json()) as { id: string };
    const item = {
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
    };
    expect((await send('POST', `/v1/rentals/${id}/evidence`, as, { items: [item] })).status).toBe(201);
    objects.put(originalPath(id, itemId), photo);
    expect((await send('POST', `/v1/rentals/${id}/evidence/${itemId}/complete`, as)).status).toBe(200);
    return id;
  };
  return { app, memory, objects, deletedUsers, send, rentalWithPhoto };
}

const itemA = '6f1c2a5e-8d3b-4c7a-9e21-0b4f5d6a7c88';
const itemB = '7a2d3b6f-9e4c-4d8b-8f32-1c5a6e7b8d99';

describe('DELETE /v1/me', () => {
  it('leaves no server data for the caller and removes the Firebase user', async () => {
    const { send, memory, objects, deletedUsers, rentalWithPhoto } = setup();
    await rentalWithPhoto('alice', itemA);
    await rentalWithPhoto('alice', itemB);

    const res = await send('DELETE', '/v1/me', 'alice');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deletedAt: expect.any(String), rentals: 2, evidenceItems: 2 });

    expect(memory.rentals.size).toBe(0);
    expect(memory.evidence.size).toBe(0);
    expect(memory.ledgers.size).toBe(0);
    expect(memory.users.has('alice')).toBe(false);
    expect(objects.objects.size).toBe(0);
    expect(deletedUsers).toEqual(['alice']);
  });

  it('leaves another user alone', async () => {
    const { send, memory, objects, deletedUsers, rentalWithPhoto } = setup();
    await rentalWithPhoto('alice', itemA);
    const bobsRental = await rentalWithPhoto('bob', itemB);

    expect((await send('DELETE', '/v1/me', 'alice')).status).toBe(200);
    expect([...memory.rentals.keys()]).toEqual([bobsRental]);
    expect(memory.users.has('bob')).toBe(true);
    expect([...objects.objects.keys()]).toEqual([originalPath(bobsRental, itemB)]);
    expect(deletedUsers).toEqual(['alice']);
  });

  it('answers with an empty receipt for a user with nothing stored', async () => {
    const { send, deletedUsers } = setup();
    const res = await send('DELETE', '/v1/me', 'bob');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ rentals: 0, evidenceItems: 0 });
    expect(deletedUsers).toEqual(['bob']);
  });

  it('needs a token', async () => {
    const { app } = setup();
    expect((await app.request('/v1/me', { method: 'DELETE' })).status).toBe(401);
  });

  it('keeps the Firebase user when a delete fails, so the app can try again', async () => {
    const { send, memory, objects, deletedUsers, rentalWithPhoto } = setup();
    await rentalWithPhoto('alice', itemA);
    objects.store.removeRental = async () => {
      throw new Error('storage down');
    };
    const res = await send('DELETE', '/v1/me', 'alice');
    expect(res.status).toBe(503);
    expect(deletedUsers).toEqual([]);
    expect(memory.rentals.size).toBe(1);
  });
});

describe('purgeExpired', () => {
  const now = new Date('2028-08-01T00:00:00Z');

  it('removes rentals past purgeAfter, with their photos, and keeps the rest', async () => {
    const { send, memory, objects, rentalWithPhoto } = setup();
    // Ended 2027-07-31: purgeAfter 2028-07-30, before `now`.
    const expired = await rentalWithPhoto('alice', itemA, { tenancyEndDate: '2027-07-31' });
    // Ends 2027-09-30: purgeAfter 2028-09-29, still kept.
    const recent = await rentalWithPhoto('alice', itemB, { tenancyEndDate: '2027-09-30' });
    const open = (await (await send('POST', '/v1/rentals', 'bob', { jurisdiction: 'VA', city: 'Norfolk' })).json()) as { id: string };

    expect(await purgeExpired(memory.store, objects.store, now)).toEqual({ purged: 1, more: false });
    expect([...memory.rentals.keys()].sort()).toEqual([recent, open.id].sort());
    expect([...objects.objects.keys()]).toEqual([originalPath(recent, itemB)]);
    expect(memory.evidence.has(`${expired}/${itemA}`)).toBe(false);
  });

  it('stops at the batch size and says more is waiting', async () => {
    const { memory, objects, rentalWithPhoto } = setup();
    for (const n of [1, 2, 3]) await rentalWithPhoto('alice', `00000000-0000-4000-8000-00000000000${n}`, { tenancyEndDate: '2020-01-01' });
    expect(await purgeExpired(memory.store, objects.store, now, 2)).toEqual({ purged: 2, more: true });
    expect(await purgeExpired(memory.store, objects.store, now, 2)).toEqual({ purged: 1, more: false });
    expect(memory.rentals.size).toBe(0);
  });
});

describe('POST /internal/purge', () => {
  const scheduler: VerifyScheduler = async (token, audience) => {
    if (token !== 'scheduler-token' || audience !== 'https://fineprint.test') throw new Error('rejected');
  };
  const call = (app: ReturnType<typeof setup>['app'], token?: string) =>
    app.request('/internal/purge', {
      method: 'POST',
      headers: { host: 'fineprint.test', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });

  it('is not there unless a scheduler is configured', async () => {
    expect((await call(setup(null).app, 'scheduler-token')).status).toBe(404);
  });

  it('refuses a missing or wrong token, and a Firebase user token', async () => {
    const { app, rentalWithPhoto, memory } = setup(scheduler);
    await rentalWithPhoto('alice', itemA, { tenancyEndDate: '2000-01-01' });
    expect((await call(app)).status).toBe(401);
    expect((await call(app, 'alice')).status).toBe(403);
    expect((await call(app, 'other')).status).toBe(403);
    expect(memory.rentals.size).toBe(1);
  });

  it('uses PURGE_AUDIENCE over the Host header when it is set', async () => {
    const { app, rentalWithPhoto, memory } = setup(scheduler, 'https://fineprint.test');
    await rentalWithPhoto('alice', itemA, { tenancyEndDate: '2000-01-01' });
    const call = (host: string) =>
      app.request('/internal/purge', { method: 'POST', headers: { host, Authorization: 'Bearer scheduler-token' } });
    // A forged Host cannot change what the token must be for.
    expect((await call('evil.test')).status).toBe(200);
    expect(memory.rentals.size).toBe(0);
    const other = setup(scheduler, 'https://elsewhere.test');
    expect((await other.app.request('/internal/purge', { method: 'POST', headers: { host: 'fineprint.test', Authorization: 'Bearer scheduler-token' } })).status).toBe(403);
  });

  it('purges for the scheduler', async () => {
    const { app, rentalWithPhoto, memory, objects } = setup(scheduler);
    await rentalWithPhoto('alice', itemA, { tenancyEndDate: '2000-01-01' });
    const res = await call(app, 'scheduler-token');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ purged: 1, more: false });
    expect(memory.rentals.size).toBe(0);
    expect(objects.objects.size).toBe(0);
  });
});
