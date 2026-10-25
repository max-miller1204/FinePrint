# FinePrint iOS

SwiftUI app for iOS 26. Swift 6 language mode, strict concurrency, main actor by default.

## Build and test

Open `FinePrint.xcodeproj` in Xcode 26, or from the command line:

```sh
xcodebuild -project ios/FinePrint.xcodeproj -scheme FinePrint \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build
xcodebuild -project ios/FinePrint.xcodeproj -scheme FinePrint \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' test
```

Simulator builds need no signing team. Add `CODE_SIGNING_ALLOWED=NO` if your machine has no Apple ID set up.

The `FinePrint/` and `FinePrintTests/` folders are synchronized groups: new files you add there are part of the target without editing the project file.

## Launch arguments

Pass these with `xcrun simctl launch booted org.fineprint.FinePrint <args>`, or turn them on in the scheme's Run > Arguments tab.

| Argument | Effect |
|---|---|
| `-FinePrintServerURL <url>` | Uses this server for this launch only. Beats the developer-menu value. Must be `http` or `https` with a host; an invalid value is ignored. |
| `-FinePrintInMemoryStore` | Keeps SwiftData and the sign-in in memory, so nothing persists and every launch signs in as a new anonymous user. Always on when running tests. |
| `-FinePrintDeadlineStub present` / `empty` | DEBUG builds only. `present` shows the sample deadline even over real ones; `empty` turns the sample off (real deadlines still show). With neither, DEBUG builds show real deadlines, or the sample when nothing is due. |
| `-FinePrintSeedDeadline move_in_report` / `objection` / `deposit_itemization` | DEBUG builds only. Starts that clock today on a new "Sample rental", the way onboarding seeds one, so it never asks for notification permission. For e2e. |
| `-FinePrintDeveloperMenu` | DEBUG builds only. Shows the developer menu for this launch without the five taps, for UI tests. |
| `-FinePrintSkipOnboarding` | DEBUG builds only. Starts at the tabs with a default Virginia rental (Richmond, living there), created on the server like an onboarded one. For UI tests that are not about onboarding. |
| `-FinePrintFixtureLease <pdf>` | DEBUG builds only. Scan Lease and Import PDF read this PDF (an absolute path) in place of the document camera and the file picker: Import reads it as a PDF (text layer, OCR for image pages), Scan renders every page and OCRs it. Compiled out of Release. |
| `-FinePrintHangWatchdog <file>` | DEBUG builds only. Appends a line to `<file>` (an absolute path) whenever the main thread stalls for 2 s, and stops the app after 10 s so the crash report holds the main thread's stack. e2e turns it on for every launch. |
| `-FinePrintFixtureCamera <dir>` | DEBUG builds only. Feeds the jpg, heic, and png files in `<dir>` (an absolute path), in file name order and wrapping around, through the capture pipeline in place of the camera. Compiled out of Release. |

## Developer menu

Open Settings with the gear in any tab, then tap the **Version** row 5 times within 3 seconds. A **Developer** section appears (it stays until you choose **Hide Developer Options**). There you can:

- see the server URL in use and where it came from (default, saved here, or launch argument)
- set a new server URL, which is validated before it is saved, or reset to the default (see Default server URL below)
- see the anonymous sign-in (status, user ID, when the ID token expires) and check that the server accepts it
- in DEBUG builds, turn the sample deadline on or off
- open the camera, see the last kept photo's hash and seal status, and how many photos wait to upload
- in DEBUG builds, Simulate Offline holds the upload queue as if offline; turning it off counts as a reconnect

Server URL precedence: launch argument, then the developer-menu value, then the default.

## Default server URL

The built-in default is the `FinePrintServerURL` key in Info.plist, filled from `FINEPRINT_SERVER_URL` in `Config/Shared.xcconfig`:

- Debug builds use `http://localhost:8080`.
- Release builds (TestFlight, App Store) use the project's deployed server, committed in `Config/DeployedServer.xcconfig`. A clean checkout needs no setup.
- To build for your own server, copy `Config/Server.example.xcconfig` to `Config/Server.xcconfig` (git-ignored) and paste the line `./deploy.sh` prints when it finishes. It is included last, so it wins:

  ```
  FINEPRINT_SERVER_URL[config=Release] = https:/$()/fineprint-abc123-uk.a.run.app
  ```

  `//` starts a comment in a xcconfig, so write it as `/$()/`.

## TestFlight

`.github/workflows/testflight.yml` archives, signs, and uploads every push to `main` that changes `ios/`. Run it by hand with `gh workflow run testflight.yml`. The one-time App Store Connect setup and the secret names are in [docs/testflight.md](../docs/testflight.md).

## Settings

The gear opens Settings: language, reading level, the impact-count opt-in (saved on the device, with impact consent also saved on the server), and **Delete Everything**. Delete Everything calls `DELETE /v1/me`, and only after the server answers erases the rentals, deadlines, reminders, photos, upload queue, saved settings, and sign-in on the device, then shows a receipt. Share links and the AI trace have no rows yet (#35, #39).

## Sign-in

The app signs in to Firebase Auth anonymously on first launch, with no input, and sends the ID token to every `/v1` route. It never asks for an email or phone number. It calls the Firebase Auth REST API directly (no Firebase SDK) from `Networking/AuthSession.swift`.

- The Firebase project comes from the server: `GET /.well-known/fineprint-client.json` returns its web API key and project ID, so one build works with any organization's server. Point the app at another server and it starts a new anonymous account for that server's project.
- The account lives in the keychain (after first unlock, this device only), so it survives relaunches. Unsigned simulator builds (`CODE_SIGNING_ALLOWED=NO`) have no keychain access, so they sign in again on every launch; the keychain tests skip there.
- Against a local server run with `pnpm --filter @fineprint/server dev:emulated`, the server names the Firebase Auth emulator and DEBUG builds sign in there. Release builds never trust an emulator.
- Sign-in that fails while offline is retried when the app returns to the foreground, and on the next request that needs a token.
