# Eval results

<!-- Generated from saved, sequential scoped eval outputs for S5 candidate a4b68fa. -->

**PASS** for lease-synthetic, clauses-golden, and citations. Language parity was not run.

Measured 2026-10-25 on the default 26B mapper and 31B verifier, without fallback. The two datasets ran sequentially via the 1Password wrapper. Full experiment history, commands, and integration evidence: [S5 batching](s5-batching.md).

| Set | Metric | Result |
| --- | --- | --- |
| lease-synthetic | Planted findings | 8/8 |
| lease-synthetic | Recall / precision | 100% / 100% |
| lease-synthetic | False positives on both clean variants | 0 |
| clauses-golden | Recall / precision | 100% / 100% |
| clauses-golden | Verifier agrees on violations | 40/40 |
| citations | Combined findings that resolve | 141/141 (100%) |

## Lease runs

| Lease | Status | Calls | Seconds | TP | FP | FN |
| --- | --- | --- | --- | --- | --- | --- |
| planted | analyzed | 7 | 176 | 8 | 0 | 0 |
| clean | analyzed | 7 | 245 | 0 | 0 | 0 |
| clean-alt | analyzed | 7 | 191 | 0 | 0 | 0 |

## Per-rule lease scoring

| Rule | TP | FP | FN |
| --- | --- | --- | --- |
| VA_DEPOSIT_CAP | 1 | 0 | 0 |
| VA_LANDLORD_MAINTAIN_FIT | 1 | 0 | 0 |
| VA_LATE_FEE_CAP | 1 | 0 | 0 |
| VA_NO_CONFESSION_OF_JUDGMENT | 1 | 0 | 0 |
| VA_NO_EXCULPATION_INDEMNITY | 1 | 0 | 0 |
| VA_NO_LANDLORD_ATTORNEY_FEES | 1 | 0 | 0 |
| VA_NO_RIGHTS_WAIVER | 1 | 0 | 0 |
| VA_ROUTINE_MAINTENANCE_NOTICE_72H | 1 | 0 | 0 |

## Output and retry evidence

The three-lease run had one HTTP 429 and no invalid outputs. The separate golden run had one HTTP 429 and one invalid mapping answer, which succeeded on retry. Its 930 reported output tokens and zero reported thinking tokens were below the cap; provider finish reasons are not retained, so its failure type cannot be conclusively called truncation. Both scoped eval commands exited 0.

The short synthetic smoke separately passed all five semantic plants plus three deterministic plants in 108 seconds, with one S5 request and no waits or invalid outputs. The integrated strict HTTP/SSE proof retained the same plants in 112 seconds, also with one S5 request, no waits, and no invalid outputs.

The initial packed failure and first repair were not discarded: their outcomes and source revisions are listed in [the experiment ledger](s5-batching.md#complete-experiment-ledger).

Source JSON: `eval/out/110-live/candidate2/eval.json`, `golden.json`, and `combined-citations.json` (gitignored). The combined citation check was rerun against the integrated dev rule pack; it made no model calls.
