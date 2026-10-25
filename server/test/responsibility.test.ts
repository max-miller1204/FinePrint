import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { createApp } from '../src/app.js';
import { InvalidTokenError, type VerifyIdToken } from '../src/auth.js';
import type { Document } from '../src/ai/documents.js';
import { GemmaUnavailableError, type GemmaClient, type GenerateOptions } from '../src/ai/gemma.js';
import { GEMMA_26B, GEMMA_31B, type Stage } from '../src/ai/models.js';
import {
  checkResponsibility,
  MAX_LEASE_CHARS,
  moveInRecords,
  relevantClauses,
  type ResponsibilityDeps,
  type ResponsibilityInput,
} from '../src/ai/pipeline/responsibility.js';
import type { ResponsibilityAnswer } from '../src/ai/schemas/responsibility.js';
import { createTriage } from '../src/ai/triage/index.js';
import { keywordBackstop } from '../src/ai/triage/keywords.js';
import { newEvidence, type Evidence } from '../src/models/evidence.js';
import type { AnalyzedLease } from '../src/models/lease.js';
import { JURISDICTIONS_ROOT, loadRulePack } from '../src/rules/loader.js';
import { memoryStore } from './memory-store.js';

const PACK = loadRulePack(join(JURISDICTIONS_ROOT, 'va'), { requireVerified: true });
const MAINTAIN_FIT = PACK.byId.get('VA_LANDLORD_MAINTAIN_FIT')!;
const TODAY = '2026-11-10';
const HEATER = 'The heater in my bedroom stopped working last night. It is January and the apartment is very cold. I did not do anything to it.';

const REPAIRS_CLAUSE = '7. REPAIRS. Landlord shall keep the heating system in good repair. Tenant shall pay for any damage caused by Tenant, occupants, or guests.';
const LEASE: AnalyzedLease = {
  id: 'lease-1',
  clauses: [
    { id: 'c1', heading: 'RENT', verbatim: '1. RENT. Tenant shall pay monthly rent of $1,500.00 on the first day of each month.', charStart: 0, charEnd: 82 },
    { id: 'c7', heading: 'REPAIRS', verbatim: REPAIRS_CLAUSE, charStart: 900, charEnd: 900 + REPAIRS_CLAUSE.length },
  ],
};

const MOVE_IN_ID = '6f1e1c9a-9a48-4b8e-9a62-2c1f9ad1b001';

function photo(id: string, fields: Partial<Evidence> = {}): Evidence {
  const item = newEvidence(
    {
      itemId: id,
      session: 'move_in',
      room: 'Bedroom',
      checklistItem: 'Heater',
      sha256: 'a'.repeat(64),
      bytes: 1_000,
      mime: 'image/heic',
      capturedAtDevice: '2026-08-14T10:00:00-04:00',
      deviceUptimeMs: 1_000,
      source: 'in_app_camera',
      appVersion: '1.0',
    },
    `rentals/r/evidence/${id}.heic`,
    new Date('2026-08-14T14:00:00Z'),
  );
  return { ...item, receivedAtServer: new Date('2026-08-14T14:01:00Z'), sealedManifestId: 'manifest-1', ...fields };
}

const landlordAnswer: ResponsibilityAnswer = {
  verdict: 'likely_landlord',
  category: 'landlord_maintenance',
  confidence: 'high',
  reasons: [
    { text: 'Virginia makes your landlord keep the heat working.', citation: { kind: 'rule', ref: 'VA_LANDLORD_MAINTAIN_FIT' } },
    { text: 'Your lease says the landlord keeps the heating in repair.', citation: { kind: 'lease', ref: 'lease.c7', quote: 'Landlord shall keep the heating system in good repair.' } },
  ],
  whatWouldChange: ['If you or a guest broke the heater, it would likely be your responsibility.'],
  escrowEligibleCondition: true,
};

type Answers = Partial<Record<Stage, unknown>>;

