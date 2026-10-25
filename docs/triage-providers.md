# Triage providers

Before a model analyzes a lease, an Ask message, a repair description, or a landlord report, FinePrint checks the text for a high-stakes situation: eviction or court papers, a lockout, a utility shutoff, retaliation, discrimination, domestic violence, immediate danger, or self-harm. A hit hands the tenant to a person (F10, #38). This page compares the providers that can make that call and says why FinePrint uses the one it does (spec §7.9).

## What ships

Two providers run side by side, and **either one firing escalates** (recall over precision):

- **Gemma** (`gemma-4-26b-a4b-it`, `minimal` thinking, the category as an enum schema). It reads meaning, so it catches "they put my things on the curb" and an eviction summons uploaded as a "lease".
- **Keyword backstop**: multilingual term lists in code ("summons", "unlawful detainer", "changed the locks", "desalojo", ...). It costs nothing, needs no network, and still answers when every model is down.

The eval gate is 100% recall on the escalation set (Section 12; #37). The interface (spec §7.9; `server/src/ai/triage/` from #37):

```ts
interface TriageProvider {
  readonly name: string;
  classify(input: { source; text; imageCaptions?; locale }, options?): Promise<{ category; confidence }>;
}
```

A provider returns one of the nine categories (`none` or one of the eight above) and a confidence. Any provider below fits behind it, as a replacement for Gemma or as a third voter. The keyword backstop stays in every option.

## Options

| | Gemma via Gemini API (default) | Gemma self-hosted | OpenAI Decisions API | TypeSafe Jev |
| --- | --- | --- | --- | --- |
| What it is | The same client and model as the rest of the pipeline, on the `triage` stage | The same, on your Ollama or vLLM server ([self-hosting.md](self-hosting.md)) | `POST /v1/decisions` on `gpt-6-luna`: typed answers instead of text | `POST https://api.typesafe.ai/v1/systemone` on `jev-latest`: a decision model that returns typed answers, not text |
| Fit for a category | Enum schema, validated with Zod | Same | A `choice` question with the nine values; the answer has `choice`, per-value `probabilities`, and `confidence` | A `choice` question with nine `criteria`; the answer has per-option probabilities and a `confidence` from 0 to 1 |
| Images | Yes | Yes | Yes (base64 data URLs or public URLs) | Yes, behind the `TypeSafe-Danger-Zone-Images` header |
| Who receives tenant text | Google | No one outside your organization | OpenAI. Zero Data Retention for eligible customers | TypeSafe, or a router (OpenRouter, Cloudflare) in between. Retention is not stated in the API reference |
| Cost | $0 (Gemma is free on the Gemini API) | Your GPU | $0.10 per 1M uncached input tokens, no output charge | Input tokens billed, output free; no price in the API reference |
| Another key and bill for the nonprofit | No (the one Gemini key) | No | Yes | Yes |
| Counts as Gemma | Yes | Yes | No | No |

Sources, read on 2026-10-24: OpenAI's [Decisions guide](https://developers.openai.com/api/docs/guides/decisions) (released as a public beta on 2026-10-06; the guide now says generally available), and TypeSafe's [API reference](https://docs.typesafe.ai/api). Check both before relying on prices or retention terms: they are new and changing.

## Trade-offs

- **Another data processor receives sensitive tenant text.** Triage input is, by design, the most sensitive text in the app: court papers, abuse, danger. Adding OpenAI or TypeSafe means another company holds it, another entry in `PRIVACY.md`, and another set of terms for the legal-aid partner to accept. The default sends it only where the rest of the analysis already goes, and the self-hosted option sends it nowhere.
- **Another key and another bill for the nonprofit.** Each option outside Gemma adds a signup, a secret in Secret Manager, a spend cap, and an invoice that someone has to approve. Gemma on the Gemini API costs nothing and reuses the one key `./deploy.sh` already asks for.
- **The Gemma-core requirement for this submission.** The hackathon judges the use of Gemma. A non-Gemma provider in the safety path weakens that story, so it can only be an option a deploying organization turns on.
- **For a decision model:** Decisions and Jev are built for this shape of question (pick one label, with a confidence) and report per-label probabilities. That would let us tune the escalation threshold on the eval set instead of trusting one enum answer. If the escalation eval ever misses on Gemma and prompt changes do not fix it, a decision model as a third voter (escalate if any of the three fires) is the first thing to try, with the trade-offs above.

## Adding a provider

1. Implement `TriageProvider` in `server/src/ai/triage/`. Map the provider's answer onto the nine categories. With per-label probabilities, return a high-stakes category whenever its probability is above a threshold set from the eval, even if `none` scored higher.
2. Keep the keyword backstop. A provider error must leave the decision to the backstop, never block the request.
3. Read its key from the environment, store it in Secret Manager, and never log the input text: log the category, the provider name, and the length, as the Gemma provider does.
4. Run the escalation eval (`eval/`). The gate is 100% recall in English and Spanish.
5. Add the processor to `PRIVACY.md` and to this table.
