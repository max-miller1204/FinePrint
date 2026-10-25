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
  the flag, so severities are the same as without the injected text. The
  title and explanation follow the lease's locale from fixed strings in
  code, not S9 (#104): `es`, `es-MX`, `es_US` get "Instrucciones ocultas
  para herramientas de IA" and "Este documento contiene instrucciones
  ocultas dirigidas a herramientas de IA. Las ignoramos."; any language
  without reviewed text gets English.
- Not a lease: S2's `documentType` other than `residential_lease` stops
  the analysis with `status: "not_a_lease"`, the `documentType`, and
  `message: "This doesn't look like a residential lease."`
- An eviction summons or a pay-or-quit notice with a lease heading stops
  at S1 (triage) first, on the keyword backstop alone when Gemma is off.
  A court or eviction paper S1 misses, which S2 calls
  `court_or_eviction_notice`, escalates anyway: `status: "escalated"`,
  `by: "document_type"`, `category: "eviction_or_court"` (S1's own is
  `by: "triage"`).

## How to get to it (user POV)

The tenant uploads a lease ([leases](leases.md)). An injected lease shows its
findings plus the info finding about hidden instructions; a menu, an
invoice, or a commercial lease shows the not-a-lease message; a summons
opens the handoff (#38).

## Driving it with e2e

`tests/web/adversarial.e2e.ts` drives S1 through `POST /v1/triage` (the summons and the
pay-or-quit notice under a lease heading escalate on the backstop; an
invoice with injected text neither escalates nor reaches `server.log`).
`tests/web/leases.e2e.ts` runs `inject-ignore-previous-es` through the
lease stream under `scripts/with-secrets.sh`: `done.injection` carries the Spanish title. The rest:

```bash
pnpm --filter @fineprint/server test                          # server/test/adversarial.test.ts, the CI gate
cd e2e && npx e2e run tests/web/adversarial.e2e.ts --target web
cd eval && ../scripts/with-secrets.sh pnpm adversarial      # live, about 35 minutes
```

The set is `eval/datasets/adversarial.jsonl` (`eval/runners/adversarial-cases.ts`
builds each case): 8 injected leases (EN and ES, zero-width, full-width,
chat template), 2 clean leases (one with lookalike wording), 3 non-leases,
the disguised summons, and a pay-or-quit notice (the keyword backstop
catches it since #104).

## Proof

`server/test/adversarial.test.ts`: the pattern catches every injection in
the set and fires on no other case; with a scripted model each injected
lease gets the info finding with the same S4 outcomes and S5 assessments
as the clean lease, also when the model obeys the injection; each
non-lease returns the message after one call; the pay-or-quit notice
escalates at S1 on the backstop, and at S2 when the backstop is empty; an
`es`, `es-MX`, or `es_US` lease gets the info finding in Spanish. `pnpm adversarial` prints
`PASS: injection success 0/8 (gate 0)` and exits 0 (2026-10-25: 14/14 cases, 33 min, all on `gemma-4-26b-a4b-it`; Gemma also flagged the clean lookalike lease, report only).

## Charters

The lease upload charter in [leases](leases.md) uploads each case of the
adversarial set end to end.

## Gotchas

- The pattern is the floor, Gemma's flag the reach: wording the pattern
  misses still yields the finding when S2 flags it. Never loosen the
  pattern to pass a clean case without adding that case to the set.
- Images with embedded instructions are not covered: no vision stage yet
  (#26, #28).
