import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import type { KeyManagementServiceClient } from '@google-cloud/kms';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { VerifyIdToken } from '../src/auth.js';
import { InvalidTokenError } from '../src/auth.js';
import { canonicalize } from '../src/integrity/jcs.js';
import { derToP1363, kmsSigner, localSigner, type PublicJwk, type Signer, verifySignature } from '../src/integrity/kms.js';
import { type LedgerEntry, newLedgerEntry, verifyLedger } from '../src/integrity/ledger.js';
import { verifyManifest } from '../src/integrity/manifest.js';
import { modelCopyPath, originalPath } from '../src/storage/gcs.js';
import { memoryObjects } from './memory-objects.js';
import { memoryStore } from './memory-store.js';

const fakeVerifier: VerifyIdToken = async (token) => {
  if (token === 'alice' || token === 'mallory') return { uid: token, provider: 'anonymous' };
  throw new InvalidTokenError('invalid');
};

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

function setup(signer: Signer | null = localSigner()) {
  const memory = memoryStore();
  const objects = memoryObjects();
  const lines: Record<string, unknown>[] = [];
  const app = createApp({ logSink: (line) => lines.push(JSON.parse(line)), verifyIdToken: fakeVerifier, store: memory.store, objects: objects.store, signer });
  const send = (method: string, path: string, as = 'alice', body?: unknown) =>
    app.request(path, {
      method,
      headers: { Authorization: `Bearer ${as}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const keys = async (): Promise<PublicJwk[]> => (await (await app.request('/.well-known/fineprint-keys.json')).json()).keys;
  // A rental with `count` photos uploaded and completed.
  const rentalWithPhotos = async (count: number) => {
    const { id } = await (await send('POST', '/v1/rentals', 'alice', { jurisdiction: 'VA', city: 'Richmond' })).json();
    const itemIds: string[] = [];
    for (let i = 0; i < count; i++) {
      const photo = Buffer.from(`photo ${i} ${randomUUID()}`);
      const itemId = randomUUID();
      await send('POST', `/v1/rentals/${id}/evidence`, 'alice', {
        items: [
          {
            itemId,
            room: 'Kitchen',
            checklistItem: `Item ${i}`,
            sha256: sha256(photo),
            bytes: photo.length,
            mime: 'image/heic',
            capturedAtDevice: `2026-08-14T15:12:0${i}-04:00`,
            deviceUptimeMs: 81233411 + i,
            source: 'in_app_camera',
            appVersion: '1.0.0 (12)',
          },
        ],
      });
      objects.put(originalPath(id, itemId), photo);
      expect((await send('POST', `/v1/rentals/${id}/evidence/${itemId}/complete`)).status).toBe(200);
      itemIds.push(itemId);
    }
    return { rentalId: id as string, itemIds };
  };
  return { app, send, keys, rentalWithPhotos, memory, objects, lines };
}

describe('JCS (RFC 8785)', () => {
  it('sorts keys by UTF-16 code unit and serializes numbers as ECMAScript does', () => {
    // RFC 8785 §3.2.3 and appendix B values.
    expect(canonicalize({ '€': 'Euro Sign', '\r': 'Carriage Return', 'דּ': 'Hebrew Letter Dalet With Dagesh', '1': 'One', '😀': 'Emoji: Grinning Face', '\u0080': 'Control', 'ö': 'Latin Small Letter O With Diaeresis' })).toBe(
      '{"\\r":"Carriage Return","1":"One","\u0080":"Control","ö":"Latin Small Letter O With Diaeresis","€":"Euro Sign","😀":"Emoji: Grinning Face","דּ":"Hebrew Letter Dalet With Dagesh"}',
    );
    expect(canonicalize([1e21, 1e-7, -0, 0.000001, 333333333.3333333, 4.5, 2e-3, 1e23])).toBe('[1e+21,1e-7,0,0.000001,333333333.3333333,4.5,0.002,1e+23]');
    expect(canonicalize({ b: [true, null, 'x\n"'], a: { d: 1, c: 2 } })).toBe('{"a":{"c":2,"d":1},"b":[true,null,"x\\n\\""]}');
  });

  it('refuses what JSON cannot carry', () => {
    expect(() => canonicalize(Number.NaN)).toThrow(TypeError);
    expect(() => canonicalize(new Date())).toThrow(TypeError);
  });
});

describe('KMS signer', () => {
  // KMS as far as the signer uses it, backed by a local P-256 key that
  // returns DER signatures as KMS does. Node signs only whole messages, so
  // the fake knows the messages it may be asked to sign by their digest.
  function fakeKms(messages: Buffer[]) {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const byDigest = new Map(messages.map((message) => [sha256(message), message]));
    const signed: string[] = [];
    const client = {
      async listCryptoKeyVersions() {
        return [[{ name: 'k/cryptoKeyVersions/1' }, { name: 'k/cryptoKeyVersions/2' }]];
      },
      async getPublicKey({ name }: { name: string }) {
        const key = name.endsWith('/2') ? publicKey : generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey;
        return [{ pem: key.export({ format: 'pem', type: 'spki' }) }];
      },
      async asymmetricSign({ name, digest }: { name: string; digest: { sha256: Buffer } }) {
        signed.push(name);
        const message = byDigest.get(digest.sha256.toString('hex'));
        if (!message) throw new Error('unexpected digest');
        return [{ signature: sign('sha256', message, { key: privateKey, dsaEncoding: 'der' }) }];
      },
    };
    return { client: client as unknown as KeyManagementServiceClient, signed };
  }

  it('signs with the newest enabled version, in the raw form WebCrypto verifies, and publishes every version', async () => {
    const data = Buffer.from('{"hello":"world"}');
    const kms = fakeKms([data]);
    const signer = kmsSigner('k', () => kms.client);
    const signature = await signer.sign(data);
    expect(kms.signed).toEqual(['k/cryptoKeyVersions/2']);
    expect(signature.kmsKeyVersion).toBe('k/cryptoKeyVersions/2');
    expect(Buffer.from(signature.signatureB64, 'base64')).toHaveLength(64);
    const keys = await signer.publicKeys();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatchObject({ kty: 'EC', crv: 'P-256', alg: 'ES256', use: 'sig', kid: signature.keyId });
    expect(verifySignature(keys[0]!, data, signature.signatureB64)).toBe(true);
  });

  it('converts DER signatures with short r or s', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' }) as PublicJwk;
    for (let i = 0; i < 50; i++) {
      const data = Buffer.from(`message ${i}`);
      const raw = derToP1363(sign('sha256', data, { key: privateKey, dsaEncoding: 'der' }));
      expect(raw).toHaveLength(64);
      expect(verifySignature({ ...jwk, kid: 'k', alg: 'ES256', use: 'sig' }, data, raw.toString('base64'))).toBe(true);
    }
  });
});

describe('ledger', () => {
  async function chain(signer: Signer, length: number) {
    const entries: LedgerEntry[] = [];
    for (let i = 0; i < length; i++) {
      const head = entries.at(-1) ?? null;
      entries.push(await newLedgerEntry(signer, head, 'evidence_deleted', { itemId: `item-${i}`, sha256: 'a'.repeat(64) }, new Date(Date.UTC(2026, 7, 14, 0, i))));
    }
    return entries;
  }

  it('verifies an intact chain', async () => {
    const signer = localSigner();
    expect(verifyLedger(await chain(signer, 4), await signer.publicKeys())).toEqual({ ok: true });
  });

  it('detects a removed entry', async () => {
    const signer = localSigner();
    const entries = await chain(signer, 4);
    entries.splice(1, 1);
    expect(verifyLedger(entries, await signer.publicKeys())).toMatchObject({ ok: false, seq: 3 });
  });

  it('detects reordered entries', async () => {
    const signer = localSigner();
    const entries = await chain(signer, 4);
    [entries[1], entries[2]] = [entries[2]!, entries[1]!];
    expect(verifyLedger(entries, await signer.publicKeys())).toMatchObject({ ok: false, seq: 3 });
  });

  it('detects a renumbered chain, an edited payload, and a forged signature', async () => {
    const signer = localSigner();
    const keys = await signer.publicKeys();
    const renumbered = (await chain(signer, 3)).map((entry, i) => ({ ...entry, seq: i === 0 ? 1 : entry.seq + 1 }));
    expect(verifyLedger(renumbered, keys)).toMatchObject({ ok: false, reason: 'sequence' });
    const edited = await chain(signer, 2);
    edited[0] = { ...edited[0]!, payload: { ...edited[0]!.payload, itemId: 'someone-else' } };
    expect(verifyLedger(edited, keys)).toMatchObject({ ok: false, seq: 1, reason: 'payload' });
    const other = await chain(localSigner(), 1);
    expect(verifyLedger([{ ...other[0]!, keyId: keys[0]!.kid }], keys)).toMatchObject({ ok: false, reason: 'signature' });
  });
});

describe('POST /v1/rentals/:id/seal', () => {
  it('signs a manifest that verifies against the published key', async () => {
    const { send, keys, rentalWithPhotos, memory, lines } = setup();
    const { rentalId, itemIds } = await rentalWithPhotos(2);
    const res = await send('POST', `/v1/rentals/${rentalId}/seal`, 'alice', {});
    expect(res.status).toBe(201);
    const { manifest, ledgerEntry, pending } = await res.json();
    expect(pending).toBe(0);
    expect(manifest).toMatchObject({ kind: 'move_in', itemIds, sha256: sha256(Buffer.from(manifest.canonicalJson)) });
    expect(verifyManifest(manifest, await keys())).toEqual({ ok: true });
    const body = JSON.parse(manifest.canonicalJson);
    expect(body).toMatchObject({ version: 1, manifestId: manifest.manifestId, rentalId, kind: 'move_in', prevLedgerHead: null });
    expect(body.items.map((item: { itemId: string }) => item.itemId)).toEqual(itemIds);
    expect(ledgerEntry).toMatchObject({ seq: 1, type: 'manifest_sealed', payload: { manifestId: manifest.manifestId, sha256: manifest.sha256, items: 2 } });

    // A changed byte in the manifest no longer verifies.
    const tampered = { ...manifest, canonicalJson: manifest.canonicalJson.replace('Kitchen', 'Kitchon') };
    expect(verifyManifest(tampered, await keys())).toMatchObject({ ok: false });
    expect(verifyManifest({ ...tampered, sha256: sha256(Buffer.from(tampered.canonicalJson)) }, await keys())).toEqual({ ok: false, reason: 'signature' });

    for (const itemId of itemIds) expect(memory.evidence.get(`${rentalId}/${itemId}`)?.sealedManifestId).toBe(manifest.manifestId);
    expect(lines).toContainEqual(expect.objectContaining({ message: 'manifest sealed', rentalId, items: 2, pending: 0, seq: 1 }));
  });

  it('chains a second seal to the first and keeps each item on its first manifest', async () => {
    const { send, keys, rentalWithPhotos, memory } = setup();
    const { rentalId, itemIds } = await rentalWithPhotos(1);
    const first = (await (await send('POST', `/v1/rentals/${rentalId}/seal`, 'alice', {})).json()).manifest;
    const second = await (await send('POST', `/v1/rentals/${rentalId}/seal`, 'alice', { session: 'move_in' })).json();
    expect(JSON.parse(second.manifest.canonicalJson).prevLedgerHead).toMatchObject({ seq: 1 });
    expect(second.ledgerEntry.seq).toBe(2);
    expect(memory.evidence.get(`${rentalId}/${itemIds[0]}`)?.sealedManifestId).toBe(first.manifestId);

    const { entries } = await (await send('GET', `/v1/rentals/${rentalId}/ledger`)).json();
    expect(verifyLedger(entries, await keys())).toEqual({ ok: true });
    const fetched = await (await send('GET', `/v1/rentals/${rentalId}/manifests/${first.manifestId}`)).json();
    expect(fetched).toEqual(first);
  });

  it('is 409 with nothing received, 403 for another user, and 503 with no signing key', async () => {
    const { send, rentalWithPhotos } = setup();
    const { rentalId } = await rentalWithPhotos(1);
    expect((await send('POST', `/v1/rentals/${rentalId}/seal`, 'mallory', {})).status).toBe(403);
    expect((await send('POST', `/v1/rentals/${rentalId}/seal`, 'alice', { session: 'move_out' })).status).toBe(409);
    expect((await send('POST', `/v1/rentals/${rentalId}/seal`, 'alice', { gcsPath: 'x' })).status).toBe(400);
    expect((await send('GET', `/v1/rentals/${rentalId}/manifests/${randomUUID()}`)).status).toBe(404);

    const unsigned = setup(null);
    const other = await unsigned.rentalWithPhotos(1);
    const res = await unsigned.send('POST', `/v1/rentals/${other.rentalId}/seal`, 'alice', {});
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: 'DEPENDENCY_UNAVAILABLE' } });
    expect((await unsigned.app.request('/.well-known/fineprint-keys.json')).status).toBe(503);
  });

  it('is 503 when signing fails, and logs no key name', async () => {
    const failing: Signer = {
      sign: async () => {
        throw new Error('projects/p/locations/l/keyRings/r/cryptoKeys/k is down');
      },
      publicKeys: async () => [],
    };
    const { send, rentalWithPhotos, lines } = setup(failing);
    const { rentalId } = await rentalWithPhotos(1);
    expect((await send('POST', `/v1/rentals/${rentalId}/seal`, 'alice', {})).status).toBe(503);
    expect(JSON.stringify(lines)).not.toContain('cryptoKeys');
  });
});

describe('DELETE /v1/rentals/:id/evidence/:itemId', () => {
  it('deletes the bytes, logs evidence_deleted, and leaves the manifest verifiable', async () => {
    const { send, keys, rentalWithPhotos, objects } = setup();
    const { rentalId, itemIds } = await rentalWithPhotos(2);
    const { manifest } = await (await send('POST', `/v1/rentals/${rentalId}/seal`, 'alice', {})).json();
    const deleted = itemIds[0]!;
    objects.put(modelCopyPath(rentalId, deleted), Buffer.from('copy'), 'image/jpeg');

    const res = await send('DELETE', `/v1/rentals/${rentalId}/evidence/${deleted.toUpperCase()}`);
    expect(res.status).toBe(200);
    const item = await res.json();
    expect(item).toMatchObject({ itemId: deleted, status: 'deleted', sealedManifestId: manifest.manifestId });
    expect(Number.isNaN(Date.parse(item.deletedAt))).toBe(false);
    expect(objects.objects.has(originalPath(rentalId, deleted))).toBe(false);
    expect(objects.objects.has(modelCopyPath(rentalId, deleted))).toBe(false);
    expect(objects.objects.has(originalPath(rentalId, itemIds[1]!))).toBe(true);

    // The manifest signed the hash, so it still verifies with the photo gone.
    const stored = await (await send('GET', `/v1/rentals/${rentalId}/manifests/${manifest.manifestId}`)).json();
    expect(verifyManifest(stored, await keys())).toEqual({ ok: true });
    const { entries } = await (await send('GET', `/v1/rentals/${rentalId}/ledger`)).json();
    expect(entries.map((entry: LedgerEntry) => entry.type)).toEqual(['manifest_sealed', 'evidence_deleted']);
    expect(entries[1].payload).toEqual({ itemId: deleted, sha256: JSON.parse(manifest.canonicalJson).items[0].sha256 });
    expect(verifyLedger(entries, await keys())).toEqual({ ok: true });

    // Again: the same answer and no second entry. A new seal leaves it out.
    expect(await (await send('DELETE', `/v1/rentals/${rentalId}/evidence/${deleted}`)).json()).toEqual(item);
    const next = await (await send('POST', `/v1/rentals/${rentalId}/seal`, 'alice', {})).json();
    expect(next.manifest.itemIds).toEqual([itemIds[1]]);
    expect((await (await send('GET', `/v1/rentals/${rentalId}/ledger`)).json()).entries).toHaveLength(3);

    // A deleted photo cannot be completed again.
    expect((await send('POST', `/v1/rentals/${rentalId}/evidence/${deleted}/complete`)).status).toBe(409);
  });

  it('is 403 for another user and 404 for an unknown item', async () => {
    const { send, rentalWithPhotos, objects } = setup();
    const { rentalId, itemIds } = await rentalWithPhotos(1);
    expect((await send('DELETE', `/v1/rentals/${rentalId}/evidence/${itemIds[0]}`, 'mallory')).status).toBe(403);
    expect((await send('DELETE', `/v1/rentals/${rentalId}/evidence/${randomUUID()}`)).status).toBe(404);
    expect(objects.objects.has(originalPath(rentalId, itemIds[0]!))).toBe(true);
  });
});
