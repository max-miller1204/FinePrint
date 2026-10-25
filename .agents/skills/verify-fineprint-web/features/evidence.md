# Evidence uploads

How move-in photos reach the server (spec §5.3, §6.1, §6.2, §8.2, §13,
#23). The API never carries image bytes: it hands the app a 5-minute upload
URL straight to Cloud Storage, then checks what was stored against the
device's capture record (§8.1) before it records `receivedAtServer`.
Sealing (#24) comes after this and is not built.

## Sub-features

- `POST /v1/rentals/:id/evidence` with `{ items: [record, ...] }` (1 to 20).
  A record is `{ itemId (UUID), session? (move_in default), room,
  checklistItem, sha256 (64 lowercase hex), bytes, mime (image/heic or
  image/jpeg), capturedAtDevice (ISO time with offset), deviceUptimeMs,
  source (in_app_camera or imported), appVersion }`. 201 when it created an
  item, 200 when every item already existed. Each item comes back with
  `status` (`pending` or `received`), `receivedAtServer`, and `upload`:
  `{ method: "PUT", url, headers, expiresAt }` while pending, `null` once
  received.
- The upload is bound to the declared type and hash: `headers` is
  `Content-Type` and `x-goog-content-sha256`, which the client must send
  exactly. In production `url` is a V4 signed URL with both headers
  signed. Cloud Storage still stores a body whose hash differs (checked on
  Cloud Run); `complete` is what rejects it, below. Under the Storage emulator (no signing keys, no XML
  API) `url` is a resumable upload session on the emulator that takes one
  PUT of the whole body.
- Items are stored at `rentals/{rentalId}/evidence/{itemId}` (lowercased
  UUID) with the §6.1 fields, `gcsPath`
  `rentals/{rentalId}/evidence/{itemId}.heic`, `receivedAtServer: null`,
  and `sealedManifestId: null`. `gcsPath` is never returned.
- Sending the same record again is how the app gets a fresh URL after one
  expired. A different record under an `itemId` already in use is 409
  `CONFLICT`.
- `POST /v1/rentals/:id/evidence/:itemId/complete` (no body): the server
  reads the object's size and type, then streams it and computes SHA-256
  (Storage keeps only MD5 and CRC32C). All match: 200 with
  `status: "received"` and `receivedAtServer` (a Firestore Timestamp).
  Again after success: the same 200. Nothing stored: 409 `CONFLICT`. Size,
  type, or hash differ: the object is deleted, the item stays pending, and
  the answer is 422 `HASH_MISMATCH`.
- Another user's rental is 403 `FORBIDDEN` on both routes; an unknown
  rental or item 404 `NOT_FOUND`. 400 `BAD_REQUEST` for bad records
  (unknown fields such as `gcsPath` or `receivedAtServer`, duplicate
  `itemId`s, upper-case hashes, no offset on the time). 503
  `DEPENDENCY_UNAVAILABLE` when Firestore or Storage fails.
- Logs: `evidence upload urls issued` (`rentalId`, `items`, `created`),
  `evidence received` (`rentalId`, `itemId`, `bytes`), `evidence rejected`
  (`rentalId`, `itemId`, `reason`: `bytes`, `contentType`, or `sha256`),
  `evidence forbidden`. Never hashes of other users, room text, or URLs.

## How to get to it (user POV)

Sign up anonymously (see [auth](auth.md)), create a rental (see
[rentals](rentals.md)), `POST` a capture record to its evidence route, PUT
the bytes to `upload.url` with `upload.headers`, then `POST .../complete`.
The iOS app does this from its upload queue (see the iOS
`evidence-upload.md`).

## Driving it with e2e

`tests/web/evidence.e2e.ts` runs under the web target's Auth, Firestore,
and Storage emulators: it uploads real bytes to the Storage emulator URL
the server returned, completes, and reads the Firestore item back
(`receivedAtServer` `timestampValue`, `gcsPath`); uploads tampered bytes
and gets 422 `HASH_MISMATCH`, then 409 because the object was deleted;
and checks 403 for another user. `server/test/evidence.test.ts` pins
validation, idempotency, size, type, and hash mismatches, and 503s against
in-memory stores; `server/test/emulator/gcs.test.ts` PUTs to an emulator
upload URL with no credentials and hashes the stored object.

## Proof

The 201 body's `upload` (method, headers with the declared hash,
`expiresAt` within 5 minutes, a URL that is not the API's origin); the 200
`received` body; the Firestore item's `receivedAtServer` `timestampValue`;
the 422 `HASH_MISMATCH` envelope. In `.e2e/logs/server.log`: `evidence
received` and `evidence rejected` with `reason: "sha256"`, and
`route: "/v1/rentals/:id/evidence/:itemId/complete"` (never raw ids in the
route).

## Charters

```
evidence-integrity|web|skeptic|Create a rental and an evidence item, then try to get receivedAtServer set for bytes that do not match the declared sha256: wrong bytes, extra bytes, a different Content-Type, completing before uploading, re-declaring the item with another hash; report any 200 received for bytes that differ from the record
evidence-owner|web|skeptic|As a second anonymous user, try to create evidence on, get upload URLs for, or complete items of the first user's rental; report any answer other than 403 or 404
evidence-input|web|fuzzer|POST /v1/rentals/:id/evidence with wrong types, huge byte counts, non-UUID itemIds, long room names, unicode, extra fields such as gcsPath, and 21 items; report any 2xx for bad input, any 500, or any error that echoes the input
```

## Gotchas

- The emulator checks no hash at upload, so a mismatch shows up only at
  `complete` there. Production Storage refuses mismatched bytes at the PUT
  (400) as well.
- The original is always stored as `{itemId}.heic` (spec §6.2) even for a
  JPEG; `mime` and the object's Content-Type say what it is.
- Only the original uploads. The model copy (`rentals/{id}/model/`) is for
  damage analysis, which is not built.
- `expiresAt` is advisory under the emulator: its session URLs do not
  expire.
