#!/bin/bash
# ensure-daily-note.sh — Create today's daily note if it doesn't exist
# Usage: ~/scripts/ensure-daily-note.sh
# Called by cron at midnight and by workflows that need today's note.

set -euo pipefail

TODAY=$(date +%Y-%m-%d)
NOTE_PATH="$HOME/memory/daily/${TODAY}.md"

if [ -f "$NOTE_PATH" ]; then
    echo "Daily note already exists: $NOTE_PATH"
    exit 0
fi

cat > "$NOTE_PATH" << EOF
# Daily Note — ${TODAY}

## Events

## Tasks

## Notes

EOF

echo "Created daily note: $NOTE_PATH"