// Answers per stage, validated by the stage's schema like the real client.
function fakeGemma(answers: Answers) {
  const calls: { stage: Stage; schema: z.ZodType; docs: readonly Document[]; options: GenerateOptions }[] = [];
  const gemma: GemmaClient = {
    async generate(stage, schema, docs, options) {
      calls.push({ stage, schema, docs, options });
      const answer = answers[stage];
      if (answer instanceof Error) throw answer;
      if (answer === undefined) throw new Error(`no answer for ${stage}`);
      return { data: schema.parse(answer), model: stage === 'responsibility_verify' ? GEMMA_31B : GEMMA_26B, fallback: false, promptTokens: 900, outputTokens: 120 };
    },
  };
  return { gemma, calls };
}

function lines() {
  const out: Record<string, unknown>[] = [];
  const push = (message: string, fields?: object) => out.push({ message, ...fields });
  return { out, log: { debug: () => {}, info: push, warn: push, error: push } };
}

const backstopOnly = () => createTriage({ model: null, keywords: keywordBackstop() });

function run(answers: Answers, input: Partial<ResponsibilityInput> = {}, deps: Partial<ResponsibilityDeps> = {}) {
  const { gemma, calls } = fakeGemma(answers);
  const { out, log } = lines();
  const result = checkResponsibility(
    { description: HEATER, locale: 'en', today: TODAY, lease: LEASE, moveIn: [], ...input },
    { gemma, pack: PACK, triage: backstopOnly(), log, ...deps },
  );
  return { result, calls, out };
}

