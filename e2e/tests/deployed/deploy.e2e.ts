import { describe, expect, test } from 'e2e';

interface ClientConfig {
  firebase: { apiKey: string; projectId: string; authEmulatorHost?: string };
}

// Run with e2e.deployed.config.ts against the URL deploy.sh printed. These
// pin what the script wires up: the image, the env vars, Identity Platform
// with anonymous sign-in, and the app's API key.
describe('a deploy.sh deployment', { platforms: ['web'] }, () => {
  // Cloud Run reserves paths ending in z on *.run.app, so /healthz is
  // answered by Google's front end there; /health is the same check.
  test('/health answers on the Cloud Run URL', async ({ app }) => {
    const res = await fetch(new URL('/health', app.baseUrl));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toMatchObject({ status: 'ok' });
  });

  test('the client config names the real project, not an emulator', async ({ app }) => {
    const res = await fetch(new URL('/.well-known/fineprint-client.json', app.baseUrl));
    expect(res.status).toBe(200);
    const { firebase }: ClientConfig = await res.json();
    expect(firebase.apiKey).toMatch(/^AIza/);
    expect(firebase.projectId.length).toBeGreaterThan(0);
    expect(firebase.authEmulatorHost).toBeUndefined();
  });

  test('an anonymous sign-in with the served key reaches /v1/me', async ({ app }) => {
    const config: ClientConfig = await (await fetch(new URL('/.well-known/fineprint-client.json', app.baseUrl))).json();
    const signUp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${config.firebase.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnSecureToken: true }),
    });
    expect(signUp.status).toBe(200);
    const { idToken, localId } = await signUp.json();

    const res = await fetch(new URL('/v1/me', app.baseUrl), { headers: { Authorization: `Bearer ${idToken}` } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ uid: localId, provider: 'anonymous' });
  });

  test('/v1 without a token is 401', async ({ app }) => {
    const res = await fetch(new URL('/v1/me', app.baseUrl));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
  });
});
