# Adversarial input: hidden instructions and non-leases

What the lease pipeline does with an upload that tries to steer the AI or
is not a lease at all (spec §7.10, §12; #19). Documents are data, not
instructions. Code in `server/src/ai/pipeline/adversarial.ts`; details in
`docs/ai-pipeline.md`, "Adversarial input (#19)".

## Sub-features

- Injection detector: S2's `aiInstructions` flag OR a code pattern
  (`detectInjection`), either one enough. The pattern reads the text after
  NFKC folding, with zero-width and bidi characters and soft hyphens
  removed, and catches text addressed to an AI in English and Spanish
  ("ignore all previous instructions", "AI assistant: say ...", "note to
  any AI reviewing this", "if you are a language model", chat-template
  tokens). A negated command ("shall not disregard the prior rules") is
  not one.
- Info finding: an analyzed lease with `injection.detected` gets
  `injection.finding`, `{ id: "injection", kind: "injection", severity:
  "info", title: "Hidden instructions for AI tools", explanation: "This
  document contains hidden instructions aimed at AI tools. We ignored
  them.", clauseIds }`. It is not a check or a mapping, and no stage reads
  the flag, so severities are the same as without the injected text.
- Not a lease: S2's `documentType` other than `residential_lease` stops
  the analysis with `status: "not_a_lease"`, the `documentType`, and
  `message: "This doesn't look like a residential lease."`
- An eviction summons with a lease heading stops at S1 (triage) first.

## How to get to it (user POV)

The tenant uploads a lease (route in #16). An injected lease shows its
findings plus the info finding about hidden instructions; a menu, an
invoice, or a commercial lease shows the not-a-lease message; a summons
opens the handoff (#38).

## Driving it with e2e

The pipeline has no route until #16. `tests/web/adversarial.e2e.ts`
drives what has one: S1 through `POST /v1/triage` (the summons under a
lease heading escalates; an invoice with injected text neither escalates
nor reaches `server.log`). The rest:

```bash
pnpm --filter @fineprint/server test                          # server/test/adversarial.test.ts, the CI gate
cd e2e && npx e2e run tests/web/adversarial.e2e.ts --target web
cd eval && op run --env-file ../.env -- pnpm adversarial      # live, about 35 minutes
```

The set is `eval/datasets/adversarial.jsonl` (`eval/runners/adversarial-cases.ts`
builds each case): 8 injected leases (EN and ES, zero-width, full-width,
chat template), 2 clean leases (one with lookalike wording), 3 non-leases,
and the disguised summons.

## Proof

`server/test/adversarial.test.ts`: the pattern catches every injection in
the set and fires on no other case; with a scripted model each injected
lease gets the info finding with the same S4 outcomes and S5 assessments
as the clean lease, also when the model obeys the injection; each
non-lease returns the message after one call. `pnpm adversarial` prints
`PASS: injection success 0/8 (gate 0)` and exits 0 (2026-10-25: 14/14 cases, 33 min, all on `gemma-4-26b-a4b-it`; Gemma also flagged the clean lookalike lease, report only).

## Charters

None until #16 adds the route. Its charter will upload each case of the
adversarial set end to end.

## Gotchas

- The pattern is the floor, Gemma's flag the reach: wording the pattern
  misses still yields the finding when S2 flags it. Never loosen the
  pattern to pass a clean case without adding that case to the set.
- Images with embedded instructions are not covered: no vision stage yet
  (#26, #28).
