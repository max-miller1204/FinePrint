import { describe, expect, test } from 'e2e';

interface ClientConfig {
  firebase: { apiKey: string; projectId: string; authEmulatorHost?: string };
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

function call(baseUrl: string, method: string, path: string, idToken: string, body: unknown) {
  return fetch(new URL(path, baseUrl), {
    method,
    headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// The stored document, read from the Firestore emulator in ../firebase.json.
// `Bearer owner` is the emulator's admin bypass of the deny-all rules.
async function storedRental(id: string): Promise<{ fields: Record<string, Record<string, unknown>> }> {
  const res = await fetch(`http://127.0.0.1:${process.env.E2E_FIRESTORE_PORT ?? '8090'}/v1/projects/demo-fineprint/databases/(default)/documents/rentals/${id}`, {
    headers: { Authorization: 'Bearer owner' },
  });
  expect(res.status).toBe(200);
  return res.json();
}

describe('Rentals API', { platforms: ['web'] }, () => {
  test('an anonymous user creates a rental and patches its dates', async ({ app }) => {
    const { idToken, localId } = await signUpAnonymously(app.baseUrl);

    const created = await call(app.baseUrl, 'POST', '/v1/rentals', idToken, { jurisdiction: 'VA', city: 'Richmond', monthlyRent: 1450 });
    expect(created.status).toBe(201);
    expect(created.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    const rental = await created.json();
    expect(rental).toMatchObject({ jurisdiction: 'VA', city: 'Richmond', phase: 'pre_signing', monthlyRent: 1450, purgeAfter: null });
    expect(created.headers.get('location')).toBe(`/v1/rentals/${rental.id}`);
    expect(rental).not.toHaveProperty('ownerUid');

    const patched = await call(app.baseUrl, 'PATCH', `/v1/rentals/${rental.id}`, idToken, {
      phase: 'move_in',
      occupancyDate: '2026-08-01',
      tenancyEndDate: '2027-07-31',
      depositAmount: 1450,
    });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({
      id: rental.id,
      phase: 'move_in',
      occupancyDate: '2026-08-01',
      tenancyEndDate: '2027-07-31',
      monthlyRent: 1450,
      depositAmount: 1450,
      purgeAfter: '2028-07-30T00:00:00.000Z',
    });

    // Persisted, owned by the caller, and purgeAfter is a Timestamp a TTL
    // policy can act on.
    const { fields } = await storedRental(rental.id);
    expect(fields.ownerUid).toEqual({ stringValue: localId });
    expect(fields.phase).toEqual({ stringValue: 'move_in' });
    expect(fields.purgeAfter).toEqual({ timestampValue: '2028-07-30T00:00:00Z' });
  });

  test('another user gets 403 and the rental does not change', async ({ app }) => {
    const owner = await signUpAnonymously(app.baseUrl);
    const other = await signUpAnonymously(app.baseUrl);
    const { id } = await (await call(app.baseUrl, 'POST', '/v1/rentals', owner.idToken, { jurisdiction: 'VA', county: 'Fairfax' })).json();

    const res = await call(app.baseUrl, 'PATCH', `/v1/rentals/${id}`, other.idToken, { phase: 'ended' });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });

    const { fields } = await storedRental(id);
    expect(fields.phase).toEqual({ stringValue: 'pre_signing' });
  });

  test('clearing tenancyEndDate clears purgeAfter', async ({ app }) => {
    const { idToken } = await signUpAnonymously(app.baseUrl);
    const { id, purgeAfter } = await (
      await call(app.baseUrl, 'POST', '/v1/rentals', idToken, { jurisdiction: 'VA', city: 'Norfolk', tenancyEndDate: '2027-05-31' })
    ).json();
    expect(purgeAfter).toBe('2028-05-30T00:00:00.000Z');

    const res = await call(app.baseUrl, 'PATCH', `/v1/rentals/${id}`, idToken, { tenancyEndDate: null });
    expect(await res.json()).toMatchObject({ tenancyEndDate: null, purgeAfter: null });
  });

  test('bad input is 400, a missing rental 404, and no token 401', async ({ app }) => {
    const { idToken } = await signUpAnonymously(app.baseUrl);
    for (const body of [{ jurisdiction: 'VA' }, { jurisdiction: 'VA', city: 'Richmond', ownerUid: 'x' }, { jurisdiction: 'VA', city: 'Richmond', occupancyDate: 'soon' }]) {
      const res = await call(app.baseUrl, 'POST', '/v1/rentals', idToken, body);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: 'BAD_REQUEST' } });
    }

    const missing = await call(app.baseUrl, 'PATCH', '/v1/rentals/does-not-exist', idToken, { phase: 'living' });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });

    const anonymous = await fetch(new URL('/v1/rentals', app.baseUrl), { method: 'POST', body: '{}' });
    expect(anonymous.status).toBe(401);
  });
});