describe('checkResponsibility', () => {
  it('keeps a high landlord verdict on a broken heater when 31B agrees, with every citation resolved', async () => {
    const { result, calls } = run({ responsibility: landlordAnswer, responsibility_verify: { verdict: 'likely_landlord', reasoning: 'Heat is a landlord duty.' } });
    const check = await result;
    expect(check).toMatchObject({
      status: 'checked',
      verdict: 'likely_landlord',
      category: 'landlord_maintenance',
      confidence: 'high',
      escrowEligible: true,
      downgraded: false,
      verification: { status: 'agreed', model: GEMMA_31B, verdict: 'likely_landlord' },
      models: { primary: GEMMA_26B, verifier: GEMMA_31B },
      drops: [],
    });
    if (check.status !== 'checked') throw new Error('not checked');
    expect(check.reasons.map((r) => r.citation)).toEqual([
      {
        kind: 'rule',
        ref: 'VA_LANDLORD_MAINTAIN_FIT',
        citation: 'Va. Code § 55.1-1220(A)(4)',
        quote: MAINTAIN_FIT.versions[0]!.statuteQuote,
        sourceUrl: MAINTAIN_FIT.sourceUrl,
        effectiveFrom: '2019-10-01',
      },
      {
        kind: 'lease',
        ref: 'c7',
        leaseId: 'lease-1',
        heading: 'REPAIRS',
        quote: 'Landlord shall keep the heating system in good repair.',
        quoteSpan: { start: 912, end: 966 },
      },
    ]);
    expect(REPAIRS_CLAUSE.slice(12, 66)).toBe('Landlord shall keep the heating system in good repair.');
    expect(calls.map((c) => c.stage)).toEqual(['responsibility', 'responsibility_verify']);
  });

  it('downgrades high to medium when 31B gives another verdict', async () => {
    const { result } = run({ responsibility: landlordAnswer, responsibility_verify: { verdict: 'could_be_either', reasoning: 'Unclear cause.' } });
    expect(await result).toMatchObject({
      confidence: 'medium',
      downgraded: true,
      verification: { status: 'disagreed', model: GEMMA_31B, verdict: 'could_be_either' },
      verdict: 'likely_landlord',
    });
  });

  it('downgrades high to medium when 31B does not answer, and logs no content', async () => {
    const { result, out } = run({ responsibility: landlordAnswer, responsibility_verify: new GemmaUnavailableError('responsibility_verify', [GEMMA_31B]) });
    expect(await result).toMatchObject({
      confidence: 'medium',
      downgraded: true,
      verification: { status: 'unavailable', model: null, verdict: null },
      models: { primary: GEMMA_26B, verifier: null },
    });
    expect(out.find((l) => l.message === 'responsibility verifier unavailable')).toEqual({
      message: 'responsibility verifier unavailable',
      errorName: 'GemmaUnavailableError',
    });
    expect(out.find((l) => l.message === 'responsibility check')).toMatchObject({ status: 'checked', confidence: 'medium', verification: 'unavailable', downgraded: true });
    expect(JSON.stringify(out)).not.toContain('heater');
  });

  it('asks 31B only on high', async () => {
    const { result, calls } = run({ responsibility: { ...landlordAnswer, confidence: 'medium' } });
    expect(await result).toMatchObject({ confidence: 'medium', downgraded: false, verification: { status: 'not_needed', model: null, verdict: null } });
    expect(calls.map((c) => c.stage)).toEqual(['responsibility']);
  });

  it('shows 31B only the description and the cited text, never 26B verdict', async () => {
    const { result, calls } = run({ responsibility: landlordAnswer, responsibility_verify: { verdict: 'likely_landlord', reasoning: 'x' } });
    await result;
    const verify = calls[1]!;
    expect(verify.docs).toEqual([
      { id: 'description', text: HEATER },
      { id: 'lease.quote2', text: 'Landlord shall keep the heating system in good repair.' },
    ]);
    expect(verify.options.instruction).toContain(MAINTAIN_FIT.versions[0]!.statuteQuote);
    expect(verify.options.instruction).not.toContain(MAINTAIN_FIT.summaryForModel);
    // The instruction lists every verdict as an option; 26B's own answer
    // (its category, its reasons' words) appears nowhere.
    const sent = JSON.stringify({ docs: verify.docs, instruction: verify.options.instruction, task: verify.options.task });
    expect(sent).not.toContain('landlord_maintenance');
    expect(sent).not.toContain('Virginia makes your landlord');
    expect(JSON.stringify(verify.docs)).not.toContain('likely_landlord');
  });

  it('lets the model cite only what was sent', async () => {
    const { result, calls } = run({ responsibility: { ...landlordAnswer, confidence: 'low' } }, { moveIn: [photo(MOVE_IN_ID)] });
    await result;
    const schema = calls[0]!.schema;
    const citing = (ref: string) => ({ ...landlordAnswer, reasons: [{ text: 'x', citation: { kind: 'rule', ref } }] });
    for (const ref of ['VA_LANDLORD_MAINTAIN_FIT', 'VA_RENT_ESCROW_PROCESS', 'lease.c7', `evidence.${MOVE_IN_ID}`]) expect(schema.safeParse(citing(ref)).success).toBe(true);
    // Not in force for this check, a clause that was not sent, a photo that was not sent, invented.
    for (const ref of ['VA_LATE_FEE_CAP', 'lease.c1', 'c7', 'evidence.00000000-0000-4000-8000-000000000000', 'VA_HEAT_68_DEGREES']) {
      expect(schema.safeParse(citing(ref)).success).toBe(false);
    }
    // A looping sentence fails validation, so the client retries.
    expect(schema.safeParse({ ...landlordAnswer, whatWouldChange: ['x'.repeat(201)] }).success).toBe(false);
  });

  it('drops every reason whose citation does not resolve', async () => {
    const answer: ResponsibilityAnswer = {
      ...landlordAnswer,
      confidence: 'medium',
      reasons: [
        { text: 'A clause cited as a rule.', citation: { kind: 'rule', ref: 'lease.c7' } },
        { text: 'A rule cited as a clause.', citation: { kind: 'lease', ref: 'VA_LANDLORD_MAINTAIN_FIT', quote: 'Maintain in good and safe working order' } },
        { text: 'A quote the clause does not contain.', citation: { kind: 'lease', ref: 'lease.c7', quote: 'Landlord shall replace the heater within 24 hours.' } },
        { text: 'A clause cited as a photo.', citation: { kind: 'evidence', ref: 'lease.c7' } },
      ],
    };
    const { result } = run({ responsibility: answer });
    const check = await result;
    expect(check).toMatchObject({ verdict: 'not_sure', category: 'unknown', confidence: 'low', reasons: [], escrowEligible: false });
    if (check.status !== 'checked') throw new Error('not checked');
    expect(check.drops).toEqual([
      { reason: 'unknown_rule' },
      { reason: 'unknown_clause' },
      { reason: 'lease_quote_not_in_clause', ref: 'c7' },
      { reason: 'unknown_evidence' },
    ]);
  });

  it('drops a lease citation with no quote, and a repeat', async () => {
    const answer: ResponsibilityAnswer = {
      ...landlordAnswer,
      confidence: 'medium',
      reasons: [
        landlordAnswer.reasons[0]!,
        { text: 'Again.', citation: { kind: 'rule', ref: 'VA_LANDLORD_MAINTAIN_FIT' } },
        { text: 'No quote.', citation: { kind: 'lease', ref: 'lease.c7' } },
      ],
    };
    const check = await run({ responsibility: answer }).result;
    if (check.status !== 'checked') throw new Error('not checked');
    expect(check.reasons).toHaveLength(1);
    expect(check.verdict).toBe('likely_landlord');
    expect(check.drops).toEqual([
      { reason: 'duplicate_citation', ref: 'VA_LANDLORD_MAINTAIN_FIT' },
      { reason: 'missing_lease_quote', ref: 'c7' },
    ]);
  });

  it('calls damage pre-existing only with a move-in record cited', async () => {
    const preExisting: ResponsibilityAnswer = {
      verdict: 'likely_landlord',
      category: 'pre_existing',
      confidence: 'medium',
      reasons: [
        { text: 'You photographed the heater at move-in.', citation: { kind: 'evidence', ref: `evidence.${MOVE_IN_ID}` } },
        landlordAnswer.reasons[0]!,
      ],
      whatWouldChange: ['If the damage got worse after move-in, part of it could be yours.'],
      escrowEligibleCondition: false,
    };
    const withRecord = await run({ responsibility: preExisting }, { moveIn: [photo(MOVE_IN_ID)] }).result;
    expect(withRecord).toMatchObject({ category: 'pre_existing', escrowEligible: false });
    if (withRecord.status !== 'checked') throw new Error('not checked');
    expect(withRecord.reasons[0]!.citation).toEqual({
      kind: 'evidence',
      ref: MOVE_IN_ID,
      session: 'move_in',
      room: 'Bedroom',
      checklistItem: 'Heater',
      capturedAtDevice: '2026-08-14T10:00:00-04:00',
      sealedManifestId: 'manifest-1',
    });

    // No move-in photo sent, so the model can cite none: pre_existing has
    // nothing behind it.
    const ruleOnly = { ...preExisting, reasons: [landlordAnswer.reasons[0]!] };
    expect(await run({ responsibility: ruleOnly }).result).toMatchObject({ category: 'unknown', verdict: 'likely_landlord' });
  });

  it('sends the description, the relevant clauses, and the move-in records as documents', async () => {
    const { result, calls } = run({ responsibility: { ...landlordAnswer, confidence: 'low' } }, { moveIn: [photo(MOVE_IN_ID)] });
    await result;
    const [call] = calls;
    expect(call!.docs.map((d) => d.id)).toEqual(['description', 'lease.c7', `evidence.${MOVE_IN_ID}`]);
    expect(call!.docs[2]).toEqual({
      id: `evidence.${MOVE_IN_ID}`,
      text: 'Move-in photo. Room: Bedroom. Item: Heater. Taken: 2026-08-14T10:00:00-04:00. sealed.',
    });
    const instruction = call!.options.instruction!;
    for (const id of ['VA_LANDLORD_MAINTAIN_FIT', 'VA_DEPOSIT_WEAR_AND_TEAR', 'VA_NO_REPAIR_FEES', 'VA_RENT_ESCROW_PROCESS']) expect(instruction).toContain(id);
    expect(instruction).not.toContain('VA_LATE_FEE_CAP');
    // The escrow rule's version in force on the day: the one before 2027.
    expect(instruction).toContain('The tenant has paid into court the amount of rent');
    expect(instruction).not.toContain(HEATER);
  });

  it('cites no rule outside a rule pack, and makes no escrow claim', async () => {
    const leaseOnly = { ...landlordAnswer, confidence: 'medium' as const, reasons: [landlordAnswer.reasons[1]!] };
    const { result, calls } = run({ responsibility: leaseOnly }, {}, { pack: null });
    const check = await result;
    expect(calls[0]!.schema.safeParse(landlordAnswer).success).toBe(false);
    expect(calls[0]!.options.instruction).toContain('there are no rules for this place');
    if (check.status !== 'checked') throw new Error('not checked');
    expect(check.reasons.map((r) => r.citation.kind)).toEqual(['lease']);
    expect(check.escrowEligible).toBe(false);
  });

  it('answers not_sure without a model call when there is nothing to cite', async () => {
    const { result, calls } = run({}, { lease: null }, { pack: null });
    expect(await result).toMatchObject({
      status: 'checked',
      verdict: 'not_sure',
      category: 'unknown',
      confidence: 'low',
      reasons: [],
      models: { primary: null, verifier: null },
    });
    expect(calls).toEqual([]);
  });

  it('allows escrow only on a landlord verdict', async () => {
    const tenant = await run({ responsibility: { ...landlordAnswer, verdict: 'likely_tenant', confidence: 'medium' } }).result;
    expect(tenant).toMatchObject({ verdict: 'likely_tenant', escrowEligible: false });
  });

  it('stops with the handoff on danger, before any model call', async () => {
    const { result, calls } = run({ responsibility: landlordAnswer }, { description: 'I smell gas in the kitchen near the stove.' });
    expect(await result).toMatchObject({ status: 'escalated', triage: { escalate: true, category: 'immediate_danger' } });
    expect(calls).toEqual([]);
  });

  it('answers other escalations with the triage attached', async () => {
    const { result } = run({ responsibility: { ...landlordAnswer, confidence: 'medium' } }, { description: 'The landlord changed the locks and the new key does not open the door.' });
    expect(await result).toMatchObject({ status: 'checked', verdict: 'likely_landlord', triage: { escalate: true, category: 'lockout' } });
    const calm = await run({ responsibility: { ...landlordAnswer, confidence: 'medium' } }).result;
    expect(calm).toMatchObject({ status: 'checked', triage: { escalate: false, category: 'none' } });
  });

  it('escalates danger with no model, and is unavailable when it would need one', async () => {
    const { log } = lines();
    const deps = { gemma: null, pack: PACK, triage: backstopOnly(), log };
    const input = { description: 'There is a gas leak.', locale: 'en', today: TODAY, lease: null, moveIn: [] };
    expect(await checkResponsibility(input, deps)).toMatchObject({ status: 'escalated', triage: { category: 'immediate_danger' } });
    await expect(checkResponsibility({ ...input, description: 'The landlord changed the locks.' }, deps)).rejects.toBeInstanceOf(GemmaUnavailableError);
    await expect(checkResponsibility({ ...input, description: HEATER }, deps)).rejects.toBeInstanceOf(GemmaUnavailableError);
  });
});

