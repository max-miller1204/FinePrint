---
name: verify-fineprint-ios
description: Launch, check, drive, prove, and bug bash the FinePrint iOS app (ios/, SwiftUI, iOS 26) on a simulator with e2e. Use before claiming an iOS change works, when asked to check a screen in the running app, or to bug bash the iOS app.
---

# Verify the FinePrint iOS app

Read the [e2e skill](../e2e/SKILL.md) first. This skill only says what is
true of this app. Every command runs from `e2e/`. The config is
`e2e/e2e.config.ts`, target `ios`, tests `tests/ios/**/*.e2e.ts`. Pass
`--target ios` so a run never starts the web target's Chromium. The config
sets `E2E_TELEMETRY_DISABLED=1` (privacy stance, spec §12.1). The package
scripts set it too.

## Launch

The engine installs nothing on its own, so build the Debug `.app` first.
Build again after every change under `ios/`:

```bash
cd e2e
pnpm build:ios     # xcodebuild Debug for the simulator into ios/DerivedData/
```

Then `npx e2e run ... --target ios` does the rest:

- The runner boots the **iPhone 17 Pro** simulator (iOS 26) through
  agent-device. The first boot takes about 2 minutes. Later runs take a few
  seconds. Only one job uses the simulator at a time: run builds, unit tests,
  and e2e through the gate (see [Gate](#gate)), which queues every worktree
  on one lock.
- `ENGINE_FAILURE` "Daemon request timed out" (often with `LAUNCH_TIMEOUT`
  or `CLEANUP_TIMEOUT`) has two causes, and the frozen app is the common one:
  - **The app's main thread is frozen.** The driver reads the screen through
    accessibility, so a hung app times out every request. This is what
    stalled #25 and #17 for hours (#99). Every launch runs the app's
    watchdog (`-FinePrintHangWatchdog`, see `ios/README.md`), which stops a
    frame frozen for 10 s, and the test then fails with `APP_HANG` and the
    path of a crash report holding the main thread's stack. Don't rerun:
    fix the screen.
  - **The driver wedged**, usually after a simulator shutdown or when
    another session drives the same simulator. With no `APP_HANG` and no
    `app-hangs.log` line, run `../scripts/ios-gate/reset-driver.sh` and run
    once more. The gate does this for you.
- It starts the Hono server (`node --import tsx src/index.ts` in `server/`)
  inside the Firebase Auth, Firestore, and Storage emulators
  (`firebase emulators:exec`, config `firebase.ios.json`: Auth **9199**,
  Firestore **8190**, Storage **9290**) on fixed port **18080**, waits for
  `/healthz`, and logs both to `e2e/.e2e/logs/server-ios.log`. Set
  `E2E_IOS_SERVER_PORT` when 18080 is taken. Firestore and Storage are JVMs
  (Java 21) and can take most of a minute to start on an 8 GB Mac. The
  emulator ports are fixed, so a parallel session on another simulator still
  collides: run one iOS run at a time.
- The `test` from `tests/ios/fixtures.ts` installs the build once per
  worker. Every iOS test imports `test` from there, not from
  `@e2e-dev/mobile`.
- Every fresh launch gets the arguments in `e2e/ios-launch.ts`:
  `-FinePrintServerURL http://127.0.0.1:18080`, `-FinePrintInMemoryStore`,
  `-FinePrintDeveloperMenu`, `-FinePrintSkipOnboarding`, and
  `-FinePrintFixtureCamera <abs path to e2e/fixtures/photos/move-in>`.
  Nothing persists between launches, so each launch signs up a new anonymous
  account (the app reads the emulator host from the server's
  `/.well-known/fineprint-client.json`), starts at the tabs with a default
  Richmond rental (created on the server like an onboarded one), and Settings
  shows the Developer section without the five taps. The shutter takes the
  next fixture photo through the real pipeline (regenerate the photos with
  `swift e2e/fixtures/generate-photos.swift`). `ios/README.md` lists all
  launch arguments.
- A test that needs other arguments relaunches with
  `device.openApp(iosBundleId, { relaunch: true, launchArguments: iosLaunchArguments({ without: [...] }) })`
  from `e2e/ios-launch.ts`; a launch's arguments replace the target's. That
  is how `onboarding.e2e.ts` reaches onboarding and `camera.e2e.ts` reaches
  "Camera not available". Pass `-FinePrintSeedDeadline <kind>` to start a
  real deadline (`deadlines.e2e.ts`).
- The iOS 26.0 simulator runtime cannot reset or grant notification
  permission through `permissions` (simctl privacy fails with
  `UNSUPPORTED_CAPABILITY`). To start from "never asked", call `reinstall(device)`
  from `tests/ios/fixtures.ts`; to allow, tap the control that asks and
  `device.alert('accept')` (or `acceptAlertIfShown(device)`).

The first time on a machine, run `npx agent-device doctor`. The warnings
about HarmonyOS and Vega are expected.

## Doctor

```bash
cd e2e
npx e2e list                                          # loads the config, starts nothing; exit 0
npx e2e run tests/ios/smoke.e2e.ts --target ios       # installs, launches, all 5 tabs and the Lease empty state; exit 0
```

- `list` fails: the config or a dependency is broken (run `pnpm install`).
- `INSTALL_FAILED` or an app path error: the build is missing or stale.
  Run `pnpm build:ios`.
- `APP_UNREACHABLE`: the server died on boot. Read
  `.e2e/logs/server-ios.log`.

## Gate

`scripts/ios-gate/gate.ts` runs one verification cycle: build (for the
booted simulator's architecture only), unit tests, and e2e files, in one
turn of the shared lock. Use it for every heavy run, while iterating and
for the final check before a PR:

```bash
node scripts/ios-gate/gate.ts walkthrough                         # one file while iterating
node scripts/ios-gate/gate.ts --only-testing FinePrintTests/RoomTests   # one unit suite
node scripts/ios-gate/gate.ts --unit smoke capture deadlines walkthrough   # before a PR
```

Run it from the repo root of your worktree. What it does for you:

- **One simulator for every worktree.** `scripts/ios-gate/heavy.sh` queues
  jobs first come, first served (`HEAVY_PRIORITY=0` goes first, without
  interrupting a running job). The simulator stays booted while another job
  waits and shuts down when the queue is empty. `tail -f
  "$(git rev-parse --git-common-dir)/fineprint-heavy/heavy.log"` shows who
  has it.
- **Skips what already passed.** A step is cached by the content of its
  inputs, uncommitted files included: unit tests by `ios/`, an e2e file by
  `ios/`, `server/`, `e2e/` (other test files left out), and that file. So
  editing `walkthrough.e2e.ts` reruns only the walkthrough, and a Swift edit
  reruns everything. A passing final check reuses the passes you already
  have. `--no-cache` runs everything.
- **Names the failure** for each file: `APP_HANG` (do not rerun),
  `APP_FAIL` (an assertion, a locator, a covered tap: read the trace),
  `SETUP` (the server never answered: read `.e2e/logs/server-ios.log`,
  and after a rebase run `pnpm install`), or `INFRA` (driver or simulator:
  the gate resets the driver and runs those files once more on its own).
- **Won't repeat a failure.** A step whose inputs haven't changed since it
  failed is refused (exit 4) until you change something, or pass `--force`.
  The same failure twice in a row prints `STOP`: diagnose before another run.

Exit codes: 0 pass, 1 `APP_FAIL`, 2 `APP_HANG`, 3 `INFRA` twice, 4 refused,
5 `SETUP`. History is in `e2e/.e2e/gate/history.jsonl` and each run's
traces in `e2e/.e2e/gate/<run>/`.

## Drive

**Scripted lane.** `tests/ios/*.e2e.ts` uses `screen` locators. These
handles are stable:

- Tabs: `getByRole('tab', { name: 'Lease' | 'Evidence' | 'Repairs' | 'Letters' | 'Ask' })`.
  They also carry test ids `tab.<name>`, but the code comment in
  `ios/FinePrint/App/AppTab.swift` says not to rely on them on iOS 26.0.
- Test ids: `settingsButton`, `settings.version`, `settings.close`,
  `settings.developerOptions`, `deadlineAccessory`, and the
  `developer.*` ids in `DeveloperMenuView.swift` and `AccountSection.swift`
  (`developer.authStatus`, `developer.userID`, `developer.checkServer`,
  `developer.serverCheckResult`, `developer.openCamera`,
  `developer.lastCaptureHash`, `developer.sealStatus`,
  `developer.uploadQueueCount`, `developer.simulateOfflineToggle`).
  Onboarding: `onboarding.*` (see [onboarding](features/onboarding.md)).
  Camera: `camera.*` (see [camera](features/camera.md)). Deadlines:
  `deadline.card.<move_in_report|objection|deposit_itemization>`,
  `deadline.remindMe`, `deadline.remindersOn`, `deadline.openSettings`,
  `deadline.reportReceived`, `deposit.forwardingAddress`,
  `deposit.inspection`, `deposit.moveOutCard`, `deposit.addMoveOutDate`,
  `dayEntry.save`, `dayEntry.cancel`. Rentals: `rentalSwitcher`,
  `rentalSwitcher.add`, `addRental.cancel` (see [rentals](features/rentals.md)). iOS 26 lists a toolbar button twice
  (its container and the button), so drive toolbar buttons such as
  `dayEntry.save` by role and name: `getByRole('button', { name: 'Start Clock' })`.
- Empty-state titles: "No lease yet", "No move-in photos yet".

`agent.*` steps use the Gemini model and need the key (see Bug bash).
`mobileTools` is wired for app switching, swipes, and system alerts.

**Live lane.** Use `e2e mcp` (topic `mcp`). The e2e MCP server is not
registered in this repo yet, so register it before a live walk. Only one
session may drive the simulator at a time: close it before a scripted run.

## Evidence

Every run writes `e2e/.e2e/report.json`, and a failed test gets
`e2e/.e2e/results/<test>/trace.md` with a screenshot and the screen tree.
The next run clears `results/`, so a proof for a PR runs with
`--output .e2e/proof/<name> --trace on`, and `--video on` for UI changes.

A proof drives the real screen through taps, never by calling an internal
setter. It records the action and the resulting screen. For anything that
calls the server, it also checks the matching `request` line in
`.e2e/logs/server-ios.log`. The app calls `POST /v1/rentals` (log line
"rental created") and the evidence routes ("evidence upload urls issued",
"evidence received"); under the Storage emulator the upload URLs point at
127.0.0.1:9290. See [evidence upload](features/evidence-upload.md).

## Bug bash

The model is Gemini (`gemini-flash-latest` through `@ai-sdk/google`) and
reads `GEMINI_API_KEY`. The worktree's `.env` (gitignored) holds a
1Password reference, not the key, so run anything that calls the model as
`op run --env-file ../.env -- <command>` from `e2e/`. Never print the
value. On macOS without 1Password, keep the key in the login keychain
(service `fineprint-gemini-api-key`, see `CONTRIBUTING.md`) and use
`../scripts/with-gemini-key.sh <command>` in place of `op run ... --`.

`e2e/e2e.bugbash.config.ts` is gitignored and local. It spreads
`e2e.config.ts` and adds the `skeptic` and `fuzzer` personas (topic
`bug-bash`, step 1). Its `context` lists what is not a bug here:

- placeholder screens on every tab except onboarding and the Evidence
  deadline cards
- the sample deadline in DEBUG builds when no real deadline is due
- "Sealed" never shows: sealing is #24

There is one simulator, so iOS charters run **one at a time**, never
fanned out in parallel.

`e2e explore --target ios` needs e2e 0.21.3 or later. On 0.21.2 it fails
before its first step with `APP_NOT_OPEN` ("No active session e2e-ios-0").
On a loaded machine, give an `agent.assert` `{ timeout: 120_000 }`, because
the default 30 s includes the device observation.

The charters are in [features/](features/), one per feature, in the
`slug|target|agent|charter` format:

```bash
cd e2e
op run --env-file ../.env -- npx e2e explore '<charter>' \
  --config e2e.bugbash.config.ts --target ios --agent <persona> --max-steps 3 \
  --output .e2e/bugbash/<slug> --reporter list,markdown
```

A finding is a bug once `tests/ios/bugbash/<slug>.e2e.ts` fails with
`ASSERTION_FAILED` on the assertion that encodes it. Tag those tests
`bugbash` and leave them out of gating runs with `--exclude-tag bugbash`.

## Cleanup

The runner stops the server it started. The simulator stays booted, which
makes the next run fast. To shut it down, run
`xcrun simctl shutdown 'iPhone 17 Pro'`, and only if you booted it. Never
`pkill` the simulator or node. Keep `e2e/.e2e/` (the report, `proof/`,
`logs/`): that is the evidence, and all of it is gitignored. Delete
`ios/DerivedData/` only to force a clean build.

## Helpers

- `pnpm build:ios` builds the app.
- `pnpm test:e2e` runs everything on both targets.
- `pnpm test:e2e:ios` runs the iOS target only.
- Unit tests: `xcodebuild ... test` (see `ios/README.md`). On an 8 GB Mac,
  keep one simulator up: run them on `iPhone 17 Pro` with
  `-parallel-testing-enabled NO` (otherwise Xcode boots a "Clone 1 of ..."
  device next to it), never while an e2e run is going, and shut down any
  simulator you booted when you are done.
