# Share links (#35)

The tenant creates and manages report links in Settings > Share Links.
The API offers `POST/GET /v1/rentals/:id/shares`, `DELETE /v1/shares/:id`,
and `GET /v1/shares/:id/access`. All require the rental owner's Firebase
ID token. Creation returns a relative `path` once. List replies cannot
recover the original URL. Scope selects lease findings and/or evidence.
Letters are not implemented and are rejected as a scope.

Default and maximum expiry: 30 days; optional explicit future `expiresAt`.
PIN: 6 to 12 ASCII digits. Only a salted scrypt digest is stored. Five
attempts per link per 15 minutes, reserved transactionally before hashing;
this includes successful entries. The link-wide budget works across server
instances without retaining an IP or visitor fingerprint. Guessing can lock
out legitimate recipients until the window resets. A valid PIN redirects
to a GET and sets a 15-minute HttpOnly, SameSite=Strict cookie (Secure over
HTTPS), scoped to this link. Production origins are forced to HTTPS even
behind Cloud Run TLS termination; HTTP is limited to the emulator lane. Only its hash is stored server-side.

Reports and original photo routes check expiry, revocation, PIN grant and
scope on every request. Photos go through the authorized route instead of
handing out a GCS URL that would outlive revocation. No response is cached.
Downloaded copies cannot be recalled. Unknown links are 404; expired and
revoked links have clear 410 pages. Wrong PIN: 403; throttled: 429 with
Retry-After. Storage/signing failures fail closed.

Create/revoke and their signed ledger event are atomic. Revoke is
idempotent. Public projections explicitly select fields and never expose
owner IDs, storage paths, full lease text, PIN hashes or sessions. Access
records contain only `at` and `userAgentFamily` from a closed browser-family
allowlist. Report opens only, including reloads; failed attempts and image
loads are not views. The owner reads 100 views per page with `nextBefore`;
the composite cursor preserves entries with equal timestamps. Account
purge recursively removes shares, access entries and PIN sessions.

## Proof

From `e2e/`, run `pnpm exec e2e run tests/web --target web --no-cache
--retries 0 --trace on --output .e2e/proof/issue-35`.

`tests/web/shares.e2e.ts` proves owner isolation, defaults, validation,
hashed storage, route-only private logging, concurrency limiting, actual
PIN form submission and reload, immediate session revocation, real original
photo bytes and manifest projection, deleted/expired/revoked/out-of-scope
photo refusal, equal-time access pagination, per-finding lease language,
full-text exclusion, phone layouts and HTML pages.
The smoke and all other web tests run in the same invocation. No model key
is needed; live model tests skip when unconfigured.

For concurrent worktrees, point `E2E_WEB_FIREBASE_CONFIG` at an isolated
Firebase config with absolute rules paths and unused emulator ports. Set
`E2E_WEB_FIRESTORE_HOST` and `E2E_WEB_AUTH_HOST` in the test process to match.
The default config and ports stay unchanged. The #35 Linux run used Auth
19099, Firestore 18090, Storage 19190, websocket 19150, hub 14400 and
logging 14500. Do not stop another worktree's emulators.

The PIN form is stress-tested at 320px, dark mode and 200% text; error and
expired/revoked/limited pages contain no tenant text. The existing report's
fixture-only Demo data / Worst case / Empty / One toggle remains available
at `/r/fixture?data=worst`. It covers long mixed-script labels, large counts,
missing data and unbreakable hashes without adding fixture access to real
share links. No added motion. Hardware Safari/keyboard/safe-area behavior
and iOS Settings runtime checks still require a phone.

## Explore charter

```text
share-links|web|skeptic|Create a scoped rental link through the authenticated API, submit wrong and correct PINs in the browser, reload, expire and revoke it, then request its photos and read the owner's access log. Try another owner, concurrent guesses, and long text at 320px. Check that revoked sessions fail immediately and that no PIN, token, IP, raw user agent, owner ID or storage path leaks into logs or public projections. Downloaded copies are outside revocation.
```

Final Linux proof: `.e2e/proof/issue-35-final/`, all 12 web files, 46 tests
passed, 2 live-model tests skipped without a configured model, exit 0.
Server unit suite: 446 passed. Typecheck, lint and jurisdiction checks pass.
The macOS CI build is separate from this Linux evidence.
