import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, test } from 'e2e';
import { caseText, loadAdversarialCases } from '../../../eval/runners/adversarial-cases.ts';

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

function call(baseUrl: string, method: string, path: string, idToken: string, body?: unknown) {
  return fetch(new URL(path, baseUrl), {
    method,
    headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// The synthetic Virginia lease the pipeline's own tests use, and the
// adversarial set's eviction summons.
const LEASE = readFileSync(join(import.meta.dirname, '..', '..', '..', 'server', 'test', 'fixtures', 'lease-synthetic.txt'), 'utf8');
const SUMMONS = readFileSync(join(import.meta.dirname, '..', '..', '..', 'eval', 'datasets', 'adversarial.jsonl'), 'utf8')
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line) as { id: string; text?: string })
  .find((c) => c.id === 'disguised-summons-en')!.text!;

// The server asks Gemma only when it inherits a key (`scripts/with-secrets.sh`, see e2e.config.ts).
const MODEL = Boolean(process.env.GEMINI_API_KEY);

async function rentalWithLease(baseUrl: string, idToken: string, text: string, locale = 'en') {
  const rental = await call(baseUrl, 'POST', '/v1/rentals', idToken, { jurisdiction: 'VA', city: 'Richmond', occupancyDate: '2026-11-01', tenancyEndDate: '2027-10-31' });
  expect(rental.status).toBe(201);
  const { id: rentalId } = await rental.json();
  const created = await call(baseUrl, 'POST', `/v1/rentals/${rentalId}/leases`, idToken, { text, locale, pageCount: 4 });
  expect(created.status).toBe(201);
  const body = await created.json();
  expect(body).toEqual({ leaseId: expect.any(String), status: 'pending', stream: `/v1/rentals/${rentalId}/leases/${body.leaseId}/stream` });
  expect(created.headers.get('location')).toBe(`/v1/rentals/${rentalId}/leases/${body.leaseId}`);
  return { rentalId, leaseId: body.leaseId as string, stream: body.stream as string };
}

interface SseEvent {
  event: string;
  id: string;
  data: Record<string, unknown>;
}

// The issue's client: `curl -N` on the stream, its output read back into events.
async function curlStream(baseUrl: string, path: string, idToken: string, timeoutMs: number): Promise<{ events: SseEvent[]; raw: string }> {
  const { stdout } = await promisify(execFile)('curl', ['-sSN', '--max-time', String(Math.ceil(timeoutMs / 1000)), '-H', `Authorization: Bearer ${idToken}`, new URL(path, baseUrl).href], {
    maxBuffer: 16 * 1024 * 1024,
  });
  const events = stdout
    .split('\n\n')
    .filter((block) => block.trim() && !block.startsWith(':'))
    .map((block) => {
      const field = (name: string) => block.split('\n').find((line) => line.startsWith(`${name}: `))?.slice(name.length + 2);
      return { event: field('event')!, id: field('id')!, data: JSON.parse(field('data')!) };
    });
  return { events, raw: stdout };
}

// The stored lease, read from the Firestore emulator in ../firebase.json.
async function storedDocs(path: string): Promise<{ documents?: { name: string; fields: Record<string, Record<string, unknown>> }[]; fields?: Record<string, Record<string, unknown>> }> {
  const host = process.env.E2E_FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8090';
  const res = await fetch(`http://${host}/v1/projects/demo-fineprint/databases/(default)/documents/${path}?pageSize=300`, {
    headers: { Authorization: 'Bearer owner' },
  });
  expect(res.status).toBe(200);
  return res.json();
}

describe('Lease API and SSE stream', { platforms: ['web'] }, () => {
  test('an eviction summons streams S1 and done with the handoff, and the GET returns it', async ({ app }) => {
    const { idToken } = await signUpAnonymously(app.baseUrl);
    const { rentalId, leaseId, stream } = await rentalWithLease(app.baseUrl, idToken, SUMMONS);

    const { events } = await curlStream(app.baseUrl, stream, idToken, 60_000);
    expect(events.map((e) => e.event)).toEqual(['stage', 'done']);
    expect(events.map((e) => e.id)).toEqual(['1', '2']);
    expect(events[0]!.data).toMatchObject({ stage: 'S1', progress: 0.05 });
    expect(events[1]!.data).toMatchObject({ status: 'escalated', findings: 0, escalation: { by: 'triage', category: 'eviction_or_court' } });

    const get = await call(app.baseUrl, 'GET', `/v1/rentals/${rentalId}/leases/${leaseId}`, idToken);
    expect(get.status).toBe(200);
    const lease = await get.json();
    expect(lease).toMatchObject({ id: leaseId, status: 'escalated', pageCount: 4, escalation: { by: 'triage', category: 'eviction_or_court' }, findings: [], clauses: [] });
    expect(lease).not.toHaveProperty('redactedText');

    // Stored under the rental (spec §6.1), with the redacted text.
    const { fields } = await storedDocs(`rentals/${rentalId}/leases/${leaseId}`);
    expect(fields!.status).toEqual({ stringValue: 'escalated' });
    expect(fields!.redactedText).toEqual({ stringValue: SUMMONS.trim() });
    expect(fields!.analyzedAt).toHaveProperty('timestampValue');

    // A second stream replays the outcome.
    const again = await curlStream(app.baseUrl, stream, idToken, 30_000);
    expect(again.events.at(-1)!.data).toMatchObject({ status: 'escalated', replay: true });
  });

  test('without a model the stream ends with an error event and the lease is failed', async ({ app }) => {
    test.skip(MODEL, 'the server has a model: the live test covers this lease');
    const { idToken } = await signUpAnonymously(app.baseUrl);
    const { rentalId, leaseId, stream } = await rentalWithLease(app.baseUrl, idToken, LEASE);
    const { events } = await curlStream(app.baseUrl, stream, idToken, 60_000);
    expect(events.map((e) => (e.event === 'stage' ? e.data.stage : e.event))).toEqual(['S1', 'S2', 'error']);
    expect(events.at(-1)!.data).toEqual({ code: 'DEPENDENCY_UNAVAILABLE', message: expect.any(String) });
    expect(events.at(-1)!.data).not.toHaveProperty('retryInMs');
    const lease = await (await call(app.baseUrl, 'GET', `/v1/rentals/${rentalId}/leases/${leaseId}`, idToken)).json();
    expect(lease).toMatchObject({ status: 'failed', errorCode: 'DEPENDENCY_UNAVAILABLE' });
  });

  test('live: curl receives stage, keyterms, finding, and done in order, and the findings persist', { timeout: 900_000 }, async ({ app }) => {
    test.skip(!MODEL, 'needs GEMINI_API_KEY: run through scripts/with-secrets.sh');
    const { idToken } = await signUpAnonymously(app.baseUrl);
    const { rentalId, leaseId, stream } = await rentalWithLease(app.baseUrl, idToken, LEASE);

    const logPath = join(import.meta.dirname, '..', '..', '.e2e', 'logs', 'server.log');
    const logStart = process.env.E2E_PACKED_LEASE_TIMING === '1' ? readFileSync(logPath, 'utf8').length : 0;
    const started = Date.now();
    const { events } = await curlStream(app.baseUrl, stream, idToken, 880_000);
    const seconds = Math.round((Date.now() - started) / 1000);
    expect(events.map((e) => e.id)).toEqual(events.map((_, i) => String(i + 1)));
    // Rate limit and busy-model waits are `error` events with retryInMs; the stream goes on.
    const waits = events.filter((e) => e.event === 'error');
    for (const wait of waits) expect(wait.data).toMatchObject({ code: expect.stringMatching(/^(RATE_LIMITED|DEPENDENCY_UNAVAILABLE)$/), retryInMs: expect.any(Number) });
    if (process.env.E2E_PACKED_LEASE_TIMING === '1') {
      expect(waits).toEqual([]);
      const calls = readFileSync(logPath, 'utf8').slice(logStart)
        .split('\n').filter((line) => line.startsWith('{')).map((line) => JSON.parse(line))
        .filter((line) => line.message === 'model call');
      const mapping = calls.filter((line) => line.stage === 'mapping');
      expect(mapping).toHaveLength(1);
      expect(mapping[0]).toMatchObject({ model: 'gemma-4-26b-a4b-it', outcome: 'ok' });
      expect(calls.filter((line) => line.outcome === 'invalid_output')).toEqual([]);
      console.log(JSON.stringify({ check: 'packed-single-lease', seconds, mappingCalls: mapping.length, mappingInputTokens: mapping[0].promptTokens, mappingOutputTokens: mapping[0].outputTokens, mappingThoughtTokens: mapping[0].thoughtTokens, rateLimitedEvents: 0, invalidOutputs: 0 }));
    }
    const kinds = events.filter((e) => e.event !== 'error').map((e) => (e.event === 'stage' ? `stage:${e.data.stage}` : e.event));
    const findings = events.filter((e) => e.event === 'finding');
    expect(kinds).toEqual([
      'stage:S1',
      'stage:S2',
      'stage:S3',
      'keyterms',
      'stage:S4',
      'stage:S5',
      'stage:S6',
      'stage:S7',
      'stage:S8',
      ...findings.map(() => 'finding'),
      'done',
    ]);
    const done = events.at(-1)!.data;
    expect(done).toMatchObject({ status: 'analyzed', findings: findings.length, tokens: { in: expect.any(Number), out: expect.any(Number) } });
    // The planted deterministic violations (server/test/fixtures/lease-synthetic.txt).
    expect(findings.map((e) => e.data.ruleId)).toEqual(expect.arrayContaining(['VA_DEPOSIT_CAP', 'VA_LATE_FEE_CAP', 'VA_ROUTINE_MAINTENANCE_NOTICE_72H']));
    for (const finding of findings) {
      const span = finding.data.quoteSpan as { start: number; end: number } | null;
      if (span) expect(LEASE.trim().slice(span.start, span.end)).toBe(finding.data.leaseQuote);
    }

    const lease = await (await call(app.baseUrl, 'GET', `/v1/rentals/${rentalId}/leases/${leaseId}`, idToken)).json();
    expect(lease).toMatchObject({ status: 'analyzed', documentType: 'residential_lease', term: { start: '2026-11-01', end: '2027-10-31' } });
    expect(lease.findings).toEqual(findings.map((e) => e.data));
    expect(lease.keyTerms).toEqual(events.find((e) => e.event === 'keyterms')!.data.keyTerms);
    if (process.env.E2E_PACKED_LEASE_TIMING === '1') {
      // Timing alone must not hide lost semantic plants after quote verification.
      for (const [ruleId, prefix] of Object.entries({
        VA_NO_RIGHTS_WAIVER: '19. WAIVER',
        VA_NO_CONFESSION_OF_JUDGMENT: '20. CONFESSION',
        VA_NO_EXCULPATION_INDEMNITY: '17. LIABILITY',
        VA_NO_LANDLORD_ATTORNEY_FEES: '21. ATTORNEY',
        VA_LANDLORD_MAINTAIN_FIT: '10. MAINTENANCE',
      })) {
        const clause = lease.clauses.find((c: { verbatim: string }) => c.verbatim.startsWith(prefix));
        expect(clause).toBeDefined();
        expect(lease.findings).toEqual(expect.arrayContaining([expect.objectContaining({
          ruleId, clauseId: clause.id, primaryAssessment: expect.stringMatching(/^(violates|unclear)$/),
        })]));
      }
    }


    const stored = await storedDocs(`rentals/${rentalId}/leases/${leaseId}/findings`);
    expect(stored.documents).toHaveLength(findings.length);
    const clauses = await storedDocs(`rentals/${rentalId}/leases/${leaseId}/clauses`);
    expect(clauses.documents!.length).toBe(lease.clauses.length);
  });

  test('live: a Spanish lease with hidden AI instructions streams S9 and the injection finding in Spanish', { timeout: 900_000 }, async ({ app }) => {
    test.skip(!MODEL, 'needs GEMINI_API_KEY: run through scripts/with-secrets.sh');
    const injected = caseText(loadAdversarialCases().find((c) => c.id === 'inject-ignore-previous-es')!);
    const { idToken } = await signUpAnonymously(app.baseUrl);
    const { rentalId, leaseId, stream } = await rentalWithLease(app.baseUrl, idToken, injected, 'es-US');

    const { events } = await curlStream(app.baseUrl, stream, idToken, 880_000);
    const stages = events.filter((e) => e.event === 'stage').map((e) => e.data.stage);
    expect(stages).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9']);
    const done = events.at(-1)!;
    expect(done.event).toBe('done');
    // The finding's words are fixed per locale in code (#104), never model text.
    expect(done.data).toMatchObject({
      status: 'analyzed',
      injection: { id: 'injection', severity: 'info', title: 'Instrucciones ocultas para herramientas de IA' },
    });
    const lease = await (await call(app.baseUrl, 'GET', `/v1/rentals/${rentalId}/leases/${leaseId}`, idToken)).json();
    expect(lease.injection).toMatchObject({ detected: true, finding: done.data.injection });
  });

  test('the lease routes check the rental, the owner, the body, and the state', async ({ app }) => {
    const owner = await signUpAnonymously(app.baseUrl);
    const other = await signUpAnonymously(app.baseUrl);
    const { rentalId, leaseId, stream } = await rentalWithLease(app.baseUrl, owner.idToken, SUMMONS);

    const code = async (res: Response) => (await res.json()).error.code;
    const forbidden = await call(app.baseUrl, 'GET', stream, other.idToken);
    expect(forbidden.status).toBe(403);
    expect(await code(forbidden)).toBe('FORBIDDEN');
    expect((await call(app.baseUrl, 'GET', `/v1/rentals/${rentalId}/leases/${leaseId}`, other.idToken)).status).toBe(403);
    expect((await call(app.baseUrl, 'POST', `/v1/rentals/${rentalId}/leases`, other.idToken, { text: LEASE })).status).toBe(403);
    expect((await call(app.baseUrl, 'GET', `/v1/rentals/${rentalId}/leases/nope`, owner.idToken)).status).toBe(404);
    expect((await call(app.baseUrl, 'GET', '/v1/rentals/nope/leases/nope/stream', owner.idToken)).status).toBe(404);
    const bad = await call(app.baseUrl, 'POST', `/v1/rentals/${rentalId}/leases`, owner.idToken, { text: '' });
    expect(bad.status).toBe(400);
    expect(await code(bad)).toBe('BAD_REQUEST');
    const noToken = await fetch(new URL(stream, app.baseUrl));
    expect(noToken.status).toBe(401);

    const md = await (await call(app.baseUrl, 'POST', '/v1/rentals', owner.idToken, { jurisdiction: 'MD', city: 'Baltimore' })).json();
    const unsupported = await call(app.baseUrl, 'POST', `/v1/rentals/${md.id}/leases`, owner.idToken, { text: LEASE });
    expect(unsupported.status).toBe(422);
    expect(await code(unsupported)).toBe('UNSUPPORTED_JURISDICTION');

    // A 150,000-character lease is far past the 16 KB cap of the other rental routes.
    const long = await call(app.baseUrl, 'POST', `/v1/rentals/${rentalId}/leases`, owner.idToken, { text: `${LEASE}\n`.repeat(20).slice(0, 150_000) });
    expect(long.status).toBe(201);
  });

  test('the server log has ids and counts, never lease text', async ({ app }) => {
    const { idToken } = await signUpAnonymously(app.baseUrl);
    const { stream } = await rentalWithLease(app.baseUrl, idToken, SUMMONS);
    await curlStream(app.baseUrl, stream, idToken, 60_000);
    const log = readFileSync(join(import.meta.dirname, '..', '..', '.e2e', 'logs', 'server.log'), 'utf8');
    expect(log).toContain('"message":"lease created"');
    expect(log).not.toContain('confess judgment');
    expect(log).not.toContain('UNLAWFUL DETAINER');
  });
});
