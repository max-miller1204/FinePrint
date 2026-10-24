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

export interface StageConfig {
  role: ModelRole;
  thinking: ThinkingLevel;
}

// Spec §7.2: `minimal` for triage and vision, `high` for mapping and verification.
export const STAGES: Record<Stage, StageConfig> = {
  triage: { role: 'primary', thinking: 'minimal' },
  extraction: { role: 'primary', thinking: 'high' },
  mapping: { role: 'primary', thinking: 'high' },
  verification: { role: 'verifier', thinking: 'high' },
  vision: { role: 'primary', thinking: 'minimal' },
  responsibility: { role: 'primary', thinking: 'high' },
  responsibility_verify: { role: 'verifier', thinking: 'high' },
  ask: { role: 'primary', thinking: 'minimal' },
  explanation: { role: 'primary', thinking: 'minimal' },
  translation: { role: 'primary', thinking: 'minimal' },
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
// the submission runs on the Gemma defaults.
export function modelConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ModelConfig {
  const provider = env.GEMMA_PROVIDER || 'gemini';
  if (provider !== 'gemini' && provider !== 'openai_compatible') {
    throw new Error(`GEMMA_PROVIDER must be gemini or openai_compatible, not ${provider}`);
  }
  return {
    provider,
    primary: env.GEMMA_PRIMARY || GEMMA_26B,
    verifier: env.GEMMA_VERIFIER || GEMMA_31B,
    fallback: env.GEMMA_FALLBACK || FLASH,
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
