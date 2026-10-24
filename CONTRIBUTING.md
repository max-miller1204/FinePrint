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
pnpm check:jurisdictions   # rule pack JSON and schema
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

### Gemini API key (Gemma 4 and e2e agent steps)

Tests without agent steps need no key. The server's Gemma 4 calls and the e2e `agent.*` steps both read `GEMINI_API_KEY`, a Google AI Studio key. Never commit it or put it in a `.env` file as plain text. Use one of these:

- 1Password: put a reference in `.env` and run `op run --env-file ../.env -- <command>`.
- macOS Keychain: store the key once, then wrap the command:

  ```sh
  security add-generic-password -U -a "$USER" -s fineprint-gemini-api-key -w   # prompts for the key
  scripts/with-gemini-key.sh <command>
  ```

The `verify-fineprint-web` and `verify-fineprint-ios` skills in `.agents/skills/` cover launching, driving, evidence, and bug bashes.

## Workflow

See [AGENTS.md](AGENTS.md) for the issue, branch, and pull request workflow.
