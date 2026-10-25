# Self-hosting the models

FinePrint runs on Gemma 4 open weights. By default the server calls them through the Gemini API, so tenant text (lease clauses, repair descriptions, Ask messages) goes to Google. An organization that wants that text to stay inside its own network can run the same models on its own Ollama or vLLM server and point FinePrint at it (spec §15.2).

```sh
GEMMA_PROVIDER=openai_compatible
GEMMA_BASE_URL=http://gemma.internal:11434/v1   # Ollama; vLLM is usually :8000/v1
GEMMA_PRIMARY=gemma4:26b                        # the names your server uses
GEMMA_VERIFIER=gemma4:31b
```

No other code or configuration changes. Every AI stage goes through the same client (`server/src/ai/gemma.ts`), so retries, Zod validation, usage records, and the document injection rule work as they do on the Gemini API.

## Should you?

| | Gemini API (default) | Self-hosted |
| --- | --- | --- |
| Where tenant text goes | Google's Gemini API, under Google's API terms | Your server only. With no `GEMMA_FALLBACK` set, nothing leaves your network |
| Model cost | $0: Gemma 4 is free on the Gemini API (`docs/ai-pipeline.md`, "Pricing") | $0 for the weights (Apache 2.0) |
| Hardware cost | None | A GPU host that runs every day. See "Hardware" |
| Throughput | 30 requests and 16K input tokens per minute per model (Tier 1). About one lease at a time per project | Whatever your GPU serves. No per-project quota |
| Fallback when Gemma is down | Flash answers (billed) and the result is labeled a fallback | No Flash: the 31B verifier falls back to 26B, then the stage fails, and the verifier marks findings "unverified" |
| Operations | A key in Secret Manager | Model downloads, upgrades, GPU drivers, uptime, network access from Cloud Run |
| Same models as the submission | Yes | Yes, if you serve the 26B and 31B instruction-tuned weights. Quantized builds can answer differently: run the eval set (`eval/`) on yours |

Self-host when a data-handling policy or a funder requires that tenant text stays with you, and you already run (or will pay for) a GPU. Otherwise the Gemini API is cheaper and simpler. Either way the evidence photos, hashes, and sealing in FinePrint do not depend on this choice.

## Hardware

Download sizes of the default Ollama builds (registry manifests, read on 2026-10-24):

| Model | Ollama tag | Size | Role |
| --- | --- | --- | --- |
| Gemma 4 26B A4B (mixture of experts, about 4B active) | `gemma4:26b` | 18.7 GB | primary: triage, extraction, mapping, vision, Ask |
| Gemma 4 31B (dense) | `gemma4:31b` | 20.4 GB | verifier |
| Gemma 4 E4B | `gemma4:e4b` | 6.6 GB | not used by FinePrint; for testing |
| Gemma 4 E2B | `gemma4:e2b` | 4.6 GB | not used by FinePrint; for testing on a laptop (see "Check it") |

Plan for the weights plus room for the context: a single 24 GB GPU holds one of the two models at a time, so Ollama swaps them, and every verifier call then waits for a model load. A 48 GB GPU (or two 24 GB GPUs) keeps both loaded. To serve one model only, set `GEMMA_VERIFIER` to the primary's name: the verifier then runs on 26B, which is weaker at the second-opinion step (#15).

## Run a server

### Ollama

```sh
ollama pull gemma4:26b
ollama pull gemma4:31b
OLLAMA_HOST=0.0.0.0:11434 ollama serve
```

Ollama has no authentication. Keep it on a private network that only the FinePrint server can reach, or behind a proxy that checks a key.

### vLLM

```sh
vllm serve google/gemma-4-26B-A4B-it --api-key "$GEMMA_API_KEY" --port 8000
```

The model names are the Hugging Face IDs (`google/gemma-4-26B-A4B-it`, `google/gemma-4-31B-it`), and one vLLM process serves one model. With two processes on different ports, the client needs one base URL, so put both behind a router (such as a LiteLLM proxy) or serve only the primary. Pass `--api-key` and set the same value in `GEMMA_API_KEY`.

## Configuration

