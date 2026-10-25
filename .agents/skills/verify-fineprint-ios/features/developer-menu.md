# Developer menu

Hidden developer options in Settings: the server URL in use and where it
came from, the anonymous sign-in ([sign-in](sign-in.md)), the evidence
camera ([camera](camera.md)), the AI trace overlay (#39), and in DEBUG builds,
the sample-deadline switch.

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
- Camera: Open Camera (`developer.openCamera`) and, after a kept photo, its
  hash (`developer.lastCaptureHash`).
- AI: Show AI Trace (`developer.aiTraceToggle`), off by default and saved in
  `UserSettings.showsAITrace`. When on, a repair check's result card and each
  Ask answer end with an AI Trace box (`aiTrace`, rows `aiTrace.step.N`): one
  row per Gemma call with the model ID, stage, time, and tokens, from the
  `trace` array the server returns. A High-confidence repair check shows both
  `gemma-4-26b-a4b-it` (`responsibility`) and `gemma-4-31b-it`
  (`responsibility_verify`). Each row is one VoiceOver element in reading
  order; nothing overlays other content. Delete Everything turns it off.
- DEBUG builds only: `developer.sampleDeadlineToggle`.

## How to get to it (user POV)

Gear > Settings > tap Version 5 times quickly > Developer Options.

## Driving it with e2e

Scripted taps are too slow for the five-tap unlock (about 1.2 s per
`tap()`, past the 3 s window), so the ios target launches with the DEBUG
argument `-FinePrintDeveloperMenu`, which shows the Developer section for
that launch without saving it. `tests/ios/auth.e2e.ts` opens Developer
Options that way. The five-tap gesture itself stays untested in e2e; the
server URL rows and the AI trace toggle have no e2e test yet. Under the e2e target, expect Source
"Launch argument" and URL `http://127.0.0.1:18080`.
`ios/FinePrintTests/LaunchOptionsTests.swift` and `ServerURLTests.swift`
cover the parsing and that the argument never saves the unlock.

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
