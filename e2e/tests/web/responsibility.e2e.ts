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

function post(baseUrl: string, path: string, idToken: string | null, body: unknown) {
  return fetch(new URL(path, baseUrl), {
    method: 'POST',
    headers: { ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function newRental(baseUrl: string, idToken: string): Promise<string> {
  const res = await post(baseUrl, '/v1/rentals', idToken, { jurisdiction: 'VA', city: 'Richmond', phase: 'living' });
  expect(res.status).toBe(201);
  return (await res.json()).id;
}

// `Bearer owner` is the emulator's admin bypass of the deny-all rules.
async function storedIssues(rentalId: string): Promise<{ name: string; fields: Record<string, { stringValue?: string }> }[]> {
  const res = await fetch(`http://127.0.0.1:8090/v1/projects/demo-fineprint/databases/(default)/documents/rentals/${rentalId}/issues`, {
    headers: { Authorization: 'Bearer owner' },
  });
  expect(res.status).toBe(200);
  return (await res.json()).documents ?? [];
}

// The statute text a rule citation must carry, straight from the rule pack.
function statuteQuotes(ruleId: string): string[] {
  const file = join(import.meta.dirname, '..', '..', '..', 'jurisdictions', 'va', 'rules', `${ruleId}.json`);
  return (JSON.parse(readFileSync(file, 'utf8')) as { versions: { statuteQuote: string }[] }).versions.map((v) => v.statuteQuote);
}

const HEATER = 'The heater in my bedroom stopped working last night. It is January and the apartment is very cold. I did not do anything to it.';

// The server asks Gemma only when the run passes it a key (`inheritEnv`):
// wrap the run in `op run` or scripts/with-gemini-key.sh.
const modelOn = Boolean(process.env.GEMINI_API_KEY || process.env.GEMMA_PROVIDER === 'openai_compatible');

interface Reason {
  text: string;
  citation: { kind: 'rule' | 'lease' | 'evidence'; ref: string; quote?: string };
}

describe('Responsibility check', { platforms: ['web'] }, () => {
  test('a broken heater in January is likely the landlord\'s, and every reason is cited', { timeout: 240_000 }, async ({ app }) => {
    const { idToken } = await signUpAnonymously(app.baseUrl);
    const rentalId = await newRental(app.baseUrl, idToken);
    const res = await post(app.baseUrl, `/v1/rentals/${rentalId}/issues`, idToken, { description: HEATER, room: 'Bedroom', checklistItem: 'Heater' });

    if (!modelOn) {
      // No model: nothing to answer with, and nothing stored.
      expect(res.status).toBe(503);
      expect((await res.json()).error.code).toBe('DEPENDENCY_UNAVAILABLE');
      expect(await storedIssues(rentalId)).toEqual([]);
      return;
    }

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ status: 'checked', verdict: 'likely_landlord', room: 'Bedroom', checklistItem: 'Heater', leaseId: null });
    expect(['landlord_maintenance', 'unknown']).toContain(body.category);
    expect(typeof body.escrowEligible).toBe('boolean');

    // Every reason resolves: no lease and no move-in photos were sent, so
    // only rules can be cited, each with its verbatim statute text.
    const reasons: Reason[] = body.reasons;
    expect(reasons.length).toBeGreaterThan(0);
    for (const { citation } of reasons) {
      expect(citation.kind).toBe('rule');
      expect(statuteQuotes(citation.ref)).toContain(citation.quote);
    }
    expect(reasons.map((r) => r.citation.ref)).toContain('VA_LANDLORD_MAINTAIN_FIT');

    // High needs 31B's agreement; without it the answer says medium and downgraded.
    if (body.confidence === 'high') expect(body.verification.status).toBe('agreed');
    if (body.downgraded) {
      expect(body.confidence).toBe('medium');
      expect(['disagreed', 'unavailable']).toContain(body.verification.status);
    }
    if (body.verification.status === 'not_needed') expect(body.downgraded).toBe(false);

    const stored = await storedIssues(rentalId);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.name).toMatch(new RegExp(`/issues/${body.issueId}$`));
    expect(stored[0]!.fields.verdict?.stringValue).toBe('likely_landlord');
  });

  test('a gas smell gets the handoff instead of a verdict, with or without a model', async ({ app }) => {
    const { idToken } = await signUpAnonymously(app.baseUrl);
    const rentalId = await newRental(app.baseUrl, idToken);
    const res = await post(app.baseUrl, `/v1/rentals/${rentalId}/issues`, idToken, { description: 'I smell gas in the kitchen near the stove.' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'escalated', triage: { escalate: true, keywords: { category: 'immediate_danger' } } });
    expect(await storedIssues(rentalId)).toEqual([]);
  });

  test('rejects a bad body, another user, and a missing token, and logs no description', async ({ app }) => {
    const owner = await signUpAnonymously(app.baseUrl);
    const other = await signUpAnonymously(app.baseUrl);
    const rentalId = await newRental(app.baseUrl, owner.idToken);
    const path = `/v1/rentals/${rentalId}/issues`;

    const bad = await post(app.baseUrl, path, owner.idToken, { description: 'Oakline secret text', photoIds: ['not-a-uuid'] });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe('BAD_REQUEST');
    const forbidden = await post(app.baseUrl, path, other.idToken, { description: HEATER });
    expect(forbidden.status).toBe(403);
    expect((await forbidden.json()).error.code).toBe('FORBIDDEN');
    expect((await post(app.baseUrl, path, null, { description: HEATER })).status).toBe(401);
    // One check that runs whatever the model status, for its log line.
    expect((await post(app.baseUrl, path, owner.idToken, { description: 'I smell gas in the hallway.' })).status).toBe(200);

    const log = readFileSync(join(import.meta.dirname, '..', '..', '.e2e', 'logs', 'server.log'), 'utf8');
    expect(log).toContain('"route":"/v1/rentals/:id/issues"');
    expect(log).toContain('"message":"responsibility check"');
    expect(log).not.toContain('Oakline');
    expect(log).not.toContain('stopped working');
    expect(log).not.toContain('smell gas');
  });
});
