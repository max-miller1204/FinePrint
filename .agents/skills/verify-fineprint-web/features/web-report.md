# F8: Server-rendered Evidence Report

`GET /r/:token` is a Hono JSX document, no hydration; a self-hosted vanilla JS verifier progressively enhances the document.
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

Production defaults to an unavailable report. #35 supplies
`createApp({ reportLoader })`: resolve and authorize the token, enforce expiry,
revocation, PIN and scope, then return the redacted `EvidenceReport` projection
(or null). Never use a rental ID as a public token. No share creation or
lifecycle API is implemented in #33. The projection is documented in
[web-evidence-report.md](../../../../docs/web-evidence-report.md).

## Proof

From `e2e/`:

```bash
pnpm exec e2e run tests/web --target web --output .e2e/proof/issue-34 --trace on --no-cache --retries 0
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

## Browser verification (#34)

**Verify exhibit N** checks the referenced manifest's canonical bytes, SHA-256,
ES256 signature and published key, then binds the exhibit ID/hash to exactly
one signed capture record and hashes a fresh original-byte download. **Verify
report** runs these checks for every included manifest and exhibit, with
verified, unchecked and failure counts. Deleted or unavailable originals are
incomplete, not passed. Pending exhibits, unknown keys, duplicate manifests,
modified canonical bytes/signatures/hashes, or mismatched originals fail.
The scope excludes lease findings, annotations, ledger history and report
completeness, as the UI states. Filtered reports retain signed manifests intact.

`tests/web/report-verify.e2e.ts` adds keyboard-only Tab/Enter/Space coverage,
untouched and tampered originals, tampered signatures/canonical bytes/hashes,
exhibit binding, missing keys, duplicate manifests, expired URLs, network
failures, unsupported WebCrypto, retries, missing originals, absent previews,
blocked scripts, empty reports, and 320px dark mode at 200% text. The shared
report tests retain 390px/1440px coverage and real print/PDF checks. The full suite passed in `.e2e/proof/issue-34/` (45 passed, 2 existing
live-model skips). After the final verdict-reset fix, smoke and both affected
report suites passed together in `.e2e/proof/issue-34-final/` (12 passed).
That run used a local config with separate emulator ports because another
worktree was using the default ports; no unrelated process was stopped.

Original GET URLs use `originalUrl` if supplied, otherwise `imageUrl` for
existing loaders. The loader must authorize original-byte access independently
of preview availability; deleted URLs are never emitted. Cross-origin storage
must permit CORS GET from the report origin. Fetches omit credentials/referrers,
bypass caches and time out after 30 seconds. No deployed bucket was changed.

## Extension points

- Verification uses `#verify-report`, `[data-verify-exhibit]` and `[data-manifest]`.
  Canonical JSON remains text with unchanged signed bytes; CSP allows only
  self-hosted scripts and same-origin/HTTPS fetches (HTTP for fixtures only).
- #35: `ReportLoader` authorization and redacted data assembly, signed image
  URLs, share lifecycle and access log. Return null for inaccessible tokens.
- #36: accessible landmarks, labels, headings, locale blocks, alt descriptions,
  visible focus and table headers are in place. Automated axe CI is separate.

## Explore charter

```text
web-report|web|skeptic|Open /r/fixture, switch Demo data / Worst case / Empty / One, inspect findings and separate annotations, follow section links by keyboard, compare phone and desktop layouts, and print the report. Check hashes, timestamps, deletion history, language blocks and print completeness without treating a seal as proof of capture time or legal validity. Verify each original and the report, including tampered and unavailable downloads. Do not expect share lifecycle or axe CI here.
```
