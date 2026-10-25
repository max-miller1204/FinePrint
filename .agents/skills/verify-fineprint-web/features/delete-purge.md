# Delete everything and the daily purge

Tenants control their data, and the server does not keep it forever (spec
§9.1, §9.2). Two paths remove a rental with everything under it; they share
one function (`server/src/purge.ts`, which calls `deleteRentalObjects` from
the evidence-deletion work in `storage/gcs.ts`).

## Sub-features

- `DELETE /v1/me` removes every rental the caller owns: the Cloud Storage
  objects under `rentals/{id}/`, then the Firestore document with all its
  subcollections (evidence, ledger, manifests, and the rest) and every
  `shares/*` document that points at it (with its `access` log). Then it
  deletes `users/{uid}` and, last, the Firebase user. 200 with a receipt:
  `{ deletedAt, rentals, evidenceItems }`. Other users are untouched.
- Order is bytes, then records, then the Firebase user, so a failure is
  safe to retry with the same token. A failure is 503
  `DEPENDENCY_UNAVAILABLE` and logs only the error class. Deleting when
  nothing is stored is 200 with zeros. After success the old token is
  401, because the Firebase user is gone.
- `POST /internal/purge` removes rentals whose `purgeAfter` has passed
  (`tenancyEndDate` + 365 days), up to 100 per call; the answer is
  `{ purged, more }`. It is not under `/v1`: Cloud Scheduler calls it
  daily with a Google ID token for the service account in
  `PURGE_CALLER_EMAIL`, minted for this service's URL (`./deploy.sh`
  creates the job `fineprint-purge`, `17 3 * * *` UTC, and the account).
  Without `PURGE_CALLER_EMAIL` it is 404. No token is 401; a wrong one,
  including a Firebase user token, is 403. A rental with no `purgeAfter`
  is never purged. (The Firestore TTL policy the spec mentions would
  delete only the document, not the photos or subcollections, so the
  scheduled job replaces it.)
- Logs carry counts (`deleted everything`, `purge finished`), never ids
  or paths.

## How to get to it (user POV)

The app's Settings > Delete Everything calls `DELETE /v1/me` (see the iOS
map's [settings](../../verify-fineprint-ios/features/settings.md)). The
purge has no caller but Cloud Scheduler.

## Driving it with e2e

- `pnpm --filter @fineprint/server test` covers both against in-memory
  stores (`server/test/delete-purge.test.ts`).
- `pnpm --filter @fineprint/server test:emulator` runs
  `server/test/emulator/delete-purge.test.ts` against the Auth, Firestore,
  and Storage emulators: it uploads real photos, writes a share and its
  access log by hand, deletes, and checks that no rental, subcollection
  document, object, share, user document, or Auth account is left, that a
  second user's data is intact, and that the purge removes only the
  expired rental.
- The iOS test `tests/ios/delete-everything.e2e.ts` drives it from the app.

## Proof

The 200 receipt; the emulator reads after (Firestore document list for
`rentals`, `users`, `shares`; Storage object list under `rentals/`; Auth
accounts); 401 on the old token; the `deleted everything` and `purge
finished` log lines.

## Charters

```
delete-owner|web|skeptic|Sign up two anonymous users, give each a rental, and DELETE /v1/me as the first; report anything of the second user's that changed or anything of the first user's that is still readable
purge-auth|web|fuzzer|POST /internal/purge with no token, a Firebase ID token, garbage, and a very long Authorization header; report any 2xx, any 500, or any answer that reveals whether a purge account is configured
```

## Gotchas

- `/internal/purge` checks the token's audience against `PURGE_AUDIENCE`
  (the service URL; `./deploy.sh` sets it after the first deploy, next to
  `PURGE_CALLER_EMAIL`), and falls back to `https://<Host>` only when it is
  unset. The e2e targets set neither, so the route is 404 there; the
  emulator test injects a verifier.
- Firestore `recursiveDelete` removes subcollections; the evidence photos
  live in Cloud Storage and go first via `deleteRentalObjects`.
