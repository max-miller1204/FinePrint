import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'e2e';

interface ClientConfig {
  firebase: { apiKey: string; projectId: string; authEmulatorHost?: string };
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

function triage(baseUrl: string, idToken: string | null, body: unknown) {
  return fetch(new URL('/v1/triage', baseUrl), {
    method: 'POST',
    headers: { ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// The same summons as eval/datasets/escalation.jsonl, eviction-or-court-01-en.
const dataset = readFileSync(join(import.meta.dirname, '..', '..', '..', 'eval', 'datasets', 'escalation.jsonl'), 'utf8')
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line) as { id: string; text: string });
const summons = dataset.find((c) => c.id === 'eviction-or-court-01-en')!.text;
const leaseClause = dataset.find((c) => c.id === 'benign-01-en')!.text;
const payOrQuitEs = dataset.find((c) => c.id === 'eviction-or-court-11-es')!.text;
const surrenderClause = dataset.find((c) => c.id === 'benign-65-en')!.text;

// The server runs without GEMINI_API_KEY unless the run is wrapped in
// `op run`, so the model is `off` (the backstop decides) or `ok`.
const modelStatus = ['off', 'ok'];

describe('Triage', { platforms: ['web'] }, () => {
  test('an eviction summons uploaded as a lease triggers the handoff', async ({ app }) => {
    const { idToken } = await signUpAnonymously(app.baseUrl);
    const res = await triage(app.baseUrl, idToken, { source: 'lease', text: summons, locale: 'en' });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    const body = await res.json();
    expect(body).toMatchObject({ escalate: true, category: 'eviction_or_court', keywords: { category: 'eviction_or_court' } });
    expect(body.keywords.matches).toContain('en.eviction_or_court.summons');
    expect(modelStatus).toContain(body.model.status);
  });

  test('an ordinary lease clause about unlawful detainer does not', async ({ app }) => {
    const { idToken } = await signUpAnonymously(app.baseUrl);
    const res = await triage(app.baseUrl, idToken, { source: 'lease', text: leaseClause, locale: 'en' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.keywords).toEqual({ category: 'none', confidence: 0, matches: [] });
    if (body.model.status === 'off') expect(body).toMatchObject({ escalate: false, category: 'none' });
  });

  // #104: a pay-or-quit notice escalates on the backstop alone; a lease
  // clause about nonpayment and surrendering possession does not.
  test('a Spanish pay-or-quit notice uploaded as a lease triggers the handoff', async ({ app }) => {
    const { idToken } = await signUpAnonymously(app.baseUrl);
    const res = await triage(app.baseUrl, idToken, { source: 'lease', text: payOrQuitEs, locale: 'es' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ escalate: true, category: 'eviction_or_court', keywords: { category: 'eviction_or_court' } });
    expect(body.keywords.matches).toContain('es.eviction_or_court.pagar-o-entregar');
  });

  test('a lease clause about nonpayment and surrender does not', async ({ app }) => {
    const { idToken } = await signUpAnonymously(app.baseUrl);
    const res = await triage(app.baseUrl, idToken, { source: 'lease', text: surrenderClause, locale: 'en' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.keywords).toEqual({ category: 'none', confidence: 0, matches: [] });
    if (body.model.status === 'off') expect(body).toMatchObject({ escalate: false, category: 'none' });
  });

  test('a Spanish lockout in Ask triggers the handoff', async ({ app }) => {
    const { idToken } = await signUpAnonymously(app.baseUrl);
    const res = await triage(app.baseUrl, idToken, { source: 'ask', text: 'El dueño cambió la cerradura y no puedo entrar.', locale: 'es-US' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ escalate: true, keywords: { category: 'lockout' } });
  });

  test('rejects a bad source and a missing token, and logs no text', async ({ app }) => {
    const { idToken } = await signUpAnonymously(app.baseUrl);
    const bad = await triage(app.baseUrl, idToken, { source: 'email', text: 'Oakline secret text' });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe('BAD_REQUEST');
    expect((await triage(app.baseUrl, null, { source: 'ask', text: 'hi' })).status).toBe(401);

    const log = readFileSync(join(import.meta.dirname, '..', '..', '.e2e', 'logs', 'server.log'), 'utf8');
    expect(log).toContain('"message":"triage"');
    expect(log).toContain('"route":"/v1/triage"');
    expect(log).not.toContain('Oakline');
    expect(log).not.toContain('cerradura');
  });
});
