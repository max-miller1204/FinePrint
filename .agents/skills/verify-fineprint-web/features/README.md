# Feature map

One file per server feature, from the client's point of view (the iOS app,
a legal-aid reader, an operator). The product features in spec §4.3 (F1 to
F10) get a file each as their routes land.

| Feature | Route | Test | Status |
| --- | --- | --- | --- |
| [Health check](healthz.md) | `GET /healthz`, `GET /health` | `tests/web/smoke.e2e.ts`, `tests/web/healthz.e2e.ts` | tested |
| [Error envelope and request IDs](errors.md) | every route | `tests/web/errors.e2e.ts` | tested |
| [Firebase anonymous auth](auth.md) | `/v1/*`, `GET /v1/me`, `GET /.well-known/fineprint-client.json` | `tests/web/auth.e2e.ts` | tested |
| [Rentals](rentals.md) | `POST /v1/rentals`, `PATCH /v1/rentals/:id` | `tests/web/rentals.e2e.ts` | tested |
| [Evidence uploads](evidence.md) | `POST /v1/rentals/:id/evidence`, `POST /v1/rentals/:id/evidence/:itemId/complete` | `tests/web/evidence.e2e.ts` | tested |
| [Evidence sealing and ledger](integrity.md) | `POST /v1/rentals/:id/seal`, `GET /v1/rentals/:id/ledger`, `GET /v1/rentals/:id/manifests/:manifestId`, `DELETE /v1/rentals/:id/evidence/:itemId`, `GET /.well-known/fineprint-keys.json` | `tests/web/integrity.e2e.ts` | tested |
| [Rule pack](rule-pack.md) | none (internal; first caller #14) | `server/test/rules.test.ts`, `pnpm check:jurisdictions`, `node scripts/refresh-snapshots.ts` (live) | unit and CI tested |
| [Gemma client](gemma-client.md) | none (internal; first caller #14) | `server/test/gemma.test.ts`, `pnpm smoke:gemma` (live) | unit and live tested |
| [Deploy to Cloud Run](deploy.md) | `./deploy.sh`, the Cloud Run URL | `tests/deployed/deploy.e2e.ts`, `tests/deployed/evidence.e2e.ts` (`e2e.deployed.config.ts`) | tested |

## Planned features (spec §4.3)

Each one gets a file in this folder as its routes land. So far only F2's
evidence uploads and sealing have them ([evidence](evidence.md),
[integrity](integrity.md)), plus F1's [rule pack](rule-pack.md), which
has no route.

| Feature | Route | Board issues | Status |
| --- | --- | --- | --- |
| F1 Lease Explainer | `/v1` lease routes and the SSE stream; rule pack and pipeline behind them | #12, #13, #14, #15, #16, #19, #20 | rule pack schema, loader, check registry, and resolver built (#12, [rule-pack](rule-pack.md)); rules, pipeline, and routes not built |
| F2 Move-in Evidence | `/v1` evidence upload (signed URLs), seal, and ledger routes | #23, #24, #26 | upload URLs and hash check built (#23); seal, ledger, and delete built (#24); damage analysis not built |
| F3 Landlord Report Diff + 5-Day Objection | `/v1` landlord report extract, diff, and objection draft routes | #28, #30 | not built |
| F4 Responsibility Check | `/v1` responsibility check route | #31 | not built |
| F5 Repair Request + Rent Escrow Path | `/v1` repair notice draft route | #32 | not built |
| F6 Move-out Ghost Overlay + Diff | `/v1` move-out compare route | #27 | not built |
| F7 Grounded Ask | `/v1` ask route with function calling | #41 | not built |
| F8 Legal-Aid Web Evidence Report | `GET /r/:token`, `/.well-known/fineprint-keys.json`, share link routes | #33, #34, #35, #36 | `/.well-known/fineprint-keys.json` built (#24); report, verify, shares not built |
| F9 Insurance Claim Packet | none (the PDF is built on the device) | #55 | not built |
| F10 High-Stakes Handoff | triage step inside the model-backed `/v1` routes; no route of its own | #37, #38 | not built |

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
| jurisdictions schema | `pnpm check:jurisdictions` | invalid JSON under `jurisdictions/`, a rule that fails `jurisdictions/schema/rule.schema.json`, or a `statuteQuote` not verbatim in its snapshot |
| gitleaks | gitleaks 8.30.1, `gitleaks git` | a secret in any commit reachable from HEAD |
