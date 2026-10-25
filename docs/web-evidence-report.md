# Web Evidence Report

The report is a Hono JSX document at `/r/:token`. It includes a disclaimer,
city and tenancy dates, chronological events, findings with original quotes
and citations, numbered exhibits, signed ledger events including deletions,
and signed manifests. Reading and printing need no JavaScript; browser verification uses a self-hosted vanilla script. Use the browser Print menu to
print or save a PDF. Names and full addresses have no fields in its model.

## Data boundary

`server/src/report/model.ts` defines a public projection. The sharing route
authorizes a hashed capability before assembling it. Missing tokens return
404; expired and revoked tokens return clear HTML 410 pages without report
details. PIN-protected reports require a short-lived, link-scoped grant.
`ReportLoader` remains available as a renderer-test injection seam. Storage
failures return a generic HTML 503. Responses use `no-store`, `no-referrer`,
`noindex`, a restrictive CSP and `nosniff`. Logs name the matched route
pattern and omit raw paths and error messages. See the
[sharing verification map](../.agents/skills/verify-fineprint-web/features/share-links.md)
for the API, security contract and proof.

Populate only the sections authorized by the link's scope. Load the persisted
findings from `getLeaseResults`, preserve the lease locale, and include only
redacted quotes. Use `listEvidence` for each authorized session (including
deleted records), `listLedger` in stored sequence, and the referenced
`getManifest` results. Never regenerate or edit canonical signed JSON.

The timeline accepts recorded events with timestamps, labels and optional
details. It can hold lease signing, occupancy, sealing, notices, landlord
reports, objections, move-out and deadlines as those records become available.
Do not invent missing events or calculate legal deadlines in the renderer.

`ReportExhibit` uses the evidence model's public fields and an authorized
photo route that rechecks the capability on every request. It excludes storage paths and owner IDs. Deleted
exhibits retain a numbered record but never request their image URL. Pending
and unsupported-preview records display an explanation. The loader should
return a null preview URL when an original is unavailable; HEIC does not
require a browser preview. Photos remain original bytes. Accepted tenant
annotations use normalized boxes in a separate SVG overlay and readable text;
rejected proposals never render. Invalid boxes are not drawn.

`leaseLocale` labels original lease quotes. English explanations and statute
quotes remain English, with translated blocks labeled by their locale.
The renderer never translates or shortens legal quotes.

## Rendered data and stress coverage

| Values | Source and limit | Empty or worst case |
| --- | --- | --- |
| City, jurisdiction, dates | Rental: city 100 characters, state code, nullable ISO dates | Missing dates/city; long mixed-script location |
| Generated time and timeline events | Loader: ISO timestamp/date; labels/details unbounded | No events; offset-preserving device times and explicit UTC server times |
| Finding ID, severity, title, explanation, action | Persisted pipeline findings: enum severity; generated text unbounded by this projection | 0, 1 and 25 findings; expanded Spanish explanations |
| Lease/statute quotes, citation, source URL | Persisted redacted findings; lease input cap 200,000 characters; nullable quotes/citations | Long multiline quotes, absent-clause fallback; escaped HTML; unsafe URL refused |
| Translation locale/title/explanation/action | Persisted checked translations; strings unbounded | Locale attributes, Spanish text, content wraps without truncation |
| Exhibit ID, session, room/item, hash, MIME | Evidence: UUID, enum session, labels 100 characters each, SHA-256 hex, JPEG/HEIC | 0, 1 and 120 exhibits; long filename-like labels and CJK text |
| Device, receipt, seal and deletion times; source/status | Evidence and referenced manifest, ISO and nullable server dates | Imported time unverified; receipt delay strictly over 24h; clock skew; deleted/pending/HEIC |
| Image and annotation box/label/description/decision | Authorized URL; normalized finite box; annotation strings unbounded | Missing preview, deleted original, invalid box, rejected proposal, accepted overlay |
| Counts and exhibit numbers | Derived from arrays, unbounded | 0/1 plurals, 120 exhibits, stable deleted-record positions |
| Ledger sequence/type/time/payload/hash/signature/key | Existing signed ledger schema; sequence ordered, hex hashes, strings | Deletion points to exhibit number or says record outside report; full signed data wraps |
| Manifest ID/time/hash/key/signature/canonical JSON | Existing signed manifest schema; canonical JSON unbounded | Signed bytes unchanged; collapsed details remain visible in print |

No pagination or truncation hides exhibits from a printed report. The 120-photo
fixture tests the intended large report; the loader owns any future size limit.
An entire raw lease is not rendered: even a 40-page input reaches this page as
persisted findings and selected verbatim quotes.

## UI and motion review

