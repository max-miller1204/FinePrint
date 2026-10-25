# TestFlight distribution

How the team and beta testers get the app (#53, spec §15.3). Setup and
secrets: [docs/testflight.md](../../../../docs/testflight.md).

## Sub-features

- `.github/workflows/testflight.yml` runs on a `macos-26` runner (Xcode 26)
  on every push to `main` that changes `ios/`, and by hand
  (`gh workflow run testflight.yml`).
- Signing is cloud-managed and automatic: the App Store Connect API key
  (secrets `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8`, Admin role) and the
  team in the `APPLE_TEAM_ID` variable. No certificates or profiles in git.
- The build number is `<run number>.<attempt>`; the version is
  `MARKETING_VERSION`.
- Release builds talk to the server in `ios/Config/DeployedServer.xcconfig`.
- `ITSAppUsesNonExemptEncryption` is `NO`, so App Store Connect asks no export
  compliance question per build.
- The app icon is `ios/FinePrint/Assets.xcassets/AppIcon.appiconset` (one
  1024 px PNG, no alpha). It is a placeholder.

## How to get to it (user POV)

Install TestFlight on the iPhone, accept the invite, and install FinePrint.

## Driving it with e2e

No e2e test: the run is the check. The "Check the archived app" step fails
the run when the archived Info.plist has the wrong build number, or a server
URL that is not `https` or is `localhost`. Watch a run with
`gh run watch <id> --exit-status`.

## Proof

The run summary shows `FinePrint <version> (<build>)` and its server, and the
export log ends with `Upload succeeded` and `** EXPORT SUCCEEDED **`. The
build then shows in App Store Connect > the app > TestFlight within 5 to 30
minutes.
