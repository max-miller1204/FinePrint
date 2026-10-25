# Lease scan, OCR, and redaction review

The first half of F1 Lease Explainer (spec §4.3 F1, §9.2, #17): the tenant
adds the current rental's lease, the phone reads it and hides personal
details, and the tenant reviews what is hidden. Nothing is uploaded yet: the
lease route (#16) does not exist, so the app builds the upload body and shows
it, and stops there.

## Sub-features

- Lease tab empty state ("No lease yet") with Scan Lease (`lease.scan`,
  VisionKit document camera) and Import PDF (`lease.importPDF`, file picker).
  Without a document camera (simulators), Scan shows an inline note
  (`lease.scanUnavailable`) to import a PDF instead. The file picker and the
  document camera are presented by `RootTabView`, above the tabs
  (`AppNavigation.systemPicker`, `App/SystemPickers.swift`).
- Reading: a PDF page's text layer when it has 20 or more letters, otherwise
  Vision OCR (`RecognizeTextRequest`, accurate) of the page rendered at
  1700 px wide. Scanned pages are always OCR'd. Progress (`lease.progress`):
  "Reading your lease…", then "Finding personal details to hide…", both
  announced to VoiceOver. Errors show `lease.error` with Try Again
  (`lease.tryAgain`).
- Redaction (`PIIDetector`, all on device, off the main actor): patterns for
  SSN, routing (label or ABA checksum), bank account, card (Luhn), email,
  date of birth (label plus `NSDataDetector` date), driver's license, phone;
  `NSDataDetector` phone, street address, link (`.gov` links kept); labelled
  fields ("Tenant: …", `Name ("Landlord")`, "the owner, Name,"); `NLTagger`
  names, places, organizations. Lease terms (amounts, term dates, statute
  citations, "Virginia") stay. Placeholders are per role or kind and
  numbered in text order: `[TENANT_1]`, `[LANDLORD_1]`, `[SSN_1]`, `[HIDDEN_1]`
  for the tenant's own additions. A name's single words and a company name
  without "LLC" are hidden with it, ignoring case and accents.
- Redaction review screen, pushed onto the Lease tab's stack (opens by itself
  after reading; again from Review Hidden Details, `lease.review`): Details / Lease Text segmented control
  (`lease.review.mode`). Details lists each detail as one toggle button
  (`lease.redaction.<PLACEHOLDER>`, e.g. `lease.redaction.TENANT_1`; VoiceOver
  value "Hidden" or "Sent as written"), grouped by People, Companies,
  Addresses and Places, Phone, Email, and Web, Numbers and IDs, Added by You.
  The footer counts hidden details (`lease.review.hiddenCount`). Hide More
  Text (`lease.review.add`) opens inline rows (`lease.hide.field`,
  `lease.hide.confirm`, `lease.hide.notFound`, `lease.hide.cancel`) that hide
  the text everywhere it appears. Lease Text highlights and underlines each
  hidden detail; VoiceOver reads "Jordan Lee, hidden," at each, has a
  "Hidden Details" rotor, and Show/Hide actions per detail. Showing a Social
  Security, account, routing, card, or license number or a date of birth
  asks first in rows under it ("Send as Written",
  `lease.review.confirmShow`, or "Keep Hidden", `lease.review.keepHidden`).
  Cancel and Done
  are toolbar buttons (drive them by role and name).
- After Done: the summary (`lease.status` "Personal details hidden"), pages,
  how they were read ("Scanned pages", "The PDF's text", or a mix), the
  hidden count (`lease.hiddenCount`), See What Gets Sent (`lease.sentPreview`,
  enabled once reviewed), and Remove Lease (`lease.remove`, then an
  inline question: `lease.remove.confirm` or `lease.remove.cancel`).
- What Gets Sent shows the upload body's `redactedText`
  (`lease.sentText`), built by `LeaseUpload.body(for:)`. `LeaseUpload.make`
  only builds an upload for the current rental's reviewed lease once the
  rental has a server ID; the body is `{redactedText, pageCount,
  ocrConfidence}` and nothing else.
- Each rental has its own lease (`Rental.current(in:)`). The original PDF or
  scan and `lease.json` (text plus the redaction map) live in Application
  Support/Leases/<rentalId>/ with complete file protection, excluded from
  iCloud and Finder backups (a temporary folder under
  `-FinePrintInMemoryStore`). Every place a detector found a detail is saved
  as a span and always replaced; matching also ignores case, accents, curly
  apostrophes, dash variants, and line wraps.
- DEBUG fixture (`-FinePrintFixtureLease <pdf>`): Import PDF reads the file
  as a PDF, Scan renders its pages and OCRs them like document camera images.
  e2e passes `e2e/fixtures/lease/fixture-lease.pdf` (page 1 text layer, page 2
  image only).

## How to get to it (user POV)

Lease tab > Scan Lease or Import PDF > review hidden details > Done > See
What Gets Sent.

## Driving it with e2e

- `tests/ios/lease.e2e.ts`: imports the fixture, checks details from both
  pages in the review, hides "grace period", turns the portal link off,
  checks the Lease Text VoiceOver label, then reads `lease.sentText` and
  checks that none of `e2e/fixtures/lease/personal-details.json` is in it.
  A second test scans the fixture, adds a Norfolk rental (no lease there),
  switches back, and removes the lease.
- Reading and OCR take a while on a loaded simulator: give the first review
  assertion `{ timeout: 90_000 }`.
- Unit tests: `ios/FinePrintTests/LeaseRedactionTests.swift` (table-driven
  patterns and near misses, the redaction map, the fixture's upload body,
  current-rental scoping, the store).

## Proof

The sent text contains `[TENANT_1]`, `[SSN_1]`, `[HIDDEN_1]` and the lease
terms ($1,450.00, 55.1-1226), and none of the fixture's names, numbers, or
addresses. The server log has no lease request.

## Charters

```
lease-redaction-miss|ios|skeptic|Import the lease from the Lease tab, open the review and the Lease Text view, and report any name, phone number, address, email, or ID number that is not highlighted, or any amount, date, or statute citation that is hidden
lease-review-worst-case|ios|fuzzer|Import the lease, then in the review hide very long phrases, text with emoji or accents, text that is not in the lease, and turn many details on and off; report a row you cannot read at large text sizes, a count that does not change, or What Gets Sent showing a detail that is still marked hidden
```

## Gotchas

- No sheet, alert, or dialog may be presented from inside the Lease tab. With
  the deadline accessory (`tabViewBottomAccessory`) showing and accessibility
  on (VoiceOver or e2e), one sends SwiftUI into an AttributeGraph cycle: the
  main thread spins in `print_cycle`, snapshots time out with "Daemon request
  timed out", and the app never recovers. A host-side bisect (#17) showed
  that a review sheet stalled, the same screen pushed did not, and removing
  the accessory removed the stall. Push screens, ask in rows, or present
  from `RootTabView` (#99).

- `NLTagger` results vary by OS version; the labelled-field detector is what
  makes the fixture deterministic. Fixture names all appear in a labelled
  field at least once.
- Do not add real personal data to the fixture. Regenerate it with
  `swift e2e/fixtures/generate-lease.swift`.
