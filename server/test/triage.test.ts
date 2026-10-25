import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { VerifyIdToken } from '../src/auth.js';
import { InvalidTokenError } from '../src/auth.js';
import { createGemma, GemmaUnavailableError } from '../src/ai/gemma.js';
import { GEMMA_26B, modelConfigFromEnv } from '../src/ai/models.js';
import type { ModelProvider, ProviderRequest } from '../src/ai/provider.js';
import { TRIAGE_INSTRUCTION } from '../src/ai/prompts/triage.js';
import { gemmaTriageProvider, MODEL_TEXT_CHARS } from '../src/ai/triage/gemma.js';
import {
  createTriage,
  TRIAGE_CATEGORIES,
  type TriageCategory,
  type TriageInput,
  type TriageProvider,
  type TriageSource,
} from '../src/ai/triage/index.js';
import { keywordBackstop, normalize, TERMS } from '../src/ai/triage/keywords.js';
import type { Clock } from '../src/ratelimit.js';
import { memoryUsageSink } from '../src/usage.js';
import { memoryStore } from './memory-store.js';

interface EscalationCase {
  id: string;
  expected: TriageCategory;
  source: TriageSource;
  locale: string;
  text: string;
}

// The `escalation` eval set (spec §12): 40 high-stakes inputs and 40 benign
// ones, EN and ES. The live runner (`pnpm --filter @fineprint/eval escalation`)
// scores Gemma and the backstop together; this file gates CI on the backstop.
const CASES: EscalationCase[] = readFileSync(new URL('../../eval/datasets/escalation.jsonl', import.meta.url), 'utf8')
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line));

const positives = CASES.filter((c) => c.expected !== 'none');
const benign = CASES.filter((c) => c.expected === 'none');
const summons = positives.find((c) => c.id === 'eviction-or-court-01-en')!;
const leaseDefault = benign.find((c) => c.source === 'lease' && c.text.includes('unlawful detainer'))!;

describe('escalation eval set', () => {
  it('has 40 positives across every category and 40 benign inputs, in EN and ES', () => {
    expect(positives).toHaveLength(40);
    expect(benign).toHaveLength(40);
    for (const category of TRIAGE_CATEGORIES.filter((c) => c !== 'none')) {
      const locales = new Set(positives.filter((c) => c.expected === category).map((c) => c.locale));
      expect([category, [...locales].sort()]).toEqual([category, ['en', 'es']]);
    }
    expect(new Set(benign.map((c) => c.locale))).toEqual(new Set(['en', 'es']));
    expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length);
  });
});

describe('keyword backstop', () => {
  const backstop = keywordBackstop();

  // The CI recall gate (spec §7.9, §12). The decision is Gemma OR the
  // backstop, so the backstop alone at 100% holds the gate even when Gemma
  // misses a case or is down.
  it.each(positives.map((c) => [c.id, c] as const))('escalates %s', async (_id, c) => {
    const result = await backstop.classify(c);
    expect(result.category).not.toBe('none');
  });

  it('reports precision on the benign inputs', async () => {
    const fired = [];
    for (const c of benign) if ((await backstop.classify(c)).category !== 'none') fired.push(c.id);
    // Not gated by the spec; a floor so a broad new term shows up in review.
    expect(fired.length / benign.length).toBeLessThanOrEqual(0.1);
  });

  it('has EN and ES terms for every category', () => {
    for (const category of TRIAGE_CATEGORIES.filter((c) => c !== 'none')) {
      const langs = new Set(TERMS.filter((t) => t.category === category).map((t) => t.id.split('.')[0]));
      expect([category, [...langs].sort()]).toEqual([category, ['en', 'es']]);
    }
    expect(new Set(TERMS.map((t) => t.id)).size).toBe(TERMS.length);
  });

  it('escalates an eviction summons uploaded as a lease, and not a lease clause about unlawful detainer', async () => {
    expect(await backstop.classify(summons)).toMatchObject({ category: 'eviction_or_court', confidence: 1 });
    expect(await backstop.classify(leaseDefault)).toEqual({ category: 'none', confidence: 0, matches: [] });
  });

  it('runs message terms only on what the tenant writes', async () => {
    const text = 'The landlord changed the locks and shut off my water.';
    expect((await backstop.classify({ source: 'ask', text, locale: 'en' })).matches).toEqual([
      'en.lockout.changed-locks',
      'en.utility_shutoff.shut-off',
    ]);
    expect((await backstop.classify({ source: 'repair', text, locale: 'en' })).category).toBe('lockout');
    expect((await backstop.classify({ source: 'lease', text, locale: 'en' })).category).toBe('none');
    expect((await backstop.classify({ source: 'landlord_report', text, locale: 'en' })).category).toBe('none');
  });

  it('matches Spanish with or without accents, whatever the locale', async () => {
    for (const text of ['Recibí una CITACIÓN del tribunal', 'recibi una citacion del tribunal']) {
      expect((await backstop.classify({ source: 'lease', text, locale: 'en' })).matches).toContain('es.eviction_or_court.citacion');
    }
    expect((await backstop.classify({ source: 'ask', text: 'He changed the locks', locale: 'es' })).category).toBe('lockout');
  });

  it('reads image captions too', async () => {
    const input: TriageInput = { source: 'repair', text: 'See photo.', imageCaptions: ['Sparks coming from an outlet'], locale: 'en' };
    expect((await backstop.classify(input)).category).toBe('immediate_danger');
  });

  it('names the most severe category first', async () => {
    const text = 'If they evict me I am going to kill myself.';
    expect(await backstop.classify({ source: 'ask', text, locale: 'en' })).toMatchObject({
      category: 'self_harm',
      matches: ['en.self_harm.kill-myself', 'en.eviction_or_court.evict-me'],
    });
  });

  it('normalizes case, accents, quotes, and whitespace', () => {
    expect(normalize('My  key DOESN’T\nwork. Cortó la luz')).toBe("my key doesn't work. corto la luz");
  });
});

