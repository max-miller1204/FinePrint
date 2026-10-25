import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { GemmaRequestError, GemmaUnavailableError, createGemma } from '../src/ai/gemma.js';
import { GEMMA_26B, STAGES, fallbackChain, modelConfigFromEnv } from '../src/ai/models.js';
import { openAiCompatibleProvider, toJsonSchema } from '../src/ai/openai-compatible.js';
import { ProviderError, providerFromConfig } from '../src/ai/provider.js';
import type { Clock } from '../src/ratelimit.js';
import { toResponseSchema } from '../src/ai/response-schema.js';
import { memoryUsageSink } from '../src/usage.js';

const Finding = z.object({
  clause: z.string(),
  severity: z.enum(['unenforceable', 'ask', 'info']),
  feeDollars: z.number().nullable(),
});

const LEASE = { id: 'lease-1', text: 'Tenant shall pay a late fee of $75 if rent is received after the 5th.' };
const ANSWER = { clause: 'late fee', severity: 'ask', feeDollars: 75 };
const BASE_URL = 'http://localhost:11434/v1';
const ENV = { GEMMA_PROVIDER: 'openai_compatible', GEMMA_BASE_URL: BASE_URL, GEMMA_PRIMARY: 'gemma4:26b', GEMMA_VERIFIER: 'gemma4:31b' };

function completion(content: string, usage: object = { prompt_tokens: 120, completion_tokens: 30 }) {
  return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }], usage }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const fakeClock = (): Clock => {
  let now = Date.parse('2026-10-24T12:00:00Z');
  return {
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  };
};

type Step = Response | Error;

function setup(steps: Step[], { env = ENV as NodeJS.ProcessEnv, stages = STAGES, apiKey = undefined as string | undefined } = {}) {
  const queue = [...steps];
  const fetchFn = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    const step = queue.shift() ?? new Response('{}', { status: 500 });
    if (step instanceof Error) throw step;
    return step;
  });
  const usage = memoryUsageSink();
  const config = modelConfigFromEnv(env);
  const gemma = createGemma({
    provider: openAiCompatibleProvider({ baseUrl: config.baseUrl!, fetch: fetchFn, ...(apiKey ? { apiKey } : {}) }),
    config,
    usage,
    clock: fakeClock(),
    random: () => 0.5,
    stages,
    log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  });
  const run = (stage: Parameters<typeof gemma.generate>[0] = 'mapping') =>
    gemma.generate(stage, Finding, [LEASE], { task: 'Classify the late fee clause.' });
  const body = (call = 0) => JSON.parse(fetchFn.mock.calls[call]![1]!.body as string);
  return { run, fetchFn, body, usage };
}

describe('openai_compatible provider', () => {
  it('posts a chat completion with the documents and a JSON Schema, and returns typed data', async () => {
    const { run, fetchFn, body, usage } = setup([completion(JSON.stringify(ANSWER))]);
    const result = await run('triage');

    expect(result).toMatchObject({ data: ANSWER, model: 'gemma4:26b', fallback: false, promptTokens: 120, outputTokens: 30 });
    expect(fetchFn.mock.calls[0]![0]).toBe(`${BASE_URL}/chat/completions`);
    const sent = body();
    expect(sent.model).toBe('gemma4:26b');
    expect(sent.messages[0].role).toBe('system');
    expect(sent.messages[0].content).toContain('<document>');
    expect(sent.messages[1].content[0]).toEqual({ type: 'text', text: expect.stringContaining('<document id="lease-1">') });
    expect(sent.response_format.type).toBe('json_schema');
    expect(sent.response_format.json_schema.schema.properties.severity).toEqual({
      type: 'string',
      enum: ['unenforceable', 'ask', 'info'],
    });
    expect(sent.stop).toEqual(['```']);
    expect(sent.reasoning_effort).toBe('none');
    expect(usage.records).toHaveLength(1);
    expect(usage.records[0]).toMatchObject({ model: 'gemma4:26b', outcome: 'ok', promptTokens: 120 });
  });

  it('sends the output cap as max_tokens', async () => {
    const { fetchFn } = setup([]);
    const provider = openAiCompatibleProvider({ baseUrl: BASE_URL, fetch: fetchFn });
    fetchFn.mockResolvedValueOnce(completion('{}'));
    await provider.generate({ model: 'gemma4:26b', systemInstruction: 'rule', parts: [{ text: 'x' }], thinking: 'minimal', maxOutputTokens: 512 });
    expect(JSON.parse(fetchFn.mock.calls[0]![1]!.body as string).max_tokens).toBe(512);
  });

  it('sends images as data URLs', async () => {
    const { fetchFn } = setup([completion(JSON.stringify(ANSWER))]);
    const provider = openAiCompatibleProvider({ baseUrl: BASE_URL, fetch: fetchFn });
    fetchFn.mockResolvedValueOnce(completion('{}'));
    await provider.generate({
      model: 'gemma4:26b',
      systemInstruction: 'rule',
      parts: [{ inlineData: { mimeType: 'image/jpeg', data: 'AAAA' } }],
      thinking: 'minimal',
    });
    const sent = JSON.parse(fetchFn.mock.calls[0]![1]!.body as string);
    expect(sent.messages[1].content).toEqual([{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } }]);
  });

  it('asks for plain JSON and high reasoning on a json stage, and reads the reasoning token count', async () => {
    const stages = { ...STAGES, mapping: { ...STAGES.mapping, output: 'json' as const } };
    const { run, body, usage } = setup(
      [completion(`\`\`\`json\n${JSON.stringify(ANSWER)}\n\`\`\``, { prompt_tokens: 200, completion_tokens: 90, completion_tokens_details: { reasoning_tokens: 60 } })],
      { stages },
    );
    expect((await run()).data).toEqual(ANSWER);
    expect(body().response_format).toEqual({ type: 'json_object' });
    expect(body().reasoning_effort).toBe('high');
    expect(body()).not.toHaveProperty('stop');
    expect(usage.records[0]!.thoughtTokens).toBe(60);
  });

  it('estimates thought tokens from the reasoning text when the server does not count them (Ollama)', async () => {
    const stages = { ...STAGES, mapping: { ...STAGES.mapping, output: 'json' as const } };
    const reply = new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(ANSWER), reasoning: 'x'.repeat(400) } }],
        usage: { prompt_tokens: 50, completion_tokens: 140 },
      }),
      { status: 200 },
    );
    const { run, usage } = setup([reply], { stages });
    const result = await run();
    expect(result.data).toEqual(ANSWER);
    expect(usage.records[0]).toMatchObject({ thoughtTokens: 100, outputTokens: 140 });
  });

  it('sends the API key as a bearer token only when one is set', async () => {
    const withKey = setup([completion(JSON.stringify(ANSWER))], { apiKey: 'test-key' });
    await withKey.run();
    expect(new Headers(withKey.fetchFn.mock.calls[0]![1]!.headers).get('authorization')).toBe('Bearer test-key');

    const without = setup([completion(JSON.stringify(ANSWER))]);
    await without.run();
    expect(new Headers(without.fetchFn.mock.calls[0]![1]!.headers).has('authorization')).toBe(false);
  });

  it('retries a 503 and a refused connection, honoring Retry-After', async () => {
    const { run, fetchFn, usage } = setup([
      new Response('busy', { status: 503, headers: { 'retry-after': '3' } }),
      new TypeError('fetch failed'),
      completion(JSON.stringify(ANSWER)),
    ]);
    expect((await run()).data).toEqual(ANSWER);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(usage.records.map((r) => [r.outcome, r.httpStatus])).toEqual([
      ['retryable_error', 503],
      ['retryable_error', 0],
      ['ok', 200],
    ]);
  });

  it('throws GemmaRequestError on a 404 (a model the server does not have) without retrying', async () => {
    const { run, fetchFn } = setup([new Response('model "gemma4:26b" not found', { status: 404 })]);
    await expect(run()).rejects.toBeInstanceOf(GemmaRequestError);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('reads the status and Retry-After into ProviderError', async () => {
    const fetchFn = vi.fn(async () => new Response('', { status: 429, headers: { 'retry-after': '1.5' } }));
    const provider = openAiCompatibleProvider({ baseUrl: `${BASE_URL}/`, fetch: fetchFn });
    const err = await provider.generate({ model: 'm', systemInstruction: '', parts: [], thinking: 'minimal' }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ status: 429, retryAfterMs: 1500 });
    expect(fetchFn.mock.calls[0]![0]).toBe(`${BASE_URL}/chat/completions`);
  });
});

