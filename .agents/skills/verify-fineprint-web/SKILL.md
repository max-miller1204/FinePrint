---
name: verify-fineprint-web
description: Launch, check, drive, prove, and bug bash the FinePrint Hono server (server/), the API and the web Evidence Report, with e2e. Use before claiming a server or web report change works, when asked to verify a route, or to bug bash the server.
---

# Verify the FinePrint server

Read the [e2e skill](../e2e/SKILL.md) first. This skill only says what is
true of this app. Every command runs from `e2e/`. The config is
`e2e/e2e.config.ts` (target `web`, tests `tests/web/**/*.e2e.ts`; the
same config holds the `ios` target, so pass `--target web` or every run
also boots the simulator). The config sets `E2E_TELEMETRY_DISABLED=1`
(privacy stance, spec §12.1) and the package scripts set it too.

## Launch

The target's `app.command` runs `firebase emulators:exec --only
auth,firestore,storage --project demo-fineprint "node --import tsx
src/index.ts"` in `server/`
(firebase-tools is a server dev dependency) with `PORT` set to a free port
(`app.url` is `http://127.0.0.1:0`). The emulators listen on
127.0.0.1: Auth 9099, Firestore 8090, Storage 9190 (`firebase.json`; the
ios target runs its own set on 9199, 8190, and 9290, so a run with both
targets never collides); emulators:exec sets `FIREBASE_AUTH_EMULATOR_HOST`,
`FIRESTORE_EMULATOR_HOST`, `FIREBASE_STORAGE_EMULATOR_HOST`, and
`GCLOUD_PROJECT` for the server. Firestore and Storage need Java 21 and
can take most of a minute to start on an 8 GB Mac, so the command's
`startupTimeout` is 180 s. The
runner starts it, polls `/healthz` until it answers, and stops it with
SIGTERM after the run, which shuts the emulators down too. Nothing to start
by hand. No seeds yet: `/healthz` checks are stubbed until M6. Run
`pnpm install` at the repo root first.

To watch the server by hand: `pnpm --filter @fineprint/server dev:emulated`
from the repo root (port 8080, or `PORT=<n>`), or `dev` with no emulator
(then `/v1` needs `FIREBASE_PROJECT_ID` and a real token). The port-0 target
never collides with it, but the emulator ports do: stop it before a run.

### A deployed server

`./deploy.sh` (feature [deploy](features/deploy.md)) puts the server on
Cloud Run in a real project. It creates billed resources, so ask the user
before running it or `--destroy`. To check a deployed server, attach to its
URL with the separate config; it starts nothing and needs no emulator:

```bash
cd e2e
E2E_DEPLOYED_URL=https://<service>.run.app npx e2e run --config e2e.deployed.config.ts
```

## Doctor

```bash
cd e2e
npx e2e list                                        # loads the config, starts nothing; exit 0
npx e2e run tests/web/smoke.e2e.ts --target web     # boots the server, GET /healthz is 200 ok; exit 0
```

`list` failing is the config or a dependency (`pnpm install`). `run`
failing with `APP_UNREACHABLE` is a server that died on boot: read
`e2e/.e2e/logs/server.log`. The first run downloads Chromium for the web
engine; that is expected.

## Drive

The [web report](features/web-report.md) now has UI at `/r/:token`.
Use its fixture-only data toggle with `REPORT_FIXTURES=1` under emulators;
`tests/web/report.e2e.ts` drives the page with semantic locators and checks
phone layouts and actual print/PDF output. The live MCP lane is optional.

API tests take only `app`, declare `{ platforms: ['web'] }` so the ios target skips
them, and call `fetch(new URL(path, app.baseUrl))` with value matchers (topic `writing-tests`, "APIs live in the same suite"). The tests
call no model themselves. The server inherits `GEMINI_API_KEY` and
`GEMMA_*` (`inheritEnv`), so under `op run` its triage also asks Gemma;
without them triage runs on the keyword backstop alone. Agent steps (`agent.act`, `agent.assert`) use the Gemini model
in the config and need the key (see Bug bash). Drive the web report with
`screen` locators or the live MCP lane (topic `mcp`); the e2e MCP server is
not registered in this repo yet.

