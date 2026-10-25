import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, test } from 'e2e';

interface ClientConfig {
  firebase: { apiKey: string; projectId: string };
}

interface UploadTarget {
  method: 'PUT';
  url: string;
  headers: Record<string, string>;
}

// Real Cloud Storage, unlike tests/web/evidence.e2e.ts, where the Storage
// emulator hands out resumable sessions instead of signed URLs. This is what
// proves deploy.sh lets the server sign: Cloud Run has no key file, so
// signing goes through IAM signBlob (roles/iam.serviceAccountTokenCreator).

async function signUpAnonymously(baseUrl: string): Promise<string> {
  const config: ClientConfig = await (await fetch(new URL('/.well-known/fineprint-client.json', baseUrl))).json();
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${config.firebase.apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ returnSecureToken: true }),
  });
  expect(res.status).toBe(200);
  return (await res.json()).idToken;
}

function call(baseUrl: string, method: string, path: string, idToken: string, body?: unknown) {
  return fetch(new URL(path, baseUrl), {
    method,
    headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

async function rentalWithItem(baseUrl: string, photo: Buffer) {
  const idToken = await signUpAnonymously(baseUrl);
  const rental = await call(baseUrl, 'POST', '/v1/rentals', idToken, { jurisdiction: 'VA', city: 'Richmond' });
  expect(rental.status).toBe(201);
  const { id } = await rental.json();
  const itemId = randomUUID();
  const created = await call(baseUrl, 'POST', `/v1/rentals/${id}/evidence`, idToken, {
    items: [{
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
    }],
  });
  // A 503 here is the signing failure: the server could not call signBlob.
  expect(created.status).toBe(201);
  const { items } = await created.json();
  return { idToken, rentalId: id as string, itemId, upload: items[0].upload as UploadTarget };
}

function put(upload: UploadTarget, body: Buffer) {
  return fetch(upload.url, { method: upload.method, headers: upload.headers, body: new Uint8Array(body) });
}

describe('evidence uploads on a deploy.sh deployment', { platforms: ['web'] }, () => {
  test('the server signs an upload URL and the photo lands in the bucket', async ({ app }) => {
    const baseUrl = app.baseUrl as string;
    const photo = Buffer.from(`move-in photo ${randomUUID()}`);
    const { idToken, rentalId, itemId, upload } = await rentalWithItem(baseUrl, photo);

    const url = new URL(upload.url);
    expect(url.hostname).toBe('storage.googleapis.com');
    expect(url.searchParams.get('X-Goog-Algorithm')).toBe('GOOG4-RSA-SHA256');

    expect((await put(upload, photo)).status).toBe(200);
    const completed = await call(baseUrl, 'POST', `/v1/rentals/${rentalId}/evidence/${itemId}/complete`, idToken);
    expect(completed.status).toBe(200);
    expect(await completed.json()).toMatchObject({ itemId, status: 'received', bytes: photo.length });
  });

  // Real Cloud Storage takes the PUT even though x-goog-content-sha256 is
  // signed: a V4 query-string signature does not cover the payload. The
  // server's own hash of the stored bytes on `complete` is what rejects it.
  test('bytes that do not match the declared hash are rejected on complete', async ({ app }) => {
    const baseUrl = app.baseUrl as string;
    const photo = Buffer.from(`move-in photo ${randomUUID()}`);
    const { idToken, rentalId, itemId, upload } = await rentalWithItem(baseUrl, photo);
    const tampered = Buffer.from(photo);
    tampered.writeUInt8(tampered.readUInt8(0) ^ 0xff, 0);

    expect((await put(upload, tampered)).status).toBe(200);
    const rejected = await call(baseUrl, 'POST', `/v1/rentals/${rentalId}/evidence/${itemId}/complete`, idToken);
    expect(rejected.status).toBe(422);
    expect(await rejected.json()).toMatchObject({ error: { code: 'HASH_MISMATCH' } });
    // The rejected object was deleted from the bucket.
    const again = await call(baseUrl, 'POST', `/v1/rentals/${rentalId}/evidence/${itemId}/complete`, idToken);
    expect(again.status).toBe(409);
  });
});
