# Health check

`GET /healthz` tells Cloud Run and an operator whether the server and its
dependencies answer. No auth. `GET /health` is the same route: Cloud Run reserves
paths ending in `z` on its `*.run.app` URLs, so `/healthz` never reaches
the server there.

## Sub-features

- 200 `{ status: 'ok', checks: { firestore, gcs, kms } }` when every check
  passes; each check is `ok` or `stubbed`.
- 503 in the error envelope, code `DEPENDENCY_UNAVAILABLE`, message
  `Unreachable: <names>`, when a check throws or takes over 2 s.

## How to get to it (user POV)

`GET /healthz` (or `/health`) on the server's base URL. No account. On a
`*.run.app` URL only `/health` works.

## Driving it with e2e

`tests/web/smoke.e2e.ts` (Doctor) and `tests/web/healthz.e2e.ts` pin the
200 body. The 503 path needs a failing dependency, so it is pinned in
`server/test/app.test.ts` with an injected check until M6 adds emulators.

## Proof

Status 200, `content-type: application/json`, the exact body above, and an
`INFO` `request` line with `route: "/healthz"` in `.e2e/logs/server.log`.

## Charters

```
healthz-methods|web|skeptic|Call /healthz with GET, HEAD, POST, and a trailing slash; report any answer that is not JSON or not in the error envelope
```

## Gotchas

- Every check reads `stubbed` until M6. That is by design, not a bug.
