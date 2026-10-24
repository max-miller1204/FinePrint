# Onboarding

First launch (spec §4.2, #40): a tenant with no account is set up in under
30 seconds. It shows whenever no rental exists on the device.

## Sub-features

- Welcome (`onboarding.disclosure`): one sentence of value and "Not a
  lawyer. Built on Virginia law." Continue is `onboarding.continue`.
- Language (`onboarding.language.en`, `onboarding.language.es`): defaults to
  the device language. The choice is stored (`FinePrint.language`). Only
  English is localized today, so Español changes nothing visible until #45.
- Where do you rent: a state menu (`onboarding.state`, Virginia by default),
  a search box (`onboarding.place.search`) over the 95 counties and 38
  independent cities (rows `onboarding.place.<name>-<city|county>`, for
  example `onboarding.place.richmond-city`), and "Use "x"" for a town that
  is not listed (`onboarding.place.custom`). Another state shows "FinePrint's
  legal checks only cover Virginia. Evidence tools still work."
  (`onboarding.outsideVirginia`) and a city field (`onboarding.place.city`);
  Continue stays available once a city is typed. Only the city or county is
  kept, never a street address (spec §6.3).
- Where are you in your rental: Before signing (`onboarding.phase.pre_signing`,
  lands on Lease), Just moved in (`move_in`, Evidence, occupancy date today),
  Living there (`living`, Repairs), Moving out (`move_out`, Evidence). Then
  `onboarding.finish` ("Get started"). `onboarding.back` goes back a step.
- The rental is saved on the device first, then created with
  `POST /v1/rentals`; the server logs "rental created". Offline, or before
  sign-in finishes, it is retried on foreground and when sign-in succeeds.
- No notification prompt: permission is asked in context later.

## How to get to it (user POV)

Install fresh and open the app. There is no way back to onboarding once a
rental exists, short of reinstalling.

## Driving it with e2e

- The ios target launches with `-FinePrintSkipOnboarding` (default Virginia
  rental: Richmond, living there, created on the server the same way), so
  other tests start at the tabs.
- `tests/ios/onboarding.e2e.ts` relaunches with `device.openApp(bundleId, {
  relaunch: true, launchArguments })`, which replaces the target's arguments
  (leave `-FinePrintSkipOnboarding` out). It times a full Virginia run
  (under 30 s), checks the Evidence tab, no system alert, and the server log
  line; checks the outside-Virginia message; and checks the skip launch.
- `ios/FinePrintTests/OnboardingTests.swift` covers phase to tab, the rental
  fields, outside-Virginia detection, the bundled list, language default, and
  the server create (success, offline then retry, error).

## Proof

Onboarding ends on the tab for the chosen phase, `onboarding.continue` is
gone, and `e2e/.e2e/logs/server-ios.log` has one more "rental created" line.

## Charters

```
onboarding-edges|ios|skeptic|Go through onboarding with odd input: search for a town, type a very long city, pick another state and go back to Virginia, rotate the device, and use the largest text size; report any state where Continue is stuck, text is cut off, or a step cannot be reached
```

## Gotchas

- `-FinePrintInMemoryStore` means every launch is a first launch, so
  onboarding only shows without `-FinePrintSkipOnboarding`.
- Search matches every word of the query in the name ("fairfax county"). The
  city and the county of one name are separate rows (Richmond, Richmond County).
- Deadlines come from `DeadlineStore.seedInitialDeadlines` (#29).
