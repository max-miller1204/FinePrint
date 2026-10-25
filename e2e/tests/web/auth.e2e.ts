import { describe, expect, test } from 'e2e';

interface ClientConfig {
  firebase: { apiKey: string; projectId: string; authEmulatorHost?: string };
}

// What the iOS app does on first launch: read the server's Firebase project,
// then create an anonymous account there. No user input.
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

describe('Firebase anonymous auth on /v1', { platforms: ['web'] }, () => {
  test('a request with no token is 401 in the envelope', async ({ app }) => {
    const res = await fetch(new URL('/v1/me', app.baseUrl));
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('www-authenticate')).toContain('Bearer');
    expect(res.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(await res.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
  });

  test('a forged or malformed token is 401', async ({ app }) => {
    for (const authorization of ['Bearer not-a-token', 'Bearer eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.', 'Basic dXNlcjpwYXNz']) {
      const res = await fetch(new URL('/v1/me', app.baseUrl), { headers: { Authorization: authorization } });
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
    }
  });

  test('an unknown /v1 path needs a token before it says 404', async ({ app }) => {
    const res = await fetch(new URL('/v1/does-not-exist', app.baseUrl));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
  });

  test('an anonymous ID token reaches /v1/me', async ({ app }) => {
    const { idToken, localId } = await signUpAnonymously(app.baseUrl);
    const res = await fetch(new URL('/v1/me', app.baseUrl), { headers: { Authorization: `Bearer ${idToken}` } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ uid: localId, provider: 'anonymous' });
  });

  test('the client config is public and names the emulated project', async ({ app }) => {
    const res = await fetch(new URL('/.well-known/fineprint-client.json', app.baseUrl));
    expect(res.status).toBe(200);
    // The web target runs the Auth emulator, so the app is pointed at it.
    expect(await res.json()).toEqual({
      firebase: { apiKey: expect.any(String), projectId: 'demo-fineprint', authEmulatorHost: `127.0.0.1:${process.env.E2E_AUTH_PORT ?? '9099'}` },
    });
  });

  test('public routes need no token', async ({ app }) => {
    expect((await fetch(new URL('/healthz', app.baseUrl))).status).toBe(200);
  });
});
