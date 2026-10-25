# Move-in walkthrough

The guided room-by-room capture behind F2 Move-in Evidence (spec §4.3 F2,
#25): Start Move-In Walkthrough, choose rooms, a checklist per room, item
progress, Mark No Damage, then Seal Move-In Report. Sealing signs the
photos on the server (#24) and starts the landlord's report clock.

## Sub-features

- Empty state on the Evidence tab: "No move-in photos
  yet", the 5-day rule in one passage, and "Start Move-In Walkthrough"
  (`walkthrough.start`). It sits below any deadline cards.
- Choose Rooms sheet: presets Kitchen, Bathroom, Bedroom, Living room,
  Hallway, Exterior (`walkthrough.room.<kitchen|bathroom|bedroom|living_room|hallway|exterior>`;
  selected rows are `isSelected`), and the tenant's own rooms
  (`walkthrough.customRoomField`, `walkthrough.addCustomRoom`; a name is cut
  at 60 characters, and a name already used is refused with
  `walkthrough.customRoomError`). The pinned button
  (`walkthrough.rooms.confirm`, "Start Walkthrough", or "Add to
  Walkthrough" when adding to one in progress) is disabled until a room is
  chosen. `walkthrough.rooms.cancel` closes the sheet.
- Checklists: presets get walls, floor, ceiling, windows, doors, outlets and
  switches, fixtures, and (kitchen) appliances, as fits the room (Hallway
  has no windows; Exterior has walls, windows, doors, fixtures). A room the
  tenant names gets the common seven.
- Walkthrough screen (`WalkthroughView`): "N of M done" and a bar
  (`walkthrough.progress`), a row per room (`walkthrough.roomRow.<name, lowercase, dashes>`, such as
  `walkthrough.roomRow.hallway`), Add Rooms (`walkthrough.addRooms`), and Seal Move-In Report
  (`walkthrough.seal`, Cmd-Return), disabled until one photo is kept.
- Room screen: "N of M done" (`walkthrough.roomProgress`) and one row per
  item (`walkthrough.item.<name, lowercase, dashes>`, such as
  `walkthrough.item.walls` or `walkthrough.item.outlets-and-switches`). A
  row says "Not checked", "Photographed", or "No damage", and photographed
  rows show the seal status pill. Tap opens the camera; swipe, long press,
  or the VoiceOver action marks no damage or puts it back.
- Camera additions (`CameraScreen` with walkthrough controls): the item,
  room, and "N of M done" (`camera.progress`), and Mark No Damage
  (`camera.markNoDamage`), which records the item without a photo and
  closes the camera. Keeping a photo marks the item photographed; an item
  can have several photos.
- Seal: if items are unchecked, a confirmation appears in the list ("Seal Anyway", `walkthrough.seal.confirm`, or "Keep
  Checking", `walkthrough.seal.keepChecking`). The sealer waits for kept photos to upload, calls
  `POST /v1/rentals/:id/seal` with session `move_in`, marks the photos
  Sealed, records the manifest ID on the walkthrough, starts the landlord's
  report clock, and plays the success haptic. Offline, or while photos are
  still uploading, the screen says so (`walkthrough.sealError`) and the
  walkthrough stays open to try again.
- Sealed (`walkthrough.sealed`): the Sealed pill, when, and the 5-day note.
  Rooms and items are read-only. The Evidence card (`walkthrough.card`) says
  Sealed, and `walkthrough.open` reads "View Walkthrough".
- The landlord's report clock: `DeadlineStore.startMoveInReportClock`. A
  rental that already has the clock (from onboarding, running or closed)
  keeps it. Otherwise it starts on the rental's occupancy date, or on the
  day the walkthrough began when there is none. Sealing never asks for
  notification permission; the card offers Remind Me.
- Scoping (#46): a walkthrough belongs to the rental that was current when
  it started (`Rental.walkthroughs`, deleted with the rental). Another
  rental shows its own empty state.
- A "no damage" mark is the tenant's word and stays on the device. Only
  photos are in the signed manifest, so a seal needs at least one photo.

## How to get to it (user POV)

Evidence tab > Start Move-In Walkthrough.

## Driving it with e2e

- `tests/ios/walkthrough.e2e.ts` has three tests: the empty state and the
  room picker's rules; a full walkthrough
  (Hallway and Exterior, a photo with the fixture camera, a Mark No Damage, Seal Anyway)
  that checks the server log (`evidence received`, `manifest sealed`), the
  `deadline.card.move_in_report` card, and the accessory; and the same
  screens at the largest accessibility text size (it sets and then restores
  the simulator's size with `xcrun simctl ui booted content_size`, and
  saves screenshots).
- The default Richmond rental ("Living there", no occupancy date) has no
  report clock, so sealing creates it; the test checks that.
- The nav bar's back button is named after the previous screen's title
  ("Move-In Walkthrough", "Evidence"). iOS 26 lists a toolbar button twice,
  so find it by role and name. The sealing confirmation is in the list, not a system dialog:
  a `confirmationDialog` on this list froze the screen (an AttributeGraph cycle in the
  accessibility graph, found by bisecting the screen).
- `ios/FinePrintTests/WalkthroughTests.swift` covers presets and
  checklists, progress, no-damage and reopen rules, room names, the sealed
  walkthrough being read-only, rental scoping and cascade delete, the clock
  (occupancy versus walkthrough day, keeping an existing clock), and the
  sealer (upload wait, offline, server error then retry, refused photos,
  nothing to seal, sealed status surviving a relaunch).
- VoiceOver is checked through the accessibility tree: the shutter reads
  "Take photo of Walls in Hallway", rows are one element with a state
  value and a hint, the pill reads its status, the progress bar reads "N of
  M done", and failures and a successful seal are announced. Spoken output
  needs a person with VoiceOver on a device.

## Proof

After Seal Anyway the screen shows the Sealed pill, `server-ios.log` has one
`manifest sealed` line (and `evidence received` for the photo), and the
Evidence tab shows `deadline.card.move_in_report` and the accessory
"Landlord's move-in report due".

## Charters

```
walkthrough-rooms|ios|fuzzer|Start a move-in walkthrough with every preset and several custom rooms, one with a very long name and one that repeats a preset; open each room, then add more rooms from the walkthrough; report truncated or overlapping text, a room that cannot be opened, or a name accepted twice
walkthrough-seal|ios|skeptic|Keep a photo, mark another item no damage, and seal with Simulate Offline on and then off; report a seal that succeeds offline, a clock that starts without a seal, or a sealed walkthrough that still lets you add photos
```

## Gotchas

- The fixture camera has three photos and wraps around; every shutter in a
  walkthrough takes the next one, starting again each time the camera opens.
- Sealing waits up to 60 seconds for photos to upload; with
  `developer.simulateOfflineToggle` on it fails at once with the offline
  message.
- A sealed walkthrough cannot take more photos. A second walkthrough for the
  same rental is not offered yet.
- Refs #99: with the deadline accessory up, a presentation made from inside a
  tab froze the screen. The room picker is presented by `RootTabView`
  (`AppNavigation.roomPicker`), and the seal confirmation is inline instead of
  a `confirmationDialog`. Each button in a confirmation sits in its own list row.
- Typing is slow on the simulator, so the e2e does not add a typed room; the
  unit tests cover the room rules.
- The confirmation only shows when some item is unchecked; a walkthrough with
  every item done seals straight away.