Stable handles: routes, status codes, the `error.code` field of the
envelope, and the `X-Request-Id` header. For `/v1`, sign up against the
emulator the client config names (`tests/web/auth.e2e.ts`,
`signUpAnonymously`) and send the `idToken` as a bearer token. Never assert an error `message`
that a later change might reword unless the test is about that message.

## Evidence

Every run writes `e2e/.e2e/report.json`; a failed test gets
`e2e/.e2e/results/<test>/trace.md` (`--trace on` for passing ones). The
next run clears `.e2e/results/`, Doctor included, so a proof for a PR runs
with `--output .e2e/proof/<name>`. Side effects: the server writes one
JSON log line per request to `e2e/.e2e/logs/server.log`; read it to prove
`requestId` is on every line and that no request content was logged. Rentals are stored in the Firestore emulator,
which starts empty on every run; read a document back with `GET
http://127.0.0.1:8090/v1/projects/demo-fineprint/databases/(default)/documents/<path>`
and `Authorization: Bearer owner` (`tests/web/rentals.e2e.ts`). A proof calls the real route over HTTP, never an
internal function, and checks the status, the body, and the headers.

## Bug bash

The model is Gemini (`gemini-flash-latest` through `@ai-sdk/google`),
reading `GEMINI_API_KEY`. The worktree's `.env` (gitignored) holds a
1Password reference, not the key, so run anything that calls the model as
`op run --env-file ../.env -- <command>` from `e2e/`. Never print the
value. Tests without agent steps need no key. On macOS without
1Password, keep the key in the login keychain (service
`fineprint-gemini-api-key`, see `CONTRIBUTING.md`) and use
`../scripts/with-gemini-key.sh <command>` in place of `op run ... --`.

`e2e/e2e.bugbash.config.ts` is gitignored and local: it spreads
`e2e.config.ts` and adds the `skeptic` and `fuzzer` personas with a
`context` that says what is not a bug here (stubbed checks, replaced
malformed request ids, 404 on an unsupported method, 401 on any `/v1` path
without a token). If it is missing, recreate it from the example in topic
`bug-bash`, step 1. Each explorer starts its own server and
emulators, and the emulator ports are fixed, so run charters one at a time. The
charters are in [features/](features/), one block per feature in the
`slug|target|agent|charter` format (topic `bug-bash`, step 3):

```bash
cd e2e
op run --env-file ../.env -- npx e2e explore '<charter>' \
  --config e2e.bugbash.config.ts --target web --agent <persona> --max-steps 3 \
  --output .e2e/bugbash/<slug> --reporter list,markdown
```

`.e2e/` is gitignored, which covers `.e2e/bugbash/`. A finding is a bug
once `tests/web/bugbash/<slug>.e2e.ts` fails with `ASSERTION_FAILED` on
the assertion that encodes it; tag those tests `bugbash` and leave them
out of gating runs with `--exclude-tag bugbash`.

## Cleanup

The runner stops the server it started. A `pnpm --filter server dev` you
started is yours to stop by its pid, never `pkill node`. Keep
`e2e/.e2e/report.json`, `e2e/.e2e/proof/`, and `e2e/.e2e/logs/`: that is
the evidence, and all of it is gitignored.

## Helpers

`pnpm test:e2e:web` in `e2e/` runs this target only. Otherwise the e2e
CLI is the helper. Unit tests: `pnpm --filter server test` (vitest). The
Gemma client has a live check against the real API, `op run --env-file
../.env -- pnpm smoke:gemma` from `server/` ([features/gemma-client.md](features/gemma-client.md)).
