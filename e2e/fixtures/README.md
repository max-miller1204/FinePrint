# e2e fixtures

## photos/

Photos for the DEBUG fixture camera (`-FinePrintFixtureCamera <dir>`, spec §12.1). Simulators have
no camera, so the app returns these files from the shutter and runs the real capture pipeline on
them: GPS removal, SHA-256, model copy, quality gate, capture record.

- `photos/move-in/` and `photos/move-out/` hold the same three views under the same file names
  (`01-kitchen-wall`, `02-bathroom-tile`, `03-bedroom-door`). Move-out is the same view framed a
  few pixels differently and with a dark scuff mark, so a pair shows what the ghost overlay should
  reveal.
- The app takes the photos in file name order and wraps around after the last.
- 1200x900 JPEGs, about 110 to 150 KB each, with no EXIF or location.

They are our own content, drawn by `generate-photos.swift` (CoreGraphics and ImageIO, fixed random
seed). To regenerate them, from the repository root:

```
swift e2e/fixtures/generate-photos.swift
```

The e2e config passes the absolute host path of `photos/move-in` in the launch argument. The
simulator process reads the Mac's filesystem directly, so nothing is copied into the app container
and nothing is bundled: the photos are not in the app target, and the Release binary has no
fixture code (`FixtureCameraSource` and the argument are under `#if DEBUG`).

## lease/

`lease/fixture-lease.pdf` is a two-page Virginia lease for the DEBUG fixture lease
(`-FinePrintFixtureLease <pdf>`, #17). Page 1 has a text layer; page 2 is an image only, like a
scanned page, so Import PDF reads one page from the text layer and OCRs the other. Every personal
detail in it is made up (555-01xx phone numbers, an SSN from the 987-65-432x example range,
example domains) and listed in `lease/personal-details.json`, which the unit tests and
`tests/ios/lease.e2e.ts` check are absent from the text that would be uploaded. Regenerate it from
the repository root:

```
swift e2e/fixtures/generate-lease.swift
```
