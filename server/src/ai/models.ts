// Model IDs, per-stage routing, fallback chains, and quota (spec §7.2, §15.2).
// Every model choice lives here so a run on the wrong model is one env var
// away from being fixed, and the usage records name the model that answered.

export const GEMMA_26B = 'gemma-4-26b-a4b-it';
export const GEMMA_31B = 'gemma-4-31b-it';
// Billed, unlike Gemma: set an AI Studio spend cap before using it.
export const FLASH = 'gemini-flash-latest';

// Gemma 4 rejects `low` and `medium` with HTTP 400 (docs/ai-pipeline.md, gap 2).
export type ThinkingLevel = 'minimal' | 'high';

export type ModelRole = 'primary' | 'verifier';

export type Stage =
  | 'triage'
  | 'extraction'
  | 'mapping'
  | 'verification'
  | 'vision'
  | 'responsibility'
  | 'responsibility_verify'
  | 'ask'
  | 'explanation'
  | 'translation';

// `schema` sends the Zod schema as `responseSchema`: the API holds the answer
// to its shape, but the model does not think, even at `high`. `json` sends the
// schema as text in the system instruction and asks for plain JSON: the model
// thinks, and Zod still rejects anything off the schema (docs/ai-pipeline.md,
// gap 6). Pick per stage from eval results (#14, #15).
export type OutputMode = 'schema' | 'json';

export interface StageConfig {
  role: ModelRole;
  thinking: ThinkingLevel;
  output: OutputMode;
}

// Spec §7.2: `minimal` for triage and vision, `high` for mapping and verification.
// `high` only takes effect on a `json` stage. The lease stages (#14) are on
// `json`: in `schema` mode 26B looped until the output cap on half of the
// synthetic lease's S2 runs and garbled S5's quotes (docs/ai-pipeline.md, gap 7).
// `verification` (#15) is on `json` from the clauses-golden eval (eval/runners/
// verifier.ts, 2026-10-25): 29 of 30 violations agreed and none of 15
// look-alikes, against 27 of 30 and 2 checks skipped in `schema` mode, at
// about 52 s a call against 19 s. `explanation` and `translation` are on
// `json` too: in `schema` mode 26B answered "text" for a whole explanation
// and "explicación" for a translation on the synthetic lease (2026-10-25).
// They stay at `minimal`, so `json` adds no thinking time.
export const STAGES: Record<Stage, StageConfig> = {
  triage: { role: 'primary', thinking: 'minimal', output: 'schema' },
  extraction: { role: 'primary', thinking: 'high', output: 'json' },
  mapping: { role: 'primary', thinking: 'high', output: 'json' },
  verification: { role: 'verifier', thinking: 'high', output: 'json' },
  vision: { role: 'primary', thinking: 'minimal', output: 'schema' },
  responsibility: { role: 'primary', thinking: 'high', output: 'schema' },
  responsibility_verify: { role: 'verifier', thinking: 'high', output: 'schema' },
  // Native function calling cannot be combined with responseSchema. Ask validates
  // JSON locally; the live Ask eval covers tool dispatch and grounded answers.
  ask: { role: 'primary', thinking: 'minimal', output: 'json' },
  explanation: { role: 'primary', thinking: 'minimal', output: 'json' },
  translation: { role: 'primary', thinking: 'minimal', output: 'json' },
};

export type ProviderName = 'gemini' | 'openai_compatible';

export interface ModelConfig {
  provider: ProviderName;
  primary: string;
  verifier: string;
  fallback: string;
  // Only for `openai_compatible`: an Ollama or vLLM server running Gemma 4 open weights.
  baseUrl?: string;
}

// `GEMMA_PRIMARY` and `GEMMA_VERIFIER` let a dev run use Flash on the same key;
// the submission runs on the Gemma defaults. Self-hosted, they name the
// server's models, and there is no Flash fallback unless `GEMMA_FALLBACK`
// names one on the same server: falling back to the Gemini API would send
// tenant text out of the organization (docs/self-hosting.md).
export function modelConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ModelConfig {
  const provider = env.GEMMA_PROVIDER || 'gemini';
  if (provider !== 'gemini' && provider !== 'openai_compatible') {
    throw new Error(`GEMMA_PROVIDER must be gemini or openai_compatible, not ${provider}`);
  }
  const primary = env.GEMMA_PRIMARY || GEMMA_26B;
  return {
    provider,
    primary,
    verifier: env.GEMMA_VERIFIER || GEMMA_31B,
    // `fallbackChain` drops the repeat, so self-hosted chains end at the primary.
    fallback: env.GEMMA_FALLBACK || (provider === 'gemini' ? FLASH : primary),
    ...(env.GEMMA_BASE_URL ? { baseUrl: env.GEMMA_BASE_URL } : {}),
  };
}

// The models to try in order once the one before has run out of retries.
// Gemma always goes first; Flash only answers when every Gemma model is down.
// Primary: 26B, then Flash. Verifier: 31B, then 26B, then Flash.
export function fallbackChain(role: ModelRole, config: ModelConfig): string[] {
  const chain = role === 'verifier' ? [config.verifier, config.primary, config.fallback] : [config.primary, config.fallback];
  return [...new Set(chain)];
}

export interface ModelLimits {
  requestsPerMinute: number;
  inputTokensPerMinute: number;
}

// Tier 1, per project and per model (docs/ai-pipeline.md, "Rate limits").
const GEMMA_LIMITS: ModelLimits = { requestsPerMinute: 30, inputTokensPerMinute: 16_000 };
const FLASH_LIMITS: ModelLimits = { requestsPerMinute: 1_000, inputTokensPerMinute: 2_000_000 };

// Unknown models get Gemma's limits: waiting too long beats a 429 storm.
export function limitsFor(model: string): ModelLimits {
  return model.startsWith('gemini-') ? FLASH_LIMITS : GEMMA_LIMITS;
}

// A self-hosted server has no per-project quota: it queues requests itself,
// so the limiter only stops a runaway loop.
export const SELF_HOSTED_LIMITS: ModelLimits = { requestsPerMinute: 600, inputTokensPerMinute: 10_000_000 };
