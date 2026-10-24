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
| `-FinePrintInMemoryStore` | Keeps SwiftData in memory, so nothing persists. Always on when running tests. |
| `-FinePrintDeadlineStub present` / `empty` | DEBUG builds only. Shows or hides the sample deadline above the tab bar. DEBUG builds show it by default. |

## Developer menu

Open Settings with the gear in any tab, then tap the **Version** row 5 times within 3 seconds. A **Developer** section appears (it stays until you choose **Hide Developer Options**). There you can:

- see the server URL in use and where it came from (default, saved here, or launch argument)
- set a new server URL, which is validated before it is saved, or reset to the default (`http://localhost:8080`)
- in DEBUG builds, turn the sample deadline on or off

Server URL precedence: launch argument, then the developer-menu value, then the default.