function fixed(name: string, result: { category: TriageCategory; confidence: number } | Error): TriageProvider {
  return {
    name,
    async classify() {
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

function lines() {
  const out: Record<string, unknown>[] = [];
  const push = (message: string, fields?: object) => out.push({ message, ...fields });
  return { out, log: { debug: () => {}, info: push, warn: push, error: push } };
}

describe('createTriage', () => {
  const benignAsk: TriageInput = { source: 'ask', text: 'When is rent due?', locale: 'en' };
  const lockoutAsk: TriageInput = { source: 'ask', text: 'The landlord changed the locks.', locale: 'en' };

  it('escalates when only the model fires', async () => {
    const triage = createTriage({ model: fixed('gemma', { category: 'retaliation', confidence: 0.7 }), keywords: keywordBackstop() });
    expect(await triage.check(benignAsk)).toEqual({
      escalate: true,
      category: 'retaliation',
      model: { status: 'ok', category: 'retaliation', confidence: 0.7 },
      keywords: { category: 'none', confidence: 0, matches: [] },
    });
  });

  it('escalates when only the backstop fires', async () => {
    const triage = createTriage({ model: fixed('gemma', { category: 'none', confidence: 0.9 }), keywords: keywordBackstop() });
    expect(await triage.check(lockoutAsk)).toMatchObject({ escalate: true, category: 'lockout', model: { status: 'ok', category: 'none' } });
  });

  it('does not escalate when neither fires', async () => {
    const triage = createTriage({ model: fixed('gemma', { category: 'none', confidence: 0.95 }), keywords: keywordBackstop() });
    expect(await triage.check(benignAsk)).toMatchObject({ escalate: false, category: 'none' });
  });

  it('falls back to the backstop when the model is unavailable, and logs no content', async () => {
    const { out, log } = lines();
    const triage = createTriage({ model: fixed('gemma', new GemmaUnavailableError('triage', [GEMMA_26B])), keywords: keywordBackstop() });
    expect(await triage.check(lockoutAsk, { log })).toMatchObject({ escalate: true, category: 'lockout', model: { status: 'unavailable' } });
    expect(await triage.check(benignAsk, { log })).toMatchObject({ escalate: false, model: { status: 'unavailable' } });
    expect(out[0]).toEqual({ message: 'triage model unavailable', provider: 'gemma', errorName: 'GemmaUnavailableError' });
    expect(out[1]).toEqual({
      message: 'triage',
      source: 'ask',
      escalate: true,
      category: 'lockout',
      modelStatus: 'unavailable',
      modelCategory: null,
      keywordCategory: 'lockout',
      keywordMatches: 1,
      textChars: lockoutAsk.text.length,
    });
    expect(JSON.stringify(out)).not.toContain('locks.');
  });

  it('runs the backstop alone with no model', async () => {
    const triage = createTriage({ model: null, keywords: keywordBackstop() });
    expect(await triage.check(summons)).toMatchObject({ escalate: true, category: 'eviction_or_court', model: { status: 'off' } });
  });
});

const immediate: Clock = { now: () => Date.parse('2026-10-24T12:00:00Z'), sleep: async () => {} };

function gemmaWith(text: string) {
  const requests: ProviderRequest[] = [];
  const provider: ModelProvider = {
    name: 'fake',
    async generate(request) {
      requests.push(request);
      return { text, promptTokens: 300, outputTokens: 10, thoughtTokens: 0 };
    },
  };
  const gemma = createGemma({ provider, config: modelConfigFromEnv({}), usage: memoryUsageSink(), clock: immediate, log: lines().log });
  return { provider: gemmaTriageProvider(gemma), requests };
}

describe('GemmaTriageProvider', () => {
  it('asks 26B at minimal thinking with the category enum and the source note', async () => {
    const { provider, requests } = gemmaWith('{"category":"eviction_or_court","confidence":0.97}');
    expect(await provider.classify({ ...summons, imageCaptions: ['A court form'] })).toEqual({ category: 'eviction_or_court', confidence: 0.97 });
    const [request] = requests;
    expect(request).toMatchObject({ model: GEMMA_26B, thinking: 'minimal' });
    expect(request!.systemInstruction).toContain(TRIAGE_INSTRUCTION);
    expect(request!.responseSchema?.properties?.category?.enum).toEqual([...TRIAGE_CATEGORIES]);
    const texts = request!.parts.map((p) => ('text' in p ? p.text : ''));
    expect(texts[0]).toMatch(/^<document id="lease">\nCOMMONWEALTH OF VIRGINIA/);
    expect(texts[1]).toBe('<document id="image_captions">\nA court form\n</document>');
    expect(texts[2]).toContain('uploaded as a lease');
  });

  it('sends the model only the head of a long document', async () => {
    const { provider, requests } = gemmaWith('{"category":"none","confidence":0.9}');
    await provider.classify({ source: 'lease', text: 'a'.repeat(MODEL_TEXT_CHARS * 3), locale: 'en' });
    const first = requests[0]!.parts[0]!;
    expect('text' in first && first.text.length).toBeLessThan(MODEL_TEXT_CHARS + 50);
  });

  it('rejects a category outside the enum', async () => {
    const { provider } = gemmaWith('{"category":"noise_complaint","confidence":0.9}');
    await expect(provider.classify(summons)).rejects.toThrow(/invalid output/);
  });
});

// Tokens are the uid, as in rentals.test.ts.
const fakeVerifier: VerifyIdToken = async (token) => {
  if (token === 'alice') return { uid: token, provider: 'anonymous' };
  throw new InvalidTokenError('invalid');
};

function route(model: TriageProvider | null = null) {
  const logged: Record<string, unknown>[] = [];
  const app = createApp({
    logSink: (line) => logged.push(JSON.parse(line)),
    verifyIdToken: fakeVerifier,
    store: memoryStore().store,
    triage: createTriage({ model, keywords: keywordBackstop() }),
  });
  const post = (body: unknown, token: string | null = 'alice') =>
    app.request('/v1/triage', {
      method: 'POST',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  return { post, logged };
}

describe('POST /v1/triage', () => {
  it('escalates an eviction summons uploaded as a lease', async () => {
    const { post, logged } = route();
    const res = await post({ source: 'lease', text: summons.text, locale: 'en' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      escalate: true,
      category: 'eviction_or_court',
      model: { status: 'off' },
      keywords: { category: 'eviction_or_court', confidence: 1, matches: expect.arrayContaining(['en.eviction_or_court.summons']) },
    });
    const line = logged.find((l) => l.message === 'triage');
    expect(line).toMatchObject({ source: 'lease', escalate: true, category: 'eviction_or_court', requestId: expect.any(String) });
    expect(JSON.stringify(logged)).not.toContain('Oakline');
  });

  it('passes a lease clause, and uses the model answer when it fires', async () => {
    expect(await (await route().post({ source: 'lease', text: leaseDefault.text })).json()).toMatchObject({ escalate: false, category: 'none' });
    const { post } = route(fixed('gemma', { category: 'discrimination', confidence: 0.8 }));
    expect(await (await post({ source: 'ask', text: 'They said no to me.', locale: 'es-US' })).json()).toMatchObject({
      escalate: true,
      category: 'discrimination',
      model: { status: 'ok', category: 'discrimination', confidence: 0.8 },
    });
  });

  it('rejects bad bodies without echoing them', async () => {
    const { post } = route();
    for (const [body, field] of [
      [{ source: 'email', text: 'hi' }, 'source'],
      [{ source: 'ask', text: '   ' }, 'text'],
      [{ source: 'ask', text: 'hi', locale: 'not a locale' }, 'locale'],
      [{ source: 'ask', text: 'hi', imageCaptions: ['x'.repeat(1001)] }, 'imageCaptions.0'],
      [{ source: 'ask', text: 'hi', secret: 'leak' }, 'unknown fields'],
      ['not json', 'Body must be JSON'],
    ] as const) {
      const res = await post(body);
      expect(res.status).toBe(400);
      const { error } = await res.json();
      expect(error.code).toBe('BAD_REQUEST');
      expect(error.message).toContain(field);
      expect(error.message).not.toContain('leak');
    }
    expect((await post({ source: 'lease', text: 'x'.repeat(200_001) })).status).toBe(400);
  });

  it('needs a token', async () => {
    expect((await route().post({ source: 'ask', text: 'hi' }, null)).status).toBe(401);
  });
});
