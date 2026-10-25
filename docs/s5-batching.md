# S5 packed mapping (#110)

## Selected implementation and result

Accuracy repair candidate 2 (`a4b68fa`) matched the measured baseline:
8/8 planted findings, zero false positives on both clean variants, short
smoke 5/5 semantic plants, and 141/141 citations across lease-synthetic and
clauses-golden. The three long leases took 612 seconds total versus the
baseline's 1,184 seconds, a measured 48.3% reduction. These are single runs
per revision, not a statistical latency or accuracy guarantee.

S5 still packs in lease order to 12,000 estimated input tokens, including
the rule instruction, document rule, JSON schema, escaped framing, and task
ids. At most 40 clauses preserve the 400-token-per-clause output allowance
within the shared 16,384-token ceiling. An oversized individual clause
retains the previous send-alone behavior. Mapping stays on 26B, with 31B
verification; no fallback answered any recorded run.

The accuracy fix addresses the model boundary:

- S5 gets opaque batch-local document ids such as `mapping_AA`, unrelated
  to the section numbers printed in lease text. Its schema enumerates only
  the ids present in that batch.
- A trusted alias table restores public `cN` ids before S6. Public clause
  ids, quote offsets, storage, and response schemas remain unchanged.
- The prompt asks for every clause and rule to be considered, but routine
  compliance need not be reported. It distinguishes blanket duties from
  supported exceptions, requires a concrete ambiguity for `unclear`, and
  compares charges in matching units while retaining multipliers.
- S6 still rejects a quote outside its assigned clause. It never searches
  another clause to repair a finding. Rejection diagnostics log only ids
  and rule ids, including any other matching ids within the same batch.

The original short smoke lost three findings at S6 after model claims paired
quotes with the wrong clauses. Segmentation can make `cN` differ from the
printed section number; the old logs cannot prove that every mismatch was
caused by that confusion. Both repaired candidates had zero quote-rejection
records, retained all semantic plants, and kept the rejection gate intact.
The original missing HVAC finding and clean-alt holdover false positive
were absent in both repaired candidates. Rules, statutes, scoring thresholds,
and severity logic were not weakened.

## Complete experiment ledger

All live commands used `op run --env-file ~/.config/fineprint/.env --`.
The key was never printed. Runs were sequential on Linux. No parity API
calls were made. Each candidate was run once per selected dataset; no
failed result was discarded to seek a passing sample.

The following table covers the three-lease `lease-synthetic` phase only.
Input is provider-reported prompt tokens from all attempts, including
triage and invalid answers, rather than the pipeline counter that omits
triage. Rate-limit errors have no reported prompt count.

| Revision | Plants | Clean / clean-alt FP | Seconds (planted / clean / clean-alt) | Total seconds | Recorded input | 429s | Invalid S5 answers |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Baseline `73f6ea5` | 8/8 | 0 / 0 | 309 / 366 / 509 | 1,184 | 167,861 | 17 | 1 |
| Original packed `a027768` | 7/8 | 0 / 1 | 225 / 263 / 220 | 708 | 117,873 | 4 | 1 |
| Candidate 1 `7217cc8` | 8/8 | 0 / 0 | 330 / 348 / 310 | 988 | 136,166 | 3 | 1 |
| Candidate 2 `a4b68fa` | 8/8 | 0 / 0 | 176 / 245 / 191 | 612 | 116,699 | 1 | 0 |

