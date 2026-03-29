#!/bin/bash
# evening-standup.sh — End-of-day summary with self-improvement loop
# Gathers data, runs self-review, summarizes, logs proposals,
# updates WORKING.md, writes blog post, delivers to configured channel.
#
# Usage: ~/scripts/evening-standup.sh                    # Pif defaults
#        ~/scripts/evening-standup.sh --brief-id <uuid>  # From briefs table

set -euo pipefail
source ~/.pif-env
source ~/scripts/brief-lib.sh

LOG="/root/logs/evening-standup.log"
TS=$(date '+%Y-%m-%d %H:%M')
TODAY=$(date +%Y-%m-%d)
PROMPTS_DIR=~/agents/pif/prompts

log() { echo "${TS} — $1" >> "$LOG"; }
notify_failure() {
  deliver_brief "Evening standup failed: $1"
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
  SECTIONS="${BRIEF_SECTIONS}"
else
  # Pif defaults
  MODEL="sonnet"
  SECTIONS="daily_notes working_state recent_commits learnings telegram_history tasks workflows events proposals"
  BRIEF_TENANT_ID="c2818981-bcb9-4fde-83d8-272d72c7a3d1"
  export BRIEF_TENANT_ID
fi

# ============================================================
# STEP 2: Self-review (proposals)
# ============================================================
run_self_review() {
  local DATA="$1"
  local PROMPT
  if _is_admin_tenant; then
    PROMPT=$(cat "${PROMPTS_DIR}/evening-self-review.md")
  else
    PROMPT=$(cat "${PROMPTS_DIR}/evening-self-review-tenant.md")
  fi

  echo "${PROMPT}

Review this data from today:

${DATA}" | env -u CLAUDECODE claude --print --model "$MODEL"
}

# ============================================================
# STEP 3: Summarize
# ============================================================
run_summarize() {
  local DATA="$1"
  local PROPOSALS="$2"
  local PROMPT
  # Use custom prompt if provided via brief config, else admin/tenant default
  if [ -n "${BRIEF_PROMPT_FILE:-}" ] && [ -f "${BRIEF_PROMPT_FILE}" ]; then
    PROMPT=$(cat "${BRIEF_PROMPT_FILE}")
  elif _is_admin_tenant; then
    PROMPT=$(cat "${PROMPTS_DIR}/evening-summarize.md")
  else
    PROMPT=$(cat "${PROMPTS_DIR}/evening-summarize-tenant.md")
  fi

  local INPUT="${PROMPT}

Today's data:
${DATA}"
  if [ -n "$PROPOSALS" ] && [ "$PROPOSALS" != "None" ]; then
    INPUT="${INPUT}

Self-improvement proposals from today's review:
${PROPOSALS}"
  fi

  echo "$INPUT" | env -u CLAUDECODE claude --print --model "$MODEL"
}

# ============================================================
# STEP 4: Log proposals
# ============================================================
log_proposals() {
  local PROPOSALS="$1"
  local PROPOSAL_COUNT="$2"
  local MEM_DIR; MEM_DIR=$(_tenant_memory)

  # Strip to just the number
  PROPOSAL_COUNT=$(echo "$PROPOSAL_COUNT" | tr -dc '0-9')
  PROPOSAL_COUNT=${PROPOSAL_COUNT:-0}

  if [ "$PROPOSAL_COUNT" != "0" ] && [ -n "$PROPOSAL_COUNT" ]; then
    mkdir -p "$MEM_DIR"
    echo "" >> "${MEM_DIR}/improvement-proposals.md"
    echo "## ${TODAY} Evening Review" >> "${MEM_DIR}/improvement-proposals.md"
    echo "" >> "${MEM_DIR}/improvement-proposals.md"
    echo "$PROPOSALS" >> "${MEM_DIR}/improvement-proposals.md"
    echo "" >> "${MEM_DIR}/improvement-proposals.md"
    log "Logged ${PROPOSAL_COUNT} proposals to ${MEM_DIR}"
  else
    log "No proposals to log"
  fi
}

# ============================================================
# STEP 5: Update WORKING.md
# ============================================================
update_working() {
  local WORKING_UPDATE="$1"
  local MEM_DIR; MEM_DIR=$(_tenant_memory)
  if [ -n "$WORKING_UPDATE" ]; then
    if _is_admin_tenant; then
      cd ~/memory && git add -A && git commit -m "pre-update: evening-standup ${TODAY}" --allow-empty -q 2>/dev/null || true
    fi
    echo "$WORKING_UPDATE" > "${MEM_DIR}/WORKING.md"
    log "WORKING.md updated at ${MEM_DIR}"
  fi
}

# ============================================================
# STEP 6: Blog post (Pif-only, independent, non-blocking)
# ============================================================
write_blog_post() {
  local DATA="$1"
  local SUMMARY="$2"
  local PROMPT
  PROMPT=$(cat "${PROMPTS_DIR}/evening-blog.md")

  # Blog post uses claude -p (interactive mode with file access)
  echo "${PROMPT}

Today's summary:
${SUMMARY}

Today's events:
${DATA}" | env -u CLAUDECODE claude -p --model sonnet --output-format text 2>&1 || {
    log "Blog post failed (non-critical)"
    return 1
  }
}

