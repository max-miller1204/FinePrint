#!/usr/bin/env bash
# Deploy FinePrint to your own Google Cloud project (spec §15.1).
#
#   ./deploy.sh                      prompt for the project and region, then deploy
#   ./deploy.sh --project ID [--region us-east4]
#   ./deploy.sh --destroy --project ID [--region us-east4]
#
# Every step checks for the resource before it creates it, so a second run
# changes nothing except the Cloud Run revision. The script never creates the
# project or links billing; do both in the console first.
#
# The Gemini API key comes from GEMINI_API_KEY in the environment
# (GOOGLE_API_KEY also works). Load it however you keep secrets, e.g.:
#
#   op run --env-file ~/.config/fineprint/.env -- ./deploy.sh   (1Password)
#   scripts/with-gemini-key.sh ./deploy.sh                      (macOS Keychain)
#
# In a terminal with neither (Cloud Shell), it asks with hidden input. It is
# needed only until the secret has a version, goes straight to Secret
# Manager, and is never printed.
#
# Works in Cloud Shell and with macOS's bash 3.2. Needs gcloud and curl.

set -euo pipefail

ROOT=$(cd "$(dirname "$0")" && pwd)

PROJECT=${FINEPRINT_PROJECT:-}
REGION=${FINEPRINT_REGION:-}
DEFAULT_REGION=us-east4
DESTROY=false

SERVICE=fineprint
REPO=fineprint
KEYRING=fineprint
KEY=report-signing
RUNTIME_SA_ID=fineprint-api
BUILD_SA_ID=fineprint-build
# Cloud Scheduler signs in as this account to call POST /internal/purge, which
# removes rentals past purgeAfter (spec §6.1, §9.2). It holds no roles.
PURGE_SA_ID=fineprint-purge
PURGE_JOB=fineprint-purge
# Daily, 03:17 UTC.
PURGE_SCHEDULE='17 3 * * *'
SECRET=GEMINI_API_KEY
API_KEY_DISPLAY_NAME=fineprint-client
# Alerts at half the budget and at the whole budget: $10 and $20 (spec §15.4).
BUDGET_AMOUNT=20USD

APIS=(
  run.googleapis.com
  firestore.googleapis.com
  storage.googleapis.com
  cloudkms.googleapis.com
  secretmanager.googleapis.com
  cloudbuild.googleapis.com
  artifactregistry.googleapis.com
  logging.googleapis.com
  identitytoolkit.googleapis.com
  securetoken.googleapis.com
  apikeys.googleapis.com
  iam.googleapis.com
  iamcredentials.googleapis.com
  cloudbilling.googleapis.com
  billingbudgets.googleapis.com
  cloudscheduler.googleapis.com
)

usage() {
  sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case $1 in
    --project) PROJECT=${2:?--project needs a value}; shift 2 ;;
    --project=*) PROJECT=${1#*=}; shift ;;
    --region) REGION=${2:?--region needs a value}; shift 2 ;;
    --region=*) REGION=${1#*=}; shift ;;
    --destroy) DESTROY=true; shift ;;
    -h | --help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

step() { printf '\n== %s\n' "$*"; }
have() { printf '  ok      %s\n' "$*"; }
made() { printf '  created %s\n' "$*"; }
gone() { printf '  removed %s\n' "$*"; }
skip() { printf '  absent  %s\n' "$*"; }
note() { printf '  note    %s\n' "$*"; }
die() { printf '\nError: %s\n' "$*" >&2; exit 1; }

# Every gcloud call is pinned to the project and never prompts. A freshly
# enabled API answers SERVICE_DISABLED for a minute or two, so those calls
# wait and retry instead of failing (or reading as "resource missing").
gc() {
  local err attempt status wait
  err=$(mktemp)
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    status=0
    gcloud --project="$PROJECT" --quiet "$@" 2>"$err" || status=$?
    if [[ $status -ne 0 && $attempt -lt 10 ]] && grep -q 'SERVICE_DISABLED' "$err"; then
      sleep 15
      continue
    fi
    # Firestore keeps a deleted database's ID for a few minutes and says how
    # long ("Please retry in 264 seconds"), e.g. a deploy right after --destroy.
    wait=$(grep -o 'retry in [0-9]* seconds' "$err" | grep -o '[0-9]*' | head -n1 || true)
    if [[ $status -ne 0 && $attempt -lt 10 && -n $wait ]]; then
      printf '  wait    %ss, as Google asks, then retry\n' "$wait" >&2
      sleep $((wait < 600 ? wait + 5 : 600))
      continue
    fi
    break
  done
  cat "$err" >&2
  rm -f "$err"
  return "$status"
}

