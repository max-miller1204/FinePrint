import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { VerifyIdToken } from '../src/auth.js';
import { InvalidTokenError } from '../src/auth.js';
import type { Store } from '../src/storage/firestore.js';
import { originalPath } from '../src/storage/gcs.js';
import { memoryObjects } from './memory-objects.js';
import { memoryStore } from './memory-store.js';

// Tokens are the uid, so each test can act as any user.
const fakeVerifier: VerifyIdToken = async (token) => {
  if (token === 'alice' || token === 'mallory') return { uid: token, provider: 'anonymous' };
  throw new InvalidTokenError('invalid');
};

function setup(store: Store = memoryStore().store) {
  const lines: Record<string, unknown>[] = [];
  const objects = memoryObjects();
  const app = createApp({ logSink: (line) => lines.push(JSON.parse(line)), verifyIdToken: fakeVerifier, store, objects: objects.store });
  const send = (method: string, path: string, as: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { Authorization: `Bearer ${as}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
  const rental = async (as = 'alice') => ((await (await send('POST', '/v1/rentals', as, { jurisdiction: 'VA', city: 'Richmond' })).json()) as { id: string }).id;
  return { app, lines, send, objects, rental };
}

const photo = Buffer.from('not really a HEIC, but bytes all the same');
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const itemId = '6f1c2a5e-8d3b-4c7a-9e21-0b4f5d6a7c88';

// A §8.1 capture record as the app sends it, with an upper-case UUID as
// Swift writes them.
function record(overrides: Record<string, unknown> = {}) {
  return {
    itemId: itemId.toUpperCase(),
    room: 'Kitchen',
    checklistItem: 'Walls',
    sha256: sha256(photo),
    bytes: photo.length,
    mime: 'image/heic',
    capturedAtDevice: '2026-08-14T15:12:03-04:00',
    deviceUptimeMs: 81233411,
    source: 'in_app_camera',
    appVersion: '1.0.0 (12)',
    ...overrides,
  };
}

describe('POST /v1/rentals/:id/evidence', () => {
  it('creates the item and returns an upload URL bound to its type and hash', async () => {
    const { store, evidence } = memoryStore();
    const { send, rental, lines } = setup(store);
    const id = await rental();
    const res = await send('POST', `/v1/rentals/${id}/evidence`, 'alice', { items: [record()] });
    expect(res.status).toBe(201);
    const { items } = await res.json();
    expect(items).toEqual([
      {
        itemId,
        session: 'move_in',
        room: 'Kitchen',
        checklistItem: 'Walls',
        sha256: sha256(photo),
        bytes: photo.length,
        mime: 'image/heic',
        capturedAtDevice: '2026-08-14T15:12:03-04:00',
        deviceUptimeMs: 81233411,
        source: 'in_app_camera',
        appVersion: '1.0.0 (12)',
        sealedManifestId: null,
        status: 'pending',
        receivedAtServer: null,
        deletedAt: null,
        createdAt: expect.any(String),
        upload: {
          method: 'PUT',
          url: `https://storage.test/upload/${originalPath(id, itemId)}`,
          headers: { 'Content-Type': 'image/heic', 'x-goog-content-sha256': sha256(photo) },
          expiresAt: expect.any(String),
        },
      },
    ]);
    // Five minutes (spec §5.3).
    expect(Date.parse(items[0].upload.expiresAt) - Date.parse(items[0].createdAt)).toBe(5 * 60 * 1000);
    expect(items[0]).not.toHaveProperty('gcsPath');
    expect(evidence.get(`${id}/${itemId}`)).toMatchObject({ gcsPath: originalPath(id, itemId), deviceUptimeAtCapture: 81233411 });
    expect(lines).toContainEqual(expect.objectContaining({ message: 'evidence upload urls issued', rentalId: id, items: 1, created: 1 }));
  });

  it('answers a repeat of the same record with a fresh URL and no new item', async () => {
    const { send, rental, objects } = setup();
    const id = await rental();
    await send('POST', `/v1/rentals/${id}/evidence`, 'alice', { items: [record()] });
    const again = await send('POST', `/v1/rentals/${id}/evidence`, 'alice', { items: [record()] });
    expect(again.status).toBe(200);
    expect((await again.json()).items[0]).toMatchObject({ itemId, status: 'pending', upload: { method: 'PUT' } });
    expect(objects.issued).toHaveLength(2);
  });

  it('refuses a different photo under an itemId already in use', async () => {
    const { send, rental } = setup();
    const id = await rental();
    await send('POST', `/v1/rentals/${id}/evidence`, 'alice', { items: [record()] });
    const res = await send('POST', `/v1/rentals/${id}/evidence`, 'alice', { items: [record({ sha256: 'a'.repeat(64) })] });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: 'CONFLICT' } });
  });

  it.each([
    ['no items', { items: [] }],
    ['an upper-case hash', { items: [record({ sha256: sha256(photo).toUpperCase() })] }],
    ['a short hash', { items: [record({ sha256: 'abc' })] }],
    ['a PNG', { items: [record({ mime: 'image/png' })] }],
    ['zero bytes', { items: [record({ bytes: 0 })] }],
    ['a time with no offset', { items: [record({ capturedAtDevice: '2026-08-14T15:12:03' })] }],
    ['an itemId that is not a UUID', { items: [record({ itemId: 'kitchen-walls' })] }],
    ['a gcsPath', { items: [record({ gcsPath: 'rentals/other/evidence/x.heic' })] }],
    ['a receivedAtServer', { items: [record({ receivedAtServer: '2026-08-14T19:12:03Z' })] }],
    ['the same itemId twice', { items: [record(), record({ itemId })] }],
    ['21 items', { items: Array.from({ length: 21 }, () => record({ itemId: crypto.randomUUID() })) }],
  ])('rejects %s', async (_, body) => {
    const { send, rental } = setup();
    const res = await send('POST', `/v1/rentals/${await rental()}/evidence`, 'alice', body);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'BAD_REQUEST' } });
  });

  it('is 403 for another user and 404 for a missing rental', async () => {
    const { send, rental, objects } = setup();
    const id = await rental();
    const forbidden = await send('POST', `/v1/rentals/${id}/evidence`, 'mallory', { items: [record()] });
    expect(forbidden.status).toBe(403);
    expect((await send('POST', '/v1/rentals/nope/evidence', 'alice', { items: [record()] })).status).toBe(404);
    expect((await send('POST', '/v1/rentals/__x__/evidence', 'alice', { items: [record()] })).status).toBe(404);
    expect(objects.issued).toEqual([]);
  });

  it('needs a token', async () => {
    const { app } = setup();
    expect((await app.request('/v1/rentals/x/evidence', { method: 'POST', body: '{}' })).status).toBe(401);
  });
});