| Before | After | Why |
| --- | --- | --- |
| `/r/:token` returned a JSON 404 | Semantic SSR report and HTML unavailable states | Caseworkers can read and print without a client bundle |
| Long hashes/quotes can force grid overflow | `minmax(0,1fr)`, `min-width:0`, `overflow-wrap:anywhere` | Stress fixture fits 320px and 200% text without truncating evidence |
| Full-size print photo pushed metadata onto another page | 95mm print photo limit and compact metadata grid | Fixture exhibits fit on separate Letter pages with complete captions |
| Dark screen styling and fixture controls | Black-on-white print styles with hidden navigation | Clean court-exhibit output while preserving photo bytes |

Motion review: **Approve**. The document has no animation or delayed
transitions. Focus and press feedback are immediate. Hover styles are gated
by hover and fine-pointer capabilities. Content stays selectable and zoom is
unrestricted. Safe-area padding and per-scheme theme colors are present.
Hardware-specific behavior still needs a real phone; Linux emulation cannot
prove sticky hover, safe areas or touch latency.



## Sharing UI review (#35)

| Before | After | Why |
| --- | --- | --- |
| Generic unavailable state for every production link | PIN, wrong PIN, expired, revoked and throttled pages | Recipients have a clear next step without exposing report details |
| No PIN entry surface | Labeled numeric PIN field, 44px controls, visible focus and native form submission | Keyboard and phone entry work without JavaScript |
| No owner sharing controls | Native Settings forms, vertical wrapping rows, status words, retry and empty states | Dynamic Type and VoiceOver can use system layout and controls |

Motion review: **Approve**. No custom animation was added. Press feedback
is immediate; no transitions delay forms, errors or revocation.

| Severity | Field | Worst case | Result or fix |
| --- | --- | --- | --- |
| Fragile, addressed | PIN input | Browser default text below 16px on a phone | Inherited 1rem text avoids input zoom; hardware Safari check remains |
| Fragile, addressed | Access history | More than 100 views with identical timestamps | 100-row pages and a timestamp plus document-ID cursor avoid skipped views |
| Held | Error copy and headings | 320px, dark mode, 200% text | Wraps; form controls remain reachable by scrolling |
| Held | Report text and hashes | Existing Worst case / Empty / One fixture toggle | Full report regression suite passes; long evidence remains printable |

The fixture toggle stays at `/r/fixture?data=worst` under the emulator-only
fixture flag. iOS Settings has not been rendered on Linux. The on-device
checklist is in the [Settings feature map](../.agents/skills/verify-fineprint-ios/features/settings.md).

## Browser verification (#34)

Each exhibit and the report have native Verify buttons, polite atomic status
messages, visible keyboard focus, and 44px minimum touch targets. Controls
appear when the script loads, keep focus during work, prevent overlapping runs,
and hide in print. No animations were added. The fixture toggle exercises the
same controls in demo, worst-case, empty and one-exhibit states.

| Before | After | Why |
| --- | --- | --- |
| Verification hooks only | Native keyboard-operable controls and readable results | Anyone can check an original locally |
| Unchecked seal badge | SHA-256 plus ES256 verification against published keys | Detect altered bytes, manifests and exhibit associations |
| Deleted or missing bytes | Explicit incomplete result | A signed record cannot establish that unavailable photo bytes match |

Verification checks canonical manifest bytes, the manifest hash, raw P-256
signature, key ID, and the exhibit ID/hash/byte length against the signed
record. It hashes original bytes freshly downloaded by authorized GET, never
an annotated preview. Whole-report verification covers included originals and
manifests only. It does not establish report completeness, validate ledger
history, lease findings, capture times, legal validity or annotations.

For share loaders, optional `ReportExhibit.originalUrl` is an authorized,
short-lived URL to the original bytes, independent of `imageUrl` preview support
(including HEIC). Undefined falls back to `imageUrl`; null means unavailable.
Deleted URLs are omitted. Signed bytes must never be rewritten for a filtered
report. The storage host must allow CORS GET from the report's origin, with cross-origin credentials omitted. Same-origin original routes receive
the link-scoped PIN cookie and recheck expiry and revocation on every fetch. Serve reports over HTTPS for WebCrypto.
CSP allows self-hosted scripts and same-origin/HTTPS fetches; emulator fixtures
also allow HTTP. No deployment or storage CORS configuration was changed here.

Proof: `e2e/tests/web/report-verify.e2e.ts` and the existing report tests run
alongside smoke and all other web tests. Linux Chromium emulates phone widths,
dark mode and 200% text. Real-phone safe areas, touch behavior and Safari
remain untested on hardware. Share management is implemented in #35; axe CI remains #36.
