# Eval results

<!-- Written by `pnpm eval` (eval/runners/eval.ts). Do not edit by hand. -->

The lease eval sets (spec §12, #20), run against the real model. How to run them and what each set means: `docs/ai-pipeline.md`, "Lease eval sets".

**PASS**

Run 2026-10-25, 25.1 min. Models that answered: gemma-4-26b-a4b-it, gemma-4-31b-it. Output modes: extraction json, mapping json, verification json, explanation json.

| Set | Metric | Result | Gate |
| --- | --- | --- | --- |
| `lease-synthetic` | Recall | 100.0% (8/8) | >= 0.9 pass |
| `lease-synthetic` | Precision | 100.0% (8/8) | >= 0.85 pass |
| `lease-synthetic` | Severity accuracy | 100.0% (8/8) | report |
| `clauses-golden` | Recall | 100.0% | report |
| `clauses-golden` | Precision | 100.0% | report |
| `clauses-golden` | Verifier agrees on violations | 40/40 | report |
| `clauses-golden` | Verifier agrees on look-alikes | 0/0 | report |
| `citations` | Findings that resolve | 100.0% (136/136) | 100% pass |

### lease-synthetic

| Lease | Status | Calls | Seconds | Unverified | TP | FP | FN |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `planted` | analyzed | 10 | 413 | 0 | 8 | 0 | 0 |
| `clean` | analyzed | 10 | 362 | 0 | 0 | 0 | 0 |
| `clean-alt` | analyzed | 10 | 316 | 0 | 0 | 0 | 0 |

| Rule | TP | FP | FN |
| --- | --- | --- | --- |
| `VA_DEPOSIT_CAP` | 1 | 0 | 0 |
| `VA_LANDLORD_MAINTAIN_FIT` | 1 | 0 | 0 |
| `VA_LATE_FEE_CAP` | 1 | 0 | 0 |
| `VA_NO_CONFESSION_OF_JUDGMENT` | 1 | 0 | 0 |
| `VA_NO_EXCULPATION_INDEMNITY` | 1 | 0 | 0 |
| `VA_NO_LANDLORD_ATTORNEY_FEES` | 1 | 0 | 0 |
| `VA_NO_RIGHTS_WAIVER` | 1 | 0 | 0 |
| `VA_ROUTINE_MAINTENANCE_NOTICE_72H` | 1 | 0 | 0 |


### clauses-golden

60 excerpts, 7 calls, 2 S6 or S7 drops.

| Rule | TP | FN | FP | TN |
| --- | --- | --- | --- | --- |
| `VA_ABUSE_VICTIM_EARLY_TERMINATION` | 2 | 0 | 0 | 1 |
| `VA_ABUSE_VICTIM_NO_LIQUIDATED_DAMAGES` | 2 | 0 | 0 | 1 |
| `VA_CASUALTY_TERMINATION` | 2 | 0 | 0 | 1 |
| `VA_ENTRY_NOTICE_REASONABLE_TIMES` | 2 | 0 | 0 | 1 |
| `VA_HOLDOVER_PENALTY_CAP` | 2 | 0 | 0 | 1 |
| `VA_LANDLORD_MAINTAIN_FIT` | 2 | 0 | 0 | 1 |
| `VA_MILITARY_EARLY_TERMINATION` | 2 | 0 | 0 | 1 |
| `VA_MILITARY_NO_LIQUIDATED_DAMAGES` | 2 | 0 | 0 | 1 |
| `VA_MITIGATE_NO_ACCELERATED_RENT` | 2 | 0 | 0 | 1 |
| `VA_NO_CONFESSION_OF_JUDGMENT` | 2 | 0 | 0 | 1 |
| `VA_NO_EXCULPATION_INDEMNITY` | 2 | 0 | 0 | 1 |
| `VA_NO_LANDLORD_ATTORNEY_FEES` | 2 | 0 | 0 | 1 |
| `VA_NO_REPAIR_FEES` | 2 | 0 | 0 | 1 |
| `VA_NO_RETALIATION` | 2 | 0 | 0 | 1 |
| `VA_NO_RIGHTS_WAIVER` | 2 | 0 | 0 | 1 |
| `VA_NO_SELF_HELP_EVICTION` | 2 | 0 | 0 | 1 |
| `VA_NO_UNILATERAL_CHANGE` | 2 | 0 | 0 | 1 |
| `VA_PAYMENT_PROCESSING_FEE` | 2 | 0 | 0 | 1 |
| `VA_RENEWAL_NOTICE` | 2 | 0 | 0 | 1 |
| `VA_RULE_CHANGES_NEED_CONSENT` | 2 | 0 | 0 | 1 |

