# Firebase anonymous auth

Every `/v1` route needs a Firebase ID token (spec §5.2, §13). The iOS app
signs in anonymously on first launch, with no input, and sends the token as
`Authorization: Bearer <token>`. No email or phone number is collected.

## Sub-features

- `/v1/*` without a token, with a malformed `Authorization` header, or with
  a forged, expired, or deleted-account token is 401 `UNAUTHENTICATED` in
  the envelope, with `WWW-Authenticate: Bearer realm="fineprint"`.
- Auth runs before routing: an unknown `/v1` path without a token is 401,
  not 404.
- `GET /v1/me` answers `{ uid, provider }`, `provider` being `anonymous`,
  `apple` (after Sign in with Apple links the same uid), or `other`.
- If the check itself cannot run (no project configured, key fetch fails),
  the answer is 503 `DEPENDENCY_UNAVAILABLE`, never a pass.
- `GET /.well-known/fineprint-client.json` is public: the Firebase web API
  key and project ID the app signs in with, plus `authEmulatorHost` when the
  server runs against the Auth emulator. 503 when sign-in is not set up.
- Logs say why a request was rejected (`auth rejected`, `reason: missing |
  invalid | expired`) and never contain the token or the uid.
- Firestore rules deny every client read and write (`firestore.rules`); only
  the server, through the Admin SDK, touches Firestore.
- `/healthz`, `/.well-known/*`, and later `/r/*` and `/impact` need no token.

## How to get to it (user POV)

The app does it on launch. By hand: read the client config, sign up against
the Auth emulator it names, then call `/v1/me` with the `idToken`.

## Driving it with e2e

`tests/web/auth.e2e.ts` covers the 401 cases, the public config, and a real
anonymous sign-up whose token reaches `/v1/me`. The web target runs the
server under `firebase emulators:exec --only auth`, which sets
`FIREBASE_AUTH_EMULATOR_HOST` and `GCLOUD_PROJECT=demo-fineprint`.

`pnpm --filter @fineprint/server test` pins the middleware with a fake
verifier. `pnpm --filter @fineprint/server test:emulator` runs
`test/emulator/` under the Auth and Firestore emulators: the production
firebase-admin path end to end (anonymous, Apple-linked, deleted, forged)
and the Firestore rules for signed-out, owner, and other users. It needs
Java 21 for the Firestore emulator.

## Proof

Status, envelope `error.code`, and `WWW-Authenticate` for each 401; `{ uid,
provider: 'anonymous' }` for the signed-up account; in
`.e2e/logs/server.log`, an `auth rejected` line with the `reason` for each
401 and no `eyJ` (a JWT) anywhere.

## Charters

```
auth-tokens|web|fuzzer|Call /v1/me and other /v1 paths with no Authorization header, empty and odd schemes, garbage, truncated, unsigned, and very long bearer tokens; report any answer that is not 401 UNAUTHENTICATED in the envelope
auth-public|web|skeptic|Check that /healthz and /.well-known/fineprint-client.json answer without a token and that every /v1 path refuses to answer without one
```

## Gotchas

- In emulator mode firebase-admin skips the signature check, so the server
  refuses to start it for a project ID that does not begin with `demo-`.
- The Auth emulator listens on a fixed port (9099, `firebase.json`): run
  one e2e run or charter at a time.
- firebase-admin reports a failed public-key fetch as an invalid token, so
  that case is a 401, not a 503.
- A token stays valid for up to an hour after its account is deleted; the
  server does not check revocation on each request.
