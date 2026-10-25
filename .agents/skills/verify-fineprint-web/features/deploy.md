# Deploy to Cloud Run

`./deploy.sh` puts the server in an organization's own Google Cloud project
in one command (spec §15.1, §15.4). The user is a nonprofit operator, often
in Cloud Shell, who has created a project and linked billing.

## Sub-features

- Prompts for the project and region (default `us-east4`), or takes
  `--project` and `--region`. Refuses to go on when billing is not linked.
- Enables the APIs, then creates only what is missing: Firestore Native
  `(default)`, the evidence bucket `<project>-fineprint-evidence` (uniform
  access, public access prevention), key ring `fineprint` with key
  `report-signing` (`EC_SIGN_P256_SHA256`), service accounts `fineprint-api`
  (runtime) and `fineprint-build` (Cloud Build), Artifact Registry repo
  `fineprint`, secret `GEMINI_API_KEY`, Identity Platform with anonymous
  sign-in, the app's API key `fineprint-client`, and a $20 budget that
  alerts at $10 and $20. It also makes the account `fineprint-purge` (no
  roles) and the Cloud Scheduler job `fineprint-purge` (daily 03:17 UTC) that
  calls `POST /internal/purge` as that account (see
  [delete-purge.md](delete-purge.md)); the service gets
  `PURGE_CALLER_EMAIL` to match.
- Least privilege for `fineprint-api`: `datastore.user` on the project,
  `storage.objectAdmin` on the bucket, `cloudkms.signerVerifier` on the key,
  `secretmanager.secretAccessor` on the secret, and
  `iam.serviceAccountTokenCreator` on itself only, so it can sign evidence
  upload and read URLs through IAM `signBlob` (Cloud Run has no key file).
  Without that grant, `POST /v1/rentals/:id/evidence` is 503.
- `gcloud run deploy --source .` (the root `Dockerfile`) with env vars
  `FIREBASE_PROJECT_ID`, `FIREBASE_API_KEY`, `GCS_EVIDENCE_BUCKET`,
  `KMS_SIGNING_KEY` and the secret mounted as `GEMINI_API_KEY`; then checks
  `/health` (Cloud Run reserves `/healthz` on `*.run.app`) and prints the
  service URL, the key URL, and the iOS settings: the exact
  `FINEPRINT_SERVER_URL[config=Release] = https:/$()/<host>` line for
  `ios/Config/Server.xcconfig` (spec §15.1 step 6, #78).
- A second run creates nothing and ships a new revision.
- `--destroy` asks for the project ID typed back, then removes everything.
  KMS keys cannot be deleted: their versions are scheduled for destruction
  and the empty key ring stays. A later deploy adds a fresh key version.

## How to get to it (user POV)

```sh
gcloud auth login
op run --env-file ~/.config/fineprint/.env -- ./deploy.sh --project <id>   # 1Password
scripts/with-gemini-key.sh ./deploy.sh --project <id>                     # macOS Keychain
./deploy.sh --destroy --project <id>
```

## Driving it with e2e

The script is not driven by e2e; it is run by hand against a dev project
because it creates billed resources (ask the user first). The deployed
server is then checked with `e2e.deployed.config.ts`, which attaches to the
Cloud Run URL instead of starting a server:

```sh
cd e2e
E2E_DEPLOYED_URL=<service URL> npx e2e run --config e2e.deployed.config.ts
```

`tests/deployed/deploy.e2e.ts` checks `/health`, that the client config
names the real project with an `AIza...` key and no emulator, that an
anonymous sign-in with that key reaches `/v1/me`, and that `/v1` without a
token is 401. `tests/deployed/evidence.e2e.ts` creates a rental and an
evidence item, PUTs a photo to the signed URL on `storage.googleapis.com`,
and completes it (200 `received`); tampered bytes are stored by Cloud
Storage but rejected on `complete` (422 `HASH_MISMATCH`). The main config
excludes `tests/deployed/**`.

## Proof

The script's own output for both runs (every line `ok` on the second), the
deployed e2e run exiting 0, and `--destroy` output followed by
`gcloud run services list`, `gcloud storage buckets list`, and
`gcloud billing budgets list` showing nothing named `fineprint`.

## Charters

None. The script is not an HTTP surface; bug-bash the deployed server
with the other features' charters against the Cloud Run URL.

## Gotchas

- `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) must be in the environment until
  the secret has a version. With no key and no terminal, the script exits
  with both loader commands; later runs keep the stored key.
- Newly enabled APIs answer `SERVICE_DISABLED` for a minute or two. The
  script's `gc` wrapper retries those calls.
- The deployed tests create a real anonymous user each run. `--destroy`
  turns anonymous sign-in off but does not delete those users.
- Firestore keeps a deleted `(default)` ID for about five minutes. A deploy
  right after `--destroy` prints `wait <n>s` and retries on its own.
- Google protects an API key used in the last 7 days from deletion.
  `--destroy` overrides that (`--no-check-existing-usage`) and drops
  gcloud's output, which echoes the key string.
