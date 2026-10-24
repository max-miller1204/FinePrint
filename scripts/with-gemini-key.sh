#!/usr/bin/env bash
# Runs a command with GEMINI_API_KEY read from the macOS login keychain, the
# Keychain counterpart of `op run --env-file ../.env --`. The key lives only in
# the keychain and in this process's environment; it is never printed.
#
#   scripts/with-gemini-key.sh npx e2e explore '<charter>' ...
#
# Store the key once (the -w with no value makes `security` prompt for it):
#
#   security add-generic-password -U -a "$USER" -s fineprint-gemini-api-key -w
set -euo pipefail

service="${FINEPRINT_GEMINI_KEYCHAIN_SERVICE:-fineprint-gemini-api-key}"

if [[ $# -eq 0 ]]; then
  echo "usage: $(basename "$0") <command> [args...]" >&2
  exit 2
fi

if [[ -z "${GEMINI_API_KEY:-}" ]]; then
  if ! key="$(security find-generic-password -a "$USER" -s "$service" -w 2>/dev/null)" || [[ -z "$key" ]]; then
    echo "No keychain item '$service' for $USER. Add it with:" >&2
    echo "  security add-generic-password -U -a \"\$USER\" -s $service -w" >&2
    exit 1
  fi
  export GEMINI_API_KEY="$key"
  unset key
fi

exec "$@"