# New service accounts take a few seconds to be usable in IAM policies.
retry() {
  local attempt
  for attempt in 1 2 3 4 5 6; do
    if "$@" >/dev/null 2>&1; then return 0; fi
    sleep $((attempt * 5))
  done
  "$@" >/dev/null
}

ask() {
  local prompt=$1 default=${2:-} answer
  if [[ -n $default ]]; then prompt="$prompt [$default]"; fi
  read -rp "$prompt: " answer || true
  printf '%s' "${answer:-$default}"
}

preflight() {
  command -v gcloud >/dev/null || die "gcloud is not installed. Use Cloud Shell, or install the Google Cloud CLI."
  command -v curl >/dev/null || die "curl is not installed."
  local account
  account=$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | head -n1)
  [[ -n $account ]] || die "No active gcloud account. Run: gcloud auth login"

  [[ -n $PROJECT ]] || PROJECT=$(ask "Google Cloud project ID" "$(gcloud config get-value project 2>/dev/null || true)")
  [[ -n $PROJECT ]] || die "A project ID is required."
  [[ -n $REGION ]] || REGION=$(ask "Region" "$DEFAULT_REGION")

  gc projects describe "$PROJECT" --format='value(projectId)' >/dev/null 2>&1 ||
    die "Project $PROJECT does not exist or $account cannot see it. Create it first: https://console.cloud.google.com/projectcreate"

  BUCKET="$PROJECT-fineprint-evidence"
  RUNTIME_SA="$RUNTIME_SA_ID@$PROJECT.iam.gserviceaccount.com"
  BUILD_SA="$BUILD_SA_ID@$PROJECT.iam.gserviceaccount.com"
  PURGE_SA="$PURGE_SA_ID@$PROJECT.iam.gserviceaccount.com"
  KEY_NAME="projects/$PROJECT/locations/$REGION/keyRings/$KEYRING/cryptoKeys/$KEY"
  # Cloud Run requires the image name to match the service name.
  IMAGE="$REGION-docker.pkg.dev/$PROJECT/$REPO/$SERVICE"
  BUDGET_DISPLAY_NAME="fineprint $PROJECT"

  printf 'Account: %s\nProject: %s\nRegion:  %s\n' "$account" "$PROJECT" "$REGION"
}

# --- deploy ---------------------------------------------------------------

