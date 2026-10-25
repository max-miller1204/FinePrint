# Responsibility check

"Who pays for this?" (spec §4.3 F4, §7.7; #31). Gemma 26B gives a verdict
with cited reasons; code checks every citation and drops the ones that do
not resolve; Gemma 31B gives its own verdict before an answer may say
`high`. The Repairs tab card that shows it is the iOS half of #31.

## Sub-features

- `POST /v1/rentals/:id/issues` with `{ description, room?, checklistItem?,
  photoIds?, locale? }`. `description` is 1 to 2,000 characters after
  trimming; `room` and `checklistItem` are 1 to 100; up to 4 distinct
  `photoIds` (evidence item UUIDs of this rental, uploaded and not deleted);
  `locale` is a BCP 47 tag, default `en`.
- 201 with the stored issue: `{ issueId, status: "checked", description,
  room, checklistItem, photos, locale, verdict, category, confidence,
  reasons, whatWouldChange, escrowEligible, verification, downgraded,
  models, leaseId, createdAt, triage }`, written to
  `rentals/{id}/issues/{issueId}` (all but `triage`, which is the decision
  below and is not stored). `models.primary` is null when nothing could be
  cited (no rule pack, lease, or move-in photo), so no model was asked.
  - `verdict`: `likely_landlord`, `likely_tenant`, `could_be_either`,
    `not_sure`. `category`: `normal_wear_and_tear`, `tenant_damage`,
    `landlord_maintenance`, `pre_existing`, `unknown`. `confidence`: `low`,
    `medium`, `high`.
  - `reasons`: up to 4 `{ text, citation }`. A citation is `{ kind: "rule",
    ref, citation, quote, sourceUrl, effectiveFrom }` (the statute text of the
    version in force that day), `{ kind: "lease", ref, leaseId, heading,
    quote, quoteSpan }` (a slice of the clause, offsets into the lease), or
    `{ kind: "evidence", ref, session, room, checklistItem, capturedAtDevice,
    sealedManifestId }` (a move-in photo of the same room).
  - `verification`: `{ status, model, verdict }`, status `not_needed`
    (below `high`), `agreed`, `disagreed`, or `unavailable`. `downgraded` is
    true when 26B said `high` and 31B did not agree, so it is `medium` now.
  - `escrowEligible`: 26B's flag, kept only on `likely_landlord` with the
    rent escrow rule in force. Drives the escrow explainer (#32).
- Guardrails (code, `server/src/ai/pipeline/responsibility.ts`): `ref` is
  an enum of what was sent (the rules in force of `VA_LANDLORD_MAINTAIN_FIT`,
  `VA_DEPOSIT_WEAR_AND_TEAR`, `VA_NO_REPAIR_FEES`, `VA_RENT_ESCROW_PROCESS`,
  and the lease and evidence document ids), so the model cannot cite
  anything else. Code then checks each ref matches its kind and that a
  lease quote is in its clause, exactly (S3's matcher). Others are dropped
  (the log counts them). No reason left: `not_sure`, `unknown`, `low`.
  `pre_existing` with no move-in record cited: `unknown`.
- Inputs: the description; the newest analyzed lease's clauses about
  repairs, maintenance, damage, and systems (up to 24,000 characters;
  `rentals/{id}/leases`, written by #16, so none yet); the rental's received
  move-in photos of the same `room`, same item and sealed first, up to 8, as
  records (room, item, time, sealed), not images.
- Triage first (`source: repair`, the same check as `POST /v1/triage`).
  `immediate_danger`, `self_harm`, or `domestic_violence`: 200 `{ status:
  "escalated", triage }`, no model call, nothing stored; the keyword
  backstop runs without a model, so a gas smell escalates even then. Any
  other escalation (a lockout; Gemma flags a broken heater in winter as
  `utility_shutoff`) still gets the 201 answer, with `triage.escalate: true`
  so the app offers the handoff too.
- 503 `DEPENDENCY_UNAVAILABLE` when no model is configured or every model in
  the chain failed. 400 naming the field, never the value; 404 for an
  unknown rental or photo; 409 for a deleted or not yet uploaded photo; 403
  for another user's rental; 401 without a token; 413 over 16 KB.
- Log: `triage`, then `responsibility check` (`status`, `verdict`,
  `category`, `confidence`, `verification`, `downgraded`, `reasons`,
  `drops`, `leaseClauses`, `moveInRecords`, `descriptionChars`, `calls`,
  tokens), `issue created` (`rentalId`, `issueId`, `photos`), and the Gemma
  client's `model call` lines. No content.

## How to get to it (user POV)

Repairs tab → New issue → photos and a short description → the result card
(verdict, category, confidence as text and icon, reasons, what would change
the answer). The card is the iOS half of #31, not built yet.

## Driving it with e2e

`tests/web/responsibility.e2e.ts`: the broken heater in January, a gas smell
that escalates, and the 400, 403, and 401 cases with `server.log` holding no
description text. The heater case needs a model: a plain run expects 503 and
nothing stored; wrap it to ask Gemma:

```bash
cd e2e
npx e2e run tests/web/responsibility.e2e.ts --target web                               # no model: 503 path
../scripts/with-gemini-key.sh npx e2e run tests/web/responsibility.e2e.ts --target web   # Gemma 26B and 31B
```

Unit: `server/test/responsibility.test.ts` (guardrails, downgrade, 31B's
inputs, the route); emulator: `server/test/emulator/issues.test.ts` (the
newest analyzed lease, the stored issue). Live, on balanced cases with the
synthetic lease's clauses (heater gated `likely_landlord`, a window a guest
broke gated `likely_tenant`, a ceiling stain reported):

```bash
cd server && ../scripts/with-gemini-key.sh pnpm smoke:responsibility
```

## Proof

With a key: 201, `verdict: "likely_landlord"`, every reason a `rule`
citation whose `quote` is the rule file's statute text, one of them
`VA_LANDLORD_MAINTAIN_FIT`; `high` only with `verification.status:
"agreed"`; the issue in the Firestore emulator. Without one: 503 and no
issue.

## Charters

```
responsibility-balance|web|skeptic|POST /v1/rentals/:id/issues with repair stories where the tenant is clearly at fault (a guest broke it, a pet chewed it), the landlord clearly is (no heat, a leaking pipe), and it is unclear. A tenant-fault story answered likely_landlord, a reason with no citation, or high confidence without verification agreed is a bug.
```

## Gotchas

- No photo is shown to the model yet: vision and the move-in compare
  (`pre_existing_unchanged`) are #26 and #27. Until then the move-in
  shortcut rests on the tenant saying it was there and a cited move-in
  record.
- The pack has no tenant-obligation rule (§ 55.1-1227); tenant-fault
  answers cite `VA_NO_REPAIR_FEES` or the lease.
- The `responsibility` stage is on `json` output with thinking `high`: in
  `schema` mode 26B looped to the output cap on one of three live cases and
  repeated a phrase inside a string on another (2026-10-25). With thinking
  a check takes about a minute (live: 62 to 64 s for triage, 26B, and 31B),
  so the app shows progress.
- 31B is strict: on the synthetic lease, whose clause 10 hands heating
  repairs to the tenant, it answered `likely_tenant` for the broken heater,
  so 26B's `high` landlord answer was downgraded to `medium`.
- Each check is a triage call, one 26B call, and one 31B call on `high`, on
  the shared rate limiter (30 RPM and 16K input tokens per minute per
  model); about 2,900 input tokens with the synthetic lease's 11 relevant
  clauses.
