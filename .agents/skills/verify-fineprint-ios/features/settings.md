# Settings, delete everything, and the built-in server URL

The Settings sheet (spec §4.1, §9.2) holds the tenant's choices and the
one button that removes everything FinePrint holds about them.

## Sub-features

- **Reading**: Language (English, Español) and Reading Level (Standard,
  Simpler). Both are saved on the device (`UserDefaults`); the language
  shares onboarding's key. Nothing renders in Spanish or at the Simpler
  level yet (#45, #18), and the footer says so. Test ids
  `settings.language`, `settings.readingLevel`.
- **Privacy**: "Add to the Impact Count", off by default, saved on the
  device. #57 builds the counter on it. Test id `settings.impactOptIn`.
- **Your Data > Delete Everything…** (`settings.deleteEverything`) opens a
  confirmation dialog ("Delete everything?", button "Delete All My Data",
  `settings.deleteEverything.confirm`). Confirming calls `DELETE /v1/me`
  (see the web map's [delete and purge](../../verify-fineprint-web/features/delete-purge.md)).
  Only after the server answers does the device erase its rentals,
  deadlines, reminders, photos, upload queue, saved settings, and the
  anonymous sign-in. The developer menu and server address stay. A failure
  (offline, 5xx) shows `settings.deleteError` and leaves the device alone,
  so the tenant can try again.
- **Receipt**: full screen (`deletion.receipt`) in place of the tabs:
  "Everything deleted", the time, what the server removed
  (`deletion.receipt.server`: rentals and photos) and what the device
  removed (`deletion.receipt.device`). "Start Over"
  (`deletion.receipt.done`) leaves it; the receipt is never saved.
- **Left out**: share links and their access log (#35) and the AI trace
  overlay (#39) have no rows, because those features do not exist yet.
  Sign in with Apple is not built (optional in the issue).
- **Built-in server URL** (#78): the default server is the Info.plist key
  `FinePrintServerURL`, set from `ios/Config/Shared.xcconfig`. Debug is
  `http://localhost:8080`. Release is the project's deployed server,
  committed in `ios/Config/DeployedServer.xcconfig` (#53). The git-ignored
  `ios/Config/Server.xcconfig` (copy `Server.example.xcconfig`; `./deploy.sh`
  prints the line) is included last and overrides it.
  Precedence is unchanged: launch argument, developer menu, built-in default
  (the developer menu shows "Default" as the source).

## How to get to it (user POV)

Gear in any tab > Settings. Scroll to Your Data > Delete Everything….

## Driving it with e2e

`tests/ios/delete-everything.e2e.ts` taps through Settings, confirms, and
checks the receipt. It reads what is left from the emulators (Firestore
REST on 8190 with `Authorization: Bearer owner`, the Auth emulator's
`accounts:batchGet` on 9199, the Storage emulator's object list on 9290)
and the `deleted everything` line in `.e2e/logs/server-ios.log`. The second
test keeps a fixture photo first and checks its bytes leave Cloud Storage.
Unit tests: `ios/FinePrintTests/DataDeletionTests.swift` (settings, delete
flow, local erase) and `ServerURLTests.swift` (the plist default).

To check the Release default, build Release and read the plist:

```sh
xcodebuild -project ios/FinePrint.xcodeproj -scheme FinePrint -configuration Release \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath /tmp/fp-release CODE_SIGNING_ALLOWED=NO build
plutil -extract FinePrintServerURL raw /tmp/fp-release/Build/Products/Release-iphonesimulator/FinePrint.app/Info.plist
```

## Proof

The receipt on screen, the `deleted everything` log line with counts, and
the emulator reads before and after (rentals, `users`, accounts, objects).

## Charters

```
settings-delete|ios|skeptic|Open Settings, start Delete Everything and cancel it, then confirm it; report anything deleted before the confirmation, a receipt that does not appear, or tabs that come back with old data
settings-a11y|ios|fuzzer|Open Settings at the largest text size and with VoiceOver; report any control without a name, text that is cut off, or a destructive button that looks like a normal one
```

## Gotchas

- Deleting needs the server. Offline, it fails and keeps the data.
- The receipt is full screen, so the sheet that started the delete is gone
  with the tabs; nothing in Settings shows afterwards.
- The Release build needs no signing with `CODE_SIGNING_ALLOWED=NO`; do not
  launch it against the e2e server, which expects a Debug build.
