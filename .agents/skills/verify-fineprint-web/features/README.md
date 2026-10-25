# Feature map

One file per server feature, from the client's point of view (the iOS app,
a legal-aid reader, an operator). The product features in spec §4.3 (F1 to
F10) get a file each as their routes land.

| Feature | Route | Test | Status |
| --- | --- | --- | --- |
| [Health check](healthz.md) | `GET /healthz`, `GET /health` | `tests/web/smoke.e2e.ts`, `tests/web/healthz.e2e.ts` | tested |
| [Error envelope and request IDs](errors.md) | every route | `tests/web/errors.e2e.ts` | tested |
| [Firebase anonymous auth](auth.md) | `/v1/*`, `GET /v1/me`, `GET /.well-known/fineprint-client.json` | `tests/web/auth.e2e.ts` | tested |
| [Deploy to Cloud Run](deploy.md) | `./deploy.sh`, the Cloud Run URL | `tests/deployed/deploy.e2e.ts` (`e2e.deployed.config.ts`) | tested |
