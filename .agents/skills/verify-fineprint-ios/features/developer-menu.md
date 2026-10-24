# Developer menu

Hidden developer options in Settings: the server URL in use and where it
came from, and in DEBUG builds, the sample-deadline switch.

## Sub-features

- 5 taps on the Version row (`settings.version`) within 3 seconds show a
  Developer section (`settings.developerOptions`). It stays shown across
  launches until you choose Hide Developer Options (`developer.hide`).
- `developer.activeServerURL` shows the URL in use, and
  `developer.serverURLSource` shows where it came from: Default, Saved here, or
  Launch argument.
- Set (`developer.serverURLField`, `developer.saveServerURL`) and reset
  (`developer.resetServerURL`) the saved URL. An invalid URL shows
  `developer.serverURLError`.
- DEBUG builds only: `developer.sampleDeadlineToggle`.

## How to get to it (user POV)

Gear > Settings > tap Version 5 times quickly > Developer Options.

## Driving it with e2e

Untested. A scripted `tap()` takes about 1.2 s and a `doubleTap()` about
1.7 s, so the fastest mix tried (two double taps and a tap) took about
4.6 s, past the 3 s window. Nothing scripted unlocks the menu yet. Ways
to fix it, in the app: a DEBUG launch argument that starts with the menu
unlocked, or a longer window under UI tests. Under the e2e target,
expect Source "Launch argument" and URL `http://127.0.0.1:18080`.
`ios/FinePrintTests/LaunchOptionsTests.swift` and `ServerURLTests.swift`
cover the parsing.

## Proof

`developer.serverURLSource` reads "Launch argument" and
`developer.activeServerURL` matches the e2e server.

## Charters

```
developer-menu-url|ios|fuzzer|Unlock the developer menu from Settings and try saving empty, relative, ftp, and very long server URLs; report any invalid URL that saves or any valid one that is rejected
```

## Gotchas

- While a launch argument is set, a saved URL takes effect only on the next
  launch without that argument. The footer says so, and this is by design.
