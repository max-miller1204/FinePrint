# Feature map

One file per iOS feature, from a renter's point of view. Each product
feature in spec §4.3 (F1 to F10) gets its own file as its screens land
(#11).

| Feature | Screen | Test | Status |
| --- | --- | --- | --- |
| [App shell](app-shell.md) | Tab bar, next-deadline accessory, Settings sheet | `tests/ios/smoke.e2e.ts`, `tests/ios/app-shell.e2e.ts` | tested |
| [Developer menu](developer-menu.md) | Settings > Version (5 taps) > Developer Options | `tests/ios/auth.e2e.ts` (opens it) | partly tested |
| [Anonymous sign-in](sign-in.md) | No screen; shown in Developer Options > Account | `tests/ios/auth.e2e.ts` | tested |

## Planned features (spec §4.3)

None of these has a feature file yet. Each one gets a file in this folder as
its screens land.

| Feature | Screen | Board issues | Status |
| --- | --- | --- | --- |
| F1 Lease Explainer | Lease tab: scan, redaction review, findings list, key terms card, clause explorer | #17, #18 | not built |
| F2 Move-in Evidence | Evidence tab: start move-in, rooms, checklist, capture screen, seal | #21 (camera), #22, #23, #25 (walkthrough), #26 | not built |
| F3 Landlord Report Diff + 5-Day Objection | Evidence tab: landlord report, diff, countdown; Letters tab: objection | #28, #29, #30 | not built |
| F4 Responsibility Check | Repairs tab: new issue, result card | #31 | not built |
| F5 Repair Request + Rent Escrow Path | Repairs tab: repair notice, tracking, escrow explainer, emergency guidance | #32 | not built |
| F6 Move-out Ghost Overlay + Diff | Evidence tab: start move-out, ghost overlay camera, compare, deposit tracker | #27, #29 | not built |
| F7 Grounded Ask | Ask tab | #41 | not built |
| F8 Legal-Aid Web Evidence Report | none in the app beyond creating and revoking share links from the Evidence tab | #35 | not built |
| F9 Insurance Claim Packet | Repairs tab: add to claim packet, PDF through the share sheet | #55 | not built |
| F10 High-Stakes Handoff | Full-screen handoff sheet shown over any tab | #37, #38 | not built |
