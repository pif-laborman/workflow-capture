#!/bin/bash
# weekly-review.sh — Weekly pattern analysis and memory maintenance
# Gathers week's daily notes, analyzes patterns, updates MEMORY.md, delivers summary.
#
# Usage: ~/scripts/weekly-review.sh                    # Pif defaults
#        ~/scripts/weekly-review.sh --brief-id <uuid>  # From briefs table
#        ~/scripts/weekly-review.sh --tenant-id <uuid>  # Specific tenant (no brief)

set -euo pipefail
source ~/.pif-env
source ~/scripts/brief-lib.sh

LOG="/root/logs/weekly-review.log"
TS=$(date '+%Y-%m-%d %H:%M')
TODAY=$(date +%Y-%m-%d)
ADMIN_UUID="c2818981-bcb9-4fde-83d8-272d72c7a3d1"

log() { echo "${TS} — $1" >> "$LOG"; }
notify_failure() {
  deliver_brief "Weekly review failed: $1"
  log "FAILED: $1"
}

# --- Parse args ---
BRIEF_ID=""
TENANT_ID=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --brief-id) BRIEF_ID="$2"; shift 2 ;;
    --tenant-id) TENANT_ID="$2"; shift 2 ;;
    *) shift ;;
  esac
done

# --- Load config ---
if [ -n "$BRIEF_ID" ]; then
  load_brief_config "$BRIEF_ID" || { echo "Failed to load brief $BRIEF_ID" >&2; exit 1; }
  MODEL="${BRIEF_MODEL}"
  TENANT_ID="${BRIEF_TENANT_ID}"
elif [ -n "$TENANT_ID" ]; then
  MODEL="sonnet"
  BRIEF_TENANT_ID="$TENANT_ID"
  BRIEF_DELIVERY_CHANNEL="telegram"
  BRIEF_DELIVERY_TARGET=""
  export BRIEF_TENANT_ID BRIEF_DELIVERY_CHANNEL BRIEF_DELIVERY_TARGET
else
  # Pif defaults
  MODEL="sonnet"
  TENANT_ID="$ADMIN_UUID"
  BRIEF_TENANT_ID="$ADMIN_UUID"
  BRIEF_DELIVERY_CHANNEL="telegram"
  BRIEF_DELIVERY_TARGET="6614139287"
  export BRIEF_TENANT_ID BRIEF_DELIVERY_CHANNEL BRIEF_DELIVERY_TARGET
fi

# --- Resolve tenant dir ---
if [ "$TENANT_ID" = "$ADMIN_UUID" ] || [ -z "$TENANT_ID" ]; then
  TENANT_DIR="$HOME"
else
  TENANT_DIR="$HOME/tenants/${TENANT_ID}"
fi

if [ ! -d "$TENANT_DIR/memory" ]; then
  log "Tenant ${TENANT_ID:0:8}: No memory dir — skipping"
  exit 0
fi

# ============================================================
# STEP 1: Gather this week's data
# ============================================================
log "Starting weekly review${BRIEF_ID:+ (brief: ${BRIEF_ID})} tenant=${TENANT_ID:0:8}"

GATHER=""
GATHER+="=== THIS WEEK'S DAILY NOTES ==="$'\n'
for i in $(seq 0 6); do
  DATE=$(date -d "-${i} days" +%Y-%m-%d 2>/dev/null || date -v-${i}d +%Y-%m-%d)
  FILE="${TENANT_DIR}/memory/daily/${DATE}.md"
  if [ -f "$FILE" ]; then
    GATHER+="--- ${DATE} ---"$'\n'
    GATHER+="$(cat "$FILE")"$'\n'$'\n'
  fi
done

if [ -f "${TENANT_DIR}/memory/.learnings/LEARNINGS.md" ]; then
  GATHER+="=== LEARNINGS ==="$'\n'
  GATHER+="$(cat "${TENANT_DIR}/memory/.learnings/LEARNINGS.md")"$'\n'$'\n'
fi

if [ -f "${TENANT_DIR}/memory/.learnings/ERRORS.md" ]; then
  GATHER+="=== ERRORS ==="$'\n'
  GATHER+="$(cat "${TENANT_DIR}/memory/.learnings/ERRORS.md")"$'\n'$'\n'