describe('POST /v1/rentals/:id/evidence/:itemId/complete', () => {
  async function issued(context: ReturnType<typeof setup>) {
    const id = await context.rental();
    await context.send('POST', `/v1/rentals/${id}/evidence`, 'alice', { items: [record()] });
    return {
      id,
      path: originalPath(id, itemId),
      complete: (as = 'alice') => context.send('POST', `/v1/rentals/${id}/evidence/${itemId.toUpperCase()}/complete`, as),
    };
  }

  it('records receivedAtServer once the stored bytes match the record', async () => {
    const context = setup();
    const { id, path, complete } = await issued(context);
    context.objects.put(path, photo);
    const res = await complete();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ itemId, status: 'received', sha256: sha256(photo) });
    expect(Date.parse(body.receivedAtServer)).not.toBeNaN();
    expect(context.lines).toContainEqual(expect.objectContaining({ message: 'evidence received', rentalId: id, itemId, bytes: photo.length }));

    // Idempotent, and a later request for the item issues no URL.
    expect(await (await complete()).json()).toMatchObject({ receivedAtServer: body.receivedAtServer });
    const again = await (await context.send('POST', `/v1/rentals/${id}/evidence`, 'alice', { items: [record()] })).json();
    expect(again.items[0]).toMatchObject({ status: 'received', receivedAtServer: body.receivedAtServer, upload: null });
  });

  it('rejects a hash mismatch, deletes the object, and leaves the item pending', async () => {
    const context = setup();
    const { id, path, complete } = await issued(context);
    // Same length, different bytes.
    const tampered = Buffer.from(photo);
    tampered.writeUInt8(tampered.readUInt8(0) ^ 0xff, 0);
    context.objects.put(path, tampered);
    const res = await complete();
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: { code: 'HASH_MISMATCH' } });
    expect(context.objects.objects.has(path)).toBe(false);
    expect(context.lines).toContainEqual(expect.objectContaining({ message: 'evidence rejected', rentalId: id, itemId, reason: 'sha256' }));

    // The right bytes can still be uploaded afterwards.
    context.objects.put(path, photo);
    expect((await complete()).status).toBe(200);
  });

  it.each([
    ['a size mismatch', Buffer.concat([photo, Buffer.from('x')]), 'image/heic', 'bytes'],
    ['a content type mismatch', photo, 'image/jpeg', 'contentType'],
  ])('rejects %s', async (_, body, contentType, reason) => {
    const context = setup();
    const { path, complete } = await issued(context);
    context.objects.put(path, body, contentType);
    const res = await complete();
    expect(res.status).toBe(422);
    expect(context.lines).toContainEqual(expect.objectContaining({ message: 'evidence rejected', reason }));
  });

  it('is 409 before anything was uploaded', async () => {
    const context = setup();
    const { complete } = await issued(context);
    const res = await complete();
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: 'CONFLICT' } });
  });

  it('is 403 for another user, and 404 for an unknown item', async () => {
    const context = setup();
    const { id, path, complete } = await issued(context);
    context.objects.put(path, photo);
    expect((await complete('mallory')).status).toBe(403);
    expect((await context.send('POST', `/v1/rentals/${id}/evidence/${crypto.randomUUID()}/complete`, 'alice')).status).toBe(404);
    expect((await context.send('POST', `/v1/rentals/${id}/evidence/..%2Fx/complete`, 'alice')).status).toBe(404);
  });

  it('answers 503 when Cloud Storage fails, without logging its message', async () => {
    const context = setup();
    const { path, complete } = await issued(context);
    context.objects.put(path, photo);
    context.objects.store.sha256 = () => Promise.reject(new Error('rentals/secret/path'));
    const res = await complete();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: 'DEPENDENCY_UNAVAILABLE' } });
    expect(JSON.stringify(context.lines)).not.toContain('secret');
  });
});
