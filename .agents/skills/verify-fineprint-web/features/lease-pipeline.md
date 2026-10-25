# Lease pipeline (S1 to S6)

The lease analysis behind F1 Lease Explainer (spec §4.3 F1, §7.3; #14):
triage, clause segmentation and key terms, quote resolution, deterministic
checks, rule mapping, and mechanical verification. Gemma interprets; code
verifies. No route of its own yet: `POST /v1/rentals/:id/leases` and the SSE
stream are #16, and S7 to S9 (verifier, severity, explanation, translation)
are #15. Details: `docs/ai-pipeline.md`, "Lease pipeline (#14)".

## Sub-features

- `analyzeLease(input, { gemma, pack, triage? }, { signal?, onEvent? })` in
  `server/src/ai/pipeline/lease.ts`. `input` is `{ leaseId, text, locale,
  term?, today? }` (the redacted text). Returns `status: "escalated"` with
  the triage decision, `"not_a_lease"` with the `documentType`, or
  `"analyzed"` with `term`, `clauses`, `keyTerms`, `checks`, `mappings`,
  `injection`, `drops`, and `usage`.
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
  about 10 clauses a call, every rule in force in the instruction, rule ids
  as an enum.
- S6: drops a mapping whose clause is not in its batch or whose quote is
  not in its clause, and rule ids that are unknown, not in force for the
  term, or already decided by S4.
- Budget: 8 calls or fewer (`MAX_CALLS`), no request over 12,000 estimated
  input tokens. Waits come from the client's limiter as `model` events
  wrapping `waiting`.
- Events: `stage` (S1 to S6, label, progress), `keyterms`, and `model`
  (the Gemma client's `waiting`, `retry`, `invalid_output`, `fallback`).
- Log: one `lease pipeline` line (status, counts, calls, tokens, term
  source), plus the client's `model call` lines and the `triage` line. No
  lease text.

## How to get to it (user POV)

Not reachable from a route yet. The tenant uploads a lease in the app (#16
adds the route); this runs behind it and the findings screen (#19) shows
the result after #15.

## Driving it with e2e

No e2e test until #16 adds the route. Unit tests cover it with a scripted
model (`server/test/lease-pipeline.test.ts`): S3 matching, clause cutting,
key term reading, S4 on the planted values, S6 drops, the full run on the
synthetic lease, escalation, a non-lease, injection, the term fallbacks,
and the call and token budget on a 12-page lease. The live check runs the
real model:

```bash
pnpm --filter @fineprint/server test
cd server && op run --env-file ../.env -- pnpm smoke:lease
```

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

## Charters

None until #16 adds the route. Its charter will cover document injection
and non-lease uploads end to end.

## Gotchas

- Gemma's 16K input tokens a minute: one lease is about 15K, so a second
  lease in the same minute waits for a 429 retry (about a minute).
- `schema` mode loops on these stages (`docs/ai-pipeline.md`, gap 7); keep
  them on `json`.
- `VA_TENANT_RIGHTS_STATEMENT` asks whether the lease mentions the DHCD
  statement. S6 needs a quote, so a lease that never mentions it gets no
  mapping; an absence check belongs in code (#15 or later).
- A key term written only in words with no unit ("five") or as a bare
  number is dropped, never guessed: the check then reports
  `insufficient_input`.
