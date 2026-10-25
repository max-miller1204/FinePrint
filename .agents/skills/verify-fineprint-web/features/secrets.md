# Shared secrets and local key overrides

`scripts/with-secrets.sh <command> [args...]` works on Linux and macOS bash.
It preserves `GEMINI_API_KEY`, or normalizes an existing `GOOGLE_API_KEY` to
`GEMINI_API_KEY`. Without either, it reads the latest `GEMINI_API_KEY` version
from Secret Manager. Project selection matches deployment: `FINEPRINT_PROJECT`
then gcloud's configured project. No payload is printed or cached on disk.
See `CONTRIBUTING.md` for personal AI Studio keys and owner-run partner IAM.

## Verification

From the repo root, `python3 scripts/test-with-secrets.py` checks personal-key
precedence with no Cloud calls, the Google alias, project selection, missing
CLI/project/login, denied access, empty payload, command arguments and exit
status, and tracing suppression. It uses synthetic fixtures, never real keys.

From `e2e/`, run the normal suite through the loader:

```sh
FINEPRINT_PROJECT=fineprint-dev ../scripts/with-secrets.sh pnpm exec e2e run \
  --target web --exclude-tag bugbash --output .e2e/proof/secret-manager \
  --reporter list,markdown
```

To prove the shared path, first unset personal key variables in that shell.
Smoke proves startup; triage and live lease tests exercise server inheritance.
The report UI and remaining API tests check the app as a whole. The runner
starts Firebase emulators, calls live models for model-backed tests, then stops
its processes. Proof stays under the gitignored `.e2e/proof/secret-manager/`.

## Proof

2026-10-25 on Linux: the real shared-key fetch in `fineprint-dev` succeeded
with both personal key variables unset; the child printed only that
`GEMINI_API_KEY` was set. All 13 loader checks passed. The full web run through
the shared-key path exited 0: 11 files, 40 tests passed, 1 expected no-model
skip, 616.27 s. Both live lease tests and triage passed, alongside smoke,
report UI, auth, rentals, evidence, integrity, error, and adversarial tests.
Shared model quota produced 429 retries before the run passed.

ShellCheck and bash syntax checks passed. Lint passed with existing warnings,
typecheck passed, and all 444 server unit tests passed. macOS was not run; the
wrapper uses bash 3.2-compatible syntax. No IAM or secret versions were changed.

## Charters

None. This is a command wrapper with deterministic failure-path checks, not a
new HTTP or UI surface. Use the existing report and API charters for the app.
