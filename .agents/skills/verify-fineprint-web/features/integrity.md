# Evidence sealing and ledger

How the move-in record becomes tamper-evident and verifiable by a third
party (spec §6.1, §8.2, §8.3, §13, #24). The server signs a manifest of
the received photos' capture records and keeps a hash-chained, signed
ledger of what happened to them. The public keys are published, so anyone
can verify without asking the server.

## Sub-features

- `POST /v1/rentals/:id/seal` with `{ session? }` (`move_in` default,
  `move_out`, `incident`). Signs every received, not deleted item of that
  session; photos still uploading are left out and counted in `pending`.
  201 with `{ manifest, ledgerEntry, pending }`. Nothing received: 409
  `CONFLICT`. Sealing again signs a new manifest whose `prevLedgerHead`
  is the ledger head at the time; an item keeps the first
  `sealedManifestId` and its `status` becomes `sealed`.
- A manifest is `{ manifestId, kind, canonicalJson, sha256, signatureB64,
  keyId, kmsKeyVersion, itemIds, sealedAt }`. `canonicalJson` is the RFC
  8785 JCS form of `{ version: 1, manifestId, rentalId, kind, sealedAt,
  prevLedgerHead, items }`, items in capture order with the §8.1 fields and
  `receivedAtServer`. `sha256` is its hash; `signatureB64` is ES256 over
  those bytes, raw r || s (64 bytes) as WebCrypto verifies it. Stored at
  `rentals/{rentalId}/manifests/{manifestId}`.
- Ledger at `rentals/{rentalId}/ledger/{seq}` (seq zero-padded to 10
  digits), types `manifest_sealed` (`{ manifestId, kind, sha256, items }`)
  and `evidence_deleted` (`{ itemId, sha256 }`). Each entry has
  `payloadHash` (SHA-256 of the payload's JCS), `prevEntryHash` (64 zeros
  for the first), and `entryHash`, the SHA-256 of the JCS of `{ seq, type,
  payloadHash, prevEntryHash, at }`, which is what `signatureB64` signs.
  Appends run in a Firestore transaction and `create` the next seq, so two
  concurrent appends cannot both take it.
- `GET /v1/rentals/:id/ledger` returns `{ entries }` in seq order. `GET
  /v1/rentals/:id/manifests/:manifestId` returns one manifest (404
  `NOT_FOUND` otherwise).
- `DELETE /v1/rentals/:id/evidence/:itemId` (spec §13 lists
  `/v1/evidence/:itemId`; it lives under the rental like `complete`, so
  ownership is checked the same way). Removes the original and the model
  copy from Storage, sets `deletedAt` on the item (the record stays), and
  appends `evidence_deleted`. 200 with the item, `status: "deleted"`.
  Again: the same 200 and no new entry. A deleted item is left out of new
  seals, and `complete` on it is 409.
- `GET /.well-known/fineprint-keys.json` (public): a JWK Set `{ keys }`,
  each `{ kty: "EC", crv: "P-256", x, y, kid, alg: "ES256", use: "sig" }`,
  newest first, `Cache-Control: public, max-age=300`. `kid` is the RFC 7638
  thumbprint and matches a signature's `keyId`.
- Signing: with `KMS_SIGNING_KEY` set (deploy.sh), Cloud KMS
  `asymmetricSign` with the newest enabled version of the
  `EC_SIGN_P256_SHA256` key; every enabled version is published, and each
  signature is checked against the public key before it is stored. Under
  the emulators, a local P-256 key that lasts until the server stops (the
  server logs a warning). Neither: seal, delete, and the key set are 503
  `DEPENDENCY_UNAVAILABLE`. A KMS failure is 503 too, logged as `signing
  failed` with the error class only.
- Another user's rental is 403 `FORBIDDEN` on every route here.
- Logs: `manifest sealed` (`rentalId`, `manifestId`, `items`, `pending`,
  `seq`), `evidence deleted` (`rentalId`, `itemId`).
- Not built yet: an `evidence_added` entry on `complete`; the manifest
  already records what was received and when.

## How to get to it (user POV)

Upload and complete photos (see [evidence](evidence.md)), then `POST
.../seal`. A verifier fetches the manifest and the key set, checks
`sha256` and the signature, and walks the ledger. The web report's
Verify button (#34) will run the same check in the browser.

## Driving it with e2e

`tests/web/integrity.e2e.ts` runs under the web target's emulators: it
uploads two photos, seals, verifies the manifest with WebCrypto against
`/.well-known/fineprint-keys.json`, deletes one photo, reads the manifest
back from Firestore and verifies it again, then walks the ledger checking
the chain, the hashes (with its own JCS), and every signature; and checks
403 for another user. `server/test/integrity.test.ts` pins JCS against
RFC 8785 values, the KMS signer against a fake KMS (newest version, DER to
raw), ledger removal, reordering, renumbering, edited payloads and forged
signatures, and the seal and delete routes' 409, 403, 404, and 503 cases.

## Proof

The 201 seal body; `crypto.subtle.verify` true for the manifest before and
after the delete and for each ledger entry; the Firestore item's
`sealedManifestId` and `deletedAt` `timestampValue`. In
`.e2e/logs/server.log`: `manifest sealed`, `evidence deleted`, and routes
`/v1/rentals/:id/seal`, `/v1/rentals/:id/ledger`,
`/.well-known/fineprint-keys.json` (never raw ids).
