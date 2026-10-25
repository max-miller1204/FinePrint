# Grounded Ask

POST `/v1/rentals/:id/ask`: owner authentication, message/history bounds, triage,
read-only native function calls, four tool executions, per-sentence citation gate,
legal-aid handoff, no persisted conversation.

Run `pnpm exec e2e run --config e2e.ask.config.ts --target web --output .e2e/proof/ask`
from `e2e/`. Smoke, Ask, auth, rentals and triage run together. A deterministic
HTTP provider fixture exercises the real model transport without quota. Separate
emulator ports are declared in `firebase.ask.json`. Live model quality is checked
by `pnpm --filter @fineprint/eval ask` under the secret-manager environment.

Merge verification against `origin/main` at `f8f63d0`: smoke, Ask, auth, rentals
and triage passed together (18 tests, exit 0); proof output
`e2e/.e2e/proof/ask-main-merge/`. Shared Gemma stage tests retain both
Responsibility and Ask JSON routing.

Expected: only citations from this request's executed tools appear. Uncited,
invented, stale and mixed citations do not render. High-stakes input escalates
before Ask, unrelated questions hand off, foreign rentals return 403, seven
history turns return 400. Logs hold metadata only.

ask|web|skeptic|Try to cite a different rental, inject instructions in history, invent a rule ID, send seven turns, and ask a high-stakes question. Prove no unauthorized or uncited content survives and no conversation is persisted.

See `docs/grounded-ask.md` for the contract, eval, limitations and TestFlight steps.

## Dev integration verification

Merged dev's sharing and accessibility changes. Preserved the Ask and report
feature entries, and both emulator-port configuration forms so the default and
isolated Ask suites remain usable. Ask configuration permits caller-provided
ports. Smoke, Ask, auth, rentals and triage passed together: 18 passed, exit 0,
no retries or cache. Proof: `e2e/.e2e/proof/dev-ask-sharing/`. Server unit tests:
484 passed; workspace typecheck: exit 0. iOS runtime acceptance uses TestFlight
from dev by @max-miller1204; no iOS test file was authored or edited.

After #122 merged, merged origin/dev again. Retained both Ask and impact in
the feature map and both sets of English strings in the validated string
catalog. Smoke, Ask, auth, rentals and triage passed together: 18 passed,
exit 0, no retries/cache; proof `e2e/.e2e/proof/dev-ask-impact/`. Server unit
tests: 486 passed; workspace typecheck: exit 0. The impact typed-error fix
and Share Links integration are preserved. macOS CI checks the combined app.

## Timeout and source-free answer recovery

Ask on iOS uses the existing 180-second model transport and keeps a labeled
progress indicator, wait explanation, and disabled composer while awaiting JSON.
Runtime acceptance is through TestFlight on a real device; no iOS e2e files changed.

The first model prompt requires a read-only tool. A source-free answer, including
premature outOfScope, is rejected and re-prompted once within the existing five-turn
budget. The strict sentence/citation gate remains unchanged. Each gate evaluation
logs request-correlated counts, fixed rejection reasons, source count, tool names,
and the model outOfScope flag, without question text, lease text, or citation refs.
Malformed-output handoffs retain the actual executed-tool metadata.

Proof: `e2e/.e2e/proof/ask-timeout-fallback/`, 18 passed together, exit 0,
no retries/cache: smoke, Ask (including direct-answer recovery), auth, rentals,
and triage. Server unit tests: 491 passed, including grounded output, both values
of premature outOfScope, bounded refusal, unrelated-question handoff, and malformed
output diagnostics. Workspace typecheck, lint, and jurisdiction checks exited 0.
Live Gemini/Gemma Ask through the real route and `scripts/with-secrets.sh`, using
a synthetic rental with an analyzed lease: HTTP 200 in 3,936 ms, one kept sentence
with the correct pet-deposit clause citation. Evidence is in
`e2e/.e2e/proof/ask-live-check.json` and `ask-live-check.log`.

Device acceptance: install the new dev TestFlight build, select a synced Virginia
rental with an analyzed lease, ask a specific clause question, and open its citation.
Repeat with a Virginia law question and an unrelated question. During a slow answer,
confirm the progress text remains visible and duplicate sends stay disabled beyond
20 seconds. Confirm the composer re-enables after completion or a network error.
