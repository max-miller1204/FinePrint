# Lease API and SSE stream

The routes behind F1 Lease Explainer (spec §4.3 F1, §7.3, §13; #16): the
app uploads the redacted lease text, opens the stream, and shows each
stage, the key terms, and the findings as they arrive. The stream runs the
[lease pipeline](lease-pipeline.md) (S1 to S9) and stores the lease, its
clauses, and its findings (spec §6.1).

## Sub-features

- `POST /v1/rentals/:id/leases` with `{ text, locale?, readingLevel?,
  pageCount?, ocrConfidence? }`. `text` is the redacted text, 1 to 200,000
  characters after trimming; `locale` is a BCP 47 tag, default `en`;
  `readingLevel` is `standard` (grade 7, the default) or `simpler` (grade
  5). 201 with `{ leaseId, status: "pending", stream }` and a `Location`
  header. Nothing runs yet. 400 `BAD_REQUEST` naming the field (unknown
  fields too), 413 over 1 MB, 404 unknown rental, 403 another user's
  rental, 422 `UNSUPPORTED_JURISDICTION` for a rental outside Virginia
  (only `jurisdictions/va` has a pack), 503 when the packs fail to load.
- `GET /v1/rentals/:id/leases/:leaseId/stream`: `text/event-stream`. Claims
  the lease (`running`), runs the pipeline with the rental's
  `occupancyDate` and `tenancyEndDate` as the fallback term, stores the
  result, then sends `done`. Every event has an `id`, 1, 2, 3, ... Events:
  - `stage` `{ stage, label, progress }`, S1 to S9 (S9 only when `locale` is
    not English).
  - `keyterms` `{ keyTerms }` right after S3.
  - `finding`: one finding per event, in display order, after S8 (and S9).
  - `error` `{ code, message, retryInMs, model }`: a wait. `RATE_LIMITED`
    for the client's rate limiter or a 429 retry, `DEPENDENCY_UNAVAILABLE`
    for a 5xx retry. The stream goes on.
  - `done` `{ status, findings, tokens: { in, out }, calls, ms, models }`
    plus `injection` (the info finding or null) for `analyzed`,
    `escalation: { by, category }` for `escalated`, `documentType` and
    `message` for `not_a_lease`, and `replay: true` on a replay.
  - `error` `{ code, message }` with no `retryInMs`: the analysis stopped
    (`DEPENDENCY_UNAVAILABLE` when no model answered or none is
    configured, `INTERNAL` otherwise). The lease is `failed`, and the next
    stream runs it again.
  - A `: keepalive` comment every 15 s, so a long wait does not look idle.
- A stream on a finished lease (`analyzed`, `escalated`, `not_a_lease`)
  replays `keyterms`, each `finding`, and `done` with `replay: true`, with
  no model call. A second stream while one runs is 409 `CONFLICT`; a claim
  older than 15 minutes is free again. Closing the stream cancels the
  analysis and sets the lease back to `pending`.
- Without a model (no `GEMINI_API_KEY`, no `GEMMA_PROVIDER=openai_compatible`)
  S1 still runs on the keyword backstop: a summons escalates; anything else
  ends with `DEPENDENCY_UNAVAILABLE` after the S2 stage event.
- `GET /v1/rentals/:id/leases/:leaseId`: the lease without its text:
  `status`, `locale`, `readingLevel`, `pageCount`, `ocrConfidence`,
  `jurisdiction`, `rulePackVersion` (the pack's `verifiedThrough`),
  `models`, `documentType`, `term`, `keyTerms`, `injection`, `escalation`,
  `message`, `errorCode`, `drops`, `usage`, `analyzedAt`, plus `clauses`
  (lease order, with `start` and `end`) and `findings` (display order).
  Both lists are empty until the lease is finished.
- Storage: `rentals/{rentalId}/leases/{leaseId}` with the redacted text,
  `.../clauses/{clauseId}`, and `.../findings/{findingId}`, written in one
  batch when the analysis finishes. Delete everything and the purge remove
  them with the rental.
- The pipeline shares one Gemma client, and so one rate limiter, with
  `POST /v1/triage`.
- Log: `lease created` (ids, `textChars`, `locale`, `pageCount`), the
  pipeline's lines, `lease analyzed` (status and counts), and `lease
  analysis failed` (`code`, `errorName`) or `lease stream closed`. No lease
  text.

## How to get to it (user POV)

The tenant scans a lease, reviews the redactions, and taps Analyze: the app
posts the redacted text, opens the stream, and fills the findings screen as
events arrive. Reopening the lease later reads the GET.

## Driving it with e2e

`tests/web/leases.e2e.ts` reads the stream with `curl -sSN`, as the issue
asks. Without a key: the summons streams `stage` S1 then `done` with
`escalated` and is stored in the Firestore emulator; the synthetic lease
ends with an `error` event and is `failed`; 401, 403, 404, 400, 422, and a
150,000-character upload; no lease text in `server.log`. With a key, the
`live` test replaces the `failed` one: the synthetic lease streams S1 to S8,
`keyterms` after S3, every `finding`, and `done`, with any waits as `error`
events; the GET and the stored `findings` and `clauses` match the stream.
A second live test streams `inject-ignore-previous-es` with `locale: es-US`:
S1 to S9, and `done.injection` has the Spanish title (#104).

```bash
cd e2e
npx e2e run tests/web/leases.e2e.ts --target web                          # no model
../scripts/with-secrets.sh npx e2e run tests/web/leases.e2e.ts --target web   # live Gemma
pnpm --filter @fineprint/server test                                      # server/test/leases.test.ts
```

The unit tests (`server/test/leases.test.ts`, scripted model) cover the
event order, persistence, a rate limiter wait and a 429 retry as `error`
events with `retryInMs`, replay without a model call, the 409 and the stale
claim, a closed stream freeing the lease, and the log.

By hand, against `pnpm --filter @fineprint/server dev:emulated`:

```bash
curl -sS -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  --data "$(jq -Rs '{text: .}' server/test/fixtures/lease-synthetic.txt)" \
  http://127.0.0.1:8080/v1/rentals/$RENTAL/leases
curl -N -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8080/v1/rentals/$RENTAL/leases/$LEASE/stream
```

## Proof

The `curl` output: `event: stage` lines S1 to S8 in order, `event:
keyterms` after S3, one `event: finding` per finding, `event: done` last,
`id:` counting up from 1, and `event: error` lines with `"retryInMs"` when
the minute's quota runs out. The GET body's `findings` equal the streamed
ones. 2026-10-25, the historical password-manager-backed web run: 31 passed, 1
skipped (the no-model test), exit 0, 202 s. The live lease made 8 model calls
(29,340 input and 4,564 output tokens), 31
clauses, 6 key terms, 14 findings (7 `unenforceable`, 1 `ask`, 6 `info`,
none unverified), with two 429 retries streamed as `RATE_LIMITED` waits.

## Charters

```
lease-upload|web|fuzzer|POST /v1/rentals/:id/leases and open the stream with every case of eval/datasets/adversarial.jsonl and some odd uploads (empty lines only, one clause, 200,000 characters, Spanish). An injected lease must still stream findings plus the injection info finding in done; a non-lease must end with not_a_lease and its message; a summons must end with escalated. Lease text in server.log, a stream that never ends, or a stored lease whose findings differ from the stream is a bug.
```

## Gotchas

- The synthetic lease (7,836 characters) sends about 28K input tokens to
  26B against its 16K a minute, so even one lease waits: on 2026-10-25 S5's
  four mapping batches (about 6K tokens each, most of it the rule list
  repeated per batch) waited 16 to 22 s each plus two 429s, and the stream
  took 3 min 7 s. 31B (S7) used 1.1K. The waits stream as `RATE_LIMITED`
  `error` events; the stream keeps going.
- Cloud Run's request timeout is 900 s (`deploy.sh`). A live run on a
  shared quota has taken 401 s.
- The stream does the work: Cloud Run gives CPU only during a request, so
  a client that closes the stream cancels the analysis (the lease goes
  back to `pending`) instead of leaving it running unseen.
- The analysis runs once per stream: open it again only after `done` (a
  replay) or a terminal `error` (a rerun).
