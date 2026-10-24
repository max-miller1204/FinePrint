# Error envelope and request IDs

Cross-cutting conventions every route follows (spec §13, §15.4).

## Sub-features

- Every error is `{ error: { code, message, retryInMs? } }`; `retryInMs`
  appears only when the client should wait and retry.
- An unknown route is 404 `NOT_FOUND`. An unexpected exception is 500
  `INTERNAL` with a generic message; its own message never reaches the
  client or the logs.
- Every response has `X-Request-Id`: the client's value when it sends one
  (up to 255 safe characters), else a fresh UUID.
- Every log line is JSON with `requestId` (`null` only for startup and
  shutdown lines) and logs the route pattern (`/r/:token`), not the raw
  path.

## How to get to it (user POV)

Any request. `GET /v1/does-not-exist` shows the envelope.

## Driving it with e2e

`tests/web/errors.e2e.ts` pins the 404 envelope, fresh ids, and an echoed
client id. `retryInMs` and the 500 path need a route that throws, so they
are pinned in `server/test/app.test.ts`.

## Proof

The response body and `X-Request-Id` header as above, and the same id on
the matching `request` line in `.e2e/logs/server.log`.

## Charters

```
errors-envelope|web|fuzzer|Request unknown paths, odd methods, huge and unicode paths, and malformed X-Request-Id headers; report any response not in the error envelope or without an X-Request-Id
```

## Gotchas

- A malformed `X-Request-Id` (bad characters or over 255) is replaced with
  a fresh UUID, not rejected. That is by design.
