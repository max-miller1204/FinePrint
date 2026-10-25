# Repairs and the responsibility check

"Who pays for this?" on the Repairs tab (spec §4.3 F4, #31): New Issue,
a short description, where it is, optional photos, then the result card.
The answer comes from `POST /v1/rentals/:id/issues` (the server half is
the web feature [responsibility](../../verify-fineprint-web/features/responsibility.md)).

## Sub-features

- Repairs tab: with no issues, "No repairs yet", what the tab does, and
  New Issue (`repairs.newIssue`). With issues, New Issue on top and one row
  per issue, newest first (`issue.row`: verdict, the tenant's words cut to
  two lines, room and day). Rows open the saved answer (`IssueDetailView`).
  "Legal information, not legal advice." on every Repairs screen.
- New Issue (`NewIssueView`, pushed, not a sheet):
  - Description (`issue.description`), 1 to 2,000 characters after
    trimming.
  - Room (`issue.room`) and Item (`issue.item`), "Not sure" by default,
    chosen on a pushed list. Rooms are the walkthrough's first (so a repair
    names a room the way its move-in photos do), then the presets it lacks.
    Items are that room's checklist. A new room clears the item.
  - Photos: Add Photo (`issue.addPhoto`) opens the camera (the DEBUG
    fixture camera under e2e) once a room is chosen, up to 4. Each photo is
    an `incident` capture with the issue's room and item (or "Repair"), on
    the same pipeline and upload queue as move-in photos; its row
    (`issue.photo.<n>`) shows its upload status.
  - Check Who's Responsible (`issue.check`, Cmd-Return), disabled until the
    description is valid. It waits for the photos to upload (up to 60 s;
    refused photos are left out and the result says so), then calls the
    server with the app language as `locale`, on a 180 s timeout: a check
    takes about a minute. The button reads "Uploading Photos", then
    "Checking", and VoiceOver announces the start and the verdict. Going
    back during a check is fine: the answer is still saved and shows in the
    list.
  - Errors (`issue.error`), with the words and photos kept to try again:
    offline, photos still uploading, the check not available (503: no
    model on the server), or the server's error.
- Result card (`ResponsibilityCard`), on solid backgrounds:
  - Verdict (`issue.verdict`): "Likely landlord's responsibility",
    "Likely tenant's responsibility", "Could be either", or "Not sure", with
    a symbol and no severity color (a verdict is not a severity).
  - Category (`issue.category`) and confidence (`issue.confidence`): Low,
    Medium, or High as words plus one, two, or three filled bars.
  - `issue.verification`: "A second check ... agreed" when 31B agreed, or
    that it was lowered to medium when it did not.
  - Reasons (`issue.reason.<n>`), each with its source: Virginia law with
    the citation, the verbatim statute in monospace (selectable), and Read
    the Law; the lease clause heading and quote; or the move-in photo's
    room, item, day, and whether it is sealed. Each is one VoiceOver element
    with the quote as custom content; Read the Law stays its own control.
  - What would change this answer (`issue.change.<n>`).
  - `issue.escrow` when the server marks it escrow eligible: written
    request first, rent escrow is a court process, never stop paying rent
    on your own.
  - `issue.handoff` when triage flagged something that doesn't stop the
    check (a lockout, court papers): legal aid can help.
  - Done (`issue.done`) goes back to the list.
- Emergencies (`SafetyGuidance`): when triage stops the check (immediate
  danger, self-harm, domestic violence), the screen shows what to do now
  (`issue.safety.title`, `issue.safety.guidance`) and Call buttons (911;
  988; 911 and the National Domestic Violence Hotline). Nothing is saved on
  the device or the server. The handoff sheet with local resources is #38.
- Saved on the device: `RepairIssue` (SwiftData), on the rental that was
  current (`Rental.issues`, deleted with it, so Delete Everything erases
  them). The answer is stored as the server's JSON.

## How to get to it (user POV)

Repairs tab > New Issue.

## Driving it with e2e

- `tests/ios/repairs.e2e.ts`:
  - The broken heater in January: Bedroom, Fixtures, a fixture photo
    (checks `evidence received` in `server-ios.log`), then the check. With
    a key: the verdict is "Likely landlord's responsibility", a reason cites
    Virginia law, What would change shows, `issue created` logs one photo,
    and Done shows the row. Without one: `issue.error` says the check isn't
    available and nothing is stored.
  - A gas smell: safety steps and Call 911, the server logs
    `responsibility check` with `escalated`, nothing is created, and the
    tab is still empty.
- The server gets `GEMINI_API_KEY` through `inheritEnv`. A plain run takes
  the 503 path; wrap it to ask Gemma:

```bash
cd e2e
pnpm build:ios
npx e2e run tests/ios/repairs.e2e.ts --target ios                                 # no model: 503 path
../scripts/with-gemini-key.sh npx e2e run tests/ios/repairs.e2e.ts --target ios  # Gemma 26B and 31B
```

- Unit: `ios/FinePrintTests/RepairsTests.swift` (decoding every citation
  kind and the escalated reply, the request's fields, old capture records
  reading as move-in, the checker's save, emergency, 503, photo waits and
  left-out photos, the form rules, room choices).

## Proof

With a key: the result card for the heater with a Virginia law reason, the
`issue created` line with `"photos":1`, and the row on the Repairs tab.
Without one: the "isn't available" error and no `issue created` line. For
the gas smell: the safety screen and an `escalated` `responsibility check`
line.

## Charters

```
repairs-balance|ios|skeptic|Repairs > New Issue with stories where the tenant is clearly at fault (a guest broke a window), the landlord clearly is (no heat in January), and it is unclear (a ceiling stain). A reason with no source, a verdict shown in color alone, high confidence without the second check agreeing, or a truncated statute quote is a bug.
repairs-emergency|ios|fuzzer|Repairs > New Issue with emergencies phrased many ways (gas, sparks, flooding, a threat at home), with typos, in English and Spanish. Anything but the safety screen is a bug; a false alarm on an ordinary repair is a note.
```

## Gotchas

- No photo is shown to the model yet (#26, #27): photos are kept as
  evidence for the repair request (#32).
- Send a repair request and Add to insurance claim packet (spec F4 next
  actions) are #32 and #55.
- A check takes about a minute live; give `issue.verdict` a long timeout.
- Typing a long description with `fill` is slow on the simulator but works.
