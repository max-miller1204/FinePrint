# Gemma client

The one model client every AI stage calls (spec §7.1, §7.2, §14; #9). It has
no route of its own: lease analysis (#14), verification (#15), and the other
AI features reach it through `generate(stage, schema, docs, { task })` in
`server/src/ai/gemma.ts`. Details are in `docs/ai-pipeline.md`, "Gemma client".

## Sub-features

- Typed output: the Zod schema becomes `responseSchema`. The answer is read
  from non-thought parts, a code fence is stripped, and the result is
  validated with Zod, with one retry on invalid output (`GemmaOutputError`
  after that).
- Two output modes per stage (`STAGES` in `models.ts`): `schema` sends
  `responseSchema` and the model does not think; `json` sends the schema as
  text and no stop sequence, so `high` thinking takes effect. `extraction`
  and `mapping` (the lease stages, #14) are on `json`, since 26B loops in
  `schema` mode on them (`docs/ai-pipeline.md`, gap 7); the rest stay on
  `schema` until an eval says otherwise.
- `maxOutputTokens` in the options caps the answer (`max_tokens` on the
  self-hosted provider). A cut-off answer fails validation and is retried
  once, so a looping answer cannot run for minutes.
- Documents are wrapped in `<document id="...">` under a system instruction
  that says their text cannot change the task. A document cannot close its
  own tag.
- 429 and 5xx back off and retry (4 times per model), then fall back:
  primary 26B, then Flash; verifier 31B, then 26B, then Flash.
  `GemmaUnavailableError` when every model fails. A 400 throws
  `GemmaRequestError` without retrying.
- A per-model token bucket for requests and input tokens (30 RPM, 16K TPM
  on Gemma), FIFO, with a `waiting` event for the SSE stream.
- One usage record per request under `usage/{yyyy-mm-dd}/calls/` and one
  `model call` log line, each naming the model, with no content.
- `GEMMA_PRIMARY`, `GEMMA_VERIFIER`, `GEMMA_FALLBACK`, and `GEMMA_PROVIDER`
  choose the models and the provider.
- Self-hosted provider (#56): `GEMMA_PROVIDER=openai_compatible` with
  `GEMMA_BASE_URL` (and `GEMMA_API_KEY` if the server checks one) calls an
  Ollama or vLLM server's Chat Completions API
  (`server/src/ai/openai-compatible.ts`, `docs/self-hosting.md`). Schema
  stages send `response_format: json_schema`; `reasoning_effort` is `high`
  on a `json` stage at `high`, else `none`. No Flash fallback unless
  `GEMMA_FALLBACK` names a model on the same server, and the Gemini quota
  does not apply.

## How to get to it (user POV)

Through `POST /v1/triage` (the `triage` stage, [triage](triage.md)) when
the server has `GEMINI_API_KEY` or `GEMMA_PROVIDER=openai_compatible`. The
lease pipeline ([lease-pipeline](lease-pipeline.md), #14) calls the
`extraction` and `mapping` stages behind the lease stream ([leases](leases.md), #16).
Triage and the lease stream share one client, so one rate limiter.

## Driving it with e2e

`tests/web/triage.e2e.ts` reaches it when the run is wrapped in `scripts/with-secrets.sh`
(the `triage` log line says `modelStatus: "ok"`). `pnpm --filter @fineprint/server test`
covers it with the SDK mocked (`test/gemma.test.ts`,
`test/ratelimit.test.ts`, `test/response-schema.test.ts`) and `fetch`
mocked for the self-hosted provider (`test/openai-compatible.test.ts`).
The live check calls the real API:

```bash
cd server
../scripts/with-secrets.sh pnpm smoke:gemma
```

Self-hosted, against a local Ollama (no GPU needed for the small model):

```bash
docker run -d --name fineprint-ollama -p 127.0.0.1:11434:11434 -v fineprint-ollama:/root/.ollama ollama/ollama
docker exec fineprint-ollama ollama pull gemma4:e2b      # 4.6 GB; use gemma4:26b and gemma4:31b on a GPU host
cd server
GEMMA_PROVIDER=openai_compatible GEMMA_BASE_URL=http://127.0.0.1:11434/v1 \
  GEMMA_PRIMARY=gemma4:e2b GEMMA_VERIFIER=gemma4:e2b pnpm smoke:gemma
```

## Proof

`smoke:gemma` prints `[ok ]` for `mapping (schema)` and `mapping (json)` on
`gemma-4-26b-a4b-it` and for `verification (schema)` and `verification
(json)` on `gemma-4-31b-it`, with no `(FALLBACK)`, 0 thought tokens on the
`schema` lines and more than 0 on the `json` lines, one usage record per
request, and `PASS` with exit 0. Self-hosted, the same four `[ok ]` lines
name the server's models (`gemma4:e2b` on 2026-10-24: 3 to 4 s per
`schema` call and about 18 s per `json` call on CPU). Rerun
`scripts/smoke/gemma-capabilities.ts` after changes to the request shape.

## Charters

The lease upload charter in [leases](leases.md) drives the client end to end.

## Gotchas

- With a schema set, `high` thinking yields 0 thought tokens
  (`docs/ai-pipeline.md`, gap 6). Use a `json` stage to think.
- Do not add the fence stop sequence to `json` calls: with thinking on, 31B
  then often returns an empty answer.
- 31B, and sometimes 26B, return transient HTTP 500 and 503. A live run can
  take a minute of retries, or answer from a fallback. That is reported, not
  a failure.
- The fallback model (Flash) is billed. Gemma is free.
- Gemma 4 on Ollama thinks by default, which makes `minimal` stages take
  10 to 20 s on CPU. The provider sends `reasoning_effort: none`; Ollama's
  native `think: false` is ignored on its OpenAI endpoint.
- Ollama reports no reasoning token count: self-hosted thought tokens are
  an estimate (4 characters per token of the `reasoning` text).
- A wrong `GEMMA_PRIMARY` on a self-hosted server is a 404 and fails the
  first call at once (`GemmaRequestError`), with no retries.
