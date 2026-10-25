# Issue #33 verification evidence

Synthetic data only. Captured on Linux with Chromium, 2026-10-25.

| Before | After |
| --- | --- |
| [Main: JSON 404](before-desktop.png) | [SSR report](after-desktop.png) |

Both desktop captures use `/r/fixture`, 1280 x 720, light mode. The main
version has no report route. The new version has the emulator-only synthetic
report. [Phone stress capture](phone-worst-dark.png): 320 x 720, dark mode,
25 findings, long Spanish blocks and 120 exhibits. The same run also checks
200% text and 390 x 844 keyboard/empty/single-exhibit flows.

[Tagged Letter PDF](report.pdf), generated from the actual print media rules,
with navigation hidden and signature details collapsed before printing.
[Exhibit page](print-exhibit.png) shows the separate annotation overlay,
complete timestamps, full hash and tenant annotation on one page. Original
photo pixels remain unchanged. The synthetic signatures use an ephemeral
local key, and were verified against that server's published JWK during e2e.

Final gate, one run, exit **0**:

```text
cd e2e
pnpm exec e2e run tests/web --target web --output .e2e/proof/issue-33 --trace on --no-cache --retries 0

run 01a172aa-ec7b-750d-86f2-b36a92ccb830
Test Files  11 passed (11)
Tests       39 passed | 2 skipped (41)
Duration    15.36s
```

This includes smoke and all five report tests. The two skipped tests are
existing live-model lease pipeline tests that require `GEMINI_API_KEY`.
Every report test ran. Local traces and the runner's full report remain at
`e2e/.e2e/proof/issue-33/` (gitignored).

Other checks: 444 unit tests passed, `pnpm typecheck` passed, `pnpm lint`
passed with warnings, and `git diff --check` passed.

Real-hardware testing was not done. No Mac or iOS simulator was available.
Emulated viewports do not establish phone safe-area behavior, sticky hover,
touch latency or Safari printing. Those need a real-device check before rollout.

UI, stress-data and motion review: [web report notes](../../web-evidence-report.md).
No open product decisions in #33. Browser verification (#34), live share
resolution/lifecycle (#35), and axe CI (#36) are follow-up work. Production
tokens fail closed until an authorized ReportLoader is supplied by #35.