fi

MEMORY_FILE="${TENANT_DIR}/.claude/projects/-/memory/MEMORY.md"
if [ -f "$MEMORY_FILE" ]; then
  GATHER+="=== CURRENT MEMORY ==="$'\n'
  GATHER+="$(cat "$MEMORY_FILE")"$'\n'$'\n'
fi

if [ -f "${TENANT_DIR}/memory/WORKING.md" ]; then
  GATHER+="=== WORKING STATE ==="$'\n'
  GATHER+="$(cat "${TENANT_DIR}/memory/WORKING.md")"$'\n'$'\n'
fi

# Also gather Supabase data (tenant-scoped)
GATHER+="$(section_tasks 2>/dev/null)"$'\n'
GATHER+="$(section_workflows 2>/dev/null)"$'\n'

# Check if there's enough data
if [ ${#GATHER} -lt 200 ]; then
  log "Tenant ${TENANT_ID:0:8}: Not enough data for weekly review — skipping"
  exit 0
fi

log "Data gathered (${#GATHER} bytes)"

# ============================================================
# STEP 2: Analyze with Claude
# ============================================================
PROMPT="Perform a weekly review. Analyze patterns from this week's data.

Tasks:
1. Identify recurring themes or patterns
2. Note any learnings that appeared 3+ times (ready to promote)
3. Flag stale or completed items in MEMORY.md
4. Suggest updates if new preferences were observed

IMPORTANT: You MUST reply using EXACTLY this structured format. Do NOT write conversational text. Start your response with \"STATUS: done\" on the very first line. Each section must begin with the key in ALL CAPS followed by a colon.

STATUS: done
PATTERNS: <key patterns observed>
PROMOTE: <learnings to promote to MEMORY.md, or \"none\">
MEMORY_UPDATE: <updated MEMORY.md content, keep under 200 lines>
WEEKLY_SUMMARY: <concise summary, 10-15 lines>

Do NOT add any preamble, greeting, or commentary before \"STATUS: done\".

Data:
${GATHER}"

ANALYZE_OUTPUT=$(echo "$PROMPT" | env -u CLAUDECODE claude --print --model "$MODEL" 2>&1) || {
  notify_failure "Claude analysis failed"
  exit 1
}

# Verify structured output
if ! echo "$ANALYZE_OUTPUT" | grep -q "STATUS: done"; then
  notify_failure "Claude output missing STATUS: done"
  exit 1
fi

WEEKLY_SUMMARY=$(extract_field "$ANALYZE_OUTPUT" "WEEKLY_SUMMARY")
MEMORY_UPDATE=$(extract_field "$ANALYZE_OUTPUT" "MEMORY_UPDATE")
log "Analysis complete"

# ============================================================
# STEP 3: Update MEMORY.md (if content provided)
# ============================================================
if [ -n "$MEMORY_UPDATE" ] && [ ${#MEMORY_UPDATE} -gt 50 ]; then
  if [ -d "${TENANT_DIR}/memory/.git" ]; then
    cd "${TENANT_DIR}/memory" && git add -A && git commit -m "pre-update: weekly-review ${TODAY}" --allow-empty -q 2>/dev/null || true
  fi
  echo "$MEMORY_UPDATE" > "$MEMORY_FILE"
  log "Tenant ${TENANT_ID:0:8}: MEMORY.md updated"
fi

# ============================================================
# STEP 4: Deliver
# ============================================================
if [ -n "$WEEKLY_SUMMARY" ]; then
  deliver_brief "Weekly review:

${WEEKLY_SUMMARY}" || {
    notify_failure "delivery failed"
  }
  log "Weekly review delivered"
else
  log "No summary generated — skipping delivery"
fi

brief_log_event "weekly_review_completed" "weekly-review" "{\"status\": \"ok\"}"
log "Weekly review complete for tenant ${TENANT_ID:0:8}"

if [ -n "${BRIEF_PROMPT_FILE:-}" ] && [ -f "${BRIEF_PROMPT_FILE}" ] && [[ "${BRIEF_PROMPT_FILE}" == /tmp/brief-prompt-* ]]; then rm -f "$BRIEF_PROMPT_FILE"; fi
