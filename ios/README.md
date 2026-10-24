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
| `-FinePrintDeadlineStub present` / `empty` | DEBUG builds only. Shows or hides the sample deadline above the tab bar. DEBUG builds show it by default. |
| `-FinePrintDeveloperMenu` | DEBUG builds only. Shows the developer menu for this launch without the five taps, for UI tests. |

## Developer menu

Open Settings with the gear in any tab, then tap the **Version** row 5 times within 3 seconds. A **Developer** section appears (it stays until you choose **Hide Developer Options**). There you can:

- see the server URL in use and where it came from (default, saved here, or launch argument)
- set a new server URL, which is validated before it is saved, or reset to the default (`http://localhost:8080`)
- see the anonymous sign-in (status, user ID, when the ID token expires) and check that the server accepts it
- in DEBUG builds, turn the sample deadline on or off

Server URL precedence: launch argument, then the developer-menu value, then the default.

## Sign-in

The app signs in to Firebase Auth anonymously on first launch, with no input, and sends the ID token to every `/v1` route. It never asks for an email or phone number. It calls the Firebase Auth REST API directly (no Firebase SDK) from `Networking/AuthSession.swift`.

- The Firebase project comes from the server: `GET /.well-known/fineprint-client.json` returns its web API key and project ID, so one build works with any organization's server. Point the app at another server and it starts a new anonymous account for that server's project.
- The account lives in the keychain (after first unlock, this device only), so it survives relaunches. Unsigned simulator builds (`CODE_SIGNING_ALLOWED=NO`) have no keychain access, so they sign in again on every launch; the keychain tests skip there.
- Against a local server run with `pnpm --filter @fineprint/server dev:emulated`, the server names the Firebase Auth emulator and DEBUG builds sign in there. Release builds never trust an emulator.
- Sign-in that fails while offline is retried when the app returns to the foreground, and on the next request that needs a token.
