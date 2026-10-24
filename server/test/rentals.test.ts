import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { VerifyIdToken } from '../src/auth.js';
import { InvalidTokenError } from '../src/auth.js';
import { purgeAfter } from '../src/models/rental.js';
import type { Store } from '../src/storage/firestore.js';
import { memoryStore } from './memory-store.js';

// Tokens are the uid, so each test can act as any user.
const fakeVerifier: VerifyIdToken = async (token) => {
  if (token === 'alice' || token === 'mallory') return { uid: token, provider: 'anonymous' };
  throw new InvalidTokenError('invalid');
};

function setup(store: Store = memoryStore().store) {
  const lines: Record<string, unknown>[] = [];
  const app = createApp({ logSink: (line) => lines.push(JSON.parse(line)), verifyIdToken: fakeVerifier, store });
  const send = (method: string, path: string, as: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { Authorization: `Bearer ${as}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
  return { app, lines, send };
}

const richmond = { jurisdiction: 'VA', city: 'Richmond' };

describe('POST /v1/rentals', () => {
  it('creates a rental owned by the caller, in pre_signing by default', async () => {
    const { store, rentals, users } = memoryStore();
    const { send } = setup(store);
    const res = await send('POST', '/v1/rentals', 'alice', richmond);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(res.headers.get('location')).toBe(`/v1/rentals/${body.id}`);
    expect(body).toEqual({
      id: expect.any(String),
      jurisdiction: 'VA',
      city: 'Richmond',
      county: null,
      phase: 'pre_signing',
      occupancyDate: null,
      tenancyEndDate: null,
      monthlyRent: null,
      depositAmount: null,
      purgeAfter: null,
      createdAt: expect.any(String),
      updatedAt: body.createdAt,
    });
    expect(body).not.toHaveProperty('ownerUid');
    expect(rentals.get(body.id)?.ownerUid).toBe('alice');
    expect(users.get('alice')).toBe('anonymous');
  });

  it('sets purgeAfter one year after tenancyEndDate', async () => {
    const { send } = setup();
    const res = await send('POST', '/v1/rentals', 'alice', { ...richmond, occupancyDate: '2026-08-01', tenancyEndDate: '2027-07-31' });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ tenancyEndDate: '2027-07-31', purgeAfter: '2028-07-30T00:00:00.000Z' });
  });

  it.each([
    ['no city or county', { jurisdiction: 'VA' }],
    ['a lower-case jurisdiction', { ...richmond, jurisdiction: 'va' }],
    ['an unknown phase', { ...richmond, phase: 'signed' }],
    ['a date that does not exist', { ...richmond, occupancyDate: '2026-02-30' }],
    ['a date with a time', { ...richmond, occupancyDate: '2026-08-01T00:00:00Z' }],
    ['negative rent', { ...richmond, monthlyRent: -1 }],
    ['fractions of a cent', { ...richmond, depositAmount: 100.001 }],
    ['an ownerUid', { ...richmond, ownerUid: 'mallory' }],
    ['a purgeAfter', { ...richmond, purgeAfter: '2099-01-01' }],
    ['an array', [richmond]],
  ])('rejects %s', async (_, body) => {
    const { send } = setup();
    const res = await send('POST', '/v1/rentals', 'alice', body);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'BAD_REQUEST' } });
  });

  it('rejects an end date before the start date', async () => {
    const { send } = setup();
    const res = await send('POST', '/v1/rentals', 'alice', { ...richmond, occupancyDate: '2026-08-01', tenancyEndDate: '2026-07-31' });
    expect(res.status).toBe(400);
  });

  it('names fields in errors but never echoes what was sent', async () => {
    const { send } = setup();
    const res = await send('POST', '/v1/rentals', 'alice', { ...richmond, monthlyRent: 'Jordan Lee', 'Jordan Lee lives at 1 Main St': 1 });
    const { error } = await res.json();
    expect(error.message).toContain('monthlyRent');
    expect(error.message).not.toContain('Jordan');
  });

  it('rejects a body that is not JSON', async () => {
    const { send } = setup();
    const res = await send('POST', '/v1/rentals', 'alice', '{not json');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: 'BAD_REQUEST', message: 'Body must be JSON' } });
  });

  it('rejects a body over 16 KB', async () => {
    const { send } = setup();
    const res = await send('POST', '/v1/rentals', 'alice', { ...richmond, county: 'x'.repeat(17 * 1024) });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: { code: 'PAYLOAD_TOO_LARGE' } });
  });

  it('needs a token', async () => {
    const { app } = setup();
    expect((await app.request('/v1/rentals', { method: 'POST', body: JSON.stringify(richmond) })).status).toBe(401);
  });

  it('answers 503 when Firestore does not answer', async () => {
    const unavailable = Object.assign(new Error('14 UNAVAILABLE'), { code: 14 });
    const { send } = setup({ ...memoryStore().store, createRental: () => Promise.reject(unavailable), updateRental: () => Promise.reject(unavailable) });
    const res = await send('POST', '/v1/rentals', 'alice', richmond);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: 'DEPENDENCY_UNAVAILABLE' } });
  });
});

describe('PATCH /v1/rentals/:id', () => {
  async function created(send: ReturnType<typeof setup>['send'], body: object = richmond) {
    return (await (await send('POST', '/v1/rentals', 'alice', body)).json()) as { id: string; createdAt: string };
  }

  it('updates dates, rent, deposit, and phase for the owner', async () => {
    const { send } = setup();
    const { id, createdAt } = await created(send);
    const res = await send('PATCH', `/v1/rentals/${id}`, 'alice', {
      phase: 'move_in',
      occupancyDate: '2026-08-01',
      tenancyEndDate: '2027-07-31',
      monthlyRent: 1450.5,
      depositAmount: 1450.5,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      id,
      city: 'Richmond',
      phase: 'move_in',
      occupancyDate: '2026-08-01',
      tenancyEndDate: '2027-07-31',
      monthlyRent: 1450.5,
      depositAmount: 1450.5,
      purgeAfter: purgeAfter('2027-07-31')!.toISOString(),
      createdAt,
    });
    expect(body.updatedAt >= createdAt).toBe(true);
  });

  it('moves purgeAfter with tenancyEndDate and clears it with null', async () => {
    const { send } = setup();
    const { id } = await created(send, { ...richmond, tenancyEndDate: '2027-07-31' });
    const moved = await (await send('PATCH', `/v1/rentals/${id}`, 'alice', { tenancyEndDate: '2028-01-15' })).json();
    expect(moved.purgeAfter).toBe('2029-01-14T00:00:00.000Z');
    const cleared = await (await send('PATCH', `/v1/rentals/${id}`, 'alice', { tenancyEndDate: null })).json();
    expect(cleared).toMatchObject({ tenancyEndDate: null, purgeAfter: null });
  });

  it('leaves fields it was not sent alone', async () => {
    const { send } = setup();
    const { id } = await created(send, { ...richmond, monthlyRent: 1200, tenancyEndDate: '2027-07-31' });
    const body = await (await send('PATCH', `/v1/rentals/${id}`, 'alice', { phase: 'living' })).json();
    expect(body).toMatchObject({ phase: 'living', monthlyRent: 1200, tenancyEndDate: '2027-07-31', purgeAfter: '2028-07-30T00:00:00.000Z' });
  });

  it('is 403 for another user, and changes nothing', async () => {
    const { store, rentals } = memoryStore();
    const { send, lines } = setup(store);
    const { id } = await created(send);
    const res = await send('PATCH', `/v1/rentals/${id}`, 'mallory', { phase: 'ended' });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect(rentals.get(id)?.phase).toBe('pre_signing');
    expect(lines).toContainEqual(expect.objectContaining({ message: 'rental forbidden', rentalId: id }));
    expect(JSON.stringify(lines)).not.toContain('mallory');
  });

  it('is 404 for a rental that does not exist or an id that cannot be one', async () => {
    const { send } = setup();
    for (const id of ['missing', '__name__', 'a.b', 'x'.repeat(129)]) {
      const res = await send('PATCH', `/v1/rentals/${id}`, 'alice', { phase: 'living' });
      expect(res.status, id).toBe(404);
      expect(await res.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    }
  });

  it.each([
    ['an empty patch', {}],
    ['a city', { city: 'Norfolk' }],
    ['an ownerUid', { ownerUid: 'mallory' }],
    ['a purgeAfter', { purgeAfter: '2099-01-01T00:00:00Z' }],
    ['a null phase', { phase: null }],
  ])('rejects %s', async (_, patch) => {
    const { send } = setup();
    const { id } = await created(send);
    const res = await send('PATCH', `/v1/rentals/${id}`, 'alice', patch);
    expect(res.status).toBe(400);
  });

  it('rejects a patch that puts the end before the start', async () => {
    const { send } = setup();
    const { id } = await created(send, { ...richmond, occupancyDate: '2026-08-01' });
    const res = await send('PATCH', `/v1/rentals/${id}`, 'alice', { tenancyEndDate: '2026-07-01' });
    expect(res.status).toBe(400);
  });
});

describe('purgeAfter', () => {
  it('is 365 days after the end date, at midnight UTC', () => {
    expect(purgeAfter('2027-07-31')?.toISOString()).toBe('2028-07-30T00:00:00.000Z');
    expect(purgeAfter('2026-03-01')?.toISOString()).toBe('2027-03-01T00:00:00.000Z');
    expect(purgeAfter(null)).toBeNull();
  });
});
