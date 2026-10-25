# FinePrint

> Virginia renters keep their security deposit and get repairs made. FinePrint turns their lease and their phone camera into evidence and the deadlines the law already gives them.

## Overview

Under Virginia law, the landlord's move-in damage report is **deemed correct unless the tenant objects in writing within five days** ([Va. Code § 55.1-1214](https://law.lis.virginia.gov/vacode/title55.1/chapter12/section55.1-1214/)). Most tenants do not know this clock exists. Damage left off the report can come out of their deposit at move-out.

FinePrint has two parts:

- **An iOS app for tenants** (SwiftUI, iOS 26). It explains the lease, records sealed move-in evidence, tracks the deadlines, and drafts the letters. The tenant sends the letters. The app never sends anything for them.
- **A web Evidence Report for legal aid caseworkers.** The server renders it, and the reader can check its signatures in the browser.

Scope: residential tenancies under the Virginia Residential Landlord and Tenant Act (VRLTA, Va. Code § 55.1-1200 et seq.). FinePrint does not cover commercial leases or other states, and it does not represent tenants. The rules live in a data-only jurisdiction pack (`jurisdictions/`), so a later contributor can add a state without changing code.

FinePrint is not a lawyer and gives no legal advice. When the stakes are high (eviction, lockout, retaliation, discrimination), it sends the tenant to legal aid.

### Why it matters

