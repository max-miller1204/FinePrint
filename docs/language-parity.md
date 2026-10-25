# Language parity eval (#45, server half)

`pnpm eval --only parity` runs 20 matched lease cases in English, Spanish,
and French (60 independent production S1 to S9 analyses). It uses the real
triage, mapping, independent verifier, severity table, English explanation,
and final translation. It does not translate a verdict back for a model to
judge. No iOS localization or web report layout changes are included.

## Run

```bash
pnpm install --frozen-lockfile
pnpm eval --only parity --check  # validate fixtures and rule IDs, no model
# Set GEMINI_API_KEY through your secret manager, never in source or chat.
op run --env-file ~/.config/fineprint/.env -- pnpm eval --only parity
```

The Gemini API needs quota for the primary and verifier Gemma models
(`GEMMA_PRIMARY` and `GEMMA_VERIFIER`, defaults in `server/src/ai/models.ts`).
The existing `GEMMA_PROVIDER=openai_compatible` configuration also works;
see `docs/ai-pipeline.md` for its endpoint and credential setup. Records
include the answering models and fallback use. A fallback result needs that
qualification when reporting Gemma parity.

This is 60 complete analyses, not 60 model calls. Runs are sequential and
share the client's quota limiter. Allow hours on a 16K input-token/minute
quota. Avoid running other evals with the same project's quota concurrently.

Exit codes: 0 passes every gate; 1 means failed quality, missing translation,
or unavailable analysis; 2 means setup failure (including a missing key).
`--check` prints `live model NOT run`; it cannot establish parity.

A live run writes `eval/out/eval.json` (gitignored), including every
analysis, translation, per-case result, citation failures, usage and models.
A partial `--only parity` run preserves the historical `docs/eval-results.md`.
A full `pnpm eval` now includes parity and rewrites that report. Never cite
an old report as evidence for this new dataset. Keep the JSON for human QA.

## Cases and gates

`eval/datasets/parity.jsonl` has ten violations and ten compliant look-alikes
from `clauses-golden`: retaliation, entry, military termination fees, repair
fees, unilateral amendments, rights waivers, confession of judgment,
exculpation, attorney fees, and habitability repairs. EN is copied from the
golden fixture. ES and FR are authored translations awaiting human review.
All languages use the same fixed lease term, November 2026 through October
2027, and the original DHCD statement name. Statutes and the verified rule
pack control expectations. For example, `VA_LANDLORD_MAINTAIN_FIT` is capped
at `ask` by the pack even when both models see a violation.

Each case passes parity only if all three analyses finish and every finding
has the same rule ID, severity, primary assessment, and verifier verdict.
The comparison ignores prose, model identity, order, clause IDs and finding
IDs, but retains multiplicity and extra findings, including informational
findings. Quotes are compared to each language's source, not across languages.

Gates:

- At least 19/20 cases (95%) have identical verdicts and severities across
  all three languages, using the full denominator even after a failure.
- At least 19/20 cases have the expected target-rule outcome in all three
  languages. Equal wrong answers cannot pass. A clean case permits no
  target finding, or only `info` with `complies`; violations require the
  expected severity, `violates`, and independent verifier `agree`.
- All 60 analyses complete without missing verifier answers or S9 drops.
  All ES/FR findings have nonempty translated title, explanation and action.
  English fallback text does not count as a successful translation.
- Every lease quote resolves at its source span and every statute quote
  resolves verbatim in the verified snapshot (the existing 100% citations
  gate). S9 separately guards quoted phrases embedded in prose.

Translation coverage is mechanical. It cannot establish fluency, correct
language, preservation of negation, numbers, legal qualifications, or safe
action wording. The current pipeline keeps legal fields outside S9; this
change adds no pipeline behavior based on unmeasured live failures.

## Human Spanish QA checklist

Before claiming Spanish parity or QA approval, a fluent Spanish reviewer
with access to the English cases and rule pack must:

- Review all 20 ES input clauses against EN, including the ten compliant
  look-alikes. Preserve actors, obligations, exceptions, negation, notice
  windows, amounts, percentages and legal references. Correct the fixtures
  before using them as a release benchmark.
- Review every ES title, explanation and action in the live JSON. Confirm
  natural, plain Spanish and faithful meaning, with no omitted finding,
  new legal claim, stronger certainty or changed recommendation.
- Check `ask` versus `unenforceable`, verifier disagreement and uncertainty,
  and the habitability rule's `ask` cap. No translation may imply a more
  certain legal result than the verified English finding.
- Check every amount, percentage, time, date, citation and quoted phrase.
  Lease quotes must remain verbatim Spanish from the input; statute quotes
  must remain verbatim English from the snapshot, with the same source URL.
- Confirm safe action wording, including no advice to withhold rent or skip
  court, and distinguish landlord duties from tenant-caused damage.
- Record corrections and sign-off with the run date, model IDs, fallback
  use, and case IDs. Have a French reviewer validate FR fixture equivalence
  and output meaning before claiming third-language quality.

UI strings, long Spanish layout checks and iOS localization belong to the
other half of #45. This PR must use `Refs #45` and leave the issue open.
