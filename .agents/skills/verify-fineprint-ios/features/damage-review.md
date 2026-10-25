# Damage review

Gemma's damage suggestions on a move-in photo, which the tenant confirms,
adjusts, marks not damage, or adds to (spec §4.3 F2, §7.5, #26). Only the
tenant's decisions reach the Evidence Report; the original photo, its
SHA-256, and any sealed manifest never change.

## Sub-features

- Opens by itself when a photo is kept in the walkthrough camera, and from a
  photographed item's swipe or long-press action, or its VoiceOver action,
  "Review Damage" (`DamageReviewView`, a sheet). It stays open after the
  walkthrough is sealed: annotations sit beside the sealed photo.
- Waits for the upload: "Waiting for the photo to upload" until the queue
  says received or sealed, then "Gemma is looking for damage…". Status is in
  the photo section's footer (`damage.status`).
- Calls `GET /v1/rentals/:id/evidence/:itemId/damage` first and only runs
  `POST .../analyze` (the 1536 px `model.jpg`, never the original) when the
  photo has no analysis yet. 503 says suggestions are unavailable and offers
  Try Again; the tenant can still add boxes.
- The photo shows each suggestion as a box: dashed orange while undecided,
  solid green once confirmed, adjusted, or added; boxes marked not damage are
  hidden. Drag a box to move it, drag its corner handle to resize it.
- Below the photo, one row per suggestion: label, status word and symbol
  ("AI suggested, not confirmed", "Confirmed by you", "Adjusted by you",
  "Added by you", "Not damage"), severity, description, and Confirm, Adjust,
  Not Damage buttons. Adjust shows move and resize buttons, so nothing needs
  dragging. Added boxes have a name field (`damage.label`) and Remove.
- Mold-like growth and pest signs never assert a diagnosis ("Looks like it
  could be mold", "Could be a sign of pests") and point to a written repair
  request from the Repairs tab (Va. Code § 55.1-1220).
- Add Damage (`damage.add`) puts a box in the middle of the photo for the
  tenant to place. Save (`damage.save`) sends
  `PATCH /v1/rentals/:id/evidence/:itemId` with every decision; undecided
  suggestions are not sent. A confirmed box the tenant moved is stored as
  adjusted. Cancel (`damage.cancel`); swipe-to-dismiss is off while there are
  unsaved changes. A save failure shows `damage.saveError`.
- VoiceOver: each box is one element ("Scuff", value "AI suggested, not
  confirmed") with actions Confirm, Adjust, Not Damage, Move Left/Right/Up/
  Down, Make Larger/Smaller. The result of the analysis is announced.

## How to get to it (user POV)

Evidence tab > walkthrough > a room > photograph an item and Use Photo. Or
swipe a photographed item > Review Damage.

## Driving it with e2e

- `tests/ios/walkthrough.e2e.ts` closes the review that opens after the
  fixture photo is kept (`damage.status`, then `damage.cancel`).
- Not yet driven: suggestions need a model key on the server. With
  `GEMINI_API_KEY`, run `../scripts/with-secrets.sh pnpm smoke:damage` from
  `server/` for a live call on `e2e/fixtures/photos/move-in/01-kitchen-wall.jpg`.
- `ios/FinePrintTests/DamageReviewTests.swift` covers box clamping, moving
  and resizing, undecided proposals not being saved, confirmed-then-moved
  becoming adjusted, added boxes, the repair path flag, and restoring saved
  decisions.
- Server: `server/test/damage.test.ts` (hash and manifest unchanged after
  annotation, hedged mold and pest wording, report projection).

## Proof

After Save, `server-ios.log` has `evidence annotated` for the item, and the
shared Evidence Report draws the confirmed boxes over the photo.

## Charters

```
damage-review|ios|skeptic|Keep a photo, wait for suggestions, confirm one, move another and confirm it, mark one not damage, add a box, save, reopen; report a decision that did not stick, a box outside the photo, or a mold suggestion that names mold as fact
damage-review-voiceover|ios|accessibility|With VoiceOver on, review a photo using only the box actions and the row buttons; report anything that needs a drag
```

## Gotchas

- Not run on a simulator for #26: the team waived iOS e2e for this issue, so
  the macOS `iOS build` workflow is the only check of this screen so far.
- The review reads `model.jpg` from the app container. A photo from another
  device shows "Photo not on this phone".
