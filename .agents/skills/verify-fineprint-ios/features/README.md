# Feature map

One file per iOS feature, from a renter's point of view. Each product
feature in spec §4.3 (F1 to F10) gets its own file as its screens land
(#11).

| Feature | Screen | Test | Status |
| --- | --- | --- | --- |
| [App shell](app-shell.md) | Tab bar, next-deadline accessory, Settings sheet | `tests/ios/smoke.e2e.ts`, `tests/ios/app-shell.e2e.ts` | tested |
| [Developer menu](developer-menu.md) | Settings > Version (5 taps) > Developer Options | none | untested |
