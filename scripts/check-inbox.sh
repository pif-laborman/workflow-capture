#!/bin/bash
# check-inbox.sh — Watch inbox directory for new files
# Usage: ~/scripts/check-inbox.sh
# Runs periodically via cron. Detects new files in ~/workspace/inbox/,
# logs an event to Supabase, and can trigger the inbox-processing workflow.

set -euo pipefail

source ~/.pif-env

INBOX_DIR="$HOME/workspace/inbox"
INBOX_STATE="$HOME/scripts/.inbox-state"
SUPABASE_URL="$PIF_SUPABASE_URL"
SUPABASE_KEY="${PIF_SUPABASE_SERVICE_ROLE_KEY:-$(pif-creds get Supabase 2>/dev/null)}"

# Ensure inbox directory exists
mkdir -p "$INBOX_DIR"

# Get current file list
CURRENT=$(ls -1 "$INBOX_DIR" 2>/dev/null | sort)

if [ -z "$CURRENT" ]; then
    exit 0
fi

# Compare with previous state
PREVIOUS=""
if [ -f "$INBOX_STATE" ]; then
    PREVIOUS=$(cat "$INBOX_STATE")
fi

# Find new files (in current but not in previous)
NEW_FILES=$(comm -23 <(echo "$CURRENT") <(echo "$PREVIOUS") 2>/dev/null || echo "$CURRENT")

if [ -z "$NEW_FILES" ]; then
    exit 0
fi

FILE_COUNT=$(echo "$NEW_FILES" | wc -l | tr -d ' ')
FILE_LIST=$(echo "$NEW_FILES" | tr '\n' ',' | sed 's/,$//')

echo "Detected $FILE_COUNT new file(s): $FILE_LIST"

# Log event to Supabase
curl -s -X POST "${SUPABASE_URL}/rest/v1/events" \
    -H "apikey: ${SUPABASE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_KEY}" \
    -H "Content-Type: application/json" \
    -H "Prefer: return=minimal" \
    -d "{
        \"type\": \"inbox_file_detected\",
        \"source\": \"cron:check-inbox\",
        \"data\": {\"count\": ${FILE_COUNT}, \"files\": \"${FILE_LIST}\"}
    }" > /dev/null

echo "Event logged to Supabase"

# Save current state for next comparison
echo "$CURRENT" > "$INBOX_STATE"
