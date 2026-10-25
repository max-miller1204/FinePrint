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

Production resolves hashed share capabilities and assembles scoped public
projections. See [share-links.md](share-links.md) for expiry, PIN, revocation,
photo authorization and owner access-log verification. `reportLoader` remains
an explicit injection seam for renderer tests.

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
must permit CORS GET from the report origin. Fetches send credentials only to the same origin for PIN-protected photo
routes, omit cross-origin credentials and all referrers,
bypass caches and time out after 30 seconds. No deployed bucket was changed.

## Extension points

- Verification uses `#verify-report`, `[data-verify-exhibit]` and `[data-manifest]`.
  Canonical JSON remains text with unchanged signed bytes; CSP allows only
  self-hosted scripts and same-origin/HTTPS fetches (HTTP for fixtures only).
- #35: implemented share authorization and scoped projection, protected photo
  routes, lifecycle API and access log. See [share-links.md](share-links.md).
- Accessibility CI: see the WCAG checks and manual handoff below.


## Explore charter

```text
web-report|web|skeptic|Open /r/fixture, switch Demo data / Worst case / Empty / One, inspect findings and separate annotations, follow section links by keyboard, compare phone and desktop layouts, and print the report. Check hashes, timestamps, deletion history, language blocks and print completeness without treating a seal as proof of capture time or legal validity. Verify each original and the report, including tampered and unavailable downloads. Inspect keyboard focus and contrast in every fixture state. Share lifecycle is covered separately.
```


## WCAG 2.2 AA regression gate (#36)

`tests/web/report-accessibility.e2e.ts` uses `@axe-core/playwright` against
Chromium, Firefox and WebKit launched inside the web e2e target. It scans the
whole document with WCAG 2.0 A/AA, 2.1 A/AA, 2.2 AA and best-practice tags.
There are no excluded elements, disabled rules, or violation baselines.
Every violation fails, including serious and critical findings. A negative
control injects low-contrast text and an unnamed button in an isolated page
and proves that the same gate rejects serious `color-contrast` and critical
`button-name` violations.

Each engine scans Demo, Worst case, Empty, One and unavailable reports in
light and dark mode, plus completed and failed verification states. The
keyboard tests cover landmarks, skip-link activation, visible and unobscured
focus, Tab/Shift+Tab, Enter/Space disclosures, verification with focus retained,
320px reflow at 200% text, and static behavior with reduced motion enabled.
The report has inline photos with separate annotations and no lightbox or
modal, so lightbox focus trapping/restoration is not applicable.

The existing fixture toggle stays emulator-only. Worst case exercises long
quotes, Spanish translations, Arabic/Japanese room/location text, camera
filenames, hashes and 120 exhibits; Empty and One cover missing values and
singular counts. No fixture content or legal copy is changed by #36.

Run smoke and all affected report features together, with no retries:

```bash
cd e2e
pnpm exec e2e run tests/web/smoke.e2e.ts tests/web/report.e2e.ts tests/web/report-verify.e2e.ts tests/web/report-accessibility.e2e.ts --target web --output .e2e/proof/issue-36-final --trace on --no-cache --retries 0
```

The final local gate at `.e2e/proof/issue-36-gate/` passed all 19 tests
together with retries disabled (exit 0), after syncing main. The earlier
full web suite passed 54 tests with 2 existing live-model skips. All 36 axe
scans had zero violations and zero incomplete checks. After syncing main,
474 unit tests, lint, typecheck and jurisdictions validation also passed.

CI runs this same selection on Ubuntu with Java 21 and all three browser
engines/dependencies installed. It uploads `web-report-accessibility`, including
all e2e reports/traces, print PDF and full axe JSON (passes, violations and
incomplete checks). Scans are at `.e2e/proof/axe/`, or `AXE_OUTPUT_DIR`.
A clean automated scan does not establish complete WCAG conformance.

### Waiting on: manual VoiceOver/Safari pass by @maddoxrjohnson

On a Mac, from this branch with dependencies installed:

1. Run `pnpm --filter @fineprint/server dev:emulated` with `REPORT_FIXTURES=1`.
   Open `http://localhost:8080/r/fixture` in Safari. Enable Safari Settings >
   Advanced > "Press Tab to highlight each item on a webpage" and macOS
   Keyboard > Keyboard navigation. Turn VoiceOver on with Command-F5.
2. Use the VoiceOver rotor (VO-U, where VO is Control-Option) to inspect
   landmarks, headings, links and form controls. Confirm one main region,
   logical section headings, named verification buttons and distinct report
   and fixture navigation. Tab to Skip to report and activate it.
3. Read findings and statute quotes, Spanish blocks (`?data=worst`), photo alt
   descriptions, separate tenant annotations, ledger table headers and deletion
   notices. Confirm reading order and pronunciation/language changes make sense.
4. Tab and Shift-Tab through report links, verification buttons and disclosures.
   Use Enter/Space to toggle signed manifests and ledger details. Confirm focus
   stays visible and no keyboard trap occurs. There is no lightbox to test.
5. On `?data=one`, activate Verify exhibit 1 and Verify report. Confirm progress
   and final status are announced without moving focus. In Safari Web Inspector,
   go offline and retry; confirm failure is announced. Go online and retry.
   In Demo, confirm the deleted-original result is incomplete, not passed.
6. Check Demo/Worst case/Empty/One at a narrow Safari window, 200% zoom, light
   and dark appearance, and macOS Reduce Motion. Confirm readable contrast,
   usable focus and complete content. Print a PDF and inspect exhibit captions
   and signed bytes. Record macOS/Safari versions, result and any issues in the PR.

Linux Playwright WebKit is not Safari with VoiceOver. Real-phone safe areas,
touch behavior and Safari printing remain hardware checks as documented above.

## Sharing integration proof

After merging #123/#124 into #35, `.e2e/proof/issue-35-main-merge/` passed
all 13 web files together (52 passed, 2 unconfigured live-model skips,
exit 0). This includes the six browser Verify tests and seven sharing tests.
A PIN-protected real original verifies with the same-origin session cookie;
revoking its link makes the next Verify fail. The combined CSP permits the
self-hosted script/fetches and same-origin PIN form. Secret Manager wrapper
checks also pass; no shared secret was needed for this deterministic run.


Dev integration: share-link authorization and the axe gate are preserved together. Device verification uses the dev TestFlight build by @max-miller1204.
