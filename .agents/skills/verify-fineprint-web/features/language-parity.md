# Language parity (server eval, #45)

An operator runs `pnpm eval --only parity` to compare the production lease
pipeline across 20 EN/ES/FR cases. See `docs/language-parity.md` for the
95% parity and correctness gates, 100% translation and citation gates,
credentials, runtime, evidence and exact human Spanish QA checklist.

## Drive and proof

From `e2e/`:

```bash
pnpm exec e2e run --target web --retries 0 --output .e2e/proof/spanish-parity --reporter list,markdown
```

`parity.e2e.ts` launches the real operator CLI: dataset validation exits 0
without credentials, and a live invocation without `GEMINI_API_KEY` exits
2 with an actionable error. `leases.e2e.ts` exercises HTTP/SSE behavior.
`server/test/parity-eval.test.ts` covers dataset alignment, wrong-answer
agreement, missing/duplicate/outage runs, translation coverage, extra
findings, verdict mismatch and the exact 19/20 threshold.

2026-10-25 on Linux: the full web run exited 0, 36 passed, 2 skipped
across 11 files (run `01a172ac-16d8-7a0f-b8e7-73effaf9fcf6`). The
skips are the existing live Gemma lease tests. Server tests: 443 passed.
Live parity has NOT been measured: `GEMINI_API_KEY` was unset. A green
credential-free run is evidence of runnable eval machinery and server
regression coverage, not of 95% model parity or Spanish semantic quality.

## Charter

language-parity|web|skeptic|Validate all 20 Spanish clauses against English, run the live parity eval with Gemma quota, inspect mismatched verdict signatures and missing translations, resolve every quote to its source, and apply the human Spanish QA checklist. Do not treat English fallback or equal wrong answers as parity. Keep iOS out of scope.