| Env var | Default | Notes |
| --- | --- | --- |
| `GEMMA_PROVIDER` | `gemini` | `openai_compatible` for Ollama, vLLM, or any server with the OpenAI Chat Completions API |
| `GEMMA_BASE_URL` | none | Required. The API root, ending in `/v1`. Must start with `http://` or `https://` |
| `GEMMA_API_KEY` | none | Sent as `Authorization: Bearer`. Only when the server checks a key. Keep it in Secret Manager, as with `GEMINI_API_KEY` |
| `GEMMA_PRIMARY` | `gemma-4-26b-a4b-it` | Set to your server's name for 26B, such as `gemma4:26b` |
| `GEMMA_VERIFIER` | `gemma-4-31b-it` | Set to your server's name for 31B, such as `gemma4:31b` |
| `GEMMA_FALLBACK` | the primary (no fallback) | A model on the same server. Never a Gemini model: the request would go to your server, which does not have it |

`GEMINI_API_KEY` is not needed by the model client when self-hosted.

On Cloud Run, `./deploy.sh` sets up the Gemini API path only. After it runs, switch the service with `gcloud run services update fineprint --region <region> --update-env-vars GEMMA_PROVIDER=openai_compatible,GEMMA_BASE_URL=...,GEMMA_PRIMARY=...,GEMMA_VERIFIER=...`. Cloud Run reaches a server on a private network through Direct VPC egress or a Serverless VPC Access connector. That networking is not automated.

## How the self-hosted path differs

`server/src/ai/openai-compatible.ts` sends `POST {GEMMA_BASE_URL}/chat/completions` with the system instruction as the system message and the documents as the user message (images as base64 data URLs).

- **Structured output:** a `schema` stage sends the Zod schema as `response_format: json_schema` (both servers constrain decoding to it) and stops at a code fence, as on the Gemini API. A `json` stage sends `response_format: json_object`. Zod validates the answer either way.
- **Thinking:** `reasoning_effort: "high"` on a `json` stage at `high`, and `"none"` on every other call. Gemma 4 on Ollama thinks unless told `none` (measured: about 1,200 characters of reasoning on a one-line prompt, and 13 to 23 s on CPU instead of under 1 s). vLLM maps `reasoning_effort` to Gemma 4's `enable_thinking`. Reasoning comes back in its own field and is never parsed as the answer.
- **Thought tokens:** read from `usage.completion_tokens_details.reasoning_tokens` when the server reports it. Ollama does not, so the client estimates 4 characters per token of reasoning. `outputTokens` includes reasoning on both servers.
- **Rate limits:** the 30 RPM and 16K TPM Gemini quota does not apply. The limiter allows 600 requests and 10M input tokens per minute per model, only to stop a runaway loop; the server queues the rest.
- **Errors:** a refused connection or reset retries like a 503 (the server may be loading a model). 429 and 5xx retry with backoff, honoring `Retry-After`. A 404 (a model name the server does not have) fails at once with `GemmaRequestError`, so a wrong `GEMMA_PRIMARY` shows on the first call. Error bodies are not read or logged.
- **Fallback:** no Flash. See "Should you?".

## Check it

The live check runs the same client against your server:

```sh
cd server
GEMMA_PROVIDER=openai_compatible GEMMA_BASE_URL=http://127.0.0.1:11434/v1 \
  GEMMA_PRIMARY=gemma4:26b GEMMA_VERIFIER=gemma4:31b pnpm smoke:gemma
```

It exits `0` when `mapping` and `verification` both return schema-valid output in `schema` and `json` modes, and every `json` call thinks.

Measured on 2026-10-24 with Ollama 0.40.11 in Docker, CPU only (12 cores, no GPU runtime), and `gemma4:e2b` as both models, since the 26B and 31B builds do not fit that machine. Every call answered on the first attempt with no fallback:

| Stage (mode) | Latency | Thought tokens | Answer |
| --- | --- | --- | --- |
| mapping (schema) | 3.9 s | 0 | `LATE FEES`, `ask`, $75 |
| verification (schema) | 3.3 s | 0 | `LATE FEES`, `info`, $75 |
| mapping (json) | 18.3 s | 520 (estimated) | `info`, $75, hidden instructions flagged |
| verification (json) | 18.2 s | 527 (estimated) | `info`, $75, hidden instructions flagged |

That proves the request shape, schema-constrained decoding, thinking on and off, and the usage records. It says nothing about E2B's quality, which FinePrint does not use. Before relying on a self-hosted deployment, run the smoke check and the eval set on the 26B and 31B builds you serve. The vLLM request fields were checked against vLLM's source; no vLLM server was run.

## Triage

The high-stakes triage step (#37) calls the same client, so its model check runs on your server too. It must turn the model on when `GEMMA_PROVIDER=openai_compatible` is set without a Gemini key; otherwise the keyword backstop decides alone. Alternative triage providers, and why the default is Gemma plus a keyword backstop, are in [triage-providers.md](triage-providers.md).
