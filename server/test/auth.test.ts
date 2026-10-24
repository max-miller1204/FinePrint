import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { InvalidTokenError, firebaseIdTokenVerifier, type VerifyIdToken } from '../src/auth.js';
import { clientConfigFromEnv, type ClientConfig } from '../src/routes/wellknown.js';

const GOOD = 'good.token.value';

const fakeVerifier: VerifyIdToken = async (token) => {
  if (token === GOOD) return { uid: 'uid-123', provider: 'anonymous' };
  if (token === 'expired.token') throw new InvalidTokenError('expired');
  throw new InvalidTokenError('invalid');
};

function setup(verifyIdToken: VerifyIdToken = fakeVerifier) {
  const lines: Record<string, unknown>[] = [];
  const app = createApp({ logSink: (line) => lines.push(JSON.parse(line)), verifyIdToken });
  return { app, lines };
}

const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

describe('/v1 auth', () => {
  it('rejects a request with no token in the envelope', async () => {
    const { app } = setup();
    const res = await app.request('/v1/me');
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe('Bearer realm="fineprint"');
    expect(await res.json()).toEqual({ error: { code: 'UNAUTHENTICATED', message: 'Missing ID token' } });
  });

  it.each(['Basic dXNlcjpwYXNz', 'Bearer', 'Bearer ', 'Bearer two words', GOOD])(
    'treats the malformed header %j as no token',
    async (header) => {
      const { app } = setup();
      const res = await app.request('/v1/me', { headers: { Authorization: header } });
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED', message: 'Missing ID token' } });
    },
  );

  it('rejects an invalid token', async () => {
    const { app } = setup();
    const res = await app.request('/v1/me', bearer('forged.token'));
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe('Bearer realm="fineprint"');
    expect(await res.json()).toEqual({ error: { code: 'UNAUTHENTICATED', message: 'Invalid ID token' } });
  });

  it('tells the client when its token expired', async () => {
    const { app } = setup();
    const res = await app.request('/v1/me', bearer('expired.token'));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: 'UNAUTHENTICATED', message: 'ID token expired' } });
  });

  it('lets a valid token through and exposes the user', async () => {
    const { app } = setup();
    const res = await app.request('/v1/me', { headers: { authorization: `bearer ${GOOD}` } });
    expect(res.status).toBe(200);
    expect(res.headers.get('www-authenticate')).toBeNull();
    expect(await res.json()).toEqual({ uid: 'uid-123', provider: 'anonymous' });
  });

  it('checks auth before routing, so unknown /v1 paths do not leak', async () => {
    const { app } = setup();
    for (const path of ['/v1', '/v1/', '/v1/does-not-exist']) {
      expect((await app.request(path)).status, path).toBe(401);
    }
    const res = await app.request('/v1/does-not-exist', bearer(GOOD));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('leaves public routes open', async () => {
    const { app } = setup();
    expect((await app.request('/healthz')).status).toBe(200);
    expect((await app.request('/nope')).status).toBe(404);
  });

  it('answers 503 when the check itself fails, without logging the token', async () => {
    const secret = 'secret.token.abc';
    const { app, lines } = setup(async (token) => {
      throw new Error(`could not verify ${token}`);
    });
    const res = await app.request('/v1/me', bearer(secret));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'Sign-in check is unavailable' },
    });
    expect(lines).toContainEqual(expect.objectContaining({ severity: 'ERROR', message: 'auth check failed' }));
    expect(JSON.stringify(lines)).not.toContain(secret);
  });

  it('logs why a request was rejected, never the token or the uid', async () => {
    const { app, lines } = setup();
    await app.request('/v1/me');
    await app.request('/v1/me', bearer('forged.token'));
    await app.request('/v1/me', bearer(GOOD));
    expect(lines.filter((l) => l.message === 'auth rejected').map((l) => l.reason)).toEqual(['missing', 'invalid']);
    expect(lines.filter((l) => l.message === 'request').map((l) => l.status)).toEqual([401, 401, 200]);
    const all = JSON.stringify(lines);
    expect(all).not.toContain('forged.token');
    expect(all).not.toContain(GOOD);
    expect(all).not.toContain('uid-123');
  });
});