# ============================================================
# MAIN
# ============================================================
log "Starting evening standup${BRIEF_ID:+ (brief: ${BRIEF_ID})}"

# Step 1: Gather
DATA=$(gather_sections "$SECTIONS" 2>&1) || {
  notify_failure "data gathering failed"
  exit 1
}
log "Data gathered"

# Step 2: Self-review
REVIEW_OUTPUT=$(run_self_review "$DATA" 2>&1) || {
  log "Self-review failed (non-critical, continuing)"
  REVIEW_OUTPUT="Self-review unavailable"
}
PROPOSALS=$(extract_field "$REVIEW_OUTPUT" "PROPOSALS")
PROPOSAL_COUNT=$(extract_field "$REVIEW_OUTPUT" "PROPOSAL_COUNT")
log "Self-review done (${PROPOSAL_COUNT:-0} proposals)"

# Step 3: Summarize
SUMMARY_OUTPUT=$(run_summarize "$DATA" "$PROPOSALS" 2>&1) || {
  notify_failure "summarization failed"
  exit 1
}
SUMMARY=$(extract_field "$SUMMARY_OUTPUT" "SUMMARY")
TOP_PROPOSAL=$(extract_field "$SUMMARY_OUTPUT" "TOP_PROPOSAL")
WORKING_UPDATE=$(extract_field "$SUMMARY_OUTPUT" "WORKING_UPDATE")
DAILY_SUMMARY=$(extract_field "$SUMMARY_OUTPUT" "DAILY_SUMMARY")
log "Summary generated"

# Step 4: Update daily note summary
MEM_DIR=$(_tenant_memory)
if [ -n "$DAILY_SUMMARY" ]; then
  DAILY_NOTE="${MEM_DIR}/daily/${TODAY}.md"
  mkdir -p "${MEM_DIR}/daily"
  if [ -f "$DAILY_NOTE" ]; then
    # Replace the placeholder sections between the title and the first heartbeat entry
    python3 -c "
import sys, re
note = open('$DAILY_NOTE').read()
# Match from after the title line up to the first heartbeat section
pattern = r'(# Daily Note — [^\n]*\n)\n## Events\n.*?(?=\n## ~)'
replacement = r'\1\n' + sys.stdin.read().strip() + '\n'
updated = re.sub(pattern, replacement, note, count=1, flags=re.DOTALL)
open('$DAILY_NOTE', 'w').write(updated)
" <<< "$DAILY_SUMMARY"
    log "Daily note summary updated"
  fi
fi

# Step 5: Log proposals (to tenant's own file)
log_proposals "$PROPOSALS" "$PROPOSAL_COUNT"

# Step 6: Update WORKING.md (to tenant's own file)
update_working "$WORKING_UPDATE"

# Step 7: Blog post (Pif-admin only, non-blocking)
if _is_admin_tenant; then
  write_blog_post "$DATA" "$SUMMARY" &
  BLOG_PID=$!
  log "Blog post started (pid ${BLOG_PID})"
fi

# Step 8: Deliver
deliver_brief "Evening standup:

${SUMMARY}" || {
  notify_failure "Telegram delivery failed"
}

if [ -n "$TOP_PROPOSAL" ] && [ "$TOP_PROPOSAL" != "None" ]; then
  sleep 2
  deliver_brief "Top proposal: ${TOP_PROPOSAL}

Implement? y/n" || true
fi

# Wait for blog post if started
if [ -n "${BLOG_PID:-}" ]; then
  if wait $BLOG_PID 2>/dev/null; then
    log "Blog post completed"
  else
    log "Blog post failed or timed out (non-critical)"
  fi
fi

# Log success
brief_log_event "evening_standup_completed" "evening-standup" "{\"status\": \"ok\", \"proposals\": ${PROPOSAL_COUNT:-0}}"
log "Evening standup complete"

# Clean up temp prompt file if created
if [ -n "${BRIEF_PROMPT_FILE:-}" ] && [ -f "${BRIEF_PROMPT_FILE}" ] && [[ "${BRIEF_PROMPT_FILE}" == /tmp/brief-prompt-* ]]; then rm -f "$BRIEF_PROMPT_FILE"; fi
