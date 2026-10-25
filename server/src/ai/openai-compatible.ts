// `GEMMA_PROVIDER=openai_compatible` (spec §15.2): Gemma 4 open weights on an
// Ollama or vLLM server the organization runs, through the OpenAI Chat
// Completions API both servers expose. Tenant text then never leaves the
// organization. See docs/self-hosting.md.
//
//   POST {GEMMA_BASE_URL}/chat/completions
//     system message: the system instruction
//     user message: the document parts (text, and images as data URLs)
//     schema stage: response_format json_schema, stop at a code fence
//     json stage:   response_format json_object
//     reasoning_effort `high` on a `json` stage at `high`, otherwise `none`

import type { Part } from './documents.js';
import { ProviderError, type ModelProvider } from './provider.js';
import type { ResponseSchema } from './response-schema.js';

export interface OpenAiCompatibleOptions {
  // Ends in `/v1`, such as http://localhost:11434/v1 (Ollama) or http://localhost:8000/v1 (vLLM).
  baseUrl: string;
  // For a server started with an API key (vLLM `--api-key`). Ollama needs none.
  apiKey?: string;
  fetch?: typeof fetch;
}

type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

interface ChatCompletion {
  // `reasoning` on Ollama and vLLM; `reasoning_content` on older vLLM.
  choices?: { message?: { tool_calls?: { function: { name: string; arguments: string } }[]; content?: string | null; reasoning?: string | null; reasoning_content?: string | null } }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
}

// Same reason as the Gemini provider: 31B fences its JSON unless generation stops there.
const JSON_FENCE = '```';

export function openAiCompatibleProvider({ baseUrl, apiKey, fetch: fetchFn = fetch }: OpenAiCompatibleOptions): ModelProvider {
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;

  return {
    name: 'openai_compatible',
    async generate(request) {
      const body = {
        model: request.model,
        messages: [
          { role: 'system', content: request.systemInstruction },
          { role: 'user', content: request.parts.map(contentPart) },
        ],
        stream: false,
        ...(request.functions ? { tools: request.functions.map(f => ({ type: 'function', function: { name: f.name, description: f.description, parameters: f.parametersJsonSchema } })), parallel_tool_calls: false } : request.responseSchema
          ? {
              response_format: {
                type: 'json_schema',
                json_schema: { name: 'answer', strict: true, schema: toJsonSchema(request.responseSchema) },
              },
              stop: [JSON_FENCE],
            }
          : { response_format: { type: 'json_object' } }),
        // Only a `json` stage thinks, as on the Gemini API (docs/ai-pipeline.md, gap 6).
        // Gemma 4 on Ollama thinks unless told `none`; vLLM maps this to `enable_thinking`.
        reasoning_effort: !request.responseSchema && request.thinking === 'high' ? 'high' : 'none',
        ...(request.maxOutputTokens ? { max_tokens: request.maxOutputTokens } : {}),
      };

      let response: Response;
      try {
        response = await fetchFn(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          ...(request.signal ? { signal: request.signal } : {}),
        });
      } catch (err) {
        if (request.signal?.aborted) throw err;
        // Connection refused, DNS, reset: the server may be restarting or loading the model.
        if (err instanceof TypeError) throw new ProviderError(0);
        throw err;
      }
      if (!response.ok) {
        // The body may echo the request, so it is not read into the error.
        await response.body?.cancel();
        throw new ProviderError(response.status, retryAfterMs(response.headers.get('retry-after')));
      }

      const completion = (await response.json()) as ChatCompletion;
      // Ollama and vLLM return reasoning in a separate field, so `content` is the answer alone.
      const message = completion.choices?.[0]?.message;
      const reasoning = message?.reasoning ?? message?.reasoning_content ?? '';
      const usage = completion.usage;
      let text = message?.content ?? '';
      const call = message?.tool_calls?.[0]?.function;
      if (call) {
        try {
          text = JSON.stringify({ type: 'tool', call: { ...JSON.parse(call.arguments), name: call.name } });
        } catch {
          // Malformed arguments are invalid model output, so Gemma owns the retry.
          text = '';
        }
      }
      return {
        text,
        promptTokens: usage?.prompt_tokens ?? 0,
        // Includes the reasoning on both servers.
        outputTokens: usage?.completion_tokens ?? 0,
        // Ollama does not count reasoning tokens: estimate at 4 characters per token.
        thoughtTokens: usage?.completion_tokens_details?.reasoning_tokens ?? Math.ceil(reasoning.length / 4),
      };
    },
  };
}

function contentPart(part: Part): ContentPart {
  if ('text' in part) return { type: 'text', text: part.text };
  return { type: 'image_url', image_url: { url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` } };
}

// `Retry-After` in seconds. The HTTP-date form is not used by Ollama or vLLM.
function retryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : null;
}

type JsonSchema = Record<string, unknown>;

// The client hands every provider the Gemini `responseSchema` (OpenAPI 3.0
// subset). Ollama and vLLM constrain decoding with JSON Schema, so this maps
// it back: lowercase types, `nullable` as a `null` type, numeric bounds as
// numbers. Zod still validates the answer, as on the Gemini path.
export function toJsonSchema(schema: ResponseSchema): JsonSchema {
  const out: JsonSchema = {};
  if (schema.description) out.description = schema.description;
  if (schema.format) out.format = schema.format;
  if (schema.anyOf) out.anyOf = schema.anyOf.map(toJsonSchema);
  if (schema.type) {
    const type = schema.type.toLowerCase();
    out.type = schema.nullable ? [type, 'null'] : type;
  } else if (schema.nullable && schema.anyOf) {
    (out.anyOf as JsonSchema[]).push({ type: 'null' });
  }
  if (schema.enum) out.enum = schema.nullable ? [...schema.enum, null] : schema.enum;
  if (schema.properties) {
    out.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, toJsonSchema(value)]));
    if (schema.required) out.required = schema.required;
    out.additionalProperties = false;
  }
  if (schema.items) out.items = toJsonSchema(schema.items);
  for (const key of ['minItems', 'maxItems', 'minLength', 'maxLength'] as const) {
    if (schema[key] !== undefined) out[key] = Number(schema[key]);
  }
  if (schema.minimum !== undefined) out.minimum = schema.minimum;
  if (schema.maximum !== undefined) out.maximum = schema.maximum;
  return out;
}
