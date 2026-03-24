#!/bin/bash
# morning-brief.sh — Daily morning standup
# Gathers system data, summarizes via Claude, delivers to configured channel.
#
# Usage: ~/scripts/morning-brief.sh                    # Pif defaults
#        ~/scripts/morning-brief.sh --brief-id <uuid>  # From briefs table

set -euo pipefail
source ~/.pif-env
source ~/scripts/brief-lib.sh

LOG="/root/logs/morning-brief.log"
TS=$(date '+%Y-%m-%d %H:%M')
DEFAULT_PROMPT=~/agents/pif/prompts/morning-brief.md

log() { echo "${TS} — $1" >> "$LOG"; }
notify_failure() {
  deliver_brief "Morning brief failed: $1"
  log "FAILED: $1"
}

# --- Parse args ---
BRIEF_ID=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --brief-id) BRIEF_ID="$2"; shift 2 ;;
    *) shift ;;
  esac
done

# --- Load config ---
if [ -n "$BRIEF_ID" ]; then
  load_brief_config "$BRIEF_ID" || { echo "Failed to load brief $BRIEF_ID" >&2; exit 1; }
  MODEL="${BRIEF_MODEL}"
  PROMPT_FILE="${BRIEF_PROMPT_FILE:-$DEFAULT_PROMPT}"
  SECTIONS="${BRIEF_SECTIONS}"
else
  # Pif defaults
  MODEL="haiku"
  PROMPT_FILE="$DEFAULT_PROMPT"
  SECTIONS="daily_notes working_state inbox git_activity session_activity skills_changes deployments tasks workflows system_health events"
  BRIEF_TENANT_ID="c2818981-bcb9-4fde-83d8-272d72c7a3d1"
  export BRIEF_TENANT_ID
fi

# ============================================================
# MAIN
# ============================================================
log "Starting morning brief${BRIEF_ID:+ (brief: ${BRIEF_ID})}"

# Gather
DATA="Data collected at: $(TZ="${BRIEF_TIMEZONE:-UTC}" date '+%Y-%m-%d %H:%M %Z')
$(gather_sections "$SECTIONS" 2>&1)" || {
  notify_failure "data gathering failed"
  exit 1
}

# Select prompt: custom (from DB) → tenant default → Pif default
if ! _is_admin_tenant && [ "$PROMPT_FILE" = "$DEFAULT_PROMPT" ]; then
  PROMPT_FILE=~/agents/pif/prompts/morning-brief-tenant.md
fi

# Summarize
PROMPT=$(cat "$PROMPT_FILE")
BRIEF=$(echo "${PROMPT}

Data:
${DATA}" | env -u CLAUDECODE claude --print --model "$MODEL" 2>&1) || {
  notify_failure "Claude summarization failed"
  exit 1
}

# Strip STATUS: done prefix
BRIEF=$(echo "$BRIEF" | sed '1{/^STATUS:/d}' | sed '/^$/d')

# Deliver
deliver_brief "Good morning! Here's your standup:

${BRIEF}" || {
  notify_failure "Telegram delivery failed"
  exit 1
}

# Log success
brief_log_event "morning_brief_completed" "morning-brief" "{\"status\": \"ok\"}"
log "Morning brief delivered"

# Clean up temp prompt file if created
if [ -n "${BRIEF_PROMPT_FILE:-}" ] && [ -f "${BRIEF_PROMPT_FILE}" ] && [[ "${BRIEF_PROMPT_FILE}" == /tmp/brief-prompt-* ]]; then rm -f "$BRIEF_PROMPT_FILE"; fi
