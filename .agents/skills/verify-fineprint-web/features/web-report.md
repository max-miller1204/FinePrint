# F8: Server-rendered Evidence Report

`GET /r/:token` is a Hono JSX document, no hydration or client scripts.
The header, timeline, lease findings, exhibits, ledger and integrity limits
are present in the initial response. Print through the browser's Print menu.

## Launch and data

Use the parent skill's emulated launch. Set `REPORT_FIXTURES=1` to enable
`/r/fixture` and its synthetic photo route. Both that flag and
`FIRESTORE_EMULATOR_HOST` are required; e2e sets the flag. Without them,
fixture paths do not expose data. The fixtures use real local signatures
and the server's published key, plus a SHA-256 of a bundled JPEG.

The fixture-only **Demo data / Worst case / Empty / One** control persists
in `?data=demo|worst|empty|one`. Worst case has 25 findings, Spanish blocks,
long quotes and labels, mixed scripts and 120 exhibits. Empty has no lease,
evidence, timeline, ledger or manifests. One preserves the complete signed
history instead of rewriting manifests to fit the visible exhibit subset.

Production resolves hashed share capabilities and assembles scoped public
projections. See [share-links.md](share-links.md) for expiry, PIN, revocation,
photo authorization and owner access-log verification. `reportLoader` remains
an explicit injection seam for renderer tests.

## Proof

From `e2e/`:

```bash
pnpm exec e2e run tests/web --target web --output .e2e/proof/issue-33 --trace on --no-cache --retries 0
```

`tests/web/report.e2e.ts` covers SSR and every section, response privacy,
actual photo hashes and manifest signatures, imported-time and offline-gap
warnings, deletion numbering, separate overlays, keyboard and skip navigation,
320px and 390px phone layouts, 1440px desktop, dark mode, reduced-motion
preference, 200% text, Spanish blocks, empty/one states, and an HTML 404.

The print test uses `playwright-core` (the same Chromium version as e2e's
web engine) because the portable browser fixture has no print/PDF method.
It checks actual print media, white paper and black text even under a dark
preference, hidden navigation, separate exhibit pages, caption fit, and
visibility of signed bytes after details were collapsed. It writes a tagged
Letter PDF to `.e2e/proof/report-print/report.pdf`.

Unit tests (`server/test/report.test.ts`) cover the default closed resolver,
emulator-only fixtures, escaping, unsafe URLs, error privacy and route-only
logging, real manifest/ledger signatures after deletion, the 24h boundary,
invalid annotation boxes, missing lease data, pending and HEIC records.

Linux browser emulation does not establish hardware behavior. Real-phone
safe areas, sticky hover, touch feel, browser chrome and Safari printing
still need hardware checks. No iOS simulator or hardware was used.

## Extension points

- #34: `#verify-report`, `[data-verify-exhibit]`, `[data-manifest]` and
  `[data-ledger-entry]`; canonical JSON remains text, unchanged signed bytes.
  Add a self-hosted verification script and update CSP deliberately.
- #35: implemented share authorization and scoped projection, protected photo
  routes, lifecycle API and access log. See [share-links.md](share-links.md).
- #36: accessible landmarks, labels, headings, locale blocks, alt descriptions,
  visible focus and table headers are in place. Automated axe CI is separate.

## Explore charter

```text
web-report|web|skeptic|Open /r/fixture, switch Demo data / Worst case / Empty / One, inspect findings and separate annotations, follow section links by keyboard, compare phone and desktop layouts, and print the report. Check hashes, timestamps, deletion history, language blocks and print completeness without treating a seal as proof of capture time or legal validity. Do not expect share lifecycle, browser verification or axe CI in #33.
```
