# Feature map

One file per iOS feature, from a renter's point of view. Each product
feature in spec §4.3 (F1 to F10) gets its own file as its screens land
(#11).

| Feature | Screen | Test | Status |
| --- | --- | --- | --- |
| [App shell](app-shell.md) | Tab bar, next-deadline accessory, Settings sheet | `tests/ios/smoke.e2e.ts`, `tests/ios/app-shell.e2e.ts` | tested |
| [Onboarding](onboarding.md) | First launch: welcome, language, city or county, rental phase | `tests/ios/onboarding.e2e.ts`, `ios/FinePrintTests/OnboardingTests.swift` | tested |
| [Developer menu](developer-menu.md) | Settings > Version (5 taps) > Developer Options | `tests/ios/auth.e2e.ts` (opens it) | partly tested |
| [Anonymous sign-in](sign-in.md) | No screen; shown in Developer Options > Account | `tests/ios/auth.e2e.ts` | tested |
| [Evidence camera](camera.md) | Developer Options > Camera > Open Camera (full-screen camera, review); DEBUG fixture camera `-FinePrintFixtureCamera <dir>` (#22) | `tests/ios/capture.e2e.ts`, `tests/ios/camera.e2e.ts` (no-camera state), `ios/FinePrintTests/CaptureTests.swift`, `ios/FinePrintTests/FixtureCameraTests.swift` | partly tested |
| [Evidence upload queue and seal status](evidence-upload.md) | Use Photo in the camera; Developer Options > Camera > Seal Status, Waiting to Upload, Simulate Offline | `tests/ios/capture.e2e.ts` (offline, then upload), `ios/FinePrintTests/UploadQueueTests.swift` | tested |
| [Rentals and the rental switcher](rentals.md) | Lease tab > house button: pick a rental or Add Rental; the current rental's name under every tab's title (#46) | `tests/ios/rentals.e2e.ts`, `ios/FinePrintTests/DeadlineStoreTests.swift` (scoping) | tested |
| [Settings, delete everything, and the built-in server URL](settings.md) | Gear > Settings: language, reading level, impact count, Delete Everything and its receipt (#44); the Release default server URL (#78) | `tests/ios/delete-everything.e2e.ts`, `ios/FinePrintTests/DataDeletionTests.swift`, `ios/FinePrintTests/ServerURLTests.swift` | tested; share links (#35) and AI trace (#39) rows not built |
| [Deadlines and reminders](deadlines.md) | Next-deadline accessory; Evidence tab deadline cards, Remind Me, deposit tracker | `tests/ios/deadlines.e2e.ts`, `ios/FinePrintTests/DeadlineStoreTests.swift` | tested |

## Planned features (spec §4.3)

Each one gets a file in this folder as its screens land. So far F2 has
[camera](camera.md) and [evidence upload](evidence-upload.md), and F3 and F6
share [deadlines](deadlines.md).

| Feature | Screen | Board issues | Status |
| --- | --- | --- | --- |
| F1 Lease Explainer | Lease tab: scan, redaction review, findings list, key terms card, clause explorer | #17, #18 | not built |
| F2 Move-in Evidence | Evidence tab: start move-in, rooms, checklist, capture screen, seal | #21 (camera), #22, #23, #25 (walkthrough), #26 | camera (#21), fixture camera (#22), upload queue and seal status pill (#23) built; rest not built |
| F3 Landlord Report Diff + 5-Day Objection | Evidence tab: landlord report, diff, countdown; Letters tab: objection | #28, #29, #30 | deadlines and the countdown built (#29); rest not built |
| F4 Responsibility Check | Repairs tab: new issue, result card | #31 | not built |
| F5 Repair Request + Rent Escrow Path | Repairs tab: repair notice, tracking, escrow explainer, emergency guidance | #32 | not built |
| F6 Move-out Ghost Overlay + Diff | Evidence tab: start move-out, ghost overlay camera, compare, deposit tracker | #27, #29 | deposit tracker and 45-day clock built (#29); rest not built |
| F7 Grounded Ask | Ask tab | #41 | not built |
| F8 Legal-Aid Web Evidence Report | none in the app beyond creating and revoking share links from the Evidence tab | #35 | not built |
| F9 Insurance Claim Packet | Repairs tab: add to claim packet, PDF through the share sheet | #55 | not built |
| F10 High-Stakes Handoff | Full-screen handoff sheet shown over any tab | #37, #38 | not built |