describe('relevantClauses', () => {
  it('keeps clauses about repairs, damage, and systems, in order, within the budget', () => {
    expect(relevantClauses(LEASE.clauses).map((c) => c.id)).toEqual(['c7']);
    const big = { ...LEASE.clauses[1]!, id: 'c8', verbatim: `8. MAINTENANCE. ${'x'.repeat(MAX_LEASE_CHARS)}` };
    expect(relevantClauses([...LEASE.clauses, big]).map((c) => c.id)).toEqual(['c7']);
  });
});

describe('moveInRecords', () => {
  it('keeps received, undeleted move-in photos of the same room, the same item and sealed first', () => {
    const items = [
      photo('00000000-0000-4000-8000-000000000001', { checklistItem: 'Window', sealedManifestId: null }),
      photo('00000000-0000-4000-8000-000000000002', { checklistItem: 'Window' }),
      photo('00000000-0000-4000-8000-000000000003', { checklistItem: ' heater ' }),
      photo('00000000-0000-4000-8000-000000000004', { room: 'Kitchen' }),
      photo('00000000-0000-4000-8000-000000000005', { deletedAt: new Date() }),
      photo('00000000-0000-4000-8000-000000000006', { receivedAtServer: null }),
      photo('00000000-0000-4000-8000-000000000007', { session: 'incident' }),
    ];
    expect(moveInRecords(items, 'bedroom', 'Heater').map((i) => i.id.slice(-1))).toEqual(['3', '2', '1']);
    expect(moveInRecords(items, null, 'Heater')).toEqual([]);
  });
});

