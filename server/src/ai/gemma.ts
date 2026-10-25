// The one model client every AI stage calls (spec §7.1, §7.2, §14).
//
//   generate(stage, schema, docs, { task })
//     -> for each model in the stage's fallback chain (Gemma first, Flash last)
//          wait for the rate limiter (requests and input tokens)
//          call the provider with the document rule, the stage's thinking level, and the schema
//            (as responseSchema, or as text for a `json` stage, which lets the model think)
//          429 or 5xx: back off and retry, then fall back to the next model
//          strip a code fence, JSON.parse, validate with Zod; retry once on invalid output
//          write a usage record for every request
//     -> typed, validated data, plus the model that answered

import { z } from 'zod';
import { createLogger, type Logger } from '../log.js';
import { RateLimiter, systemClock, type Clock } from '../ratelimit.js';
import type { UsageOutcome, UsageRecord, UsageSink } from '../usage.js';
import { DOCUMENT_RULE, documentParts, type Document, type Part } from './documents.js';
import {
  SELF_HOSTED_LIMITS,
  STAGES,
  fallbackChain,
  limitsFor,
  modelConfigFromEnv,
  type ModelConfig,
  type Stage,
  type StageConfig,
} from './models.js';
import { ProviderError, providerFromConfig, type ModelProvider, type ProviderResponse, type FunctionDefinition } from './provider.js';
import { toResponseSchema, type ResponseSchema } from './response-schema.js';

export interface GenerateOptions {
  functions?: FunctionDefinition[];
  // What the stage asks of the model, sent after the documents. From ai/prompts/.
  task: string;
  // Stage rules added to the system instruction, after the document rule.
  instruction?: string;
  // Caps the answer, thinking included. Gemma 4 sometimes loops in schema
  // mode until the API's limit, which takes many minutes; capped, the loop
  // ends as invalid output and is retried.
  maxOutputTokens?: number;
  signal?: AbortSignal;
  // Progress for the SSE stream and the AI trace overlay (#39).
  onEvent?: (event: GemmaEvent) => void;
  // The request's logger, so model lines carry its requestId.
  log?: Logger;
}

export type GemmaEvent =
  | { type: 'waiting'; model: string; waitMs: number }
  | { type: 'retry'; model: string; httpStatus: number; attempt: number; delayMs: number }
  | { type: 'invalid_output'; model: string }
  // Shown as "Gemma unavailable, fallback: <to>".
  | { type: 'fallback'; from: string; to: string };

export interface GenerateResult<T> {
  data: T;
  // The model that answered. Callers label findings checked by a fallback.
  model: string;
  fallback: boolean;
  promptTokens: number;
  outputTokens: number;
}

// Every model in the chain ran out of retries. The verifier stage catches this
// and marks findings "unverified" rather than failing the analysis (#15).
export class GemmaUnavailableError extends Error {
  constructor(
    readonly stage: Stage,
    readonly tried: string[],
  ) {
    super(`no model answered for stage ${stage} (tried ${tried.join(', ')})`);
    this.name = 'GemmaUnavailableError';
  }
}

// The model answered twice without valid JSON for the schema.
export class GemmaOutputError extends Error {
  constructor(
    readonly stage: Stage,
    readonly model: string,
  ) {
    super(`model ${model} returned invalid output for stage ${stage}`);
    this.name = 'GemmaOutputError';
  }
}

// A request the API refused for a reason retrying cannot fix, such as HTTP 400.
export class GemmaRequestError extends Error {
  constructor(
    readonly stage: Stage,
    readonly model: string,
    readonly httpStatus: number,
  ) {
    super(`model ${model} rejected the request for stage ${stage} with HTTP ${httpStatus}`);
    this.name = 'GemmaRequestError';
  }
}

