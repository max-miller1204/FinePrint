# S5 packed mapping (#110)

`planBatches` fills each batch in lease order to 12,000 estimated input
tokens. The estimate includes the rule instruction, document rule, JSON
schema, escaped document framing, and clause ids in the task. It also stops
at 40 clauses so the 400 output tokens per clause fit the 16,384-token
output ceiling. An oversized clause still goes alone, unchanged.

The 31-clause synthetic fixture now takes one S5 request instead of four;
its output cap is 12,400 tokens. Mapping stays on 26B and verification on
31B. The scripted pipeline retains all eight expected findings. The
HTTP/SSE proof uses a scripted model and in-memory storage; the rest of the
web suite covers Firebase emulators. Neither proves real model accuracy,
answer truncation, or quota timing.

## Live merge checks

Pending: this Linux session has no `GEMINI_API_KEY`. Both the eval and live
smoke runner stop with setup exit 2. Supply the variable through your secret
manager, with Gemma quota available. Do not put the key in commands, test
files, reports, or chat. Keep the PR in draft until these checks pass.

Compare the #20 eval on baseline commit
`73f6ea5c2a88c2344bd0f8ab98a1b5e6d2a464fd` and this branch, using the same
model configuration. Use a separate baseline worktree and install its
locked dependencies. Run sequentially, without other worktrees consuming
that project's quota:

```sh
# In each checkout, with GEMINI_API_KEY supplied by the secret manager:
pnpm eval
# Preserve out/eval.json from each checkout as baseline and packed evidence.
```

Require no lost planted findings: compare `lease.scores[].missed` and the
flagged rule/heading pairs in the two JSON reports, not just aggregate
recall. The packed result must also pass recall >= 0.9, precision >= 0.85,
and the 100% citations gate. The clauses-golden benchmark deliberately keeps
its historical ten-excerpt batches; lease-synthetic exercises the production
planner. Do not overwrite the checked-in eval report with an incomplete run.

After the evals, allow a fresh quota window and run:

```sh
cd server
pnpm smoke:lease --packed-single
```

This runs one English synthetic lease, prints elapsed seconds and token
counts, and fails unless all plants survive, S5 is one successful request,
no limiter wait event occurs, and no stage has invalid output. Preserve the
output as live evidence. To check the actual HTTP stream too, run only the
English `live: curl receives stage, keyterms, finding, and done in order`
test in `e2e/tests/web/leases.e2e.ts` under a fresh quota window, and confirm
its stream has no `RATE_LIMITED` events. That existing live test permits
waits because the full suite may share quota; the single-lease timing
criterion needs this separate inspection.

## Local verification (2026-10-25, Linux)

- `pnpm test`: 439 tests passed, exit 0.
- `pnpm typecheck`, `pnpm lint`, `pnpm check:jurisdictions`: exit 0.
  Lint reports warnings, no errors.
- From `e2e/`: `pnpm exec e2e run tests/web --target web --exclude-tag bugbash --no-cache --output .e2e/proof/110-pack-s5-final --reporter list,markdown`:
  35 passed, two live-model tests skipped, exit 0 in one run. This includes
  smoke, the lease routes, and the new packed mapping HTTP/SSE proof.
- Live eval and `smoke:lease --packed-single`: setup exit 2, missing
  `GEMINI_API_KEY`; no live timing or accuracy result is claimed.
