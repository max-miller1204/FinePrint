# AI pipeline

This document records what the Gemma 4 models and the iOS 26 SDK actually support, so each lane builds on measured facts. The Gemma client (#9) is described at the end. The rest of the pipeline description lands with the lanes that build it (#14, #15).

## Day-one smoke test (#8)

Spec §21 items 1, 2, and 7. Run on 2026-10-24 against the FinePrint Google Cloud project (`gen-lang-client-0343784935`).

### Rerun it

```sh
# Gemma capabilities (needs GEMINI_API_KEY; .env holds a 1Password reference)
op run --env-file .env -- node scripts/smoke/gemma-capabilities.ts            # about 2 minutes
op run --env-file .env -- node scripts/smoke/gemma-capabilities.ts --probe-rpm # also bursts until a 429 to read the RPM quota

# iOS 26 API availability (needs Xcode)
bash scripts/smoke/ios-capabilities.sh
```

Both exit `0` when every required capability is present. The Gemma script writes the full result, with latency and token usage per check, to `scripts/smoke/out/gemma-capabilities.json` (gitignored).

The Gemma script calls the REST API with `fetch`. Its request bodies use the same field names the `@google/genai` SDK sends (`generationConfig.responseSchema`, `thinkingConfig.thinkingLevel`, `tools[].functionDeclarations`, `inlineData`).

### Gemma 4 capabilities

| Capability | `gemma-4-26b-a4b-it` | `gemma-4-31b-it` |
| --- | --- | --- |
| Text generation | Confirmed | Confirmed |
| `systemInstruction` | Confirmed | Confirmed |
| Structured output, `responseSchema` | Confirmed (3/3 strict JSON) | **Partial**: 3/3 match the schema, 1/3 strict JSON (see gap 1) |
| Structured output, `responseJsonSchema` | Confirmed (3/3 strict JSON) | **Partial**: same trailing-fence behavior |
| Structured output, `responseSchema` + `stopSequences` set to a code fence (three backticks) | Confirmed | Confirmed (6/6 strict JSON) |
| Function calling (call, then answer from `functionResponse`) | Confirmed | Confirmed |
| `thinkingLevel: "minimal"` | Confirmed (0 thought tokens) | Confirmed (0 thought tokens) |
| `thinkingLevel: "low"` | **Not supported** (HTTP 400) | **Not supported** (HTTP 400) |
| `thinkingLevel: "medium"` | **Not supported** (HTTP 400) | **Not supported** (HTTP 400) |
| `thinkingLevel: "high"` | Confirmed (160 to 190 thought tokens on a date question) | Confirmed (55 to 105 thought tokens) |
| Image input (inline base64 PNG) | Confirmed | Confirmed |
| Image + structured output + thinking in one call | Confirmed | Confirmed |

Typical latency for a short prompt: 0.8 to 2 s per call, 4 s with `high` thinking, and 5 to 6 s for a function-calling round trip (two calls).

### Rate limits

Project tier: **Tier 1**. Limits are per project and per model.

| Model | RPM | Input TPM | RPD |
| --- | --- | --- | --- |
| `gemma-4-26b-a4b-it` | 30 | 16,000 | 14,400 |
| `gemma-4-31b-it` | 30 | 16,000 | 14,400 |

Sources:

- AI Studio rate-limit dashboard for the FinePrint project ([aistudio.google.com/rate-limit](https://aistudio.google.com/rate-limit)), read on 2026-10-24. Google's [rate limits page](https://ai.google.dev/gemini-api/docs/rate-limits) (updated 2026-10-15) lists no Gemma rows and points to this dashboard.
- Measured: `--probe-rpm` got HTTP 429 after 30 to 35 one-token calls per model. The error's `QuotaFailure` reports `GenerateRequestsPerMinutePerProjectPerModel`, `quotaValue: "30"`, "on Tier 1".

The spec's estimate (about 15 RPM and 1,500 RPD) was low on requests, but it missed the input token cap. See gap 3.

### Pricing

Google's [pricing page](https://ai.google.dev/gemini-api/docs/pricing) (updated 2026-10-22) lists Gemma 4 as **free of charge** for input and output on the free tier, and the paid tier as "Not available". Gemma calls on the Gemini API cost nothing, so the third-party rates in spec §14 (about $0.12/M input, $0.37/M output) do not apply. Model cost per tenant is $0. Only infrastructure costs remain (#51).

### iOS 26 APIs

Checked with Xcode 27.1 (27A9275), Swift 6.4, and the iOS 27.1 simulator SDK. The probes in `scripts/smoke/ios/` are typechecked at an iOS 26.0 deployment target, then at 18.0 to show which APIs are gated.

| API | Available | Minimum iOS | How it was checked |
| --- | --- | --- | --- |
| `RecognizeDocumentsRequest` (Vision) | Confirmed | 26.0 | Typecheck, plus a macOS run that read every expected token from a rendered lease page (4 paragraphs) |
| `tabViewBottomAccessory` | Confirmed | 26.0 | Typecheck, including `tabViewBottomAccessoryPlacement` for the inline (minimized) layout |
| `Tab(role: .search)` | Confirmed | 18.0 | Typecheck (not gated at 18.0) |
| `glassEffect(_:in:)` and `GlassEffectContainer` | Confirmed | 26.0 | Typecheck with `.regular.interactive()` in a capsule |
| `tabBarMinimizeBehavior(.onScrollDown)` | Confirmed | 26.0 | Typecheck |

`RecognizeDocumentsRequest` ran on macOS 27 rather than in the simulator. The Vision API is the same on both, and a host run needs no app bundle. The first on-simulator run belongs to #17.

### Gaps

1. **31B sometimes appends a markdown fence after its JSON.** With either schema form, about 2 in 3 replies end in `` ``` ``. The keys, enum values, and numbers always matched the schema. 26B returned strict JSON every time. **Fix:** set `stopSequences` to a code fence (three backticks) on every structured-output call, as `scripts/smoke/gemma-capabilities.ts` does with `JSON_FENCE`. On 31B that gave 6/6 strict JSON, up from 2/6. A "raw JSON only, no code fences" system instruction made it worse (0/6). Keep fence stripping and Zod validation as a backup. Affects #9 and #15.
2. **Only `minimal` and `high` thinking levels exist.** `low` and `medium` return HTTP 400 on both models. The spec planned `low` for triage and vision. Use `minimal` there and `high` for mapping and verification. `minimal` still returns one empty thought part, so read the answer from the parts where `thought` is not true. Affects #9, #26, #37.
3. **Input tokens per minute (16K per model) are the real bottleneck, not requests.** The spec estimates a 12-page lease analysis at about 31K input tokens. On 26B alone that is about two minutes of token budget per lease, so one lease at a time per project. The limiter must budget input tokens as well as requests (count with `countTokens` or estimate before sending). The SSE stream must report the wait. Splitting work between 26B and 31B spreads the load, since each model has its own quota. Affects #9, #14, #16.
4. **Structured output is not strictly guaranteed on any model.** 26B was strict in every sample here, but one sample per call is not a guarantee. Every call must validate with Zod and retry once on failure, as spec §7.1 already plans. Affects #9.
5. **31B has transient server errors.** On 2026-10-24, `gemma-4-31b-it` returned HTTP 503 ("experiencing high demand") and HTTP 500 ("Internal error") between successful calls over several minutes. 26B was unaffected. The client must retry 500 and 503 with backoff, not only 429. The verifier also needs a fallback for when 31B stays down, such as marking findings "unverified" instead of failing the analysis. The smoke script retries these up to 3 times (10, 20, 40 s). Affects #9 and #15.
6. **Schema-constrained output turns thinking off.** Measured on 2026-10-24 (#9): with `responseSchema` or `responseJsonSchema` set, both models report 0 thought tokens at `thinkingLevel: "high"` (26B in 9 of 9 answers, 31B in the 1 answer it gave; its other calls returned HTTP 500). With `responseMimeType: "application/json"` alone, `high` still thinks (26B 147 to 339 thought tokens, 31B 59). So `high` on a schema call costs nothing and adds nothing. **Fix (#9):** each stage has an output mode. `schema` (the default for every stage) sends `responseSchema` and gets no thinking. `json` sends the schema as text in the system instruction with `responseMimeType: "application/json"` only, so the model thinks, and Zod still rejects anything off the schema. A `json` call sends no fence stop sequence: with thinking on, 31B returned an empty answer in 2 of 3 calls with the stop set, and 3 of 3 valid answers without it; fence stripping covers the trailing fence instead. Through `generate()`, `json` mode gave 390 thought tokens on 26B and 338 on 31B, at about 10 s per call against 1.5 s for `schema`. Which stages switch is decided on the eval set (#14, #15).

## Gemma client (#9)

Every stage calls one function:

```ts
const gemma = gemmaFromEnv({ usage: firestoreUsageSink(db), log });
const { data, model, fallback } = await gemma.generate('mapping', FindingSchema, [{ id: leaseId, text }], { task });
```

| File | What it does |
| --- | --- |
| `server/src/ai/gemma.ts` | `generate(stage, schema, docs, options)`: limiter, retries, fallback, fence stripping, Zod validation (one retry on invalid output), a usage record and a `model call` log line per request |
| `server/src/ai/models.ts` | Model IDs, the stage table (role, thinking level, output mode), fallback chains, per-model quota |
| `server/src/ai/response-schema.ts` | Zod to `responseSchema` (OpenAPI 3.0 subset, with `propertyOrdering`). Throws at first use on what the API cannot express (recursive schemas, number enums) |
| `server/src/ai/documents.ts` | `<document id="...">` wrapping, the injection rule for the system instruction, and escaping so a document cannot close its own tag |
| `server/src/ai/provider.ts` | The `GEMMA_PROVIDER` seam. `gemini` calls `@google/genai` with SDK retries off |
| `server/src/ai/openai-compatible.ts` | `openai_compatible`: Chat Completions on an Ollama or vLLM server at `GEMMA_BASE_URL` ([self-hosting.md](self-hosting.md)) |
| `server/src/ratelimit.ts` | Per-model token buckets for requests and input tokens, FIFO, with debt for calls larger than a minute of quota |
| `server/src/usage.ts` | `usage/{yyyy-mm-dd}/calls/{autoId}`: stage, model, fallback, outcome, HTTP status, attempt, prompt, output, and thought tokens, latency, wait. No content |

### Configuration

| Env var | Default | Notes |
| --- | --- | --- |
| `GEMMA_PRIMARY` | `gemma-4-26b-a4b-it` | Dev may set a Flash model; the submission runs on Gemma |
| `GEMMA_VERIFIER` | `gemma-4-31b-it` | |
| `GEMMA_FALLBACK` | `gemini-flash-latest` | Last model in every chain. Billed: set an AI Studio spend cap. Self-hosted, defaults to the primary (no fallback) |
| `GEMMA_PROVIDER` | `gemini` | `openai_compatible` for Ollama or vLLM, with `GEMMA_BASE_URL` and optional `GEMMA_API_KEY` ([self-hosting.md](self-hosting.md), spec §15.2) |
| `GEMINI_API_KEY` | none | Required for `gemini` |

### Behavior

- **Thinking:** `minimal` for triage, vision, ask, explanation, and translation; `high` for extraction, mapping, verification, and responsibility. `high` takes effect only on a `json` stage (gap 6).
- **Output mode:** `schema` (every stage today) sends `responseSchema` and the fence stop sequence. `json` sends the Zod schema as JSON Schema text after the document rule, no `responseSchema`, and no stop sequence. Both strip fences and validate with Zod. Set it per stage in `STAGES`.
- **Retries:** 429, 500, 502, 503, 504, and network errors retry 4 times per model with exponential backoff (2, 4, 8, 16 s, equal jitter), or after the API's `retryDelay` on a 429. A 429 also empties that model's buckets. Other errors (such as 400) throw `GemmaRequestError` at once.
- **Fallback:** when a model runs out of retries, the next one in the chain answers. Primary: 26B, then Flash. Verifier: 31B, then 26B, then Flash. Each step emits a `fallback` event and a `model fallback` warning, and the result carries `model` and `fallback: true`. When every model fails, `GemmaUnavailableError` lets the verifier mark findings "unverified" (#15).
- **Rate limits:** input tokens are estimated at 4 characters per token (260 per image) before the call, then corrected with the API's `promptTokenCount`. A wait emits a `waiting` event with the ms, for the SSE stream.

### Check it

```sh
pnpm --filter @fineprint/server test                               # unit tests, SDK mocked, no key
cd server && op run --env-file ../.env -- pnpm smoke:gemma          # live: one 26B and one 31B stage through generate()
```

`smoke:gemma` runs `mapping` and `verification` in both output modes, on whichever provider the `GEMMA_*` variables select (self-hosted: [self-hosting.md](self-hosting.md), "Check it"). It exits `0` when every call returns schema-valid output and every `json` call thinks, and prints the model that answered, the thought tokens, any fallback, and the usage records.