// Tokens are the uid, as in rentals.test.ts.
const fakeVerifier: VerifyIdToken = async (token) => {
  if (token === 'alice' || token === 'bob') return { uid: token, provider: 'anonymous' };
  throw new InvalidTokenError('invalid');
};

const INCIDENT_ID = '7a2d4c1b-3e5f-4a6b-8c9d-0e1f2a3b4c5d';

async function route(answers: Answers | null = { responsibility: landlordAnswer, responsibility_verify: { verdict: 'likely_landlord', reasoning: 'x' } }) {
  const logged: Record<string, unknown>[] = [];
  const memory = memoryStore();
  const fake = answers ? fakeGemma(answers) : null;
  const app = createApp({
    logSink: (line) => logged.push(JSON.parse(line)),
    verifyIdToken: fakeVerifier,
    store: memory.store,
    gemma: fake?.gemma ?? null,
    triage: backstopOnly(),
    rulePacks: new Map([['VA', PACK]]),
  });
  const request = (path: string, body: unknown, token: string | null = 'alice') =>
    app.request(path, {
      method: 'POST',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  const created = await request('/v1/rentals', { jurisdiction: 'VA', city: 'Richmond', phase: 'living' });
  const rentalId: string = (await created.json()).id;
  const post = (body: unknown, token: string | null = 'alice', id = rentalId) => request(`/v1/rentals/${id}/issues`, body, token);
  return { post, logged, memory, rentalId, calls: fake?.calls ?? [] };
}

describe('POST /v1/rentals/:id/issues', () => {
  it('checks a broken heater and stores the issue', async () => {
    const { post, memory, rentalId, logged, calls } = await route();
    memory.leases.set(rentalId, LEASE);
    memory.evidence.set(`${rentalId}/${MOVE_IN_ID}`, photo(MOVE_IN_ID));
    memory.evidence.set(`${rentalId}/${INCIDENT_ID}`, photo(INCIDENT_ID, { session: 'incident', sealedManifestId: null }));

    const res = await post({ description: HEATER, room: 'Bedroom', checklistItem: 'Heater', photoIds: [INCIDENT_ID.toUpperCase()] });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({
      issueId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      status: 'checked',
      description: HEATER,
      room: 'Bedroom',
      checklistItem: 'Heater',
      photos: [INCIDENT_ID],
      locale: 'en',
      verdict: 'likely_landlord',
      category: 'landlord_maintenance',
      confidence: 'high',
      escrowEligible: true,
      verification: { status: 'agreed', model: GEMMA_31B, verdict: 'likely_landlord' },
      downgraded: false,
      models: { primary: GEMMA_26B, verifier: GEMMA_31B },
      leaseId: 'lease-1',
      createdAt: expect.any(String),
      triage: { escalate: false, category: 'none', model: { status: 'off' } },
    });
    expect(body.reasons.map((r: { citation: { kind: string; ref: string } }) => [r.citation.kind, r.citation.ref])).toEqual([
      ['rule', 'VA_LANDLORD_MAINTAIN_FIT'],
      ['lease', 'c7'],
    ]);
    expect(memory.issues.get(`${rentalId}/${body.issueId}`)).toMatchObject({ verdict: 'likely_landlord', photos: [INCIDENT_ID] });
    // The move-in photo of the same room and item went to the model.
    expect(calls[0]!.docs.map((d) => d.id)).toContain(`evidence.${MOVE_IN_ID}`);

    expect(logged.find((l) => l.message === 'issue created')).toMatchObject({ rentalId, issueId: body.issueId, photos: 1, requestId: expect.any(String) });
    expect(logged.find((l) => l.message === 'responsibility check')).toMatchObject({ verdict: 'likely_landlord', requestId: expect.any(String) });
    expect(JSON.stringify(logged)).not.toContain('stopped working');
  });

  it('answers a gas leak with the triage decision and stores nothing', async () => {
    const { post, memory, calls } = await route();
    const res = await post({ description: 'There is a gas leak in the kitchen.' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'escalated', triage: { escalate: true, category: 'immediate_danger', model: { status: 'off' } } });
    expect(memory.issues.size).toBe(0);
    expect(calls).toEqual([]);
  });

  it('is 503 without a model, and when the model is down', async () => {
    for (const answers of [null, { responsibility: new GemmaUnavailableError('responsibility', [GEMMA_26B]) }]) {
      const { post, memory } = await route(answers);
      const res = await post({ description: HEATER });
      expect(res.status).toBe(503);
      expect((await res.json()).error.code).toBe('DEPENDENCY_UNAVAILABLE');
      expect(memory.issues.size).toBe(0);
    }
  });

  it('refuses photos that are missing, deleted, or not uploaded', async () => {
    const { post, memory, rentalId } = await route();
    expect((await post({ description: HEATER, photoIds: [INCIDENT_ID] })).status).toBe(404);
    memory.evidence.set(`${rentalId}/${INCIDENT_ID}`, photo(INCIDENT_ID, { receivedAtServer: null }));
    expect((await post({ description: HEATER, photoIds: [INCIDENT_ID] })).status).toBe(409);
    memory.evidence.set(`${rentalId}/${INCIDENT_ID}`, photo(INCIDENT_ID, { deletedAt: new Date() }));
    expect((await post({ description: HEATER, photoIds: [INCIDENT_ID] })).status).toBe(409);
  });

  it('rejects bad bodies without echoing them', async () => {
    const { post } = await route();
    for (const [body, field] of [
      [{ description: '   ' }, 'description'],
      [{ description: 'x'.repeat(2_001) }, 'description'],
      [{ description: HEATER, photoIds: ['not-a-uuid'] }, 'photoIds.0'],
      [{ description: HEATER, photoIds: [INCIDENT_ID, INCIDENT_ID] }, 'photoIds'],
      [{ description: HEATER, photoIds: Array.from({ length: 5 }, (_, i) => `00000000-0000-4000-8000-00000000000${i}`) }, 'photoIds'],
      [{ description: HEATER, locale: 'not a locale' }, 'locale'],
      [{ description: HEATER, secret: 'leak' }, 'unknown fields'],
      ['not json', 'Body must be JSON'],
    ] as const) {
      const res = await post(body);
      expect(res.status).toBe(400);
      const { error } = await res.json();
      expect(error.code).toBe('BAD_REQUEST');
      expect(error.message).toContain(field);
      expect(error.message).not.toContain('leak');
    }
    expect((await post({ description: HEATER, room: 'x'.repeat(20_000) })).status).toBe(413);
  });

  it('is 404 for an unknown rental, 403 for another user, 401 without a token', async () => {
    const { post } = await route();
    expect((await post({ description: HEATER }, 'alice', 'no-such-rental')).status).toBe(404);
    expect((await post({ description: HEATER }, 'alice', 'bad/id')).status).toBe(404);
    expect((await post({ description: HEATER }, 'bob')).status).toBe(403);
    expect((await post({ description: HEATER }, null)).status).toBe(401);
  });
});
