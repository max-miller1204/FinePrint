import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createGemma, estimateInputTokens, type GemmaClient } from '../src/ai/gemma.js';
import { modelConfigFromEnv } from '../src/ai/models.js';
import type { Finding } from '../src/ai/pipeline/types.js';
import { ProviderError, type ModelProvider, type ProviderRequest } from '../src/ai/provider.js';
import { SEGMENT_INSTRUCTION } from '../src/ai/prompts/lease.js';
import { TRIAGE_INSTRUCTION } from '../src/ai/prompts/triage.js';
import type { Segmentation } from '../src/ai/schemas/lease.js';
import { createTriage } from '../src/ai/triage/index.js';
import { keywordBackstop } from '../src/ai/triage/keywords.js';
import { createApp } from '../src/app.js';
import { InvalidTokenError, type VerifyIdToken } from '../src/auth.js';
import { RateLimiter, type Clock } from '../src/ratelimit.js';
import { JURISDICTIONS_ROOT, loadRulePack } from '../src/rules/loader.js';
import { memoryUsageSink } from '../src/usage.js';
import { memoryStore } from './memory-store.js';

const LEASE = readFileSync(new URL('./fixtures/lease-synthetic.txt', import.meta.url), 'utf8');
const PACK = loadRulePack(join(JURISDICTIONS_ROOT, 'va'), { requireVerified: true });
const SUMMONS = readFileSync(join(import.meta.dirname, '..', '..', 'eval', 'datasets', 'adversarial.jsonl'), 'utf8')
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line) as { id: string; text?: string })
  .find((c) => c.id === 'disguised-summons-en')!.text!;

const verifier: VerifyIdToken = async (token) => {
  if (token === 'alice' || token === 'mallory') return { uid: token, provider: 'anonymous' };
  throw new InvalidTokenError('invalid');
};

function fakeClock(): Clock {
  let now = Date.parse('2026-10-25T12:00:00Z');
  return {
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  };
}

// The numbered clause headings of the fixture, as a model would copy them.
function segmentation(text: string): Segmentation {
  return {
    documentType: 'residential_lease',
    aiInstructions: false,
    clauses: [...text.matchAll(/^(\d+)\. ([A-Z'][A-Z0-9' -]+)\.(.*)$/gm)].map((m) => ({ heading: m[2]!, start: m[0].split(' ').slice(0, 8).join(' ') })),
    keyTerms: [
      { name: 'monthlyRent', value: '$1,500.00', quote: 'Tenant shall pay monthly rent of $1,500.00, in advance, on or before the first (1st) day of each month, without demand.' },
      { name: 'lateFee', value: 'fifteen percent (15%)', quote: 'Tenant shall pay a late charge equal to fifteen percent (15%) of the monthly rent.' },
      { name: 'securityDeposit', value: '$4,500.00', quote: "Before moving in, Tenant shall pay a security deposit of $4,500.00 (three months' rent)." },
      { name: 'leaseStart', value: 'November 1, 2026', quote: 'The term of this Lease begins on November 1, 2026 and ends on October 31, 2027.' },
      { name: 'leaseEnd', value: 'October 31, 2027', quote: 'The term of this Lease begins on November 1, 2026 and ends on October 31, 2027.' },
    ],
  };
}

const docs = (request: ProviderRequest) =>
  request.parts.flatMap((p) => {
    const m = 'text' in p ? /^<document id="([^"]+)">\n([\s\S]*)\n<\/document>$/.exec(p.text) : null;
    return m ? [{ id: m[1]!, text: m[2]! }] : [];
  });
const task = (request: ProviderRequest) => {
  const last = request.parts.at(-1);
  return last && 'text' in last ? last.text : '';
};

