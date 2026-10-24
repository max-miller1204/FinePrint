# Rentals

Every object belongs to a rental (spec §6.1, §13). The app creates one
during onboarding ("Where do you rent?", "Where are you in your rental?")
and updates its dates, rent, deposit, and phase later. Only the owner can
change it. The server stores it in Firestore, `rentals/{rentalId}`, and
creates `users/{uid}` with the user's first rental.

## Sub-features

- `POST /v1/rentals` with `{ jurisdiction, city?, county?, phase?,
  occupancyDate?, tenancyEndDate?, monthlyRent?, depositAmount? }` is 201
  with the rental and `Location: /v1/rentals/{id}`. `jurisdiction` is a
  two-letter state code; `city` or `county` (at least one) is the only
  place collected, never an address. `phase` defaults to `pre_signing`.
- `PATCH /v1/rentals/:id` with any of `phase`, `occupancyDate`,
  `tenancyEndDate`, `monthlyRent`, `depositAmount` is 200 with the whole
  rental. `null` clears a field; fields not sent stay as they were.
- `purgeAfter` is `tenancyEndDate` + 365 days at midnight UTC, set or
  moved whenever `tenancyEndDate` is, and null when it is cleared. Stored
  as a Firestore Timestamp so a TTL policy can delete the rental.
- Another user's `PATCH` is 403 `FORBIDDEN` and changes nothing. The
  owner check and the write are one transaction.
- 404 `NOT_FOUND` for an unknown rental or an id that cannot be one.
- 400 `BAD_REQUEST` for non-JSON, unknown fields (`ownerUid`,
  `purgeAfter`), bad dates (`YYYY-MM-DD` only), negative or sub-cent
  money, an end date before the occupancy date, or an empty patch. The
  message names fields, never the values sent.
- 413 `PAYLOAD_TOO_LARGE` over 16 KB. 503 `DEPENDENCY_UNAVAILABLE` when
  Firestore does not answer. 401 without a token, as on every `/v1` route.
- The response never contains `ownerUid`. Logs carry the `rentalId`
  (`rental created`, `rental forbidden`), never the uid or the body.

## How to get to it (user POV)

Sign up anonymously (see [auth](auth.md)), then `POST /v1/rentals` with
the `idToken` as a bearer token, then `PATCH` the returned id. The iOS app
does not call these routes yet.

## Driving it with e2e

`tests/web/rentals.e2e.ts` creates and patches a rental through the API
under the Auth and Firestore emulators, reads the stored document back
from the Firestore emulator REST API (`Authorization: Bearer owner`
bypasses the rules), and covers 403, clearing `purgeAfter`, 400, 404, and
401. `pnpm --filter @fineprint/server test` pins validation and the
routes against an in-memory store; `test:emulator` runs
`test/emulator/rentals.test.ts` (Firestore documents, `users/{uid}`,
Timestamp types) and `test/emulator/gcs.test.ts` (Storage emulator).

## Proof

Status, body, and `Location` of the 201; the 200 body with `purgeAfter`;
the Firestore document's `ownerUid` and `purgeAfter` `timestampValue`;
403 `FORBIDDEN` with the document unchanged. In `.e2e/logs/server.log`:
`route: "/v1/rentals/:id"` (never the raw id path), `rental created`
lines, and no city, county, uid, or `eyJ`.

## Charters

```
rentals-owner|web|skeptic|Sign up two anonymous users; as the first, create a rental with POST /v1/rentals; as the second, try to PATCH it in every way; report any answer other than 403 FORBIDDEN or any change to the rental
rentals-input|web|fuzzer|POST /v1/rentals and PATCH /v1/rentals/:id with wrong types, impossible dates, huge numbers, unicode and very long city names, extra fields such as ownerUid and purgeAfter, and non-JSON bodies; report any 2xx for bad input, any 500, or any error message that echoes the input
```

## Gotchas

- The web target runs `auth,firestore,storage` emulators; the Firestore and
  Storage ones are JVMs (Java 21) and can take most of a minute to start,
  so the command's `startupTimeout` is 180 s.
- The Firestore emulator port is fixed (8090, `firebase.json`), as is
  Storage (9190): run one web e2e run or `test:emulator` at a time.
- The ios target still runs only the Auth emulator, so rentals there would
  fail until the app needs them and `e2e/firebase.ios.json` gains its own
  Firestore port.
- Money is US dollars to the cent (`1450.5`), not integer cents.