describe('openai_compatible config', () => {
  it('never falls back to the Gemini API: chains stay on the self-hosted models', () => {
    const config = modelConfigFromEnv(ENV);
    expect(fallbackChain('primary', config)).toEqual(['gemma4:26b']);
    expect(fallbackChain('verifier', config)).toEqual(['gemma4:31b', 'gemma4:26b']);
    expect(fallbackChain('primary', modelConfigFromEnv({ GEMMA_PROVIDER: 'openai_compatible', GEMMA_BASE_URL: BASE_URL }))).toEqual([GEMMA_26B]);
  });

  it('keeps an explicit GEMMA_FALLBACK', () => {
    const config = modelConfigFromEnv({ ...ENV, GEMMA_FALLBACK: 'gemma4:e4b' });
    expect(fallbackChain('primary', config)).toEqual(['gemma4:26b', 'gemma4:e4b']);
  });

  it('fails over to the verifier chain and then gives up when the server is down', async () => {
    const { run, fetchFn } = setup(Array.from({ length: 10 }, () => new TypeError('fetch failed')));
    const err = await run('verification').catch((e) => e);
    expect(err).toBeInstanceOf(GemmaUnavailableError);
    expect(err.tried).toEqual(['gemma4:31b', 'gemma4:26b']);
    expect(fetchFn).toHaveBeenCalledTimes(10);
  });

  it('needs a GEMMA_BASE_URL with an http scheme, and no Gemini key', () => {
    expect(() => providerFromConfig(modelConfigFromEnv({ GEMMA_PROVIDER: 'openai_compatible' }), {})).toThrow(/GEMMA_BASE_URL is not set/);
    expect(() => providerFromConfig(modelConfigFromEnv({ ...ENV, GEMMA_BASE_URL: 'localhost:11434/v1' }), {})).toThrow(/http/);
    expect(providerFromConfig(modelConfigFromEnv(ENV), {}).name).toBe('openai_compatible');
  });
});

describe('toJsonSchema', () => {
  it('maps the Gemini responseSchema back to JSON Schema', () => {
    const schema = z.object({
      clauses: z.array(z.object({ heading: z.string().describe('As written'), fee: z.number().int().min(0).nullable() })).min(1),
      kind: z.enum(['lease', 'other']).nullable(),
      note: z.string().optional(),
    });
    expect(toJsonSchema(toResponseSchema(schema))).toEqual({
      type: 'object',
      properties: {
        clauses: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              heading: { type: 'string', description: 'As written' },
              fee: { type: ['integer', 'null'], minimum: 0 },
            },
            required: ['heading', 'fee'],
            additionalProperties: false,
          },
        },
        kind: { type: ['string', 'null'], enum: ['lease', 'other', null] },
        note: { type: 'string' },
      },
      required: ['clauses', 'kind'],
      additionalProperties: false,
    });
  });
});
