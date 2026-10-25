import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, test } from 'e2e';

interface ClientConfig {
  firebase: { apiKey: string; projectId: string; authEmulatorHost?: string };
}

interface Jwk {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
  kid: string;
}

interface LedgerEntry {
  seq: number;
  type: string;
  payload: Record<string, string | number>;
  payloadHash: string;
  prevEntryHash: string;
  entryHash: string;
  signatureB64: string;
  keyId: string;
  at: string;
}

// What the iOS app does on first launch (see auth.e2e.ts).
async function signUpAnonymously(baseUrl: string): Promise<{ idToken: string }> {
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

async function storedItem(rentalId: string, itemId: string): Promise<{ fields: Record<string, Record<string, unknown>> }> {
  const res = await fetch(`http://127.0.0.1:${process.env.E2E_FIRESTORE_PORT ?? '8090'}/v1/projects/demo-fineprint/databases/(default)/documents/rentals/${rentalId}/evidence/${itemId}`, {
    headers: { Authorization: 'Bearer owner' },
  });
  expect(res.status).toBe(200);
  return res.json();
}

function baseOf(app: { baseUrl?: string }): string {
  if (!app.baseUrl) throw new Error('The web target has no base URL');
  return app.baseUrl;
}

const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

// RFC 8785 for the ids, hashes, and numbers a ledger entry holds, written
// apart from the server's so the check is independent of it.
function jcs(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(jcs).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${jcs((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

// The check the web report's Verify button will run: WebCrypto ES256
// against the published key set.
async function verifies(keys: Jwk[], keyId: string, data: string, signatureB64: string): Promise<boolean> {
  const jwk = keys.find((key) => key.kid === keyId);
  if (!jwk) return false;
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, Buffer.from(signatureB64, 'base64'), new TextEncoder().encode(data));
}

// A rental with `count` photos uploaded to the Storage emulator and completed.
async function rentalWithPhotos(baseUrl: string, count: number) {
  const { idToken } = await signUpAnonymously(baseUrl);
  const { id: rentalId } = await (await call(baseUrl, 'POST', '/v1/rentals', idToken, { jurisdiction: 'VA', city: 'Richmond' })).json();
  const itemIds: string[] = [];
  for (let i = 0; i < count; i++) {
    const photo = Buffer.from(`move-in photo ${i} ${randomUUID()}`);
    const itemId = randomUUID();
    const created = await call(baseUrl, 'POST', `/v1/rentals/${rentalId}/evidence`, idToken, {
      items: [
        {
          itemId,
          room: 'Kitchen',
          checklistItem: `Item ${i}`,
          sha256: sha256(photo),
          bytes: photo.length,
          mime: 'image/jpeg',
          capturedAtDevice: `2026-08-14T15:12:0${i}-04:00`,
          deviceUptimeMs: 81233411 + i,
          source: 'in_app_camera',
          appVersion: '1.0.0 (12)',
        },
      ],
    });
    expect(created.status).toBe(201);
    const { upload } = (await created.json()).items[0];
    expect((await fetch(upload.url, { method: upload.method, headers: upload.headers, body: new Uint8Array(photo) })).status).toBe(200);
    expect((await call(baseUrl, 'POST', `/v1/rentals/${rentalId}/evidence/${itemId}/complete`, idToken)).status).toBe(200);
    itemIds.push(itemId);
  }
  return { idToken, rentalId: rentalId as string, itemIds };
}

describe('Evidence sealing and ledger', { platforms: ['web'] }, () => {
  test('a sealed manifest verifies with WebCrypto against the published key, and still does after a photo is deleted', async ({ app }) => {
    const baseUrl = baseOf(app);
    const { idToken, rentalId, itemIds } = await rentalWithPhotos(baseUrl, 2);

    const keysRes = await fetch(new URL('/.well-known/fineprint-keys.json', baseUrl));
    expect(keysRes.status).toBe(200);
    expect(keysRes.headers.get('cache-control')).toBe('public, max-age=300');
    const { keys } = (await keysRes.json()) as { keys: Jwk[] };
    expect(keys[0]).toMatchObject({ kty: 'EC', crv: 'P-256', alg: 'ES256', use: 'sig' });

    const sealed = await call(baseUrl, 'POST', `/v1/rentals/${rentalId}/seal`, idToken, { session: 'move_in' });
    expect(sealed.status).toBe(201);
    const { manifest, ledgerEntry } = await sealed.json();
    expect(manifest).toMatchObject({ kind: 'move_in', itemIds, sha256: sha256(manifest.canonicalJson) });
    expect(jcs(JSON.parse(manifest.canonicalJson))).toBe(manifest.canonicalJson);
    expect(await verifies(keys, manifest.keyId, manifest.canonicalJson, manifest.signatureB64)).toBe(true);
    expect(ledgerEntry).toMatchObject({ seq: 1, type: 'manifest_sealed' });
    const { fields } = await storedItem(rentalId, itemIds[0]!);
    expect(fields.sealedManifestId).toEqual({ stringValue: manifest.manifestId });

    const deleted = await call(baseUrl, 'DELETE', `/v1/rentals/${rentalId}/evidence/${itemIds[0]}`, idToken);
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toMatchObject({ itemId: itemIds[0], status: 'deleted' });
    expect((await storedItem(rentalId, itemIds[0]!)).fields.deletedAt).toHaveProperty('timestampValue');

    // Read back from Firestore, the manifest still verifies.
    const stored = await (await call(baseUrl, 'GET', `/v1/rentals/${rentalId}/manifests/${manifest.manifestId}`, idToken)).json();
    expect(stored).toEqual(manifest);
    expect(await verifies(keys, stored.keyId, stored.canonicalJson, stored.signatureB64)).toBe(true);

    // The ledger chains and every entry verifies.
    const { entries } = (await (await call(baseUrl, 'GET', `/v1/rentals/${rentalId}/ledger`, idToken)).json()) as { entries: LedgerEntry[] };
    expect(entries.map((entry) => entry.type)).toEqual(['manifest_sealed', 'evidence_deleted']);
    expect(entries[1]!.payload).toMatchObject({ itemId: itemIds[0] });
    let prev = '0'.repeat(64);
    for (const entry of entries) {
      expect(entry.prevEntryHash).toBe(prev);
      expect(sha256(jcs(entry.payload))).toBe(entry.payloadHash);
      const signed = jcs({ seq: entry.seq, type: entry.type, payloadHash: entry.payloadHash, prevEntryHash: entry.prevEntryHash, at: entry.at });
      expect(sha256(signed)).toBe(entry.entryHash);
      expect(await verifies(keys, entry.keyId, signed, entry.signatureB64)).toBe(true);
      prev = entry.entryHash;
    }
  });

  test('another user cannot seal, read the ledger, or delete a photo', async ({ app }) => {
    const baseUrl = baseOf(app);
    const { rentalId, itemIds } = await rentalWithPhotos(baseUrl, 1);
    const other = await signUpAnonymously(baseUrl);
    expect((await call(baseUrl, 'POST', `/v1/rentals/${rentalId}/seal`, other.idToken, {})).status).toBe(403);
    expect((await call(baseUrl, 'GET', `/v1/rentals/${rentalId}/ledger`, other.idToken)).status).toBe(403);
    const res = await call(baseUrl, 'DELETE', `/v1/rentals/${rentalId}/evidence/${itemIds[0]}`, other.idToken);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });
});