Original packed missed `VA_LANDLORD_MAINTAIN_FIT` on planted section
`21. MAINTENANCE AND REPAIRS.` and flagged `VA_HOLDOVER_PENALTY_CAP` on
clean-alt section `69. HOLDING OVER.`. Its recall and precision were 87.5%.
[The original failed report](https://github.com/max-miller1204/FinePrint/blob/87531ba/docs/eval-results.md)
is retained in commit history and in the raw artifacts.

Candidate 1 introduced opaque ids and exhaustive review, matching accuracy
but emitting 47/51/52 informational findings. Candidate 2 explicitly separated
review from reporting and qualified the proration guidance, retaining the
same max-40 guard. It reported 3/49/23 informational findings; reporting
volume remains model-dependent. Its recorded input was 30.5% below baseline.
Successful S5 calls per long lease fell from six to three.

| Short synthetic smoke | Semantic plants | Seconds | S5 calls | Waits / invalid outputs | Exit |
| --- | --- | --- | --- | --- | --- |
| Original packed | 2/5 | 87 | 1 | 0 / 0 | 1 |
| Candidate 1 | 5/5 | 115 | 1 | 0 / 0 | 0 |
| Candidate 2 | 5/5 | 108 | 1 | 0 / 0 | 0 |

Every short smoke also retained all three deterministic plants. Original
packed lost rights waiver, confession of judgment, and attorney fees after
three `lease_quote_not_in_clause` drops. Neither repaired smoke rejected a
quote. Candidate 2 resolved 31 clauses, with a 12,400-token S5 output cap;
its S5 used 8,046 input / 1,156 output / zero reported thinking tokens.

## Golden, citations, and integrated HTTP proof

Candidate 2's separate golden run passed 100% recall and precision across
60 excerpts, with the verifier agreeing on all 40 violations. It resolved
58/58 citations; lease-synthetic resolved 83/83. Rechecking the union against
the integrated dev rule pack resolved 141/141. Golden mapping retained its
historical ten-excerpt batches. One golden answer was invalid (930 output,
zero reported thinking tokens), succeeded on retry, and encountered one
429. Both incidents are retained; they are separate from the zero-invalid
three-lease run. Provider finish reasons are not retained, so invalid
answers cannot conclusively be classified as truncation from counters alone.
No isolated short smoke or HTTP response was invalid or near its output cap.

After integrating dev at `e7f24d7`, strict live HTTP/SSE plus smoke passed
with exit 0, two tests in one run. The stream took 112 seconds, made one
S5 request (8,046 input / 965 output / zero reported thinking tokens), and
had zero wait/error events and zero invalid outputs. It now asserts all
five semantic plants on their actual clauses, plus the existing three
deterministic plants. A fast valid stream alone cannot satisfy this proof.

## Integration and regression gate

Merged `origin/dev` at `e7f24d75b71b27c9d629eb0651291d393d6d3348`.
The lease e2e host conflict was resolved by preserving dev's
`E2E_WEB_FIRESTORE_HOST` / `E2E_FIRESTORE_PORT` options and this branch's
`E2E_FIRESTORE_EMULATOR_HOST` fallback. The strict semantic and timing checks
remain intact. Dev's Ask and impact functionality was preserved.

Post-integration: 489 unit tests passed; typecheck, lint (warnings only), and
jurisdiction validation exited 0. The full web gate passed in one run:
18 files, 67 tests passed, two live-model skips, exit 0. It includes smoke,
every affected lease test, packed mapping, and dev's other web features.
Evidence: `.e2e/proof/110-accuracy-repair-final/` and
`.e2e/proof/110-repaired-live-http/` under `e2e/`.

The feature map is updated with this evidence. The PR is ready for review
and targets `dev`; the separate integration thread owns any eventual merge.
This work does not merge the PR.

## Reproduce without running language parity

```sh
op run --env-file ~/.config/fineprint/.env -- pnpm eval --only lease-synthetic
# Preserve eval/out/eval.json before the next run.
op run --env-file ~/.config/fineprint/.env -- pnpm eval --only clauses-golden
op run --env-file ~/.config/fineprint/.env -- pnpm --filter @fineprint/server smoke:lease --packed-single
```

Allow a fresh quota window before an isolated short-lease timing run.
From `e2e/`:

```sh
E2E_PACKED_LEASE_TIMING=1 op run --env-file ~/.config/fineprint/.env -- \
  pnpm exec e2e run tests/web/smoke.e2e.ts tests/web/leases.e2e.ts \
  --target web --grep 'the server is up|live: curl receives' --no-cache \
  --output .e2e/proof/110-repaired-live-http --reporter list,markdown

# Run separately without credentials for the complete deterministic web gate:
pnpm exec e2e run tests/web --target web --exclude-tag bugbash --no-cache \
  --output .e2e/proof/110-accuracy-repair-final --reporter list,markdown
```

Baseline/original packed outputs and logs are preserved under the gitignored
`eval/out/110-live/`. Each repaired candidate has its own subdirectory with
its smoke and eval logs/JSON. Candidate 2 also contains golden, combined
citations, integrated HTTP, and final e2e evidence. The combined citation
check uses the existing `checkCitations` implementation and makes no API call.
