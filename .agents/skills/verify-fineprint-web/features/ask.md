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