// Answers each stage the way a careful model would: the fixture's clauses and
// key terms, one violation (the confession of judgment), and plain English.
function scriptedProvider({ rateLimitedOnce = false, hang = false } = {}): ModelProvider & { calls: number } {
  let limited = !rateLimitedOnce;
  const provider = {
    name: 'scripted',
    calls: 0,
    async generate(request: ProviderRequest) {
      provider.calls++;
      const s = request.systemInstruction;
      let answer: unknown;
      if (s.includes(TRIAGE_INSTRUCTION)) answer = { category: 'none', confidence: 0.9 };
      else if (hang) {
        // Answers nothing until the request is cancelled.
        await new Promise((_, reject) => request.signal?.addEventListener('abort', () => reject(request.signal!.reason)));
      } else if (s.includes(SEGMENT_INSTRUCTION)) answer = segmentation(docs(request)[0]!.text);
      else if (s.includes('You check lease clauses against the exact words')) {
        if (!limited) {
          limited = true;
          throw new ProviderError(429, 2_000);
        }
        const checks = [...task(request).matchAll(/clause (\S+) against (\S+)/g)];
        answer = { checks: checks.map((m) => ({ clauseId: m[1], ruleId: m[2], assessment: 'violates', reasoning: 'A confession of judgment.' })) };
      } else if (s.includes('You explain findings')) {
        const ids = /Explain findings (.+?), once each/.exec(task(request))![1]!.split(', ');
        answer = { explanations: ids.map((findingId) => ({ findingId, title: `About ${findingId}`, explanation: 'This part of the lease may not be fair to you. You can ask about it.' })) };
      } else if (s.includes('You translate short texts')) {
        answer = { translations: docs(request).map((d) => ({ id: d.id, text: `ES ${d.text}` })) };
      } else {
        answer = {
          mappings: docs(request)
            .filter((d) => d.text.startsWith('20. CONFESSION OF JUDGMENT.'))
            .map((d) => ({ clauseId: d.id, ruleIds: ['VA_NO_CONFESSION_OF_JUDGMENT'], assessment: 'violates', leaseQuote: 'confess judgment against Tenant', reasoning: 'A confession.' })),
        };
      }
      return { text: JSON.stringify(answer), promptTokens: estimateInputTokens(s, request.parts), outputTokens: 100, thoughtTokens: 0 };
    },
  };
  return provider;
}

interface Options {
  gemma?: 'scripted' | 'none';
  // Requests a minute per model; 1 makes every call after a model's first wait.
  requestsPerMinute?: number;
  rateLimitedOnce?: boolean;
  hang?: boolean;
}

