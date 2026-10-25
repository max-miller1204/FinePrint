# Contributing to FinePrint

TODO: contributor guide.

## Prerequisites

- Node 22 or later
- pnpm (version pinned in `package.json`)
- Xcode with the iOS 26 SDK (for `ios/`)

## Setup

```sh
pnpm install
```

## Repository layout

| Path | Contents |
|---|---|
| `ios/` | SwiftUI app |
| `server/` | Hono API and web report |
| `jurisdictions/` | Rule packs and statute snapshots |
| `eval/` | AI evaluation harness |
| `research/` | User research and personas |
| `docs/` | Project documentation |
| `scripts/` | Maintenance and seeding scripts |
| `e2e/` | End-to-end tests |

## Checks

CI (`.github/workflows/ci.yml`) runs these on every push and pull request. Run them locally before you push:

```sh
pnpm lint                  # Biome
pnpm typecheck             # tsc in every workspace with a typecheck script
pnpm test                  # vitest in every workspace with a test script
pnpm check:jurisdictions   # rule pack JSON, schema, and quotes in snapshots
```

CI also runs [gitleaks](https://github.com/gitleaks/gitleaks) over the history. A new workspace joins the gate by adding `typecheck` and `test` scripts to its `package.json`.

## End-to-end tests

The `e2e/` workspace runs [e2e](https://github.com/tester-army/e2e) against two targets: `web` (the Hono server on a free port) and `ios` (the Debug app on the iPhone 17 Pro simulator). Everything is a project dev dependency. Nothing is installed globally.

```sh
cd e2e
pnpm build:ios       # build the Debug .app; repeat after iOS changes
pnpm test:e2e        # both targets
pnpm test:e2e:web    # server only
pnpm test:e2e:ios    # simulator only
```

The e2e CLI sends anonymous usage data by default. FinePrint turns it off: `e2e.config.ts` and the package scripts set `E2E_TELEMETRY_DISABLED=1`. Keep it set in CI and anywhere you run `npx e2e` by hand.

### Secrets (Gemini API key)

Google Cloud Secret Manager is the shared source of truth for runtime secrets.
Currently the only required shared secret is `GEMINI_API_KEY`. Cloud Run mounts
it directly. App Store Connect and TestFlight credentials stay in GitHub secrets.
The wrapper does not fetch or migrate those credentials, and never changes IAM.

For local development, each developer should create their own key at
https://aistudio.google.com/apikey in their own Google Cloud project so their
AI Studio usage has separate quota.
Set `GEMINI_API_KEY` in your shell profile using your editor, then reload the
profile. Do not paste the key into a shell command that would save it in history.
Alternatively keep `export GEMINI_API_KEY=...` in a private file outside the repo,
set its permissions to `600`, and source it before running commands. Never commit
or print the value. The wrapper does not source `.env` files or resolve old
password-manager references. Remove those references from your environment.

On Linux and macOS, wrap commands with:

```sh
scripts/with-secrets.sh pnpm --filter @fineprint/server dev:emulated
cd e2e
../scripts/with-secrets.sh pnpm test:e2e:web
```

The wrapper preserves a nonempty `GEMINI_API_KEY` already in the environment.
If only `GOOGLE_API_KEY` is set, it uses that as `GEMINI_API_KEY` for both the
server and e2e. With either personal key, gcloud is unnecessary. Tests without
agent steps or live model calls can also run directly without a key.

To use the shared key (deployed server and model-backed CI, or an explicit local
fallback), install the [Google Cloud CLI](https://cloud.google.com/sdk/docs/install)
and authenticate:

```sh
gcloud auth login
export FINEPRINT_PROJECT=fineprint-dev  # or your own deployed project
scripts/with-secrets.sh <command> [args...]
```

As in `deploy.sh`, project selection is `FINEPRINT_PROJECT`, then gcloud's
configured project (`gcloud config set project <project-id>`). The wrapper reads
`latest` from `GEMINI_API_KEY` only if no personal key is set. It keeps the payload
in process memory, exports it to the command, and never writes a cache. Missing
CLI, project, authentication, access, or an empty secret stops the command with
an error. A CLI login is sufficient; application-default login is not required.

**Partner access (owner runs manually).** For `maddoxrjohnson`, replace the email
placeholder with their Google account email, not their GitHub username. Grant
access only to this secret, following the [gcloud secret IAM reference](https://cloud.google.com/sdk/gcloud/reference/secrets/add-iam-policy-binding):

```sh
gcloud secrets add-iam-policy-binding GEMINI_API_KEY \
  --project=fineprint-dev \
  --member='user:<PARTNER_GOOGLE_ACCOUNT_EMAIL>' \
  --role=roles/secretmanager.secretAccessor \
  --condition=None
```

Use the same command with your own Google account email if it needs access.
Repeat per specific secret if the project gains other shared runtime secrets;
add those names to the wrapper explicitly. No project-wide role is needed.
The partner then runs `gcloud auth login` and sets `FINEPRINT_PROJECT` as above.
Confirm access without displaying the payload:

```sh
scripts/with-secrets.sh bash -c 'if [[ -n ${GEMINI_API_KEY:-} ]]; then echo "GEMINI_API_KEY is set"; else exit 1; fi'
```

For a shared-access check, use a shell without a personal key exported. To run
model-backed CI, authenticate its service account through your existing Google
Cloud identity setup, grant that identity access to this specific secret, then
use the same wrapper. Current model-free CI needs no Gemini key.

**Deployment and rotation.** Run `./deploy.sh` directly with no personal
`GEMINI_API_KEY` or `GOOGLE_API_KEY` exported to keep the deployed shared key.
The deploy script adds a version when an exported key differs from the stored
key. Only supply an environment key for intentional shared-key rotation, or use
its hidden prompt during first-time setup. Do not wrap deployment in a shell
carrying a personal development key. Secret creation, rotation, deployment,
and IAM grants remain owner actions.

The `verify-fineprint-web` and `verify-fineprint-ios` skills in `.agents/skills/` cover launching, driving, evidence, and bug bashes.

## Workflow

See [AGENTS.md](AGENTS.md) for the issue, branch, and pull request workflow.
