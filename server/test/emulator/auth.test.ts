import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';

// Runs under `pnpm test:emulator`, which starts the Auth emulator and sets
// FIREBASE_AUTH_EMULATOR_HOST and GCLOUD_PROJECT. The app uses its default
// firebase-admin verifier, so this is the production code path end to end.

const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const identityToolkit = `http://${host}/identitytoolkit.googleapis.com/v1`;

async function call<T>(method: string, body: object): Promise<T> {
  // The emulator accepts any API key.
  const res = await fetch(`${identityToolkit}/${method}?key=fake-api-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

// What the iOS app does on first launch: an anonymous account, no input.
const signUpAnonymously = () => call<{ idToken: string; localId: string }>('accounts:signUp', { returnSecureToken: true });

// An unsigned IdP token, which the emulator accepts in place of Apple's.
function fakeAppleIdToken() {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return `${part({ alg: 'none' })}.${part({ iss: 'https://appleid.apple.com', aud: 'org.fineprint.FinePrint', sub: 'apple-sub-1', iat: now, exp: now + 600 })}.`;
}

function setup() {
  const lines: Record<string, unknown>[] = [];
  return { app: createApp({ logSink: (line) => lines.push(JSON.parse(line)) }), lines };
}

describe.runIf(host)('/v1 against the Auth emulator', () => {
  it('accepts the ID token from an anonymous sign-up', async () => {
    const { idToken, localId } = await signUpAnonymously();
    const res = await setup().app.request('/v1/me', { headers: { Authorization: `Bearer ${idToken}` } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ uid: localId, provider: 'anonymous' });
  });

  it('keeps the uid when the anonymous account links Sign in with Apple', async () => {
    const anon = await signUpAnonymously();
    const linked = await call<{ idToken: string; localId: string }>('accounts:signInWithIdp', {
      idToken: anon.idToken,
      postBody: `id_token=${fakeAppleIdToken()}&providerId=apple.com`,
      requestUri: 'http://localhost',
      returnSecureToken: true,
    });
    expect(linked.localId).toBe(anon.localId);
    const res = await setup().app.request('/v1/me', { headers: { Authorization: `Bearer ${linked.idToken}` } });
    expect(await res.json()).toEqual({ uid: anon.localId, provider: 'apple' });
  });

  it('rejects the token of a deleted account', async () => {
    const { idToken } = await signUpAnonymously();
    await call('accounts:delete', { idToken });
    const res = await setup().app.request('/v1/me', { headers: { Authorization: `Bearer ${idToken}` } });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
  });

  it('rejects a token with a forged uid', async () => {
    const { idToken } = await signUpAnonymously();
    const [header, payload] = idToken.split('.');
    const claims = JSON.parse(Buffer.from(payload!, 'base64url').toString());
    const forged = Buffer.from(JSON.stringify({ ...claims, sub: 'someone-else', user_id: 'someone-else' })).toString('base64url');
    const res = await setup().app.request('/v1/me', { headers: { Authorization: `Bearer ${header}.${forged}.` } });
    expect(res.status).toBe(401);
  });
});
