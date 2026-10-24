# AI pipeline

This document records what the Gemma 4 models and the iOS 26 SDK actually support, so each lane builds on measured facts. The rest of the pipeline description lands with the lanes that build it (#9, #14, #15).

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

1. **31B sometimes appends a markdown fence after its JSON.** With either schema form, about 2 in 3 replies end in `` ``` ``. The keys, enum values, and numbers always matched the schema. The Gemma client must strip a leading or trailing code fence before `JSON.parse`, then validate with Zod. 26B returned strict JSON every time. Affects #9 and #15.
2. **Only `minimal` and `high` thinking levels exist.** `low` and `medium` return HTTP 400 on both models. The spec planned `low` for triage and vision. Use `minimal` there and `high` for mapping and verification. `minimal` still returns one empty thought part, so read the answer from the parts where `thought` is not true. Affects #9, #26, #37.
3. **Input tokens per minute (16K per model) are the real bottleneck, not requests.** The spec estimates a 12-page lease analysis at about 31K input tokens. On 26B alone that is about two minutes of token budget per lease, so one lease at a time per project. The limiter must budget input tokens as well as requests (count with `countTokens` or estimate before sending). The SSE stream must report the wait. Splitting work between 26B and 31B spreads the load, since each model has its own quota. Affects #9, #14, #16.
4. **Structured output is not strictly guaranteed on any model.** 26B was strict in every sample here, but one sample per call is not a guarantee. Every call must validate with Zod and retry once on failure, as spec §7.1 already plans. Affects #9.