check_billing() {
  step "Billing"
  local enabled
  enabled=$(gc billing projects describe "$PROJECT" --format='value(billingEnabled)' 2>/dev/null || true)
  [[ $enabled == True ]] ||
    die "Billing is not linked to $PROJECT. Link it, then run this again: https://console.cloud.google.com/billing/linkedaccount?project=$PROJECT"
  BILLING_ACCOUNT=$(gc billing projects describe "$PROJECT" --format='value(billingAccountName)')
  BILLING_ACCOUNT=${BILLING_ACCOUNT#billingAccounts/}
  have "billing account $BILLING_ACCOUNT"
}

enable_apis() {
  step "APIs"
  local enabled missing=() api
  enabled=$(gc services list --enabled --format='value(config.name)')
  for api in "${APIS[@]}"; do
    if grep -qx "$api" <<<"$enabled"; then have "$api"; else missing+=("$api"); fi
  done
  if [[ ${#missing[@]} -gt 0 ]]; then
    gc services enable "${missing[@]}"
    for api in "${missing[@]}"; do made "$api"; done
  fi
}

ensure_firestore() {
  step "Firestore"
  local type
  type=$(gc firestore databases describe --database='(default)' --format='value(type)' 2>/dev/null || true)
  if [[ -z $type ]]; then
    gc firestore databases create --database='(default)' --location="$REGION" --type=firestore-native >/dev/null
    made "(default) database, Native mode, $REGION"
  elif [[ $type == FIRESTORE_NATIVE ]]; then
    have "(default) database, Native mode"
  else
    die "The (default) database is in $type, not Native mode. Use a fresh project."
  fi
}

ensure_bucket() {
  step "Evidence bucket"
  if gc storage buckets describe "gs://$BUCKET" --format='value(name)' >/dev/null 2>&1; then
    # Re-assert the two settings the evidence model depends on.
    gc storage buckets update "gs://$BUCKET" --uniform-bucket-level-access --public-access-prevention >/dev/null
    have "gs://$BUCKET (uniform access, public access prevention)"
  else
    gc storage buckets create "gs://$BUCKET" --location="$REGION" \
      --uniform-bucket-level-access --public-access-prevention >/dev/null
    made "gs://$BUCKET (uniform access, public access prevention)"
  fi
}

ensure_kms() {
  step "KMS signing key"
  if gc kms keyrings describe "$KEYRING" --location="$REGION" >/dev/null 2>&1; then
    have "key ring $KEYRING"
  else
    gc kms keyrings create "$KEYRING" --location="$REGION"
    made "key ring $KEYRING"
  fi
  if gc kms keys describe "$KEY" --keyring="$KEYRING" --location="$REGION" >/dev/null 2>&1; then
    have "key $KEY"
  else
    gc kms keys create "$KEY" --keyring="$KEYRING" --location="$REGION" \
      --purpose=asymmetric-signing --default-algorithm=ec-sign-p256-sha256 --protection-level=software
    made "key $KEY (EC_SIGN_P256_SHA256)"
  fi
  # --destroy schedules every version for destruction, and KMS never deletes
  # the key itself, so a redeploy needs a fresh version.
  local live
  live=$(gc kms keys versions list --key="$KEY" --keyring="$KEYRING" --location="$REGION" \
    --filter='state=(ENABLED PENDING_GENERATION)' --format='value(name)')
  if [[ -n $live ]]; then
    have "an enabled key version"
  else
    gc kms keys versions create --key="$KEY" --keyring="$KEYRING" --location="$REGION" >/dev/null
    made "key version"
  fi
}

ensure_service_account() {
  local id=$1 email=$2 title=$3
  if gc iam service-accounts describe "$email" >/dev/null 2>&1; then
    have "$email"
  else
    gc iam service-accounts create "$id" --display-name="$title" >/dev/null
    made "$email"
  fi
}

ensure_service_accounts() {
  step "Service accounts"
  ensure_service_account "$RUNTIME_SA_ID" "$RUNTIME_SA" "FinePrint API (Cloud Run runtime)"
  ensure_service_account "$BUILD_SA_ID" "$BUILD_SA" "FinePrint build (Cloud Build)"
  ensure_service_account "$PURGE_SA_ID" "$PURGE_SA" "FinePrint purge (Cloud Scheduler)"
}

ensure_artifact_registry() {
  step "Artifact Registry"
  if gc artifacts repositories describe "$REPO" --location="$REGION" >/dev/null 2>&1; then
    have "repository $REPO"
  else
    gc artifacts repositories create "$REPO" --location="$REGION" --repository-format=docker \
      --description="FinePrint server images" >/dev/null
    made "repository $REPO"
  fi
}

ensure_secret() {
  step "Gemini API key (Secret Manager)"
  local key=${GEMINI_API_KEY:-${GOOGLE_API_KEY:-}} current=''
  if gc secrets describe "$SECRET" >/dev/null 2>&1; then
    have "secret $SECRET"
  else
    gc secrets create "$SECRET" --replication-policy=user-managed --locations="$REGION" >/dev/null
    made "secret $SECRET"
  fi
  if gc secrets versions list "$SECRET" --filter='state=ENABLED' --format='value(name)' | grep -q .; then
    current=$(gc secrets versions access latest --secret="$SECRET" 2>/dev/null || true)
    if [[ -z $key || $key == "$current" ]]; then
      have "a key version (unchanged)"
      return
    fi
  elif [[ -z $key ]]; then
    if [[ -t 0 ]]; then
      read -rsp "  Gemini API key from https://aistudio.google.com/apikey (input hidden): " key || true
      echo
    fi
    [[ -n $key ]] || die "GEMINI_API_KEY is not set. Run with it in the environment, for example:
  op run --env-file ~/.config/fineprint/.env -- ./deploy.sh   (1Password)
  scripts/with-gemini-key.sh ./deploy.sh                      (macOS Keychain, see CONTRIBUTING.md)"
  fi
  printf '%s' "$key" | gc secrets versions add "$SECRET" --data-file=- >/dev/null
  made "a key version"
}

ensure_iam() {
  step "Least-privilege bindings"
  local member="serviceAccount:$RUNTIME_SA"
  retry gc projects add-iam-policy-binding "$PROJECT" --member="$member" --role=roles/datastore.user --condition=None
  have "$RUNTIME_SA_ID: roles/datastore.user on the project"
  retry gc storage buckets add-iam-policy-binding "gs://$BUCKET" --member="$member" --role=roles/storage.objectAdmin
  have "$RUNTIME_SA_ID: roles/storage.objectAdmin on gs://$BUCKET"
  retry gc kms keys add-iam-policy-binding "$KEY" --keyring="$KEYRING" --location="$REGION" \
    --member="$member" --role=roles/cloudkms.signerVerifier
  have "$RUNTIME_SA_ID: roles/cloudkms.signerVerifier on $KEY"
  # The server signs with the newest enabled version and publishes every one
  # (server/src/integrity/kms.ts), so it lists the versions. signerVerifier
  # cannot list; without this, sealing and the key URL are 503.
  retry gc kms keys add-iam-policy-binding "$KEY" --keyring="$KEYRING" --location="$REGION" \
    --member="$member" --role=roles/cloudkms.viewer
  have "$RUNTIME_SA_ID: roles/cloudkms.viewer on $KEY"
  retry gc secrets add-iam-policy-binding "$SECRET" --member="$member" --role=roles/secretmanager.secretAccessor
  have "$RUNTIME_SA_ID: roles/secretmanager.secretAccessor on $SECRET"
  # Signed upload and read URLs (server/src/storage/gcs.ts): Cloud Run has no
  # key file, so the server signs through IAM signBlob as itself. Granted on
  # its own account only, so it can sign as nothing else.
  retry gc iam service-accounts add-iam-policy-binding "$RUNTIME_SA" --member="$member" \
    --role=roles/iam.serviceAccountTokenCreator
  have "$RUNTIME_SA_ID: roles/iam.serviceAccountTokenCreator on itself"
  # Delete Everything removes the caller's Firebase user last
  # (server/src/accounts.ts). Without this, DELETE /v1/me is 503.
  retry gc projects add-iam-policy-binding "$PROJECT" --member="$member" --role=roles/firebaseauth.admin --condition=None
  have "$RUNTIME_SA_ID: roles/firebaseauth.admin on the project"
  retry gc projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$BUILD_SA" \
    --role=roles/run.builder --condition=None
  have "$BUILD_SA_ID: roles/run.builder on the project"
}

# Identity Platform has no gcloud commands, so this uses its REST API. The
# access token goes in a header file, never on the command line.
idp() {
  local method=$1 path=$2
  shift 2
  curl -sS -o /dev/null -w '%{http_code}' -X "$method" \
    -H @<(printf 'Authorization: Bearer %s\n' "$(gcloud auth print-access-token)") \
    -H "x-goog-user-project: $PROJECT" -H 'Content-Type: application/json' \
    "https://identitytoolkit.googleapis.com$path" "$@"
}

ensure_auth() {
  step "Firebase anonymous auth (Identity Platform)"
  local status
  status=$(idp GET "/admin/v2/projects/$PROJECT/config")
  if [[ $status == 200 ]]; then
    have "Identity Platform"
  else
    status=$(idp POST "/v2/projects/$PROJECT/identityPlatform:initializeAuth" -d '{}')
    [[ $status == 200 ]] || die "Could not turn on Identity Platform (HTTP $status)."
    made "Identity Platform"
  fi
  status=$(idp PATCH "/admin/v2/projects/$PROJECT/config?updateMask=signIn.anonymous.enabled" \
    -d '{"signIn":{"anonymous":{"enabled":true}}}')
  [[ $status == 200 ]] || die "Could not turn on anonymous sign-in (HTTP $status)."
  have "anonymous sign-in on"

  # The app's sign-in key. It identifies the project and grants nothing on
  # its own, so it is a plain env var, not a secret (server/src/routes/wellknown.ts).
  local name
  name=$(gc services api-keys list --filter="displayName=$API_KEY_DISPLAY_NAME" --format='value(name)' | head -n1)
  if [[ -n $name ]]; then
    have "API key $API_KEY_DISPLAY_NAME"
  else
    gc services api-keys create --display-name="$API_KEY_DISPLAY_NAME" \
      --api-target=service=identitytoolkit.googleapis.com \
      --api-target=service=securetoken.googleapis.com >/dev/null 2>&1
    name=$(gc services api-keys list --filter="displayName=$API_KEY_DISPLAY_NAME" --format='value(name)' | head -n1)
    [[ -n $name ]] || die "Could not create the API key."
    made "API key $API_KEY_DISPLAY_NAME (Identity Toolkit and Secure Token only)"
  fi
  FIREBASE_API_KEY=$(gc services api-keys get-key-string "$name" --format='value(keyString)')
}

ensure_budget() {
  step "Budget alerts"
  local billing=(--billing-account="$BILLING_ACCOUNT" --billing-project="$PROJECT")
  if gc billing budgets list "${billing[@]}" --filter="displayName=\"$BUDGET_DISPLAY_NAME\"" \
    --format='value(name)' | grep -q .; then
    have "budget \"$BUDGET_DISPLAY_NAME\" (alerts at \$10 and \$20)"
  else
    gc billing budgets create "${billing[@]}" --display-name="$BUDGET_DISPLAY_NAME" \
      --budget-amount="$BUDGET_AMOUNT" --threshold-rule=percent=0.5 --threshold-rule=percent=1.0 \
      --filter-projects="projects/$PROJECT" >/dev/null
    made "budget \"$BUDGET_DISPLAY_NAME\" (alerts at \$10 and \$20)"
  fi
  note "alerts email the billing account's admins"
}

deploy_service() {
  step "Cloud Run (builds the server; takes a few minutes)"
  # The env var names are the server's contract with this script.
  local env="FIREBASE_PROJECT_ID=$PROJECT,FIREBASE_API_KEY=$FIREBASE_API_KEY"
  env+=",GCS_EVIDENCE_BUCKET=$BUCKET,KMS_SIGNING_KEY=$KEY_NAME,PURGE_CALLER_EMAIL=$PURGE_SA"
  # Plain gcloud, not gc, so the build log streams instead of arriving at the end.
  # --timeout: a lease stream runs the whole analysis in one request, rate limit waits included.
  gcloud --project="$PROJECT" --quiet run deploy "$SERVICE" --source="$ROOT" --image="$IMAGE" --region="$REGION" \
    --service-account="$RUNTIME_SA" --build-service-account="projects/$PROJECT/serviceAccounts/$BUILD_SA" \
    --allow-unauthenticated --set-env-vars="$env" --set-secrets="GEMINI_API_KEY=$SECRET:latest" \
    --max-instances=3 --memory=512Mi --timeout=900
  SERVICE_URL=$(gc run services describe "$SERVICE" --region="$REGION" --format='value(status.url)')
}

# The daily purge: Cloud Scheduler calls POST /internal/purge with a Google ID
# token for the purge account. The server accepts only that account, for this
# service's URL (server/src/routes/internal.ts), so the open Cloud Run URL
# exposes nothing.
ensure_purge_job() {
  step "Daily purge (Cloud Scheduler)"
  # The URL is known only now, so the server learns the token audience with an
  # update (the same URL the job names below). Unchanged settings add no revision.
  gc run services update "$SERVICE" --region="$REGION" --update-env-vars="PURGE_AUDIENCE=$SERVICE_URL" >/dev/null
  have "PURGE_AUDIENCE=$SERVICE_URL"
  local args=(--location="$REGION" --schedule="$PURGE_SCHEDULE" --time-zone=Etc/UTC
    --uri="$SERVICE_URL/internal/purge" --http-method=POST
    --oidc-service-account-email="$PURGE_SA" --oidc-token-audience="$SERVICE_URL")
  if gc scheduler jobs describe "$PURGE_JOB" --location="$REGION" >/dev/null 2>&1; then
    gc scheduler jobs update http "$PURGE_JOB" "${args[@]}" >/dev/null
    have "job $PURGE_JOB ($PURGE_SCHEDULE UTC)"
  else
    gc scheduler jobs create http "$PURGE_JOB" "${args[@]}" >/dev/null
    made "job $PURGE_JOB ($PURGE_SCHEDULE UTC)"
  fi
}

check_health() {
  step "Health check"
  local attempt
  for attempt in 1 2 3 4 5 6; do
    if curl -fsS "$SERVICE_URL/health" >/dev/null 2>&1; then
      have "$SERVICE_URL/health answers 200"
      return
    fi
    sleep $((attempt * 2))
  done
  die "$SERVICE_URL/health did not answer 200. Read the logs: gcloud run services logs read $SERVICE --project $PROJECT --region $REGION"
}

# The URL as a xcconfig value: "//" starts a comment there, so it becomes "/$()/".
xcconfig_url() {
  printf '%s:/$()/%s' "${1%%://*}" "${1#*://}"
}

summary() {
  cat <<EOF

FinePrint is deployed.

  Service URL:     $SERVICE_URL
  Public key URL:  $SERVICE_URL/.well-known/fineprint-keys.json
  Client config:   $SERVICE_URL/.well-known/fineprint-client.json

iOS app: the server address is the only value to set. The app reads the
Firebase project and key from the client config above.

  Release builds:  copy ios/Config/Server.example.xcconfig to
                   ios/Config/Server.xcconfig and put this line in it
                   (a xcconfig reads "//" as a comment, so it is written "/\$()/"):

    FINEPRINT_SERVER_URL[config=Release] = $(xcconfig_url "$SERVICE_URL")

  Developer menu:  Server URL = $SERVICE_URL
  Launch argument: -FinePrintServerURL $SERVICE_URL

Run ./deploy.sh again to ship a new revision. ./deploy.sh --destroy --project $PROJECT removes it all.
EOF
}

deploy() {
  check_billing
  enable_apis
  ensure_firestore
  ensure_bucket
  ensure_kms
  ensure_service_accounts
  ensure_artifact_registry
  ensure_secret
  ensure_iam
  ensure_auth
  ensure_budget
  deploy_service
  ensure_purge_job
  check_health
  summary
}

# --- destroy --------------------------------------------------------------

destroy() {
  cat <<EOF

This permanently deletes FinePrint from $PROJECT ($REGION): the Cloud Run
service, the daily purge job, every stored photo and report (the bucket and the Firestore
database), the Gemini key secret, the images, the service accounts, the API
key, and the budget. KMS keys cannot be deleted, so every key version is
scheduled for destruction and the empty key ring stays.

EOF
  local typed
  read -rp "Type the project ID ($PROJECT) to confirm: " typed || true
  [[ $typed == "$PROJECT" ]] || die "Confirmation did not match. Nothing was removed."

  step "Cloud Run"
  if gc run services describe "$SERVICE" --region="$REGION" >/dev/null 2>&1; then
    gc run services delete "$SERVICE" --region="$REGION" >/dev/null
    gone "service $SERVICE"
  else skip "service $SERVICE"; fi

  step "Daily purge (Cloud Scheduler)"
  if gc scheduler jobs describe "$PURGE_JOB" --location="$REGION" >/dev/null 2>&1; then
    gc scheduler jobs delete "$PURGE_JOB" --location="$REGION" >/dev/null
    gone "job $PURGE_JOB"
  else skip "job $PURGE_JOB"; fi

  step "Budget alerts"
  local account
  account=$(gc billing projects describe "$PROJECT" --format='value(billingAccountName)' 2>/dev/null || true)
  account=${account#billingAccounts/}
  local budgets=''
  if [[ -n $account ]]; then
    budgets=$(gc billing budgets list --billing-account="$account" --billing-project="$PROJECT" \
      --filter="displayName=\"$BUDGET_DISPLAY_NAME\"" --format='value(name)' 2>/dev/null || true)
  fi
  if [[ -n $budgets ]]; then
    local budget
    for budget in $budgets; do gc billing budgets delete "$budget" --billing-project="$PROJECT" >/dev/null; done
    gone "budget \"$BUDGET_DISPLAY_NAME\""
  else skip "budget \"$BUDGET_DISPLAY_NAME\""; fi

  step "Firebase anonymous auth"
  local names
  names=$(gc services api-keys list --filter="displayName=$API_KEY_DISPLAY_NAME" --format='value(name)' 2>/dev/null || true)
  if [[ -n $names ]]; then
    local name
    # A key used in the last 7 days is protected; the typed confirmation
    # above is the override. gcloud echoes the deleted key, string included,
    # so its output is dropped.
    for name in $names; do
      gc services api-keys delete "$name" --no-check-existing-usage >/dev/null 2>&1 ||
        die "Could not delete API key $name. Retry: gcloud services api-keys delete $name --no-check-existing-usage --project $PROJECT"
    done
    gone "API key $API_KEY_DISPLAY_NAME"
  else skip "API key $API_KEY_DISPLAY_NAME"; fi
  if [[ $(idp GET "/admin/v2/projects/$PROJECT/config") == 200 ]]; then
    idp PATCH "/admin/v2/projects/$PROJECT/config?updateMask=signIn.anonymous.enabled" \
      -d '{"signIn":{"anonymous":{"enabled":false}}}' >/dev/null
    gone "anonymous sign-in (Identity Platform stays on; it cannot be turned off)"
  else skip "Identity Platform"; fi

  step "Secret Manager"
  if gc secrets describe "$SECRET" >/dev/null 2>&1; then
    gc secrets delete "$SECRET" >/dev/null
    gone "secret $SECRET"
  else skip "secret $SECRET"; fi

  step "Artifact Registry"
  if gc artifacts repositories describe "$REPO" --location="$REGION" >/dev/null 2>&1; then
    gc artifacts repositories delete "$REPO" --location="$REGION" >/dev/null 2>&1
    gone "repository $REPO"
  else skip "repository $REPO"; fi

  step "Cloud Storage"
  local bucket
  for bucket in "$BUCKET" "run-sources-$PROJECT-$REGION"; do
    if gc storage buckets describe "gs://$bucket" >/dev/null 2>&1; then
      gc storage rm --recursive "gs://$bucket" >/dev/null 2>&1
      gone "gs://$bucket and its objects"
    else skip "gs://$bucket"; fi
  done

  step "Firestore"
  if gc firestore databases describe --database='(default)' >/dev/null 2>&1; then
    gc firestore databases delete --database='(default)' >/dev/null
    gone "(default) database"
  else skip "(default) database"; fi

  step "KMS signing key"
  if gc kms keys describe "$KEY" --keyring="$KEYRING" --location="$REGION" >/dev/null 2>&1; then
    local versions version
    versions=$(gc kms keys versions list --key="$KEY" --keyring="$KEYRING" --location="$REGION" \
      --filter='state=(ENABLED DISABLED PENDING_GENERATION)' --format='value(name)')
    for version in $versions; do
      gc kms keys versions destroy "${version##*/}" --key="$KEY" --keyring="$KEYRING" --location="$REGION" >/dev/null
    done
    gc kms keys remove-iam-policy-binding "$KEY" --keyring="$KEYRING" --location="$REGION" \
      --member="serviceAccount:$RUNTIME_SA" --role=roles/cloudkms.signerVerifier >/dev/null 2>&1 || true
    gc kms keys remove-iam-policy-binding "$KEY" --keyring="$KEYRING" --location="$REGION" \
      --member="serviceAccount:$RUNTIME_SA" --role=roles/cloudkms.viewer >/dev/null 2>&1 || true
    if [[ -n $versions ]]; then gone "key versions of $KEY (scheduled for destruction)"; else skip "key versions of $KEY"; fi
  else skip "key $KEY"; fi

  step "Service accounts"
  gc projects remove-iam-policy-binding "$PROJECT" --member="serviceAccount:$RUNTIME_SA" \
    --role=roles/datastore.user --condition=None >/dev/null 2>&1 || true
  gc projects remove-iam-policy-binding "$PROJECT" --member="serviceAccount:$RUNTIME_SA" \
    --role=roles/firebaseauth.admin --condition=None >/dev/null 2>&1 || true
  gc projects remove-iam-policy-binding "$PROJECT" --member="serviceAccount:$BUILD_SA" \
    --role=roles/run.builder --condition=None >/dev/null 2>&1 || true
  local email
  for email in "$RUNTIME_SA" "$BUILD_SA" "$PURGE_SA"; do
    if gc iam service-accounts describe "$email" >/dev/null 2>&1; then
      gc iam service-accounts delete "$email" >/dev/null
      gone "$email and its project bindings"
    else skip "$email"; fi
  done

  printf '\nFinePrint is removed from %s. The enabled APIs stay on; they cost nothing idle.\n' "$PROJECT"
}

preflight
if $DESTROY; then destroy; else deploy; fi
