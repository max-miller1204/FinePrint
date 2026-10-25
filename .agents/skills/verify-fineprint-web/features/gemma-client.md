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
  text and no stop sequence, so `high` thinking takes effect. Every stage
  is on `schema` until the eval set (#14, #15) says otherwise.
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

## How to get to it (user POV)

Through `POST /v1/triage` (the `triage` stage, [triage](triage.md)) when
the server has `GEMINI_API_KEY`. The lease pipeline (#14) is next.

## Driving it with e2e

`tests/web/triage.e2e.ts` reaches it when the run is wrapped in `op run`
(the `triage` log line says `modelStatus: "ok"`). `pnpm --filter @fineprint/server test`
covers it with the SDK mocked (`test/gemma.test.ts`,
`test/ratelimit.test.ts`, `test/response-schema.test.ts`). The live check
calls the real API:

```bash
cd server
op run --env-file ../.env -- pnpm smoke:gemma
```

## Proof

`smoke:gemma` prints `[ok ]` for `mapping (schema)` and `mapping (json)` on
`gemma-4-26b-a4b-it` and for `verification (schema)` and `verification
(json)` on `gemma-4-31b-it`, with no `(FALLBACK)`, 0 thought tokens on the
`schema` lines and more than 0 on the `json` lines, one usage record per
request, and `PASS` with exit 0. Rerun
`scripts/smoke/gemma-capabilities.ts` after changes to the request shape.

## Charters

None until a route calls the client. The lease route's charter (#14) will
cover document injection end to end.

## Gotchas

- With a schema set, `high` thinking yields 0 thought tokens
  (`docs/ai-pipeline.md`, gap 6). Use a `json` stage to think.
- Do not add the fence stop sequence to `json` calls: with thinking on, 31B
  then often returns an empty answer.
- 31B, and sometimes 26B, return transient HTTP 500 and 503. A live run can
  take a minute of retries, or answer from a fallback. That is reported, not
  a failure.
- The fallback model (Flash) is billed. Gemma is free.