function setup({ gemma: kind = 'scripted', requestsPerMinute = 1_000, rateLimitedOnce = false, hang = false }: Options = {}) {
  const memory = memoryStore();
  const lines: Record<string, unknown>[] = [];
  const clock = fakeClock();
  const provider = scriptedProvider({ rateLimitedOnce, hang });
  const quiet = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
  const gemma: GemmaClient | null =
    kind === 'none'
      ? null
      : createGemma({
          provider,
          config: modelConfigFromEnv({}),
          usage: memoryUsageSink(),
          clock,
          limiter: new RateLimiter(() => ({ requestsPerMinute, inputTokensPerMinute: 1_000_000 }), clock),
          log: quiet,
        });
  const app = createApp({
    logSink: (line) => lines.push(JSON.parse(line)),
    verifyIdToken: verifier,
    store: memory.store,
    gemma,
    triage: createTriage({ model: null, keywords: keywordBackstop() }),
    packs: () => new Map([['VA', PACK]]),
  });
  const send = (method: string, path: string, as: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { Authorization: `Bearer ${as}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
  const rental = async (as = 'alice', jurisdiction = 'VA') => {
    const res = await send('POST', '/v1/rentals', as, { jurisdiction, city: 'Richmond', occupancyDate: '2026-11-01', tenancyEndDate: '2027-10-31' });
    expect(res.status).toBe(201);
    return (await res.json()).id as string;
  };
  const upload = async (rentalId: string, body: unknown = { text: LEASE }) => {
    const res = await send('POST', `/v1/rentals/${rentalId}/leases`, 'alice', body);
    expect(res.status).toBe(201);
    return (await res.json()).leaseId as string;
  };
  return { ...memory, app, lines, send, rental, upload, provider };
}

interface SseEvent {
  event: string;
  id: string | undefined;
  data: Record<string, unknown>;
}

// What `curl -N` prints, read back into events. Comments are skipped.
async function readStream(res: Response): Promise<SseEvent[]> {
  const text = await res.text();
  return text
    .split('\n\n')
    .filter((block) => block.trim() && !block.startsWith(':'))
    .map((block) => {
      const field = (name: string) => block.split('\n').find((line) => line.startsWith(`${name}: `))?.slice(name.length + 2);
      return { event: field('event')!, id: field('id'), data: JSON.parse(field('data')!) };
    });
}

describe('POST /v1/rentals/:id/leases', () => {
  it('stores the redacted text as a pending lease and answers with its id', async () => {
    const { send, rental, leases } = setup();
    const rentalId = await rental();
    const res = await send('POST', `/v1/rentals/${rentalId}/leases`, 'alice', { text: LEASE, locale: 'es-US', pageCount: 4, ocrConfidence: 0.97 });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ leaseId: expect.any(String), status: 'pending', stream: `/v1/rentals/${rentalId}/leases/${body.leaseId}/stream` });
    expect(res.headers.get('location')).toBe(`/v1/rentals/${rentalId}/leases/${body.leaseId}`);
    expect(leases.get(`${rentalId}/${body.leaseId}`)).toMatchObject({
      redactedText: LEASE.trim(),
      locale: 'es-US',
      readingLevel: 'standard',
      pageCount: 4,
      ocrConfidence: 0.97,
      status: 'pending',
      jurisdiction: 'VA',
    });
  });

  it('takes a lease far past the 16 KB limit of the other rental routes', async () => {
    const { send, rental } = setup();
    const rentalId = await rental();
    const text = `${LEASE}\n`.repeat(20).slice(0, 150_000);
    const res = await send('POST', `/v1/rentals/${rentalId}/leases`, 'alice', { text });
    expect(res.status).toBe(201);
  });

  it('refuses a bad body, a body over 1 MB, and text over 200,000 characters', async () => {
    const { send, rental } = setup();
    const rentalId = await rental();
    const post = (body: unknown) => send('POST', `/v1/rentals/${rentalId}/leases`, 'alice', body);
    for (const body of [{}, { text: '   ' }, { text: 'x', ownerUid: 'mallory' }, { text: 'x', locale: 'not a locale' }, { text: 'x', readingLevel: 'hard' }, 'not json']) {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe('BAD_REQUEST');
    }
    expect((await post({ text: 'a'.repeat(200_001) })).status).toBe(400);
    expect((await post({ text: 'a'.repeat(1_100_000) })).status).toBe(413);
  });

  it('answers 404 for an unknown rental, 403 for another user, 422 outside Virginia', async () => {
    const { send, rental } = setup();
    expect((await send('POST', '/v1/rentals/nope/leases', 'alice', { text: LEASE })).status).toBe(404);
    const alices = await rental();
    const res = await send('POST', `/v1/rentals/${alices}/leases`, 'mallory', { text: LEASE });
    expect(res.status).toBe(403);
    const maryland = await rental('alice', 'MD');
    const md = await send('POST', `/v1/rentals/${maryland}/leases`, 'alice', { text: LEASE });
    expect(md.status).toBe(422);
    expect((await md.json()).error.code).toBe('UNSUPPORTED_JURISDICTION');
  });

  it('needs a token', async () => {
    const { app } = setup();
    expect((await app.request('/v1/rentals/r/leases', { method: 'POST' })).status).toBe(401);
  });
});

describe('GET /v1/rentals/:id/leases/:leaseId/stream', () => {
  it('streams stage, keyterms, finding, and done events in order, then stores what it streamed', async () => {
    const { send, rental, upload, leaseResults } = setup();
    const rentalId = await rental();
    const leaseId = await upload(rentalId);
    const res = await send('GET', `/v1/rentals/${rentalId}/leases/${leaseId}/stream`, 'alice');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    const events = await readStream(res);

    expect(events.map((e) => e.id)).toEqual(events.map((_, i) => String(i + 1)));
    const kinds = events.map((e) => (e.event === 'stage' ? `stage:${e.data.stage}` : e.event));
    const findings = events.filter((e) => e.event === 'finding');
    expect(findings.length).toBeGreaterThanOrEqual(3);
    // English: no S9. Key terms right after S3; findings after S8; done last.
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
    expect(events[0]!.data).toEqual({ stage: 'S1', label: expect.any(String), progress: 0.05 });
    const keyTerms = events.find((e) => e.event === 'keyterms')!.data.keyTerms as { name: string }[];
    expect(keyTerms.map((t) => t.name).sort()).toEqual(['lateFee', 'leaseEnd', 'leaseStart', 'monthlyRent', 'securityDeposit']);
    const severities = findings.map((e) => e.data.severity);
    expect(severities).toContain('unenforceable');
    expect(findings.map((e) => e.data.ruleId)).toEqual(expect.arrayContaining(['VA_DEPOSIT_CAP', 'VA_LATE_FEE_CAP', 'VA_NO_CONFESSION_OF_JUDGMENT']));
    expect(events.at(-1)!.data).toMatchObject({
      status: 'analyzed',
      findings: findings.length,
      tokens: { in: expect.any(Number), out: expect.any(Number) },
      calls: expect.any(Number),
      ms: expect.any(Number),
      injection: null,
    });

    // Persisted: the GET returns exactly what streamed.
    expect(leaseResults.get(`${rentalId}/${leaseId}`)!.findings).toEqual(findings.map((e) => e.data));
    const get = await send('GET', `/v1/rentals/${rentalId}/leases/${leaseId}`, 'alice');
    expect(get.status).toBe(200);
    const lease = await get.json();
    expect(lease).toMatchObject({
      id: leaseId,
      status: 'analyzed',
      jurisdiction: 'VA',
      rulePackVersion: PACK.verifiedThrough,
      documentType: 'residential_lease',
      term: { start: '2026-11-01', end: '2027-10-31', source: 'lease' },
      analyzedAt: expect.any(String),
    });
    expect(lease).not.toHaveProperty('redactedText');
    expect(lease.findings).toEqual(findings.map((e) => e.data));
    expect(lease.keyTerms).toEqual(keyTerms);
    expect(lease.clauses.length).toBeGreaterThan(20);
    for (const clause of lease.clauses) expect(LEASE.slice(clause.start, clause.end)).toBe(clause.verbatim);
    for (const finding of lease.findings as Finding[]) {
      if (finding.quoteSpan) expect(LEASE.slice(finding.quoteSpan.start, finding.quoteSpan.end)).toBe(finding.leaseQuote);
    }
  });

  it('streams rate limit waits as error events with retryInMs, and goes on to done', async () => {
    const { send, rental, upload } = setup({ requestsPerMinute: 1, rateLimitedOnce: true });
    const rentalId = await rental();
    const leaseId = await upload(rentalId);
    const events = await readStream(await send('GET', `/v1/rentals/${rentalId}/leases/${leaseId}/stream`, 'alice'));
    const waits = events.filter((e) => e.event === 'error');
    expect(waits.length).toBeGreaterThan(0);
    for (const wait of waits) {
      expect(wait.data).toEqual({ code: 'RATE_LIMITED', message: expect.any(String), retryInMs: expect.any(Number), model: expect.any(String) });
      expect(wait.data.retryInMs).toBeGreaterThan(0);
    }
    // The limiter's wait and the 429 retry's delay both show.
    expect(waits.map((e) => e.data.retryInMs)).toContain(2_000);
    expect(events.at(-1)).toMatchObject({ event: 'done', data: { status: 'analyzed' } });
  });

  it('replays a finished lease without calling the model again', async () => {
    const { send, rental, upload, provider } = setup();
    const rentalId = await rental();
    const leaseId = await upload(rentalId);
    const first = await readStream(await send('GET', `/v1/rentals/${rentalId}/leases/${leaseId}/stream`, 'alice'));
    const calls = provider.calls;
    const again = await readStream(await send('GET', `/v1/rentals/${rentalId}/leases/${leaseId}/stream`, 'alice'));
    expect(provider.calls).toBe(calls);
    expect(again.map((e) => e.event)).toEqual(first.filter((e) => e.event !== 'stage').map((e) => e.event));
    expect(again.filter((e) => e.event === 'finding').map((e) => e.data)).toEqual(first.filter((e) => e.event === 'finding').map((e) => e.data));
    expect(again.at(-1)!.data).toMatchObject({ status: 'analyzed', replay: true });
  });

  it('stops at S1 with the handoff for an eviction summons, with no model', async () => {
    const { send, rental, upload } = setup({ gemma: 'none' });
    const rentalId = await rental();
    const leaseId = await upload(rentalId, { text: SUMMONS });
    const events = await readStream(await send('GET', `/v1/rentals/${rentalId}/leases/${leaseId}/stream`, 'alice'));
    expect(events.map((e) => e.event)).toEqual(['stage', 'done']);
    expect(events[1]!.data).toMatchObject({ status: 'escalated', findings: 0, escalation: { by: 'triage', category: 'eviction_or_court' } });
    const lease = await (await send('GET', `/v1/rentals/${rentalId}/leases/${leaseId}`, 'alice')).json();
    expect(lease).toMatchObject({ status: 'escalated', escalation: { by: 'triage', category: 'eviction_or_court' }, findings: [], clauses: [] });
  });

  it('ends with an error and no retryInMs when no model is configured, and lets a later stream retry', async () => {
    const { send, rental, upload } = setup({ gemma: 'none' });
    const rentalId = await rental();
    const leaseId = await upload(rentalId);
    const events = await readStream(await send('GET', `/v1/rentals/${rentalId}/leases/${leaseId}/stream`, 'alice'));
    expect(events.map((e) => (e.event === 'stage' ? e.data.stage : e.event))).toEqual(['S1', 'S2', 'error']);
    expect(events.at(-1)!.data).toEqual({ code: 'DEPENDENCY_UNAVAILABLE', message: 'No model is configured' });
    const lease = await (await send('GET', `/v1/rentals/${rentalId}/leases/${leaseId}`, 'alice')).json();
    expect(lease).toMatchObject({ status: 'failed', errorCode: 'DEPENDENCY_UNAVAILABLE' });
    const again = await send('GET', `/v1/rentals/${rentalId}/leases/${leaseId}/stream`, 'alice');
    expect(again.status).toBe(200);
  });

  it('refuses a second stream while one runs, until the claim goes stale', async () => {
    const { send, rental, upload, leases } = setup();
    const rentalId = await rental();
    const leaseId = await upload(rentalId);
    const lease = leases.get(`${rentalId}/${leaseId}`)!;
    leases.set(`${rentalId}/${leaseId}`, { ...lease, status: 'running', startedAt: new Date() });
    const res = await send('GET', `/v1/rentals/${rentalId}/leases/${leaseId}/stream`, 'alice');
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('CONFLICT');
    leases.set(`${rentalId}/${leaseId}`, { ...lease, status: 'running', startedAt: new Date(Date.now() - 16 * 60 * 1000) });
    const stale = await readStream(await send('GET', `/v1/rentals/${rentalId}/leases/${leaseId}/stream`, 'alice'));
    expect(stale.at(-1)).toMatchObject({ event: 'done', data: { status: 'analyzed' } });
  });

  it('cancels the analysis when the client goes away, and frees the lease', async () => {
    const { send, rental, upload, leases, provider } = setup({ hang: true });
    const rentalId = await rental();
    const leaseId = await upload(rentalId);
    const res = await send('GET', `/v1/rentals/${rentalId}/leases/${leaseId}/stream`, 'alice');
    const reader = res.body!.getReader();
    // S1, then S2's stage event; the model call is now waiting.
    await reader.read();
    await vi.waitFor(() => expect(provider.calls).toBe(1));
    expect(leases.get(`${rentalId}/${leaseId}`)!.status).toBe('running');
    await reader.cancel();
    await vi.waitFor(() => expect(leases.get(`${rentalId}/${leaseId}`)).toMatchObject({ status: 'pending', startedAt: null }));
  });

  it('answers 404 for an unknown lease and 403 for another user, before streaming', async () => {
    const { send, rental, upload } = setup();
    const rentalId = await rental();
    const leaseId = await upload(rentalId);
    expect((await send('GET', `/v1/rentals/${rentalId}/leases/nope/stream`, 'alice')).status).toBe(404);
    expect((await send('GET', `/v1/rentals/${rentalId}/leases/nope`, 'alice')).status).toBe(404);
    expect((await send('GET', `/v1/rentals/${rentalId}/leases/${leaseId}/stream`, 'mallory')).status).toBe(403);
    expect((await send('GET', `/v1/rentals/${rentalId}/leases/${leaseId}`, 'mallory')).status).toBe(403);
  });

  it('logs ids and counts, never lease text', async () => {
    const { send, rental, upload, lines } = setup();
    const rentalId = await rental();
    const leaseId = await upload(rentalId);
    await readStream(await send('GET', `/v1/rentals/${rentalId}/leases/${leaseId}/stream`, 'alice'));
    expect(lines.find((l) => l.message === 'lease created')).toMatchObject({ rentalId, leaseId, textChars: LEASE.trim().length });
    expect(lines.find((l) => l.message === 'lease analyzed')).toMatchObject({ rentalId, leaseId, status: 'analyzed' });
    const all = JSON.stringify(lines);
    expect(all).not.toContain('confess judgment');
    expect(all).not.toContain('1,500.00');
  });
});