export interface RetryPolicy {
  // Retries per model after the first try, before falling back.
  retries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

// 2, 4, 8, and 16 s (with jitter): about 30 s per model before a fallback.
export const DEFAULT_RETRY: RetryPolicy = { retries: 4, baseDelayMs: 2_000, maxDelayMs: 30_000 };

// A `json` stage gets its schema as text, last in the system instruction.
export const JSON_RULE = 'Answer with one JSON value that matches this JSON Schema, and nothing else:';

// 429 is quota; 5xx is 31B's "high demand" and "Internal error" (docs/ai-pipeline.md, gap 5);
// 0 is a network failure.
const RETRYABLE = new Set([0, 429, 500, 502, 503, 504]);

export interface GemmaDeps {
  provider: ModelProvider;
  config: ModelConfig;
  usage: UsageSink;
  limiter?: RateLimiter;
  clock?: Clock;
  retry?: RetryPolicy;
  log?: Logger;
  random?: () => number;
  stages?: Record<Stage, StageConfig>;
}

export interface GemmaClient {
  generate<S extends z.ZodType>(stage: Stage, schema: S, docs: readonly Document[], options: GenerateOptions): Promise<GenerateResult<z.output<S>>>;
}

export function createGemma({
  provider,
  config,
  usage,
  clock = systemClock,
  limiter = new RateLimiter(limitsFor, clock),
  retry = DEFAULT_RETRY,
  log: baseLog = createLogger(null),
  random = Math.random,
  stages = STAGES,
}: GemmaDeps): GemmaClient {
  const schemas = new WeakMap<z.ZodType, ResponseSchema>();
  const responseSchemaFor = (schema: z.ZodType) => {
    let converted = schemas.get(schema);
    if (!converted) {
      converted = toResponseSchema(schema);
      schemas.set(schema, converted);
    }
    return converted;
  };
  const jsonRules = new WeakMap<z.ZodType, string>();
  const jsonRuleFor = (schema: z.ZodType) => {
    let rule = jsonRules.get(schema);
    if (!rule) {
      rule = `${JSON_RULE}\n${JSON.stringify(z.toJSONSchema(schema, { io: 'output', unrepresentable: 'throw' }))}`;
      jsonRules.set(schema, rule);
    }
    return rule;
  };

  return {
    async generate(stage, schema, docs, { task, instruction, maxOutputTokens, signal, onEvent, functions, log = baseLog }) {
      const { role, thinking, output } = stages[stage];
      const chain = fallbackChain(role, config);
      const responseSchema = output === 'schema' ? responseSchemaFor(schema) : undefined;
      const systemInstruction = [DOCUMENT_RULE, instruction, output === 'json' ? jsonRuleFor(schema) : undefined]
        .filter(Boolean)
        .join('\n\n');
      const parts = documentParts(docs, task);
      const estimate = estimateInputTokens(systemInstruction, parts);

      for (const [index, model] of chain.entries()) {
        const fallback = index > 0;
        if (fallback) {
          onEvent?.({ type: 'fallback', from: chain[index - 1]!, to: model });
          log.warn('model fallback', { stage, from: chain[index - 1], to: model });
        }
        let attempt = 0;
        let transientFailures = 0;
        let invalidOutputs = 0;

        for (;;) {
          attempt++;
          const waitedMs = await limiter.acquire(model, estimate, {
            signal,
            onWait: (waitMs) => onEvent?.({ type: 'waiting', model, waitMs }),
          });
          const started = clock.now();
          const write = (outcome: UsageOutcome, httpStatus: number | null, response?: ProviderResponse) => {
            const record: UsageRecord = {
              stage,
              model,
              fallback,
              outcome,
              httpStatus,
              attempt,
              promptTokens: response?.promptTokens ?? 0,
              outputTokens: response?.outputTokens ?? 0,
              thoughtTokens: response?.thoughtTokens ?? 0,
              latencyMs: clock.now() - started,
              waitedMs,
              at: new Date(clock.now()).toISOString(),
            };
            const { at: _at, ...fields } = record;
            log[outcome === 'ok' ? 'info' : 'warn']('model call', fields);
            usage.record(record).catch((err: unknown) => {
              log.warn('usage record failed', { stage, model, errorName: err instanceof Error ? err.name : 'unknown' });
            });
          };

          let response: ProviderResponse;
          try {
            response = await provider.generate({
              model,
              ...(functions ? { functions } : {}),
              systemInstruction,
              parts,
              thinking,
              ...(responseSchema ? { responseSchema } : {}),
              ...(maxOutputTokens ? { maxOutputTokens } : {}),
              ...(signal ? { signal } : {}),
            });
          } catch (err) {
            if (!(err instanceof ProviderError)) {
              write('error', null);
              throw err;
            }
            if (!RETRYABLE.has(err.status)) {
              write('error', err.status);
              throw new GemmaRequestError(stage, model, err.status);
            }
            write('retryable_error', err.status);
            if (err.status === 429) limiter.drain(model);
            if (transientFailures++ >= retry.retries) break;
            const delayMs = err.retryAfterMs ?? backoffMs(transientFailures, retry, random);
            onEvent?.({ type: 'retry', model, httpStatus: err.status, attempt, delayMs });
            await clock.sleep(delayMs, signal);
            continue;
          }

          limiter.settle(model, estimate, response.promptTokens || estimate);
          const parsed = parseOutput(response.text, schema);
          if (parsed.success) {
            write('ok', 200, response);
            return { data: parsed.data, model, fallback, promptTokens: response.promptTokens, outputTokens: response.outputTokens };
          }
          // Spec §7.1: structured output is not guaranteed on any model, so retry once.
          write('invalid_output', 200, response);
          onEvent?.({ type: 'invalid_output', model });
          if (invalidOutputs++ >= 1) throw new GemmaOutputError(stage, model);
        }
      }
      throw new GemmaUnavailableError(stage, chain);
    },
  };
}

// One answered model call, for the AI trace overlay (#39). No prompts and no
// content: what ran, on which model, how long it took, and its token counts.
export interface TraceStep {
  stage: Stage;
  model: string;
  ms: number;
  inputTokens: number;
  outputTokens: number;
  fallback: boolean;
}

// Wraps a client so a request can return the calls it made. `ms` is the whole
// generate() call: rate-limit waits and retries included.
export function traced(gemma: GemmaClient, clock: Pick<Clock, 'now'> = systemClock): { gemma: GemmaClient; trace: TraceStep[] } {
  const trace: TraceStep[] = [];
  return {
    trace,
    gemma: {
      async generate(stage, schema, docs, options) {
        const started = clock.now();
        const result = await gemma.generate(stage, schema, docs, options);
        trace.push({
          stage,
          model: result.model,
          ms: clock.now() - started,
          inputTokens: result.promptTokens,
          outputTokens: result.outputTokens,
          fallback: result.fallback,
        });
        return result;
      },
    },
  };
}

// The production client: models from GEMMA_* env vars, the Gemini API key
// from GEMINI_API_KEY. Logs the model IDs so a run on the wrong model shows.
export function gemmaFromEnv(deps: Omit<GemmaDeps, 'provider' | 'config'>, env: NodeJS.ProcessEnv = process.env): GemmaClient {
  const config = modelConfigFromEnv(env);
  const provider = providerFromConfig(config, env);
  if (config.provider === 'openai_compatible' && !deps.limiter) {
    deps = { ...deps, limiter: new RateLimiter(() => SELF_HOSTED_LIMITS, deps.clock) };
  }
  (deps.log ?? createLogger(null)).info('model config', {
    provider: provider.name,
    primary: config.primary,
    verifier: config.verifier,
    fallback: config.fallback,
  });
  return createGemma({ ...deps, config, provider });
}

// Exponential backoff with equal jitter: half the delay is fixed, half random,
// so parallel callers that hit the same 503 do not retry in lockstep.
export function backoffMs(retry: number, policy: RetryPolicy, random: () => number = Math.random): number {
  const delay = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (retry - 1));
  return Math.round(delay / 2 + (random() * delay) / 2);
}

// About 4 characters per token for English, and roughly 260 tokens per image.
// The limiter replaces this with the API's count once the call returns.
export function estimateInputTokens(systemInstruction: string, parts: readonly Part[]): number {
  let chars = systemInstruction.length;
  let images = 0;
  for (const part of parts) {
    if ('text' in part) chars += part.text.length;
    else images++;
  }
  return Math.ceil(chars / 4) + images * 260;
}

// 31B may wrap or trail its JSON with a markdown fence even with stopSequences
// (docs/ai-pipeline.md, gap 1), and a `json` stage sends no stop sequence.
export function stripFence(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

export function parseOutput<S extends z.ZodType>(text: string, schema: S): { success: true; data: z.output<S> } | { success: false } {
  let value: unknown;
  try {
    value = JSON.parse(stripFence(text));
  } catch {
    return { success: false };
  }
  const result = schema.safeParse(value);
  return result.success ? { success: true, data: result.data } : { success: false };
}
