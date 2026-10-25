# App shell

The frame every screen lives in (spec §4.3, the Lease, Evidence, Repairs,
Letters, and Ask surfaces). For now, each tab shows a placeholder screen.

## Sub-features

- A tab bar with Lease, Evidence, Repairs, Letters, and Ask. Ask is the
  search-role tab at the trailing edge.
- Each tab opens on a placeholder with a title and a short description.
  Lease shows "No lease yet".
- The next-deadline accessory sits above the tab bar and reads "Next
  deadline: <title>, <countdown>". Tapping it opens the deadline's flow
  (Evidence for every kind today). It shows the most urgent real deadline
  (see [deadlines.md](deadlines.md)); DEBUG builds show a sample "Object to
  move-in report" deadline when nothing real is due.
- The gear (`settingsButton`) in every tab opens Settings as a sheet. Close
  (`settings.close`) dismisses it.

## How to get to it (user POV)

Open the app. No account and no network needed.

## Driving it with e2e

- `tests/ios/smoke.e2e.ts` (Doctor) checks that all 5 tabs are visible and
  that the Lease empty state shows.
- `tests/ios/app-shell.e2e.ts` taps the accessory and checks that the
  Evidence tab is selected and its empty state shows. It also opens and
  closes Settings.
- Locators: `getByRole('tab', { name })`, `getByTestId('deadlineAccessory')`,
  `getByTestId('settingsButton')`, `getByTestId('settings.close')`.

## Proof

After the tap, the Evidence tab is `[selected]` in the screen tree and "No
move-in photos yet" is on screen. With `--video on`, the recording shows
the tap and the switch.

## Charters

```
app-shell-tabs|ios|skeptic|Visit every tab, open and close Settings from each, and tap the deadline accessory from each tab; report any tab that opens the wrong screen, a Settings sheet that will not close, or an accessory that does not land on Evidence
app-shell-a11y|ios|fuzzer|Rotate the device and switch tabs rapidly; report any control without an accessible name, a tab bar that disappears and does not come back, or an accessory that overlaps the tab bar
```

## Gotchas

- `tabBarMinimizeBehavior(.onScrollDown)` shrinks the tab bar on scroll. A
  minimized tab bar is by design.
- `-FinePrintDeadlineStub empty` hides the sample (real deadlines still
  show), but the target does not pass it. To test the empty state, use `device.openApp` with
  `relaunch: true` and the `-FinePrintDeadlineStub empty` argument.
