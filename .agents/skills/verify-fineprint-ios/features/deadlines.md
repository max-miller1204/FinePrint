# Deadlines and reminders

The Virginia clocks behind the product (spec §2.1, §4.1, §4.2 step 5, §4.3
F3 and F6, #29): the landlord's move-in report (5 days from occupancy, Va.
Code § 55.1-1214), the tenant's written objection (5 days from receiving
that report, § 55.1-1214), and the deposit itemization (45 days from
tenancy end, § 55.1-1226). Deadlines are SwiftData `Deadline` rows that
belong to a `Rental`, counted in whole calendar days on `CalendarDay`.

## Sub-features

- Seeding: onboarding calls `DeadlineStore.seedInitialDeadlines(for:)`.
  "Just moved in" / "Living there" with an occupancy date starts the
  landlord's report clock; "Moving out" / "Ended" with an end date starts
  the deposit clock. Seeding never asks for notification permission.
- Accessory (`deadlineAccessory`): the soonest deadline due today or later;
  if none, the latest one that passed in the last 7 days ("Past due"). It
  hides when nothing is due. Tapping it selects the deadline's tab
  (Evidence for all three kinds today) and scrolls to its card.
- Evidence lists one card per deadline (`deadline.card.<kind>`, kinds
  `move_in_report`, `objection`, `deposit_itemization`): title, due day,
  countdown, a plain-language explanation, and the citation.
- Landlord's report card: "I Got the Report" (`deadline.reportReceived`)
  opens a date sheet (defaults to today; `dayEntry.save` "Start Clock",
  `dayEntry.cancel`). Saving closes the landlord's clock and starts the
  objection clock.
- Deposit tracker: the deposit card adds "Give your landlord your forwarding
  address in writing" (`deposit.forwardingAddress`) and the right to be at
  the move-out inspection (`deposit.inspection`). When the rental is moving
  out with no end date, a "Deposit Tracker" card (`deposit.moveOutCard`)
  offers "Add Move-Out Date" (`deposit.addMoveOutDate`).
- Reminders: local notifications at 9 a.m. local time on the 2 days before
  the due day (day 3 and day 4 of a 5-day clock). Permission is asked only
  from an in-app action: "Remind Me" (`deadline.remindMe`) on a card,
  "Start Clock" after recording the report, or adding a move-out date. Once
  given, the card shows "Reminders at 9 a.m. on ..." (`deadline.remindersOn`);
  if refused, "Notifications are off" with Open Settings
  (`deadline.openSettings`). Changing a date reschedules; finishing or
  removing a deadline cancels its reminders.

## How to get to it (user POV)

Finish onboarding with "Just moved in" (or "Moving out" with a date). The
accessory shows the clock; tap it to land on its card in Evidence.

## Driving it with e2e

- `tests/ios/deadlines.e2e.ts` relaunches with `-FinePrintSeedDeadline
  <kind>` (DEBUG) to start a clock today. It reinstalls the app to start
  from "never asked" (the simulator cannot reset notification permission),
  then proves seeding showed no prompt, and allows reminders by tapping
  Remind Me and accepting the system prompt. It checks the accessory text, the Evidence card, the
  Remind Me state, the report-received flow, the deposit tracker, and the
  hidden accessory with `-FinePrintDeadlineStub empty`.
- `ios/FinePrintTests/DeadlineStoreTests.swift` covers day math in
  America/New_York, Pacific/Honolulu, and Asia/Tokyo, both DST changes,
  reminder trigger times, seeding per phase, no permission request from
  seeding, rescheduling and cancelling, and the accessory's pick.
- Locators: `getByTestId('deadlineAccessory')`, the `deadline.*`,
  `deposit.*`, and `dayEntry.*` ids above.

## Proof

After the seeded launch, the accessory reads "Next deadline: Landlord's
move-in report due, 5 days left" and no permission alert is on screen;
after the tap, Evidence is `[selected]` and `deadline.card.move_in_report`
is visible. After Start Clock, the accessory reads "Object to move-in
report" and "5 days left".

## Charters

```
deadlines-accessory|ios|skeptic|Launch with -FinePrintSeedDeadline move_in_report, tap the accessory from every tab, record the landlord's report with several dates, and report any accessory that opens the wrong tab, shows a stale countdown, or keeps a clock that was closed
deadlines-permission|ios|skeptic|Launch with -FinePrintSeedDeadline objection and notification permission reset; report any notification prompt that appears before you tap Remind Me, Start Clock, or Add Move-Out Date, and any card that still offers Remind Me after you answered
deadlines-a11y|ios|fuzzer|With -FinePrintSeedDeadline deposit_itemization, use the largest accessibility text size and VoiceOver order on the Evidence cards; report truncated deadline text, a countdown read without its title, or a control without an accessible name
```

## Gotchas

- DEBUG builds with no `-FinePrintDeadlineStub` show real deadlines, and
  the sample "Object to move-in report" only when nothing real is due.
  `present` forces the sample over real deadlines; `empty` turns the sample
  off but real deadlines still show. The developer toggle switches between
  `present` and `empty` behavior.
- A relaunch's `launchArguments` replace the target's, so the test repeats
  the server, in-memory, and developer-menu arguments.
- A reminder whose 9 a.m. has passed is not scheduled, so a clock started
  late may have one reminder or none.
- Simulators deliver local notifications, but the e2e tests check what the
  card says, not the banner.
