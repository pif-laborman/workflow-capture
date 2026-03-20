#!/bin/bash
# evening-standup.sh — End-of-day summary with self-improvement loop
# Gathers data, runs self-review, summarizes, logs proposals,
# updates WORKING.md, writes blog post, delivers to Telegram.
# Replaces workflows/evening-standup.yml — simpler, no antfarm dependency.
#
# Schedule: 21:00 CET via Supabase schedules (command field)
# Usage: ~/scripts/evening-standup.sh

set -euo pipefail
source ~/.pif-env

LOG="/root/logs/evening-standup.log"
TS=$(date '+%Y-%m-%d %H:%M')
TODAY=$(date +%Y-%m-%d)
PROMPTS_DIR=~/agents/pif/prompts

log() { echo "${TS} — $1" >> "$LOG"; }
notify_failure() {
  ~/scripts/telegram-send.sh "Evening standup failed: $1"
  log "FAILED: $1"
}

# --- Supabase helpers ---
sb_get() {
  local SRK
  SRK=$(grep 'SUPABASE_SERVICE_KEY=' /etc/mission-control-api.env 2>/dev/null | cut -d= -f2) || SRK="${PIF_SUPABASE_ANON_KEY}"
  curl -s "${PIF_SUPABASE_URL}/rest/v1/${1}" \
    -H "apikey: ${SRK}" \
    -H "Authorization: Bearer ${SRK}" 2>/dev/null
}

log_event() {
  local SRK
  SRK=$(grep 'SUPABASE_SERVICE_KEY=' /etc/mission-control-api.env 2>/dev/null | cut -d= -f2) || SRK="${PIF_SUPABASE_ANON_KEY}"
  curl -s -X POST "${PIF_SUPABASE_URL}/rest/v1/events" \
    -H "apikey: ${SRK}" \
    -H "Authorization: Bearer ${SRK}" \
    -H "Content-Type: application/json" \
    -d "{\"type\": \"$1\", \"source\": \"evening-standup\", \"data\": $2, \"tenant_id\": \"c2818981-bcb9-4fde-83d8-272d72c7a3d1\"}" \
    >/dev/null 2>&1 || true
}

# ============================================================
# STEP 1: Gather data
# ============================================================
gather_data() {
  echo "=== TODAY'S NOTE ==="
  cat ~/memory/daily/${TODAY}.md 2>/dev/null || echo "No events today"

  echo ""
  echo "=== CURRENT WORKING STATE ==="
  cat ~/memory/WORKING.md

  echo ""
  echo "=== RECENT LEARNINGS ==="
  tail -20 ~/memory/.learnings/LEARNINGS.md 2>/dev/null || echo "None"

  echo ""
  echo "=== TELEGRAM INTERACTIONS TODAY ==="
  sqlite3 /root/data/bot.db "
    SELECT datetime(timestamp) as ts, substr(prompt, 1, 200) as prompt
    FROM messages
    WHERE date(timestamp) = date('now')
    ORDER BY timestamp;
  " 2>/dev/null || echo "No interactions today"

  echo ""
  echo "=== TASK OUTCOMES TODAY ==="
  sb_get "tasks?select=title,status,updated_at&updated_at=gte.${TODAY}T00:00:00Z&order=updated_at.desc" || echo "Could not fetch tasks"

  echo ""
  echo "=== WORKFLOW RUNS TODAY ==="
  sb_get "runs?select=workflow_id,status,triggered_by,completed_at&started_at=gte.${TODAY}T00:00:00Z&order=started_at.desc" || echo "Could not fetch runs"

  echo ""
  echo "=== PREVIOUS IMPROVEMENT PROPOSALS ==="
  tail -30 ~/memory/improvement-proposals.md 2>/dev/null || echo "No prior proposals"
}

# ============================================================
# STEP 2: Self-review (proposals)
# ============================================================
run_self_review() {
  local DATA="$1"
  local PROMPT
  PROMPT=$(cat "${PROMPTS_DIR}/evening-self-review.md")

  echo "${PROMPT}

Review this data from today:

${DATA}" | env -u CLAUDECODE claude --print --model sonnet
}

