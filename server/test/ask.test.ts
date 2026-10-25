import { describe, it, expect, vi } from 'vitest';
import { join } from 'node:path';
import { z } from 'zod';
import { AskInput, AskTurn, citationGate, groundedAsk, rentalTools, type Source } from '../src/ai/ask.js';
import { createGemma } from '../src/ai/gemma.js';
import { modelConfigFromEnv } from '../src/ai/models.js';
import { createTriage } from '../src/ai/triage/index.js';
import { keywordBackstop } from '../src/ai/triage/keywords.js';
import { createApp } from '../src/app.js';
import { newRental, CreateRentalInput } from '../src/models/rental.js';
import { newLease } from '../src/models/lease.js';
import { loadRulePack, JURISDICTIONS_ROOT } from '../src/rules/loader.js';
import { memoryUsageSink } from '../src/usage.js';
import { memoryStore } from './memory-store.js';

const pack = loadRulePack(join(JURISDICTIONS_ROOT, 'va'), { requireVerified: true });
const rule = pack.rules[0]!;
const source: Source = { kind: 'rule', ref: rule.id, label: rule.citation, text: rule.versions[0]!.statuteQuote };
const sentence = (citations: { kind: 'rule'; ref: string }[] = [{ kind: 'rule', ref: rule.id }], text = 'A sourced sentence.') => ({ text, citations });
function model(turns: z.infer<typeof AskTurn>[]) {
  const generate = vi.fn(async () => ({ text: JSON.stringify(turns.shift()), promptTokens: 1, outputTokens: 1, thoughtTokens: 0 }));
  return { generate, gemma: createGemma({ provider: { name: 'fake', generate }, config: modelConfigFromEnv({}), usage: memoryUsageSink(), retry: { retries: 0, baseDelayMs: 0, maxDelayMs: 0 } }) };
}
const input = AskInput.parse({ message: 'What are the rules?' });
const rental = newRental('r1', 'alice', CreateRentalInput.parse({ jurisdiction: 'VA', city: 'Richmond', occupancyDate: '2026-11-01', tenancyEndDate: '2027-11-01' }), new Date());

describe('Ask citation gate', () => {
  it('drops uncited, invented, wrong-kind, mixed and paragraph claims', () => {
    const answer = citationGate({ outOfScope: false, sentences: [sentence(), sentence([]), sentence([{ kind: 'rule', ref: 'invented' }]), sentence([{ kind: 'rule', ref: rule.id }, { kind: 'rule', ref: 'invented' }]), sentence(undefined, 'A sourced sentence. An unsupported claim.')] }, [source]);
    expect(answer.sentences).toHaveLength(1);
    expect(answer.sentences[0]!.citations[0]).toEqual(source);
  });
  it('hands off empty answers, stale history refs and explicit out-of-scope', () => {
    expect(citationGate({ outOfScope: false, sentences: [sentence()] }, []).outOfScope).toBe(true);
    expect(citationGate({ outOfScope: true, sentences: [sentence()] }, [source]).sentences).toEqual([]);
  });
  it('accepts only six bounded history turns', () => {
    expect(AskInput.safeParse({ message: 'x', history: Array(7).fill({ role: 'user', text: 'x' }) }).success).toBe(false);
    expect(AskInput.safeParse({ message: 'x', rentalId: 'another' }).success).toBe(false);
  });
});