// Real firebase-admin, offline: in emulator mode it checks every claim but
// skips the signature. These tokens fail before it asks the emulator whether
// the user exists; test/emulator/ covers tokens that pass.
describe('firebaseIdTokenVerifier', () => {
  const PROJECT = 'demo-fineprint';

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function emulatorToken(claims: Record<string, unknown> = {}) {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: `https://securetoken.google.com/${PROJECT}`,
      aud: PROJECT,
      auth_time: now,
      user_id: 'anon-uid',
      sub: 'anon-uid',
      iat: now,
      exp: now + 3600,
      firebase: { identities: {}, sign_in_provider: 'anonymous' },
      ...claims,
    };
    const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    return `${part({ alg: 'none', typ: 'JWT' })}.${part(payload)}.`;
  }

  function emulatorVerifier() {
    vi.stubEnv('FIREBASE_AUTH_EMULATOR_HOST', '127.0.0.1:9099');
    return firebaseIdTokenVerifier({ FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIREBASE_PROJECT_ID: PROJECT });
  }

  it('refuses emulator mode for a real project', () => {
    expect(() => firebaseIdTokenVerifier({ FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', GOOGLE_CLOUD_PROJECT: 'fineprint-prod' })).toThrow(
      /must start with "demo-"/,
    );
    expect(() => firebaseIdTokenVerifier({ FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' })).toThrow(/must start with "demo-"/);
  });

  it('reports an expired token as expired', async () => {
    const past = Math.floor(Date.now() / 1000) - 7200;
    const token = emulatorToken({ iat: past, auth_time: past, exp: past + 3600 });
    await expect(emulatorVerifier()(token)).rejects.toMatchObject({ name: 'InvalidTokenError', reason: 'expired' });
  });

  it.each([
    ['another project', { aud: 'demo-other', iss: 'https://securetoken.google.com/demo-other' }],
    ['a wrong issuer', { iss: 'https://evil.example.org/demo-fineprint' }],
    ['no subject', { sub: '' }],
  ])('rejects a token from %s', async (_, claims) => {
    await expect(emulatorVerifier()(emulatorToken(claims))).rejects.toMatchObject({ name: 'InvalidTokenError', reason: 'invalid' });
  });

  it('rejects something that is not a JWT', async () => {
    await expect(emulatorVerifier()('not-a-jwt')).rejects.toMatchObject({ name: 'InvalidTokenError', reason: 'invalid' });
  });
});

describe('/.well-known/fineprint-client.json', () => {
  const lines: string[] = [];
  const app = (clientConfig: ClientConfig | null) => createApp({ logSink: (l) => lines.push(l), verifyIdToken: fakeVerifier, clientConfig });

  it('publishes the Firebase project the app signs in to, with no token', async () => {
    const config = { firebase: { apiKey: 'AIza-test', projectId: 'fineprint-dev' } };
    const res = await app(config).request('/.well-known/fineprint-client.json');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=300');
    expect(await res.json()).toEqual(config);
  });

  it('answers 503 in the envelope when sign-in is not set up', async () => {
    const res = await app(null).request('/.well-known/fineprint-client.json');
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'Sign-in is not set up on this server' },
    });
  });

  it('reads the key and project from the environment', () => {
    expect(clientConfigFromEnv({})).toBeNull();
    expect(clientConfigFromEnv({ GOOGLE_CLOUD_PROJECT: 'fineprint-dev' })).toBeNull();
    expect(clientConfigFromEnv({ FIREBASE_API_KEY: 'AIza-test', GOOGLE_CLOUD_PROJECT: 'fineprint-dev' })).toEqual({
      firebase: { apiKey: 'AIza-test', projectId: 'fineprint-dev' },
    });
    expect(
      clientConfigFromEnv({ FIREBASE_API_KEY: 'AIza-a', FIREBASE_PROJECT_ID: 'fineprint-a', GOOGLE_CLOUD_PROJECT: 'gcp-b' }),
    ).toEqual({ firebase: { apiKey: 'AIza-a', projectId: 'fineprint-a' } });
  });

  it('points the app at the Auth emulator when the server uses it', () => {
    expect(clientConfigFromEnv({ FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', GCLOUD_PROJECT: 'demo-fineprint' })).toEqual({
      firebase: { apiKey: 'fake-api-key', projectId: 'demo-fineprint', authEmulatorHost: '127.0.0.1:9099' },
    });
  });
});
