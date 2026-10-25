# S5 packed mapping (#110)

`planBatches` fills each batch in lease order to 12,000 estimated input
tokens. The estimate includes the rule instruction, document rule, JSON
schema, escaped document framing, and clause ids in the task. It also stops
at 40 clauses so the 400 output tokens per clause fit the 16,384-token
output ceiling. An oversized clause still goes alone, unchanged.

## Live acceptance result: FAIL (2026-10-25)

PR #118 must remain draft. Packing met the single-request and no-wait
criterion, but lost planted findings. No language parity work was run.
All live commands used `op run --env-file ~/.config/fineprint/.env --`
without printing the key. Runs were sequential, on Linux, using the default
26B mapper and 31B verifier with no fallback.

Baseline: `73f6ea5c2a88c2344bd0f8ab98a1b5e6d2a464fd`, full `pnpm eval`,
25.5 minutes, exit 0. Packed: `a02776831120a2bb4cc55a944cee46db44dc7ae3`,
full `pnpm eval`, 17.8 minutes, exit 1. These are one measured run per
revision, not a statistical claim about every model response.

| Metric | Baseline | Packed |
| --- | --- | --- |
| Planted findings retained | 8/8 | 7/8 |
| Lease-synthetic recall | 100% | 87.5%, fails the 90% gate |
| Lease-synthetic precision | 100% | 87.5% |
| Clean / clean-alt false positives | 0 / 0 | 0 / 1 |
| Golden excerpt recall / precision | 100% / 100% | 100% / 100% |
| Citations | 137/137 | 107/107 |
| S5 successful calls per long eval lease | 6 | 3 |
| Full-run HTTP 429 records | 18 | 5 |
| Full-run invalid S5 answers | 1 | 1 |

Packed omitted `VA_LANDLORD_MAINTAIN_FIT` on the planted lease's
`21. MAINTENANCE AND REPAIRS.` section. Baseline found that same rule and
section; the comparison used rule/heading pairs, not just aggregate recall.
Packed also flagged `VA_HOLDOVER_PENALTY_CAP` as `ask` on clean-alt's
`69. HOLDING OVER.` section, scored as a false positive by the existing eval.
The scoring rules, statutes, and prompts were unchanged for the comparison.

| Long eval lease | Seconds, baseline / packed | Successful calls | Input tokens |
| --- | --- | --- | --- |
| planted | 309 / 225 | 11 / 7 | 52,101 / 33,497 |
| clean | 366 / 263 | 10 / 7 | 51,320 / 33,498 |
| clean-alt | 509 / 220 | 10 / 7 | 50,981 / 34,816 |

## Single-lease timing and output caps

`pnpm smoke:lease --packed-single` ran the short synthetic fixture in a
fresh quota window: 87 seconds, five calls, 12,005 input tokens, one S5
request (7,648 input / 726 output / zero reported thinking tokens), no
limiter waits, no invalid outputs. S2 resolved 32 clauses, so S5's output
cap was 12,800 tokens. The smoke exited 1: only two of five semantic plants
survived, plus all three deterministic plants. Rights waiver, confession of
judgment, and attorney fees were missed; S6 dropped three mappings for
`lease_quote_not_in_clause`. The quote verification gate stayed intact.

The separate HTTP/SSE timing proof passed with exit 0: smoke and the English
live lease stream test in one run, two tests passed. The lease stream took
89 seconds, with one S5 request (7,634 input / 955 output / zero reported
thinking tokens), zero wait/error events, and zero invalid outputs. This
proves timing and valid responses for that run; the stream test checks the
three deterministic plants, not every semantic plant.

No invalid answer occurred in either isolated single-lease run. The full
packed eval had one invalid S5 response with 1,126 output tokens and zero
reported thinking tokens, well below the output ceiling; it succeeded on
retry. The baseline invalid answer used 151 output plus 5,842 thinking
tokens, close to its approximately 6K batch cap. The client does not retain
provider finish reasons, so these counters alone cannot conclusively
classify invalid answers as truncation. They do not establish a general
no-truncation guarantee for all larger batches.

## Reproduce

Use the secret manager to supply `GEMINI_API_KEY`; never put the value in a
command, test, report, or chat. Run baseline and packed evals sequentially
with the same model configuration:

```sh
op run --env-file ~/.config/fineprint/.env -- pnpm eval
# Preserve eval/out/eval.json for each revision.
cd server
op run --env-file ~/.config/fineprint/.env -- pnpm smoke:lease --packed-single
```

For the strict HTTP timing proof, allow a fresh quota window and run from
`e2e/`:

```sh
E2E_PACKED_LEASE_TIMING=1 op run --env-file ~/.config/fineprint/.env -- \
  pnpm exec e2e run tests/web/smoke.e2e.ts tests/web/leases.e2e.ts \
  --target web --grep 'the server is up|live: curl receives' --no-cache \
  --output .e2e/proof/110-packed-live-http --reporter list,markdown
```

The measured HTTP run used a local config derived from `e2e.config.ts` with
isolated emulator ports (Auth 19110, Firestore 18110, Storage 19210) because
another worktree owned the defaults. Set `E2E_FIRESTORE_EMULATOR_HOST` to
match the isolated Firestore endpoint when overriding the emulator config.

Raw evidence is gitignored under `eval/out/110-live/` (baseline/packed JSON,
logs, copied reports, smoke output, and HTTP/server logs) and
`e2e/.e2e/proof/110-packed-live-http/`. The generated packed result is
checked in at `docs/eval-results.md`.

## Regression verification

Before integrating main: 439 unit tests, typecheck, lint, and jurisdiction
checks passed. The full web gate passed with 35 tests and two live skips.
After adding strict timing assertions, smoke plus all lease-route and packed
mapping tests passed together on isolated emulators: six passed, two live
skips, exit 0 (`.e2e/proof/110-live-regression-isolated/`). A separate live
smoke-plus-stream run passed both selected tests with exit 0 as recorded
above. Post-integration verification is recorded in the PR evidence.
