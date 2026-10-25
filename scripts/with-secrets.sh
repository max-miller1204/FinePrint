#!/usr/bin/env bash
# Run a command with FinePrint secrets, preserving personal development keys.
# Compatible with Linux and macOS bash 3.2. Never trace secret assignments.
set +x
set -euo pipefail

if [[ $# -eq 0 ]]; then
  echo 'Usage: scripts/with-secrets.sh <command> [args...]' >&2
  exit 2
fi

# Personal AI Studio keys take precedence and need no Cloud authentication.
# Normalize the server's GOOGLE_API_KEY alias for e2e, which reads GEMINI_API_KEY.
if [[ -z ${GEMINI_API_KEY:-} && -n ${GOOGLE_API_KEY:-} ]]; then
  export GEMINI_API_KEY="$GOOGLE_API_KEY"
fi

if [[ -z ${GEMINI_API_KEY:-} ]]; then
  command -v gcloud >/dev/null 2>&1 || {
    echo 'Error: install the Google Cloud CLI (gcloud), or export your personal GEMINI_API_KEY. See CONTRIBUTING.md.' >&2
    exit 1
  }
  project=${FINEPRINT_PROJECT:-}
  if [[ -z $project ]]; then
    project=$(gcloud config get-value project 2>/dev/null) || project=''
  fi
  if [[ -z $project || $project == '(unset)' ]]; then
    echo 'Error: set FINEPRINT_PROJECT or run gcloud config set project <project-id>, as for deploy.sh.' >&2
    exit 1
  fi
  if ! account=$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null) || [[ -z $account ]]; then
    echo 'Error: gcloud is not authenticated. Run gcloud auth login, then retry.' >&2
    exit 1
  fi
  if ! key=$(gcloud secrets versions access latest --secret=GEMINI_API_KEY --project="$project" --quiet 2>/dev/null); then
    echo "Error: cannot access GEMINI_API_KEY in project '$project'. Run gcloud auth login if credentials expired; ask the project owner for roles/secretmanager.secretAccessor on this secret and confirm an enabled latest version exists. See CONTRIBUTING.md." >&2
    exit 1
  fi
  if [[ -z $key ]]; then
    echo "Error: GEMINI_API_KEY in project '$project' is empty. Ask the owner to add a valid secret version." >&2
    exit 1
  fi
  export GEMINI_API_KEY="$key"
  unset key
fi

exec "$@"