describe('Ask tool loop', () => {
  it('uses native declarations, executes only four calls, then hands off', async () => {
    const { gemma, generate } = model(Array(5).fill({ type: 'tool', call: { name: 'get_deadlines' } }));
    const execute = vi.fn(async () => [source]);
    expect((await groundedAsk(gemma, input, execute, [rule.id])).outOfScope).toBe(true);
    expect(execute).toHaveBeenCalledTimes(4);
    expect(generate.mock.calls).toHaveLength(5);
  });
  it('answers from tool results and isolates successive requests', async () => {
    const { gemma } = model([{ type: 'tool', call: { name: 'get_rule', rule_id: rule.id } }, { type: 'answer', answer: { outOfScope: false, sentences: [sentence()] } }, { type: 'answer', answer: { outOfScope: false, sentences: [sentence()] } }]);
    const execute = vi.fn(async () => [source]);
    expect((await groundedAsk(gemma, input, execute, [rule.id])).sentences).toHaveLength(1);
    expect((await groundedAsk(gemma, input, execute, [rule.id])).outOfScope).toBe(true);
  });
  it('searches only analyzed leases of this rental and versions rules by date', async () => {
    const { store } = memoryStore();
    for (const id of ['r1', 'r2']) {
      const lease = await store.createLease(id, leaseID => newLease(leaseID, 'VA', { text: 'Deposit is $100.', locale: 'en', readingLevel: 'standard' }, new Date()));
      await store.saveLeaseAnalysis(id, { ...lease, status: 'analyzed' }, [{ id: 'c1', heading: 'Deposit', verbatim: 'Deposit is $100.', start: 0, end: 16 }], []);
    }
    const execute = rentalTools(store, rental, pack, '2026-10-25');
    const clauses = await execute({ name: 'search_lease_clauses', query: 'deposit' });
    expect(clauses).toHaveLength(1);
    expect(await execute({ name: 'get_rule', rule_id: 'unknown' })).toEqual([]);
    const deadlines = await execute({ name: 'get_deadlines' });
    expect(deadlines.find(d => d.ref === 'move_in_report')?.text).toContain('2026-11-06');
    expect(deadlines.find(d => d.ref === 'deposit_itemization')?.text).toContain('Vacating date is unknown');
  });
});

describe('Ask HTTP route', () => {
  it('authorizes before triage, escalates before Ask, and does not store the conversation', async () => {
    const memory = memoryStore(); memory.rentals.set(rental.id, rental);
    const { gemma, generate } = model([{ type: 'answer', answer: { outOfScope: true, sentences: [] } }]);
    const app = createApp({ store: memory.store, gemma, triage: createTriage({ model: null, keywords: keywordBackstop() }), verifyIdToken: async token => ({ uid: token, provider: 'anonymous' }), logSink: () => {}, packs: () => new Map([['VA', pack]]) });
    const ask = (token: string, message: string) => app.request('/v1/rentals/r1/ask', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ message }) });
    expect((await ask('mallory', 'question')).status).toBe(403);
    const escalated = await ask('alice', 'My landlord changed the locks and locked me out.');
    expect((await escalated.json()).escalation.escalate).toBe(true);
    expect(generate).not.toHaveBeenCalled();
    const answer = await ask('alice', 'Who won the football game?');
    expect(answer.status).toBe(200);
    expect(answer.headers.get('Cache-Control')).toBe('no-store');
    expect((await answer.json()).outOfScope).toBe(true);
    expect(memory.rentals.get(rental.id)).toEqual(rental);
    expect(memory.leases.size).toBe(0);
  });
});

describe('native function transports', () => {
  it('Gemini sends declarations and converts the SDK function call into validated dispatch data', async () => {
    const { geminiProvider } = await import('../src/ai/provider.js');
    const { ASK_FUNCTIONS } = await import('../src/ai/ask.js');
    const { GenerateContentResponse } = await import('@google/genai');
    const response = new GenerateContentResponse();
    response.candidates = [{ content: { parts: [{ functionCall: { name: 'get_deadlines', args: {} } }] } }];
    const generateContent = vi.fn(async (_request: import('@google/genai').GenerateContentParameters) => response);
    const provider = geminiProvider({ generateContent });
    const result = await provider.generate({ model: 'gemma-4-26b-a4b-it', systemInstruction: 'Read only.', parts: [{ text: 'Question' }], thinking: 'minimal', functions: ASK_FUNCTIONS });
    expect(JSON.parse(result.text)).toEqual({ type: 'tool', call: { name: 'get_deadlines' } });
    expect(generateContent.mock.calls[0]![0].config?.tools).toEqual([{ functionDeclarations: ASK_FUNCTIONS }]);
    expect(generateContent.mock.calls[0]![0].config).not.toHaveProperty('responseMimeType');
  });
});
