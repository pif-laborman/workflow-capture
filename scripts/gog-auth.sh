#!/bin/bash
# gog OAuth helper for headless server
# Usage: ./gog-auth.sh <redirect-url>
set -euo pipefail
source ~/.pif-env
export GOG_KEYRING_PASSWORD="${GOG_KEYRING_PASSWORD:-$(pif-creds get 'GOG (Google Workspace CLI)' 2>/dev/null)}"

if [ -z "${1:-}" ]; then
  echo "Step 1: Getting auth URL..."
  echo ""
  gog auth add pif.laborman@gmail.com \
    --services gmail,calendar,drive,contacts,sheets,docs \
    --remote --step 1 --no-input
  echo ""
  echo "Visit the auth_url above, authorize, then run:"
  echo "  bash ~/scripts/gog-auth.sh '<redirect-url>'"
else
  echo "Step 2: Exchanging code for token..."
  gog auth add pif.laborman@gmail.com \
    --services gmail,calendar,drive,contacts,sheets,docs \
    --remote --step 2 --auth-url "$1" --no-input
  echo ""
  echo "Verifying..."
  export GOG_ACCOUNT=pif.laborman@gmail.com
  gog auth status
fi
