#!/bin/bash
# share-file.sh — Get a public URL for a local file via MC /fs/share
# Usage: share-file.sh <path>
# Returns the public Supabase URL on stdout.

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: share-file.sh <file-path>" >&2
  exit 1
fi

source "$(dirname "$0")/brief-lib.sh"

URL=$(share_file "$1")
if [ -z "$URL" ]; then
  echo "Failed to share file: $1" >&2
  exit 1
fi

echo "$URL"
