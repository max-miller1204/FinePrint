import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, test } from 'e2e';

interface ClientConfig {
  firebase: { apiKey: string; projectId: string; authEmulatorHost?: string };
}

interface UploadTarget {
  method: 'PUT';
  url: string;
  headers: Record<string, string>;
  expiresAt: string;
}

// What the iOS app does on first launch (see auth.e2e.ts).
async function signUpAnonymously(baseUrl: string): Promise<{ idToken: string; localId: string }> {
  const config: ClientConfig = await (await fetch(new URL('/.well-known/fineprint-client.json', baseUrl))).json();
  const { apiKey, authEmulatorHost } = config.firebase;
  const res = await fetch(`http://${authEmulatorHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ returnSecureToken: true }),
  });
  expect(res.status).toBe(200);
  return res.json();
}

function call(baseUrl: string, method: string, path: string, idToken: string, body?: unknown) {
  return fetch(new URL(path, baseUrl), {
    method,
    headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// The stored item, read from the Firestore emulator in ../firebase.json.
// `Bearer owner` is the emulator's admin bypass of the deny-all rules.
async function storedItem(rentalId: string, itemId: string): Promise<{ fields: Record<string, Record<string, unknown>> }> {
  const res = await fetch(`http://${process.env.E2E_WEB_FIRESTORE_HOST ?? `127.0.0.1:${process.env.E2E_FIRESTORE_PORT ?? '8090'}`}/v1/projects/demo-fineprint/databases/(default)/documents/rentals/${rentalId}/evidence/${itemId}`, {
    headers: { Authorization: 'Bearer owner' },
  });
  expect(res.status).toBe(200);
  return res.json();
}

// The web target always has one; the type allows a mobile target's none.
function baseOf(app: { baseUrl?: string }): string {
  if (!app.baseUrl) throw new Error('The web target has no base URL');
  return app.baseUrl;
}

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

// A §8.1 capture record, as the app's upload queue sends it.
function record(photo: Buffer, itemId = randomUUID()) {
  return {
    itemId,
    room: 'Kitchen',
    checklistItem: 'Walls',
    sha256: sha256(photo),
    bytes: photo.length,
    mime: 'image/jpeg',
    capturedAtDevice: '2026-08-14T15:12:03-04:00',
    deviceUptimeMs: 81233411,
    source: 'in_app_camera',
    appVersion: '1.0.0 (12)',
  };
}

async function rentalWithItem(baseUrl: string, photo: Buffer) {
  const { idToken } = await signUpAnonymously(baseUrl);
  const { id } = await (await call(baseUrl, 'POST', '/v1/rentals', idToken, { jurisdiction: 'VA', city: 'Richmond' })).json();
  const item = record(photo);
  const created = await call(baseUrl, 'POST', `/v1/rentals/${id}/evidence`, idToken, { items: [item] });
  expect(created.status).toBe(201);
  const { items } = await created.json();
  return { idToken, rentalId: id as string, itemId: item.itemId, upload: items[0].upload as UploadTarget, item: items[0] };
}

// The bytes go to Storage directly, never through the API (spec §5.3).
function put(upload: UploadTarget, body: Buffer) {
  return fetch(upload.url, { method: upload.method, headers: upload.headers, body: new Uint8Array(body) });
}

describe('Evidence uploads', { platforms: ['web'] }, () => {
  test('a photo goes straight to Storage and the server records receivedAtServer', async ({ app }) => {
    const baseUrl = baseOf(app);
    const photo = Buffer.from(`move-in photo ${randomUUID()}`);
    const { idToken, rentalId, itemId, upload, item } = await rentalWithItem(baseUrl, photo);
    expect(item).toMatchObject({ itemId, status: 'pending', receivedAtServer: null, sha256: sha256(photo) });
    expect(upload).toMatchObject({ method: 'PUT', headers: { 'Content-Type': 'image/jpeg', 'x-goog-content-sha256': sha256(photo) } });
    expect(Date.parse(upload.expiresAt) - Date.now()).toBeLessThanOrEqual(5 * 60 * 1000);
    expect(new URL(upload.url).origin).not.toBe(new URL(baseUrl).origin);

    expect((await put(upload, photo)).status).toBe(200);
    const completed = await call(baseUrl, 'POST', `/v1/rentals/${rentalId}/evidence/${itemId}/complete`, idToken);
    expect(completed.status).toBe(200);
    const received = await completed.json();
    expect(received).toMatchObject({ itemId, status: 'received', bytes: photo.length });
    expect(Number.isNaN(Date.parse(received.receivedAtServer))).toBe(false);

    // Persisted as a Timestamp, with the bucket path the server chose.
    const { fields } = await storedItem(rentalId, itemId);
    expect(fields.sha256).toEqual({ stringValue: sha256(photo) });
    expect(fields.gcsPath).toEqual({ stringValue: `rentals/${rentalId}/evidence/${itemId}.heic` });
    expect(fields.receivedAtServer).toHaveProperty('timestampValue');

    // Asking again after it was received issues no upload URL.
    const again = await (await call(baseUrl, 'POST', `/v1/rentals/${rentalId}/evidence`, idToken, { items: [record(photo, itemId)] })).json();
    expect(again.items[0]).toMatchObject({ status: 'received', upload: null });
  });

  test('bytes that do not match the declared hash are rejected and the item stays pending', async ({ app }) => {
    const baseUrl = baseOf(app);
    const photo = Buffer.from(`move-in photo ${randomUUID()}`);
    const { idToken, rentalId, itemId, upload } = await rentalWithItem(baseUrl, photo);
    const tampered = Buffer.from(photo);
    tampered.writeUInt8(tampered.readUInt8(0) ^ 0xff, 0);

    expect((await put(upload, tampered)).status).toBe(200);
    const rejected = await call(baseUrl, 'POST', `/v1/rentals/${rentalId}/evidence/${itemId}/complete`, idToken);
    expect(rejected.status).toBe(422);
    expect(await rejected.json()).toMatchObject({ error: { code: 'HASH_MISMATCH' } });
    const { fields } = await storedItem(rentalId, itemId);
    expect(fields.receivedAtServer).toEqual({ nullValue: null });

    // The rejected object was deleted, so there is nothing to complete.
    const empty = await call(baseUrl, 'POST', `/v1/rentals/${rentalId}/evidence/${itemId}/complete`, idToken);
    expect(empty.status).toBe(409);
  });

  test('another user cannot add evidence to a rental or complete its items', async ({ app }) => {
    const baseUrl = baseOf(app);
    const photo = Buffer.from(`move-in photo ${randomUUID()}`);
    const { rentalId, itemId } = await rentalWithItem(baseUrl, photo);
    const other = await signUpAnonymously(baseUrl);

    const create = await call(baseUrl, 'POST', `/v1/rentals/${rentalId}/evidence`, other.idToken, { items: [record(photo)] });
    expect(create.status).toBe(403);
    const complete = await call(baseUrl, 'POST', `/v1/rentals/${rentalId}/evidence/${itemId}/complete`, other.idToken);
    expect(complete.status).toBe(403);
    expect(await complete.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });
});
