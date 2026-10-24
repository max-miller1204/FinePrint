# Anonymous sign-in

The app signs in to Firebase Auth anonymously on first launch, with no
screen and no input, and sends the ID token to every `/v1` route (spec
§5.2). It never asks for an email or phone number. The server side is in
`verify-fineprint-web` [auth](../../verify-fineprint-web/features/auth.md).

## Sub-features

- First launch: the app reads the server's Firebase project from
  `GET /.well-known/fineprint-client.json`, then creates an anonymous
  account. DEBUG builds follow the `authEmulatorHost` it names; Release
  builds never do.
- The account is kept in the keychain and its ID token refreshed before it
  expires. `-FinePrintInMemoryStore` (always on under e2e) keeps it in
  memory, so each launch is a new account.
- A `/v1` call that gets a 401 refreshes the token and retries once.
- Pointing the app at a server on another Firebase project starts a new
  account.
- Offline at first launch: Developer Options shows "Couldn't sign in" and a
  retry; the app retries on its own when it returns to the foreground.
- Developer Options > Account (`developer.authStatus`, `developer.userID`,
  ID token expiry) and Check with Server (`developer.checkServer`), which
  calls `GET /v1/me` and shows `developer.serverCheckResult`.

## How to get to it (user POV)

Nothing to do: it happens at launch. To see it: Settings > Developer
Options > Account.

## Driving it with e2e

`tests/ios/auth.e2e.ts` opens Developer Options (the target passes
`-FinePrintDeveloperMenu`), waits for "Signed in anonymously", taps Check
with Server, and expects "The server accepted this sign-in." Unit tests in
`ios/FinePrintTests/AuthTests.swift` cover the REST calls, refresh, the
retry, account replacement, offline, and the Release emulator guard with a
stubbed transport.

## Proof

The two texts above on screen, and in `.e2e/logs/server-ios.log` a `GET
/.well-known/fineprint-client.json` 200 and a `GET /v1/me` 200 with no
`eyJ` (a JWT) anywhere.

## Charters

```
sign-in-offline|ios|skeptic|Open Developer Options and use Check with Server repeatedly; report any state where the status says signed in but the server check fails, or any error text that is not plain language
```

## Gotchas

- Unsigned builds (`pnpm build:ios` uses `CODE_SIGNING_ALLOWED=NO`) have no
  keychain, so they sign in again on every launch even without
  `-FinePrintInMemoryStore`.
