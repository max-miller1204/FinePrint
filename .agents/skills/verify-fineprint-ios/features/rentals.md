# Rentals and the rental switcher

A renter can have more than one rental, and every tab shows one of them
(spec §4.1, #46). Rentals live on the device in SwiftData and are created
on the server with `POST /v1/rentals`, like the onboarded one.

## Sub-features

- The house button (`rentalSwitcher`, accessible name "Rentals", value the
  current rental's name) at the leading edge of the Lease tab's navigation
  bar opens a menu: one checkmarked row per rental (its city or county, and
  its phase on a second line), then Add Rental (`rentalSwitcher.add`).
- Add Rental opens a sheet with onboarding's "Where do you rent?" and
  "Where are you in your rental?" steps (same `onboarding.*` ids). The
  finish button reads "Add Rental" (`onboarding.finish`); Cancel
  (`addRental.cancel`) closes it. The new rental becomes current and gets
  the deadlines its phase implies, like an onboarded one.
- The current rental is the one picked last in the switcher, or a rental
  added after that pick (`Rental.current(in:)`, stored as
  `Rental.selectedAt`, so it survives relaunch).
- Every tab scopes to the current rental: the Evidence deadline cards, the
  move-out date card, the next-deadline accessory, and the developer
  camera's rental. Reminders still fire for every rental's deadlines.
- With two or more rentals, every tab's navigation bar names the current
  rental under its title (`navigationSubtitle`). With one, there is no
  subtitle.

## How to get to it (user POV)

Lease tab > house button (top left) > Add Rental, or pick a rental.

## Driving it with e2e

- `tests/ios/rentals.e2e.ts` adds Norfolk ("Just moved in") next to the
  default Richmond rental, checks Norfolk on every tab, its move-in card,
  the accessory, and Norfolk's "rental created" server log line, then switches
  back to Richmond and checks every tab again. A second test cancels Add
  Rental.
- iOS 26 lists a toolbar button twice (its container and the button), so
  open the switcher with `getByRole('button', { name: 'Rentals' })` and pick
  a rental by its text.

## Proof

After each switch, every tab's navigation bar shows the rental's name and
the accessory shows that rental's deadline ("Landlord's move-in report
due" for Norfolk, the DEBUG sample for Richmond). The server log has one
"rental created" line per rental.

## Charters

```
rentals-switch|ios|skeptic|Add a second and a third rental from the Lease tab's house button, switch between them, and visit every tab after each switch; report any tab, deadline card, or accessory that shows another rental's data, or a switch that does not stick after leaving and returning to the Lease tab
rentals-worst-case|ios|fuzzer|Add rentals with very long typed town names, two rentals in the same city, and a rental outside Virginia; report a truncated or overlapping navigation bar, a switcher row you cannot tell apart, or an Add Rental sheet that saves without a place and phase
```

## Gotchas

- `-FinePrintSeedDeadline` adds a "Sample rental" with no city, so a test
  that combines it with Add Rental has two rentals from the start.