- **Most Blacksburg households rent.** 64% of occupied housing units in the Town of Blacksburg are renter-occupied: 8,885 of 13,840 (±612). In Montgomery County the share is 45% (16,523 of 36,961), and in Virginia it is 33% (1,099,123 of 3,365,732). Source: U.S. Census Bureau, American Community Survey 2020–2024 5-year estimates, table B25003, via [Census Reporter](https://censusreporter.org/data/table/?table=B25003&geo_ids=16000US5107784,05000US51121,04000US51).
- **Most Virginia Tech undergraduates live off campus.** 67% of degree-seeking undergraduates live off campus or commute, while 99% of first-year students live in college housing. Virginia Tech enrolled 31,536 undergraduates in fall 2025. Source: Virginia Tech [Common Data Set 2025–2026](https://aie.vt.edu/analytics-and-ai/common-data-set.html), sections B1 and F1.
- **Many renters lose some or all of their deposit, and documentation helps.** These figures are national; no Virginia data was found. Among U.S. renters who recently moved from a previous rental, 40% got their entire deposit back, 18% got most of it, 9% got some, and 24% got none. 19% disagreed with the landlord about repairs, damage, or maintenance, and 16% about move-out costs or fees. Renters who documented the move-in condition with photos, video, and a checklist, and told the landlord, got their entire deposit back 50% of the time, against 41% for renters who did none of these. That comparison is observational. Source: [Zillow Consumer Housing Trends Report 2024: Renters](https://www.zillow.com/research/renters-housing-trends-report-2024-34387/) ([archived copy](https://web.archive.org/web/20260120104727/https://www.zillow.com/research/renters-housing-trends-report-2024-34387/)). The report combines six surveys of more than 36,000 renters, fielded March to July 2024.
- **Virginia deposit disputes.** TODO: source. Virginia's courts do not report security deposit cases separately, and no public Virginia dataset was found.

### Status

This is a hackathon build. The README describes the code on `main`. Planned work is marked **planned** and links to its issue.

| Area | On `main` | Planned |
| --- | --- | --- |
| iOS app shell | Tab bar (Lease, Evidence, Repairs, Letters, Ask), the next-deadline accessory, onboarding, settings, the developer menu | The screens for the Lease, Repairs, Letters, and Ask tabs |
| Deadlines | The move-in report, objection, and deposit itemization clocks, with local reminders | |
| Evidence capture | In-app camera, SHA-256 at the shutter, GPS removed, on-device quality checks, an encrypted upload queue, direct upload to Cloud Storage | Damage analysis with Gemma, the move-out overlay and diff |
| Evidence integrity | Server hash check, Cloud KMS-signed manifests (RFC 8785 JCS), a hash-chained signed ledger, logged deletion, published public keys | The web report's in-browser verification |
| Sign-in | Firebase anonymous auth (Identity Platform) | Sign in with Apple |
| AI | The Gemma 4 client: routing, rate limits, retries, fallback, Zod validation, usage records ([docs/ai-pipeline.md](docs/ai-pipeline.md)) | Every AI stage below, and the rule pack |
| Deploy | Idempotent `deploy.sh` and `--destroy` | |

## Models and licenses

| Model | Role | License |
| --- | --- | --- |
| [`gemma-4-26b-a4b-it`](https://ai.google.dev/gemma/docs/core) (mixture of experts, about 4B active parameters) | Primary model for every stage | [Apache-2.0](https://ai.google.dev/gemma/apache_2) |
| [`gemma-4-31b-it`](https://ai.google.dev/gemma/docs/core) (dense) | Independent verifier for legal findings only | [Apache-2.0](https://ai.google.dev/gemma/apache_2) |
| `gemini-flash-latest` | Last fallback, only when every Gemma model is down. The server labels its answers as fallback answers. | Proprietary, billed |

The server calls both Gemma models through the [Gemini API](https://ai.google.dev/gemini-api/docs) with the `@google/genai` SDK. The model IDs live in [`server/src/ai/models.ts`](server/src/ai/models.ts). The env vars `GEMMA_PRIMARY`, `GEMMA_VERIFIER`, and `GEMMA_FALLBACK` change them. FinePrint has no on-device language model. On the phone it uses only Apple frameworks (Vision, NaturalLanguage, CryptoKit).

`GEMMA_PROVIDER=openai_compatible` with `GEMMA_BASE_URL` is reserved for a self-hosted Gemma 4 server (Ollama or vLLM). The setting exists, but that provider is **not built yet**.

FinePrint itself is licensed under [Apache-2.0](LICENSE), the same license as Gemma 4.

### What the AI does

Design rule: **Gemma interprets, code verifies.** Each call returns structured JSON, and Zod validates it. Code checks quotes, citations, numbers, and dates literally. User documents are wrapped in `<document>` tags, and the system instruction says that text inside a document cannot change the task.

| Stage | Model | Thinking | What it does | Status |
| --- | --- | --- | --- | --- |
| Triage | 26B | `minimal` | Finds high-stakes situations (eviction, lockout, retaliation). A keyword backstop in code also triggers, so either one can route the tenant to legal aid. | Planned (#37) |
| Lease extraction | 26B | `high` | Pulls clauses and key terms (rent, deposit, dates, fees) from the redacted lease text | Planned (#14) |
| Rule mapping | 26B | `high` | Maps clauses to VRLTA rules from the rule pack, such as the prohibited provisions in § 55.1-1208 and the late-fee cap in § 55.1-1204 | Planned (#14) |
| Legal verifier | 31B | `high` | A second, independent opinion on each legal finding. If 31B is down, the finding is marked "unverified". | Planned (#15) |
| Vision | 26B | `minimal` | Finds damage in evidence photos, proposes an approximate box for the tenant to adjust, and compares move-out photos with move-in photos | Planned |
| Landlord report diff | 26B | not set | Compares the landlord's move-in report with the tenant's sealed evidence, then drafts the five-day objection | Planned |
| Responsibility check | 26B, then 31B | `high` | "Likely the landlord's / likely yours" with reasons, citations, confidence, and what would change the answer. 31B checks the High-confidence verdicts. | Planned |
| Ask | 26B | `minimal` | Answers questions grounded in the tenant's lease and the rule pack, with function calling | Planned |
| Explanation, translation | 26B | `minimal` | Plain-language explanations. Translation is a separate, last step over text that is already verified. Legal quotes stay verbatim. | Planned |

What is built today is the client that every stage calls: `generate(stage, schema, docs, options)` in [`server/src/ai/gemma.ts`](server/src/ai/gemma.ts). Its stage table, retry policy, fallback chains, and measured model behavior are in [docs/ai-pipeline.md](docs/ai-pipeline.md). No route calls a model yet.

## Architecture

```mermaid
flowchart LR
  subgraph iPhone["iOS app (SwiftUI, iOS 26)"]
    CAM["In-app camera<br/>SHA-256 at capture, GPS removed"]
    Q[("Upload queue<br/>complete file protection")]
    UI["Tabs, onboarding,<br/>deadline reminders"]
  end

  subgraph GCP["Google Cloud project (us-east4)"]
    RUN["Cloud Run: fineprint<br/>Hono + TypeScript<br/>REST API"]
    FS[("Firestore<br/>rentals, evidence, manifests,<br/>ledger, usage")]
    GCS[("Cloud Storage<br/>evidence originals")]
    KMS["Cloud KMS<br/>EC P-256 signing key"]
    SM["Secret Manager<br/>Gemini API key"]
    LOG["Cloud Logging<br/>structured JSON, no content"]
    CB["Cloud Build +<br/>Artifact Registry"]
  end

  AUTH["Firebase Auth<br/>(Identity Platform)<br/>anonymous sign-in"]
  GEM["Gemini API<br/>gemma-4-26b-a4b-it<br/>gemma-4-31b-it"]

  CAM --> Q
  Q -- "create item, then complete" --> RUN
  Q -- "PUT via V4 signed URL" --> GCS
  UI -- "ID token" --> AUTH
  UI -- "Bearer ID token" --> RUN
  RUN -- verify token --> AUTH
  RUN --> FS
  RUN -- "signed URLs, re-hash" --> GCS
  RUN -- "asymmetricSign" --> KMS
  SM -. "env var at deploy" .-> RUN
  RUN -. "client built, no route yet" .-> GEM
  RUN --> LOG
  CB -- "deploy.sh builds" --> RUN
```

The planned design (spec §5.1) adds on-device OCR (`RecognizeDocumentsRequest`) and PII redaction before any lease text leaves the phone, on-device PDF letters, Server-Sent Events for streamed findings, and the web Evidence Report at `/r/:token`. None of these are on `main` yet.

### How a photo becomes evidence

1. The in-app camera hashes the original (SHA-256) at the shutter, removes any GPS, and checks for darkness, overexposure, and blur.
2. The app queues the photo with complete file protection and calls `POST /v1/rentals/:id/evidence`. The server returns a 5-minute V4 signed PUT URL. The upload must send the signed content type and declared hash (`x-goog-content-sha256`) headers. Cloud Storage does not hash the body against that header, so step 4 is the check that rejects other bytes.
3. The app uploads the bytes **straight to Cloud Storage**. The API never proxies image bytes.
4. `POST /v1/rentals/:id/evidence/:itemId/complete`: the server hashes the stored object again, compares the hash and size with the capture record, and records `receivedAtServer`. A mismatch returns 422 `HASH_MISMATCH`.
5. `POST /v1/rentals/:id/seal`: the server builds a manifest of the items and the previous ledger head, canonicalizes it with RFC 8785 JCS, and signs it with Cloud KMS. It then appends a hash-chained, KMS-signed `manifest_sealed` ledger entry.
6. Anyone can check a signature against the public keys at `/.well-known/fineprint-keys.json`.

### Server routes on `main`

| Route | Auth | Purpose |
| --- | --- | --- |
| `GET /healthz`, `GET /health` | Public | Health. Cloud Run reserves `/healthz` on `*.run.app`, so `deploy.sh` checks `/health`. The dependency checks are stubbed for now. |
| `GET /.well-known/fineprint-client.json` | Public | Firebase project ID and web API key for the app. One app build works with any deployment. |
| `GET /.well-known/fineprint-keys.json` | Public | KMS public keys (JWK) |
| `GET /v1/me` | ID token | Confirms that the server accepts the token |
| `POST /v1/rentals`, `PATCH /v1/rentals/:id` | ID token | Create and update a rental |
| `POST /v1/rentals/:id/evidence` | ID token | Create evidence items and return signed upload URLs |
| `POST /v1/rentals/:id/evidence/:itemId/complete` | ID token | Check the stored hash and record the receipt time |
| `DELETE /v1/rentals/:id/evidence/:itemId` | ID token | Delete the photo and log `evidence_deleted` in the ledger |
| `POST /v1/rentals/:id/seal` | ID token | Sign a manifest and append it to the ledger |
| `GET /v1/rentals/:id/ledger`, `GET /v1/rentals/:id/manifests/:manifestId` | ID token | Read the ledger and the manifests |

Errors use one envelope: `{ "error": { "code": "...", "message": "..." } }`. Each response carries an `X-Request-Id`, and each log line carries the same ID.

## Setup

Prerequisites: Node 22 or later, pnpm (the version is pinned in `package.json`), Java 21 for the Firebase emulators, and Xcode with the iOS 26 SDK for the app.

```sh
pnpm install
pnpm --filter @fineprint/server dev:emulated   # server on :8080 with the Auth, Firestore, and Storage emulators
```

The iOS app's default server is `http://localhost:8080`. To build it and run its tests, see [ios/README.md](ios/README.md).

Checks (CI runs these on each push and pull request):

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm check:jurisdictions
cd e2e && pnpm test:e2e:web        # end-to-end tests against the server with emulators
```

Most work needs no Gemini API key. The live Gemma smoke test and the e2e agent steps need one. The repo never reads a `.env` file itself. Load the key with 1Password or the macOS Keychain, as [CONTRIBUTING.md](CONTRIBUTING.md) describes.

### Deploy your own

[![Open in Cloud Shell](https://gstatic.com/cloudssh/images/open-btn.svg)](https://shell.cloud.google.com/cloudshell/editor?cloudshell_git_repo=https://github.com/max-miller1204/FinePrint&cloudshell_git_branch=main)

The button clones the repo into Cloud Shell. First create a Google Cloud project and link billing to it. Then, in Cloud Shell or on any machine with the Google Cloud CLI, run:

```sh
gcloud auth login
./deploy.sh                    # prompts for the project and region (us-east4)
./deploy.sh --destroy          # removes it all, after you type the project ID
```

The Gemini API key comes from `GEMINI_API_KEY` in the environment. Load it with 1Password (`op run --env-file ~/.config/fineprint/.env -- ./deploy.sh`) or the macOS Keychain (`scripts/with-gemini-key.sh ./deploy.sh`). See [CONTRIBUTING.md](CONTRIBUTING.md). If neither is available, as in Cloud Shell, the script asks for the key with hidden input. The key goes straight to Secret Manager, and the script never prints it.

You can run the script again at any time. It skips the resources that exist and ships a new revision. At the end it prints the server URL to set in the iOS app. The budget alerts are in US dollars, so the budget step fails on a billing account that uses a different currency.

## API dependency map

Each external service FinePrint uses. `deploy.sh` creates these resources and grants these bindings. The runtime service account is `fineprint-api`, and the build service account is `fineprint-build`. Measured costs are coming in #51. The cost column gives only the pricing model.

| Service | Used for | IAM / permissions | Cost | What breaks if it is down |
| --- | --- | --- | --- | --- |
| **Gemini API** (`generativelanguage.googleapis.com`) | Gemma 4 calls (26B and 31B), with Gemini Flash as the last fallback | API key from AI Studio, stored in the Secret Manager secret `GEMINI_API_KEY`. No IAM role. | Gemma 4: free of charge, and the paid tier is "Not available" ([pricing](https://ai.google.dev/gemini-api/docs/pricing), read 2026-10-22). Flash fallback: billed per token, so set a spend cap in AI Studio. Tier 1 quota: 30 RPM, 16K input TPM, 14.4K RPD per model. | Nothing today, because no route calls a model yet. When the AI stages land: on 429 or 5xx the client retries with backoff, then falls back from 31B to 26B to Flash. If every model fails, legal findings show as "unverified". Capture and sealing do not depend on it. |
| **Firebase Auth / Identity Platform** (`identitytoolkit`, `securetoken`) | Anonymous sign-in on the app. The server verifies ID tokens with `firebase-admin`. | API key `fineprint-client`, limited to Identity Toolkit and Secure Token. It identifies the project and grants nothing on its own, so the server publishes it. Token checks need no role. | Identity Platform per-user pricing. Anonymous sign-in is within its free tier at hackathon scale ([pricing](https://cloud.google.com/identity-platform/pricing)). | New users cannot sign in, and tokens cannot refresh. When a token expires, `/v1` calls return 401. Photos stay queued on the phone. |
| **Cloud Run** (`run`) | The single `fineprint` service: the API, and later the web report. `--max-instances=3`, 512 MiB, unauthenticated ingress (the app authenticates per request). | The service runs as `fineprint-api`. `fineprint-build` has `roles/run.builder`. | Per request and per vCPU-second. Scales to zero. | Everything server-side. The app keeps working offline: captures queue and upload on reconnect. |
| **Firestore** (Native mode, `(default)`) | Rentals, evidence records, manifests, the ledger, and model usage records (`usage/{date}/calls`). Client access is denied by rules. Only the server reads and writes. | `fineprint-api`: `roles/datastore.user` on the project | Per document read, write, and delete, plus storage. The free daily quota covers small deployments. | The rental, evidence, and seal routes return 503 `DEPENDENCY_UNAVAILABLE`, which the app retries. Nothing is sealed. |
| **Cloud Storage** (bucket `<project>-fineprint-evidence`) | Evidence originals and the 1536 px copies for the model. Uniform access, public access prevention enforced, reached only through 5-minute V4 signed URLs. | `fineprint-api`: `roles/storage.objectAdmin` on the bucket, and `roles/iam.serviceAccountTokenCreator` on itself only. Cloud Run has no key file, so the server signs URLs through IAM `signBlob` (`iamcredentials` API). | Per GB-month of standard storage in `us-east4`, plus operations | Uploads and the hash check fail. Photos stay in the phone's queue and retry. If `signBlob` fails, `POST /v1/rentals/:id/evidence` returns 503. |
| **Cloud KMS** (key ring `fineprint`, key `report-signing`, `EC_SIGN_P256_SHA256`, software protection) | Signs manifests and ledger entries, and serves the public keys | `fineprint-api`: `roles/cloudkms.signerVerifier` on the key | Per active key version per month, plus per signing operation ([pricing](https://cloud.google.com/kms/pricing)) | Sealing and `/.well-known/fineprint-keys.json` return 503. Uploads and hash checks still work, and the server can seal those items later. |
| **Secret Manager** (`GEMINI_API_KEY`, user-managed replication in the region) | Holds the Gemini API key. Cloud Run mounts it as an env var. | `fineprint-api`: `roles/secretmanager.secretAccessor` on the secret | Per active secret version per month, plus per access operation | A new revision cannot start without its secret. Running instances keep the value they already have. |
| **Cloud Build** and **Artifact Registry** (repo `fineprint`) | `gcloud run deploy --source .` builds the root `Dockerfile` and stores the image | `fineprint-build`: `roles/run.builder` | Per build-minute, and per GB-month of stored images | Deploys fail. The running service is not affected. |
| **Cloud Logging** | Structured JSON logs from stdout: request ID, route pattern, status, latency, model, tokens. Never content. | Cloud Run writes logs by default | Free allotment for ingestion, then per GiB | You lose visibility only. The service is not affected. |
| **Cloud Billing and Billing Budgets** | The billing check before deploy, and a $20 budget that alerts at $10 and $20 | The person who deploys needs to see the billing account and create budgets on it | Free | Only the alerts stop. A budget alert does not cap spend. |
| **law.lis.virginia.gov** | Source of the statute text for the rule pack snapshots. Planned: no script fetches from it yet, and `jurisdictions/va/` is still empty. | None (public) | Free | Nothing at runtime. A snapshot refresh would wait. |

`deploy.sh` also enables `iam`, `iamcredentials`, `apikeys`, `logging`, `cloudbilling`, and `billingbudgets`, which it needs to set up the resources above.

## Cost

TODO: measured cost table (#51)

## Eval results

TODO: summary of `docs/eval-results.md` (#20, #50)

## Accessibility

TODO (#49)

## Privacy

TODO: see [PRIVACY.md](PRIVACY.md) (#49)

### Gemini API data use

**Google may use what FinePrint sends to Gemma 4 to improve its products, and human reviewers may read it.** Gemma 4 on the Gemini API has only a free tier: the [pricing page](https://ai.google.dev/gemini-api/docs/pricing) (updated 2026-10-22) lists its paid tier as "Not available" and marks the free tier "Used to improve our products: Yes".

The [Gemini API Additional Terms](https://ai.google.dev/gemini-api/terms) (updated 2026-04-28) say access is a Paid Service "only when accessing the API through a Cloud Project associated with an active billing account", and that "unpaid quota in Gemini API" is an unpaid Service. A billed project is required for the paid terms but is not enough on its own. `deploy.sh` requires billing, but Gemma has no paid quota to use, so Gemma calls fall under the unpaid terms. Those terms also say: "Do not submit sensitive, confidential, or personal information to the Unpaid Services."

What FinePrint does about it:

- **Planned:** only lease text that the device has already redacted goes to the model. Original scans never leave the phone.
- **Planned:** evidence photos go to the model only as 1536 px copies with GPS removed.
- **Not built:** to keep content off Google's unpaid terms entirely, run Gemma 4 open weights on your own server (`GEMMA_PROVIDER=openai_compatible`).
- The Gemini Flash fallback is billed, so it falls under the Paid Service terms when the key's project has billing.

## Limitations

What the evidence model proves, and what it does not (spec §8.4):

- FinePrint proves that **a file has not changed since the server sealed it at time T**, and that **the tenant's record of events is complete and in order**. The ledger is hash-chained and each entry is KMS-signed, so a removed or reordered entry is detectable.
- It **cannot prove that the device clock was right** before the photo reached the server. The server records its own receipt time next to the device's capture time.
- It **cannot prove that a scene was not staged.** A hash shows only that the bytes have not changed.
- A deleted photo leaves a logged gap. The manifest still verifies, because it signed the hash, not the bytes.
- Planned for the web report (not on `main` yet): offline gaps longer than 24 hours get a flag, and imported photos get a "capture time unverified" label.

Other limits:

- **Virginia only.** The rules cover the VRLTA, and the rule pack for it is not written yet.
- **Data use.** Gemma calls fall under Google's unpaid terms: Google may use the content to improve its products (see [Gemini API data use](#gemini-api-data-use)).
- **Not legal advice.** Verdicts say "likely", with reasons, citations, and confidence. High-stakes situations go to legal aid.
- **The AI can be wrong.** Code checks quotes, citations, numbers, and dates literally, and a second model checks legal findings. Interpretation can still be wrong. A finding checked by a fallback model carries a label.
- **Throughput.** Gemma 4 on Tier 1 allows 16K input tokens per minute per model, so one 12-page lease takes about two minutes of quota. Each project can analyze about one lease at a time.
- **Languages (planned).** Analysis will run in English. Translation into other languages comes last, and only English and Spanish will be reviewed by people.
- **Health checks are stubbed.** `/healthz` does not yet check Firestore, Cloud Storage, or KMS.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[Apache-2.0](LICENSE)
