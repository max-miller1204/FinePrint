# Web Evidence Report

The report is a Hono JSX document at `/r/:token`. It includes a disclaimer,
city and tenancy dates, chronological events, findings with original quotes
and citations, numbered exhibits, signed ledger events including deletions,
and signed manifests. It needs no JavaScript. Use the browser Print menu to
print or save a PDF. Names and full addresses have no fields in its model.

## Data boundary

`server/src/report/model.ts` defines a public projection. `ReportLoader` is
injected into `createApp`; it must authorize a token before assembling data.
The default returns null, so production links remain closed until #35 adds
share resolution. This avoids publishing a rental by guessing its ID.
Missing, expired and revoked links should all return null, with the same 404.
Storage failures return a generic HTML 503. Report responses use `no-store`,
`no-referrer`, `noindex`, a restrictive CSP and `nosniff`. Logs name the route
pattern and omit the raw path and error message.

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
short-lived image URL. It excludes storage paths and owner IDs. Deleted
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

Browser verification, share management and axe CI remain #34, #35 and #36.
