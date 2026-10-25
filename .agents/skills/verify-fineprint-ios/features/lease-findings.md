# Lease findings, key terms, and clause explorer

The second half of F1 Lease Explainer (spec §4.3 F1, §7.3, §10.1, §11, #18):
the tenant sends the reviewed, redacted lease, the server checks it against
the Virginia rule pack, and the findings stream in with verbatim lease and
statute quotes.

## Sub-features

- **Virginia Law Check card** on the lease summary once the review is done.
  Check My Lease (`lease.analyze`) creates the rental on the server if it has
  no `serverID` yet, sends `POST /v1/rentals/:id/leases` (`LeaseUpload`:
  `{text, locale, readingLevel, pageCount, ocrConfidence}`), then opens
  `GET .../leases/:leaseId/stream` (`APIClient.leaseEvents`, an SSE parser
  that reads bytes, `ServerSentEventDecoder`). While it runs the card shows
  the stage in the tenant's language (`LeaseStageLabel`, S1 to S9), a
  progress bar, and "Waiting for the checker" on a rate-limit `error` event
  that has `retryInMs` (`lease.analysis.progress`). It ends with
  `lease.analysis.done` ("Checked against Virginia law", the count),
  `lease.analysis.escalated` (triage stopped it), `lease.analysis.notALease`
  (the server's message), or `lease.analysis.error` with Try Again
  (`lease.analysis.retry`; none for an unsupported state).
- Only IDs stay on the phone: `Leases/<rentalId>/analysis.json`
  (`LeaseAnalysisRecord`: rental, review time, server rental and lease IDs).
  When the tab opens again the app reopens the stream and the server replays
  a finished check. A new redaction review makes the record stale, so the
  tenant checks again; Remove Lease deletes it.
- **Key terms card** (`lease.keyTerms`): rent, deposit, late fee, dates,
  notice, in that order. Each row (`lease.keyTerm.<name>`, value as the
  accessibility value) expands in place to the lease's own words
  (`lease.keyTerm.<name>.quote`) and Show in Lease. Name and value stack at
  accessibility text sizes.
- **Findings list** (`lease.findings`): most serious first, then the
  server's order (`LeaseFinding.displayOrder`). Each row
  (`lease.finding.<id>`) is one VoiceOver element: label "severity word,
  title", value the citation (or "No Virginia rule in our checklist covers
  this"), hint "Opens details", custom content for both quotes. Findings
  that arrive together appear 40 ms apart with a spring; under Reduce Motion
  they cross-fade in at once. A new likely-unenforceable finding during a
  live run plays the warning haptic and is announced. Announcements
  (`AnnouncementQueue`) go out at most once every 2 s: a newer stage
  replaces an older one, findings and the end wait their turn. A replayed
  check is not announced finding by finding. No findings shows
  `lease.findings.empty`.
- **Finding detail**, in place of the summary (`lease.finding.detail`, Back
  is `lease.finding.close`): severity badge, title, explanation, What your
  lease says (`lease.finding.leaseQuote`, Show in Lease
  `lease.finding.showInLease`), What Virginia law says
  (`lease.finding.statuteQuote`, `lease.finding.citation`, a link to
  law.lis.virginia.gov `lease.finding.statuteLink`), or, with no rule, "No
  Virginia rule in our checklist covers this" (`lease.finding.noRule`), and
  What you can do (`lease.finding.action`). Quotes are monospaced,
  selectable, and never truncated (`QuoteBlock`). Text is the tenant's
  language when the server translated it, otherwise English.
- **Clause explorer**, in place of the summary (`lease.explorer` opens it;
  `lease.explorer.view`, Back is `lease.explorer.close`): the sent text in a
  lazy list of paragraphs (`LeaseParagraphs.split`, long paragraphs cut at
  line breaks). A finding's quote is tinted with its severity color and
  underlined; its name sits above the paragraph the quote starts in
  (`lease.explorer.finding.<id>`, opens the detail). A "Findings" rotor
  jumps between them in lease order. Show in Lease opens it scrolled to that
  quote with a bar beside it. The server's offsets are UTF-16 units into the
  trimmed text it got (`TextSpan.range(in:)`).
- DEBUG stub (`-FinePrintStubFindings <n>`): Check My Lease plays
  `LeaseAnalysisStub` (stages, key terms read from the text, n findings
  cycling severities, the first quoting the late fee clause), 150 ms apart,
  with no server call.

## How to get to it (user POV)

Lease tab > Import PDF > review > Done > Check My Lease > tap a finding >
Show in Lease.

## Driving it with e2e

- `tests/ios/lease-findings.e2e.ts`:
  - stub, 25 findings: key term quote, the late fee finding first with its
    severity word, the detail's quotes and citation, Show in Lease, Back to
    the finding, Back to the list.
  - stub, 0 findings: the empty row.
  - no model on the server (the default run): the real upload and stream
    stop at S2 with DEPENDENCY_UNAVAILABLE; the app shows the error and Try
    Again, and the server log has one more "lease created".
  - live (`op run --env-file ../.env --`): the dev server checks the
    fixture lease and the late fee finding (15%, Va. Code § 55.1-1204) is
    shown.
- Unit tests: `ios/FinePrintTests/LeaseFindingsTests.swift` (SSE parsing,
  event decoding with the server's extra fields, error mapping, ordering,
  UTF-16 spans, paragraph splitting and highlights, announcement throttling,
  the record, the upload body, the stub).

## Proof

The finding detail shows the lease's "late fee of 15%" and Virginia's
"10 percent" with the citation; the server log has "lease created" and
"lease analyzed".

## Worst cases (break-ui)

- 0 and 25 findings: `-FinePrintStubFindings 0` and `25`.
- A 40-page lease: `swift e2e/fixtures/generate-long-lease.swift`, then
  launch with `-FinePrintFixtureLease <abs path to e2e/fixtures/lease/long-lease.pdf>`
  (and the stub for findings without a model).
- AX5 Dynamic Type: no quote, title, or key term value truncated.

## Charters

```
lease-findings-readability|ios|skeptic|Import the lease, finish the review, tap Check My Lease, and open each finding; report any finding without its severity word, a quote that is cut off, a citation without a link, or a finding that makes a legal claim with no Virginia rule
lease-findings-worst-case|ios|fuzzer|Import the lease, check it, then switch rentals, re-review hidden details, remove the lease, and reopen findings and the clause explorer while findings are still arriving; report a screen that freezes, a finding from another lease, or a highlight on the wrong words
```

## Gotchas

- Same rule as the scan (#99): the detail and the explorer replace the
  summary in place; nothing is pushed or presented from inside the tab.
- The fixture lease's late fee is 15% so the deterministic late-fee cap
  check finds it. Regenerate the PDF after editing
  `e2e/fixtures/generate-lease.swift` (`swift e2e/fixtures/generate-lease.swift`).
- `URLSession.AsyncBytes.lines` drops empty lines, which end SSE messages,
  so the stream is parsed byte by byte.
