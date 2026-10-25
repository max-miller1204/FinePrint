import { createPublicKey, generateKeyPairSync, sign as signLocally, verify, type JsonWebKey, type KeyObject } from 'node:crypto';
import { KeyManagementServiceClient } from '@google-cloud/kms';
import { canonicalize, sha256Hex } from './jcs.js';

// Signing for manifests and ledger entries (spec §8.2): Cloud KMS
// `asymmetricSign` with an EC_SIGN_P256_SHA256 key. The public half is
// published at /.well-known/fineprint-keys.json, so anyone can verify
// without asking the server.

// A JWK as the key set publishes it. `kid` is the RFC 7638 thumbprint.
export interface PublicJwk {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
  kid: string;
  alg: 'ES256';
  use: 'sig';
}

export interface Signature {
  // Raw r || s (IEEE P1363), 64 bytes, as WebCrypto's ECDSA verify takes it.
  signatureB64: string;
  keyId: string;
  kmsKeyVersion: string;
}

export interface Signer {
  // Signs `data` (ES256: ECDSA P-256 over its SHA-256).
  sign(data: Buffer): Promise<Signature>;
  // Every key a stored signature may name, newest first.
  publicKeys(): Promise<PublicJwk[]>;
}

export function toPublicJwk(key: KeyObject): PublicJwk {
  const { kty, crv, x, y } = key.export({ format: 'jwk' }) as JsonWebKey;
  if (kty !== 'EC' || crv !== 'P-256' || !x || !y) throw new Error('Not a P-256 public key');
  // RFC 7638: the required members, in JCS form, hashed.
  const kid = Buffer.from(sha256Hex(canonicalize({ crv, kty, x, y })), 'hex').toString('base64url');
  return { kty, crv, x, y, kid, alg: 'ES256', use: 'sig' };
}

export function verifySignature(jwk: PublicJwk, data: Buffer, signatureB64: string): boolean {
  const key = createPublicKey({ key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, format: 'jwk' });
  return verify('sha256', data, { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(signatureB64, 'base64'));
}

// KMS returns ECDSA signatures DER-encoded: SEQUENCE { INTEGER r, INTEGER s }.
export function derToP1363(der: Buffer): Buffer {
  if (der[0] !== 0x30) throw new Error('Not a DER signature');
  let at = der[1]! & 0x80 ? 2 + (der[1]! & 0x7f) : 2;
  const integer = () => {
    if (der[at] !== 0x02) throw new Error('Not a DER signature');
    const length = der[at + 1]!;
    let value = der.subarray(at + 2, at + 2 + length);
    at += 2 + length;
    while (value.length > 32 && value[0] === 0) value = value.subarray(1);
    if (value.length > 32) throw new Error('Not a P-256 signature');
    return Buffer.concat([Buffer.alloc(32 - value.length), value]);
  };
  return Buffer.concat([integer(), integer()]);
}

// A key made at startup and never stored, for the emulators and tests.
// Signatures from it verify only while this process runs.
export function localSigner(): Signer {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = toPublicJwk(publicKey);
  return {
    async sign(data) {
      const signature = signLocally('sha256', data, { key: privateKey, dsaEncoding: 'ieee-p1363' });
      return { signatureB64: signature.toString('base64'), keyId: jwk.kid, kmsKeyVersion: 'local' };
    },
    async publicKeys() {
      return [jwk];
    },
  };
}

// Key versions change only on deploy, so they are read once a while.
const KEY_CACHE_MS = 10 * 60 * 1000;

interface KeyVersion {
  name: string;
  jwk: PublicJwk;
}

// `keyName` is the CryptoKey (deploy.sh's KMS_SIGNING_KEY). It signs with
// the newest enabled version and publishes every enabled one, so earlier
// signatures stay verifiable after a version is added.
export function kmsSigner(keyName: string, client: () => KeyManagementServiceClient = () => new KeyManagementServiceClient()): Signer {
  let kms: KeyManagementServiceClient | undefined;
  let cached: { at: number; versions: Promise<KeyVersion[]> } | undefined;
  const connect = () => (kms ??= client());

  const versions = () => {
    if (cached && Date.now() - cached.at < KEY_CACHE_MS) return cached.versions;
    const load = (async () => {
      const [list] = await connect().listCryptoKeyVersions({ parent: keyName, filter: 'state=ENABLED' });
      const names = list.map((version) => version.name).filter((name): name is string => Boolean(name));
      names.sort((a, b) => versionNumber(b) - versionNumber(a));
      if (names.length === 0) throw new Error('The signing key has no enabled version');
      return Promise.all(
        names.map(async (name) => {
          const [{ pem }] = await connect().getPublicKey({ name });
          if (!pem) throw new Error('KMS returned no public key');
          return { name, jwk: toPublicJwk(createPublicKey(pem)) };
        }),
      );
    })();
    cached = { at: Date.now(), versions: load };
    load.catch(() => {
      if (cached?.versions === load) cached = undefined;
    });
    return load;
  };

  return {
    async sign(data) {
      const [newest] = await versions();
      const [response] = await connect().asymmetricSign({ name: newest!.name, digest: { sha256: Buffer.from(sha256Hex(data), 'hex') } });
      if (!response.signature) throw new Error('KMS returned no signature');
      const signatureB64 = derToP1363(Buffer.from(response.signature as Uint8Array)).toString('base64');
      // Checked against the published key before anything is stored, in place
      // of KMS's CRC32C round trip.
      if (!verifySignature(newest!.jwk, data, signatureB64)) throw new Error('KMS signature does not verify');
      return { signatureB64, keyId: newest!.jwk.kid, kmsKeyVersion: newest!.name };
    },
    async publicKeys() {
      return (await versions()).map((version) => version.jwk);
    },
  };
}

const versionNumber = (name: string) => Number(name.slice(name.lastIndexOf('/') + 1));

// KMS_SIGNING_KEY in production (deploy.sh sets it). Under the emulators, a
// local key. Otherwise null: sealing answers 503 until a key is set.
export function signerFromEnv(env: NodeJS.ProcessEnv = process.env): Signer | null {
  if (env.KMS_SIGNING_KEY) return kmsSigner(env.KMS_SIGNING_KEY);
  if (env.FIRESTORE_EMULATOR_HOST) return localSigner();
  return null;
}