# ============================================================
# STEP 3: Summarize
# ============================================================
run_summarize() {
  local DATA="$1"
  local PROPOSALS="$2"
  local PROMPT
  PROMPT=$(cat "${PROMPTS_DIR}/evening-summarize.md")

  echo "${PROMPT}

Today's data:
${DATA}

Self-improvement proposals from today's review:
${PROPOSALS}" | env -u CLAUDECODE claude --print --model sonnet
}

# ============================================================
# STEP 4: Log proposals
# ============================================================
log_proposals() {
  local PROPOSALS="$1"
  local PROPOSAL_COUNT="$2"

  # Strip to just the number
  PROPOSAL_COUNT=$(echo "$PROPOSAL_COUNT" | tr -dc '0-9')
  PROPOSAL_COUNT=${PROPOSAL_COUNT:-0}

  if [ "$PROPOSAL_COUNT" != "0" ] && [ -n "$PROPOSAL_COUNT" ]; then
    mkdir -p ~/memory
    echo "" >> ~/memory/improvement-proposals.md
    echo "## ${TODAY} Evening Review" >> ~/memory/improvement-proposals.md
    echo "" >> ~/memory/improvement-proposals.md
    echo "$PROPOSALS" >> ~/memory/improvement-proposals.md
    echo "" >> ~/memory/improvement-proposals.md
    log "Logged ${PROPOSAL_COUNT} proposals"
  else
    log "No proposals to log"
  fi
}

# ============================================================
# STEP 5: Update WORKING.md
# ============================================================
update_working() {
  local WORKING_UPDATE="$1"
  if [ -n "$WORKING_UPDATE" ]; then
    cd ~/memory && git add -A && git commit -m "pre-update: evening-standup ${TODAY}" --allow-empty -q 2>/dev/null || true
    echo "$WORKING_UPDATE" > ~/memory/WORKING.md
    log "WORKING.md updated"
  fi
}

# ============================================================
# STEP 6: Blog post (independent — failure doesn't block delivery)
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
# STEP 7: Deliver to Telegram
# ============================================================
deliver() {
  local SUMMARY="$1"
  local TOP_PROPOSAL="$2"

  ~/scripts/telegram-send.sh "Evening standup:

${SUMMARY}"

  if [ -n "$TOP_PROPOSAL" ] && [ "$TOP_PROPOSAL" != "None" ]; then
    sleep 2
    ~/scripts/telegram-send.sh "Top proposal: ${TOP_PROPOSAL}

Implement? y/n"
  fi
}

# ============================================================
# Helper: extract KEY: value from Claude output
# ============================================================
extract_field() {
  local OUTPUT="$1"
  local KEY="$2"
  # Remove markdown bold, then extract everything after KEY: until the next KEY: or end
  echo "$OUTPUT" | sed 's/\*\*//g' | python3 -c "
import sys, re
text = sys.stdin.read()
# Find the key
pattern = r'^${KEY}:\s*(.*?)(?=^[A-Z_]+:|$)'
m = re.search(pattern, text, re.MULTILINE | re.DOTALL)
if m:
    print(m.group(1).strip())
" 2>/dev/null
}

# ============================================================
# MAIN
# ============================================================
log "Starting evening standup"

# Step 1: Gather
DATA=$(gather_data 2>&1) || {
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
log "Summary generated"

# Step 4: Log proposals
log_proposals "$PROPOSALS" "$PROPOSAL_COUNT"

# Step 5: Update WORKING.md
update_working "$WORKING_UPDATE"

# Step 6: Blog post (independent, non-blocking)
write_blog_post "$DATA" "$SUMMARY" &
BLOG_PID=$!
log "Blog post started (pid ${BLOG_PID})"

# Step 7: Deliver (don't wait for blog)
deliver "$SUMMARY" "$TOP_PROPOSAL" || {
  notify_failure "Telegram delivery failed"
}

# Wait for blog post (with timeout)
if wait $BLOG_PID 2>/dev/null; then
  log "Blog post completed"
else
  log "Blog post failed or timed out (non-critical)"
fi

# Log success
log_event "evening_standup_completed" "{\"status\": \"ok\", \"proposals\": ${PROPOSAL_COUNT:-0}}"
log "Evening standup complete"
