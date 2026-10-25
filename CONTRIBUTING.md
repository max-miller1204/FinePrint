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

Tests without agent steps need no key. The server's Gemma 4 calls, the e2e `agent.*` steps, and `deploy.sh` all read `GEMINI_API_KEY` from the environment (`GOOGLE_API_KEY` also works), a Google AI Studio key. Nothing in the repo reads a `.env` file itself: wrap the command in one of the two loaders below. Never commit the key or write its value to a file in the repo, and never print it.

**1Password** (`op` CLI). `~/.config/fineprint/.env` holds a reference, not the key:

```sh
# ~/.config/fineprint/.env
GEMINI_API_KEY=op://<vault>/<item>/<field>
```

```sh
ln -s ~/.config/fineprint/.env .env                        # optional, per checkout; .env is gitignored
op run --env-file ~/.config/fineprint/.env -- <command>    # or --env-file .env (../.env from e2e/)
```

To add a secret: store it in 1Password, then add a `NAME=op://<vault>/<item>/<field>` line to `~/.config/fineprint/.env`.

**macOS Keychain** (no 1Password). Store the key once, then wrap the command:

```sh
security add-generic-password -U -a "$USER" -s fineprint-gemini-api-key -w   # prompts for the key
scripts/with-gemini-key.sh <command>
```

To add a secret: store it with `security add-generic-password -U -a "$USER" -s fineprint-<name> -w`, then export it in `scripts/with-gemini-key.sh` the same way it exports `GEMINI_API_KEY`.

Examples: `op run --env-file ~/.config/fineprint/.env -- ./deploy.sh` or `scripts/with-gemini-key.sh ./deploy.sh`.

The `verify-fineprint-web` and `verify-fineprint-ios` skills in `.agents/skills/` cover launching, driving, evidence, and bug bashes.

## Workflow

See [AGENTS.md](AGENTS.md) for the issue, branch, and pull request workflow.
