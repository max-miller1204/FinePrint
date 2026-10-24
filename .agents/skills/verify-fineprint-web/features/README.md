# Feature map

One file per server feature, from the client's point of view (the iOS app,
a legal-aid reader, an operator). The product features in spec §4.3 (F1 to
F10) get a file each as their routes land.

| Feature | Route | Test | Status |
| --- | --- | --- | --- |
| [Health check](healthz.md) | `GET /healthz` | `tests/web/smoke.e2e.ts`, `tests/web/healthz.e2e.ts` | tested |
| [Error envelope and request IDs](errors.md) | every route | `tests/web/errors.e2e.ts` | tested |
| [Firebase anonymous auth](auth.md) | `/v1/*`, `GET /v1/me`, `GET /.well-known/fineprint-client.json` | `tests/web/auth.e2e.ts` | tested |

## CI gate

`.github/workflows/ci.yml` runs on every push and pull request. It runs
the root scripts, so a feature's server unit tests gate merges once they
are in `server/test/` (or any workspace with a `test` script). The e2e
tests in this map do not run in CI yet; run them locally before a PR.

| Job | Command | Fails on |
| --- | --- | --- |
| lint | `pnpm lint` (Biome, recommended rules, no formatter) | any lint error; warnings pass |
| typecheck | `pnpm typecheck` | a `tsc` error in any workspace with a `typecheck` script |
| unit tests | `pnpm test` | a failing vitest test in any workspace with a `test` script (emulator tests excluded) |
| jurisdictions schema | `pnpm check:jurisdictions` | invalid JSON under `jurisdictions/`, or a rule that fails `jurisdictions/schema/rule.schema.json` |
| gitleaks | gitleaks 8.30.1, `gitleaks git` | a secret in any commit reachable from HEAD |
