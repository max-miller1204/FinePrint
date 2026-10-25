// The seam between the Gemma client and an API (spec §15.2). `gemini` calls
// the Gemini API through @google/genai. `openai_compatible` calls an Ollama or
// vLLM server running Gemma 4 open weights at `GEMMA_BASE_URL`
// (openai-compatible.ts, docs/self-hosting.md). The client depends only on
// this interface.

import { ApiError, GoogleGenAI, ThinkingLevel as SdkThinkingLevel, type GenerateContentResponse } from '@google/genai';
import type { Part } from './documents.js';
import type { ModelConfig, ThinkingLevel } from './models.js';
import { openAiCompatibleProvider } from './openai-compatible.js';
import type { ResponseSchema } from './response-schema.js';

export interface FunctionDefinition {
  name: string;
  description: string;
  parametersJsonSchema: Record<string, unknown>;
}

export interface ProviderRequest {
  functions?: FunctionDefinition[];
  model: string;
  systemInstruction: string;
  parts: Part[];
  // Omitted in `json` mode: the API then allows thinking (docs/ai-pipeline.md, gap 6).
  responseSchema?: ResponseSchema;
  thinking: ThinkingLevel;
  // Ends a runaway answer: it comes back cut off, fails validation, and is retried.
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

export interface ProviderResponse {
  // The answer text, thought parts excluded.
  text: string;
  promptTokens: number;
  outputTokens: number;
  thoughtTokens: number;
}

export interface ModelProvider {
  readonly name: string;
  generate(request: ProviderRequest): Promise<ProviderResponse>;
}

// A failed request. `status` is the HTTP status, or 0 for a network error.
// `retryAfterMs` comes from the API's RetryInfo on a 429, when present.
export class ProviderError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterMs: number | null = null,
  ) {
    super(`model request failed with HTTP ${status}`);
    this.name = 'ProviderError';
  }
}

// 31B fences its JSON about 2 times in 3 unless generation stops at the fence
// (docs/ai-pipeline.md, gap 1). A fence inside a JSON string also stops it;
// the client then fails validation and retries. Only for schema calls: with
// thinking on, 31B opens its answer with a fence and the stop leaves it empty.
const JSON_FENCE = '```';

const THINKING: Record<ThinkingLevel, SdkThinkingLevel> = {
  minimal: SdkThinkingLevel.MINIMAL,
  high: SdkThinkingLevel.HIGH,
};

// The subset of GoogleGenAI the provider uses, so tests can pass a fake.
export interface GenAiModels {
  generateContent: GoogleGenAI['models']['generateContent'];
}

export function geminiProvider(models: GenAiModels): ModelProvider {
  return {
    name: 'gemini',
    async generate(request) {
      let response: GenerateContentResponse;
      try {
        response = await models.generateContent({
          model: request.model,
          contents: [{ role: 'user', parts: request.parts }],
          config: {
            systemInstruction: request.systemInstruction,
            ...(request.functions ? { tools: [{ functionDeclarations: request.functions }] } : { responseMimeType: 'application/json' }),
            ...(!request.functions && request.responseSchema ? { responseSchema: request.responseSchema, stopSequences: [JSON_FENCE] } : {}),
            thinkingConfig: { thinkingLevel: THINKING[request.thinking] },
            ...(request.maxOutputTokens ? { maxOutputTokens: request.maxOutputTokens } : {}),
            ...(request.signal ? { abortSignal: request.signal } : {}),
          },
        });
      } catch (err) {
        if (request.signal?.aborted) throw err;
        if (err instanceof ApiError) throw new ProviderError(err.status, retryDelayMs(err.message));
        // fetch failures (DNS, reset connection) are worth a retry like a 503.
        if (err instanceof TypeError) throw new ProviderError(0);
        throw err;
      }
      // `minimal` still returns one empty thought part; read only the answer parts.
      const parts = response.candidates?.[0]?.content?.parts ?? [];
      const calls = response.functionCalls;
      const text = calls?.length ? JSON.stringify({ type: 'tool', call: { ...calls[0]!.args, name: calls[0]!.name } }) : parts
        .filter((p) => !p.thought && typeof p.text === 'string')
        .map((p) => p.text)
        .join('');
      const usage = response.usageMetadata;
      return {
        text,
        promptTokens: usage?.promptTokenCount ?? 0,
        outputTokens: usage?.candidatesTokenCount ?? 0,
        thoughtTokens: usage?.thoughtsTokenCount ?? 0,
      };
    },
  };
}

// The SDK puts the error body in the message; a 429 carries
// `"retryDelay": "17s"` in its RetryInfo detail.
function retryDelayMs(message: string): number | null {
  const match = /"retryDelay":\s*"(\d+(?:\.\d+)?)s"/.exec(message);
  return match ? Math.round(Number(match[1]) * 1000) : null;
}

export function providerFromConfig(config: ModelConfig, env: NodeJS.ProcessEnv = process.env): ModelProvider {
  if (config.provider === 'openai_compatible') {
    if (!config.baseUrl) throw new Error('GEMMA_BASE_URL is not set; see docs/self-hosting.md');
    if (!/^https?:\/\//.test(config.baseUrl)) throw new Error('GEMMA_BASE_URL must start with http:// or https://');
    // Optional: only for a server that checks a key (vLLM `--api-key`).
    const apiKey = env.GEMMA_API_KEY;
    return openAiCompatibleProvider({ baseUrl: config.baseUrl, ...(apiKey ? { apiKey } : {}) });
  }
  const apiKey = env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
  // No SDK retries: the client owns backoff so the limiter sees every attempt.
  return geminiProvider(new GoogleGenAI({ apiKey }).models);
}
