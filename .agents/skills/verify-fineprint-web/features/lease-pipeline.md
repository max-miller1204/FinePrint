# Lease pipeline (S1 to S9)

The lease analysis behind F1 Lease Explainer (spec §4.3 F1, §7.3; #14,
#15): triage, clause segmentation and key terms, quote resolution,
deterministic checks, rule mapping, mechanical verification, the 31B legal
verifier and the severity table, plain-language explanations, and
translation. Gemma interprets; code verifies. The route is
`GET /v1/rentals/:id/leases/:leaseId/stream` ([leases](leases.md), #16). Details:
`docs/ai-pipeline.md`, "Lease pipeline (#14, #15)".

## Sub-features

- `analyzeLease(input, { gemma, pack, triage? }, { signal?, onEvent? })` in
  `server/src/ai/pipeline/lease.ts`. `input` is `{ leaseId, text, locale,
  readingLevel?, term?, today? }` (the redacted text; `readingLevel` is
  `standard` or `simpler`). Returns `status: "escalated"` with
  `by` (`triage` or `document_type`) and the triage decision, `"not_a_lease"` with the `documentType` and the not-a-lease `message`, or
  `"analyzed"` with `term`, `clauses`, `keyTerms`, `checks`, `mappings`,
  `findings`, `injection` (with its `info` finding,
  [adversarial-input](adversarial-input.md)), `drops`, and `usage`.
- S1: `triage.check({ source: "lease" })`; escalation stops before any lease call.
- S2: the `extraction` stage (26B, `json` mode, output cap of half the chunk's characters in tokens, 4,096 to 16,384),
  per chunk of at most 40,000 characters: `documentType`, `aiInstructions`,
  clause headings and starts, and key terms (`monthlyRent`,
  `securityDeposit`, `lateFee`, `damageInsurancePremium`,
  `renterInsurancePremium`, `maintenanceNoticeHours`, `leaseStart`,
  `leaseEnd`) as written, with their sentence.
- S3: clauses cut at their starts (`c0` is text before the first clause),
  each a slice of the lease with `start` and `end` offsets. Key terms kept
  only when the quote is in the lease, the value is in the quote, and code
  reads the value; percent and months of rent become dollars with the
  verified rent.
- S4: every deterministic rule in force during the term
  (`VA_DEPOSIT_CAP`, `VA_DEPOSIT_PLUS_INSURANCE_CAP`, `VA_LATE_FEE_CAP`,
  `VA_ROUTINE_MAINTENANCE_NOTICE_72H` today), with `limit`, `actual`, the
  key terms read, and the rule versions and mid-lease changes.
- S5: the `mapping` stage (26B, `json` mode, output cap 400 tokens per clause, 4,096 to 16,384),
  fills each batch up to 12,000 estimated input tokens, including the document
  rule, JSON schema, escaped tags, and task ids. At most 40 clauses per batch
  preserves the 400-token output allowance per clause. Every rule in force
  stays in the instruction, rule ids as an enum. An individually oversized
  clause is sent alone, preserving the existing no-splitting behavior.
- S6: drops a mapping whose clause is not in its batch or whose quote is
  not in its clause, and rule ids that are unknown, not in force for the
  term, or already decided by S4 or by a missing-wording check.
- Required wording (code, with S4): a lease that never mentions the DHCD
  Statement of Tenant Rights and Responsibilities gets a
  `VA_TENANT_RIGHTS_STATEMENT` finding (`basis: "absence"`, no quote, `ask`).
- S7: the `verification` stage (31B), one call for the S5 `violates`
  mappings (split only past the token cap). It sees each clause and the
  statute's exact words, nothing else: no rule summary, no S5 answer. Its
  own reading (`violates`, `complies`, `unclear`) becomes `agree`,
  `disagree`, or `unclear`; no answer is `unverified`, and the analysis
  goes on.
- Severity table (`pipeline/severity.ts`): S4 or absence violation
  `unenforceable`; `violates` plus `agree` `unenforceable`; `violates`
  plus anything else `ask`; `unclear` `ask`; `complies` and `not_covered`
  `info`. Capped at the rule's `severityIfViolated`. Findings sort by
  severity, then lease position, and are numbered `f1`, `f2`, ...
- S8: the `explanation` stage (26B), one call: a title and one to three
  sentences per finding, lease quotes as documents. Code grades each
  (Flesch-Kincaid, `pipeline/readability.ts`): grade 7 or lower, 5 for
  `simpler`. Failures get one regeneration, then the rule's own
  `tenantExplanation` if it passes, else a fixed sentence that passes
  grade 5. `actionEn` is the rule's verified `action`.
- S9: the `translation` stage (26B), only when `locale` is not `en` or
  `en-*`: title, explanation, and action, into `translations[locale]`.
  Quotes are never sent; quoted phrases must come back unchanged, or the
  finding keeps only its English.
- Budget: 8 calls or fewer to S5 (`ANALYSIS_CALLS`), 12 in all
  (`MAX_CALLS`), no request over 12,000 estimated input tokens. Waits come
  from the client's limiter as `model` events wrapping `waiting`.
- Events: `stage` (S1 to S9, label, progress), `keyterms`, `finding` (one
  per finding, in order, after S8 or S9), and `model` (the Gemma client's
  `waiting`, `retry`, `invalid_output`, `fallback`).
- Log: one `lease pipeline` line (status, counts, findings per severity,
  unverified, calls, tokens, term source), plus the client's `model call`
  lines, the `triage` line, and a `verifier unavailable`, `explanation
  unavailable`, or `translation unavailable` warning when a stage's models
  all fail. No lease text.

## How to get to it (user POV)

The tenant uploads a lease in the app; the lease stream
([leases](leases.md)) runs this and sends each finding as an event, and the
findings screen shows the `findings` list.

## Driving it with e2e

`tests/web/packed-mapping.e2e.ts` proves one S5 call for all 31 clauses of
the synthetic fixture through real HTTP/SSE, with a scripted model and
in-memory storage. It checks request budgets, 26B mapping, 31B verification,
and persisted findings without a key. This proves orchestration, not live
model recall or quota behavior.

`tests/web/leases.e2e.ts` drives it through the route ([leases](leases.md)).
Unit tests cover it with a scripted
model (`server/test/lease-pipeline.test.ts`): S3 matching, clause cutting,
key term reading, S4 on the planted values, S6 drops, the full run on the
synthetic lease with its findings and severities, escalation, a non-lease,
injection, the term fallbacks, and the call and token budget on a 12-page
lease. For S7 to S9: every row of the severity table and the cap, what the
verifier sees, disagree and unclear, a verifier outage and a fallback, the
grade check with its regeneration and fallbacks, Simpler at grade 5, a
Spanish run whose quotes are byte-identical to the English run's, a
translation that changes a quoted phrase, and the missing DHCD statement.
The live checks run the real model:

```bash
pnpm --filter @fineprint/server test
cd server && ../scripts/with-secrets.sh pnpm smoke:lease
cd eval && ../scripts/with-secrets.sh pnpm verifier     # S7 on clauses-golden, both output modes
scripts/with-secrets.sh pnpm eval  # the lease eval sets (#20), about 30 minutes
```

The eval sets (#20, `docs/ai-pipeline.md`, "Lease eval sets"):
`eval/datasets/lease-synthetic/` holds a 12-page lease with the same 8
plants and 2 clean variants, written by `node
scripts/make-synthetic-lease.ts` (`pnpm check:synthetic-lease` fails when
the files are stale). `pnpm eval` runs them S1 to S8, runs the 60
`clauses-golden` excerpts through S5 to S7, and checks that every finding's
lease quote and statute quote resolve. `server/test/lease-eval.test.ts`
covers the set, the scoring, and the citations gate with no model.

The fixture is `server/test/fixtures/lease-synthetic.txt`: a Virginia lease
with a 3-month deposit, a 15% late fee, 24 hours' notice for routine
maintenance, a rights waiver, a confession of judgment, landlord
exculpation, attorney fees, and tenant-paid HVAC repairs.

## Proof

`smoke:lease` prints `[ok ]` for `deterministic violations
["VA_DEPOSIT_CAP","VA_LATE_FEE_CAP","VA_ROUTINE_MAINTENANCE_NOTICE_72H"]`
on the synthetic lease and `[]` on the variant with its amounts fixed, `6
calls <= 8` for each, the term `2026-11-01 to 2027-10-31 (lease)`, a
`REPORT: planted semantic clauses found` line, and `PASS` with exit 0
(2026-10-24: 5/5, 50 s, all on `gemma-4-26b-a4b-it`).

With S7 to S9 (#15), the synthetic lease runs in Spanish. `smoke:lease`
also prints `[ok ] synthetic: S4 findings unenforceable [...]`, `every
explanation at grade 7 or lower`, `9 calls <= 12, 6 to S5 <= 8`, `quotes
byte-identical after translation`, one line per finding with its severity,
verifier verdict, grade, and Spanish text, `REPORT: translated 13/13
findings into es`, and each planted clause with `verifier agree` and its
severity (2026-10-25: PASS, exit 0, 401 s and 277 s with shared-quota 429
waits). `pnpm verifier` in `eval/` prints each mode's agreement; on
2026-10-25 `json` agreed with 29/30 violations and 0/15 look-alikes
(`docs/ai-pipeline.md`, "Verifier output mode").

`pnpm eval` prints a results table and `PASS` with exit 0 when recall on
`lease-synthetic` is 0.9 or higher, precision 0.85 or higher, and the
citations gate is 100%; a full run rewrites `docs/eval-results.md` (see it
for the latest numbers).

## Charters

The lease upload charter in [leases](leases.md) covers document injection
and non-lease uploads end to end.

## Gotchas

- `pnpm eval` and `smoke:lease` on the same key at the same time slow
  each other down: both wait out 429s for the same 16K tokens a minute.
- The 26B and 31B quotas are per project: another lease, the eval, or a
  second worktree on the same key in the same minute makes the run wait
  out 429s.
- Gemma's 16K input tokens a minute: one lease is about 15K, so a second
  lease in the same minute waits for a 429 retry (about a minute).
- `schema` mode loops on these stages (`docs/ai-pipeline.md`, gap 7); keep
  them on `json`.
- `VA_TENANT_RIGHTS_STATEMENT` is decided in code (`REQUIRED_WORDING` in
  `pipeline/checks.ts`): S6 needs a quote, so S5 can never report the
  statement missing. A lease that says "Tenant Rights and Responsibilities"
  anywhere passes.
- The Flesch-Kincaid grade counts syllables by vowel groups; a single long
  word ("responsibilities") moves a short explanation by a grade or more.
- A key term written only in words with no unit ("five") or as a bare
  number is dropped, never guessed: the check then reports
  `insufficient_input`.

## Packed batching live gate (#110)

Run `pnpm smoke:lease --packed-single` in `server/` with `GEMINI_API_KEY`
provided by the secret manager and a fresh Gemma quota window. It checks one
successful S5 request, all planted findings, no limiter waits, and no invalid
outputs. For the HTTP stream, run smoke plus the English live lease test with
`E2E_PACKED_LEASE_TIMING=1`; this additionally asserts no wait/error events,
one successful 26B mapping request, and no invalid outputs. An isolated
emulator run can set `E2E_FIRESTORE_EMULATOR_HOST` for the lease tests' direct
Firestore checks.

Measured 2026-10-25: baseline eval passed 8/8 plants; packed eval retained
7/8, missing `VA_LANDLORD_MAINTAIN_FIT`, and added one clean-alt false
positive. The short-fixture smoke retained only 2/5 semantic plants. The
HTTP timing proof passed in 89 seconds with one S5 request and no waits or
invalid outputs. PR #118 remains draft for the failed accuracy gate. See
[the live comparison and reproduction steps](../../../../docs/s5-batching.md).

After integrating main at `f8f63d0`, the full web gate passed in one run:
51 tests passed, two live-model skips, exit 0, including smoke and all
lease-route/packed-mapping tests (`.e2e/proof/110-post-main/`). The baseline
and packed live results above remain the acceptance evidence; regression
passes do not clear the failed accuracy gate.

PR #118 was retargeted to `dev`. Syncing `origin/dev` at `f8f63d0` required
no additional changes. A fresh full web run passed smoke and all affected
lease tests together: 51 passed, two live-model skips, exit 0
(`.e2e/proof/110-post-dev/`). The PR remains draft for the live accuracy
failures and is left for the separate integration thread to merge.

## Accuracy repair candidate 1 (#110)

S5 now receives opaque batch-local `mapping_AA` document ids, constrained by
an enum for that batch. Validated aliases are translated back to the public
`cN` ids before S6; S6 still rejects every mismatched quote. Planning reserves
both the alias schema and longer document/task ids. The mapping prompt asks
for every clause to be considered against all rules, distinguishes explicit
compliance from hypothetical exceptions, and compares charges in like units.
Quote rejection logs contain only claimed ids, rule ids, and matching ids
within the batch, never lease text. The max-40 packing guard is unchanged.
The previous failed runs remain evidence; this candidate requires its own
live smoke and eval before readiness can change.

Candidate 1 (`7217cc8`) matched baseline: 8/8 plants, zero false positives on
both clean variants, 158/158 citations, and short smoke 5/5. Its long leases
took 330/348/310 seconds with 47/51/52 informational findings, so it retained
less of the speed gain than intended. Candidate 2 keeps the same max-40
packing and opaque IDs, but separates exhaustive review from selective
reporting: omit routine compliant clauses while retaining every supported
violation or concrete ambiguity. Numeric comparisons explicitly preserve
multipliers when prorating monthly charges. Each candidate has its own
recorded live runs; no run is discarded to seek a passing result.
