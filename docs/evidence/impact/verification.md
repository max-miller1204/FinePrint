# Issue 57 verification

Linux, Chromium, Firebase Auth/Firestore/Storage emulators, 2026-10-25.

- `pnpm test`: exit 0, 440 tests in 17 files.
- `pnpm typecheck`: exit 0.
- `pnpm lint`: exit 0, existing warnings.
- `pnpm check:jurisdictions`: exit 0, 32 valid rules.
- `pnpm exec e2e run --target web --workers 1 --retries 0 --trace on --output .e2e/proof/impact-final` from `e2e/`: exit 0 in one run, 11 files, 36 passed, two existing live-model tests skipped because no model key was supplied. Includes smoke, impact, rentals, evidence, sealing, leases, auth, triage, errors, and health. Run ID: `01a172af-acb8-766f-9286-04ca34a7509b`.
- Firestore emulator: `pnpm exec vitest run test/emulator/impact.test.ts test/emulator/rentals.test.ts test/emulator/delete-purge.test.ts --no-file-parallelism --testTimeout 20000`: exit 0, six tests in three files. Proves opt-in-only verified clause aggregation, concurrent completion deduplication, no backfill, rental writes preserving dedupe flags, and deletion.

Concurrent worktree setup: `E2E_WEB_FIREBASE_CONFIG=/tmp/fineprint-57-firebase.json`, `E2E_FIRESTORE_HOST=127.0.0.1:18057`, `E2E_AUTH_HOST=127.0.0.1:19057`, `TMPDIR=/tmp/fineprint-57-emulators` (created first). The temporary Firebase config uses absolute rule paths and unique auth, Firestore, Storage, hub, and logging ports. See the verification skill for overrides.

An initial default-port run could not start because another worktree owned those ports. An optional all-emulator run failed an existing GCS test that assumes the whole bucket is empty; deletion/purge fixtures leave other rentals in that bucket. The six affected emulator tests pass together in a fresh emulator run. No unrelated test was changed to hide that failure.

Before/after images show `/impact` in Chromium at 1280 x 1000, light mode. Before is the running `origin/main` app (404); after is this branch with one opted-in account, one early move-in seal, and $1,000 of bucketed deposit coverage. No model or production data was used. Dark mode and extreme totals were also captured at 320 x 740. The test-only Demo data / Worst case switch tests zero and maximum safe integer totals, with a 200% text-size overflow check. No such switch ships on the public page. Long numbers wrap; there is no horizontal overflow. No new animations were introduced.

## iOS and hardware follow-up

The existing toggle was local-only. Minimal changes send authenticated consent, acknowledge before saving locally, expose failures, serialize foreground sync with toggle changes, and explain retained anonymous totals. A request-shape Swift test was added. iOS was not compiled or driven on Linux; iOS e2e did not run. The repository has Linux PR CI and a macOS TestFlight workflow, but no separate macOS PR compile job. Use the existing TestFlight workflow on this branch to compile before merge, or verify its main upload after merge according to the release process.

On a device with that build and the updated server:

1. Fresh install: open Settings; verify the toggle starts off. Enable it, wait for saving to finish, and confirm `/impact` gains one participant. Reopen Settings and restart the app; the choice should persist without another participant.
2. Turn it off, seal a new move-in report, and confirm totals do not rise. Turn it on and seal a different report; confirm it adds only once and uses the deposit bucket. Re-seal and verify no duplicate. Earlier reports must not backfill.
3. Disable networking and change the toggle: the prior acknowledged choice stays visible and an error appears. Reconnect and retry. Foreground sync must not fight the toggle or block rental upload on failure.
4. Delete Everything: private data disappears and past aggregate totals remain. A fresh anonymous account starts off.
5. With VoiceOver and large Dynamic Type, check the saving/error state and the expanded privacy copy. Open `/impact` in phone Safari and verify scrolling, safe-area padding, dark mode, and zoom. Desktop emulation does not verify physical touch behavior.

Metrics for unbuilt letter, repair, and actual handoff workflows remain explicitly untracked. The occupancy-day measure is not a statutory deadline. No pending product decision blocks this change.
