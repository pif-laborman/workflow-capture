#!/bin/bash
# morning-brief.sh — Daily morning standup for Pavol
# Gathers system data, summarizes via Claude, delivers to Telegram.
# Replaces workflows/morning-brief.yml — simpler, no antfarm dependency.
#
# Schedule: 8:00 CET via Supabase schedules (command field)
# Usage: ~/scripts/morning-brief.sh

set -euo pipefail
source ~/.pif-env

LOG="/root/logs/morning-brief.log"
TS=$(date '+%Y-%m-%d %H:%M')
PROMPT_FILE=~/agents/pif/prompts/morning-brief.md

log() { echo "${TS} — $1" >> "$LOG"; }
notify_failure() {
  ~/scripts/telegram-send.sh "Morning brief failed: $1"
  log "FAILED: $1"
}

# --- Supabase helper ---
sb_get() {
  local SRK
  SRK=$(grep 'SUPABASE_SERVICE_KEY=' /etc/mission-control-api.env 2>/dev/null | cut -d= -f2) || SRK="${PIF_SUPABASE_ANON_KEY}"
  curl -s "${PIF_SUPABASE_URL}/rest/v1/${1}" \
    -H "apikey: ${SRK}" \
    -H "Authorization: Bearer ${SRK}" 2>/dev/null
}

# --- Log event to Supabase ---
log_event() {
  local SRK
  SRK=$(grep 'SUPABASE_SERVICE_KEY=' /etc/mission-control-api.env 2>/dev/null | cut -d= -f2) || SRK="${PIF_SUPABASE_ANON_KEY}"
  curl -s -X POST "${PIF_SUPABASE_URL}/rest/v1/events" \
    -H "apikey: ${SRK}" \
    -H "Authorization: Bearer ${SRK}" \
    -H "Content-Type: application/json" \
    -d "{\"type\": \"$1\", \"source\": \"morning-brief\", \"data\": $2, \"tenant_id\": \"c2818981-bcb9-4fde-83d8-272d72c7a3d1\"}" \
    >/dev/null 2>&1 || true
}

# ============================================================
# STEP 1: Gather data
# ============================================================
gather_data() {
  echo "=== YESTERDAY'S NOTE ==="
  local YESTERDAY
  YESTERDAY=$(date -d "yesterday" +%Y-%m-%d)
  cat ~/memory/daily/${YESTERDAY}.md 2>/dev/null || echo "No note for yesterday"

  echo ""
  echo "=== TODAY'S NOTE ==="
  cat ~/memory/daily/$(date +%Y-%m-%d).md 2>/dev/null || echo "No daily note yet"

  echo ""
  echo "=== WORKING STATE ==="
  cat ~/memory/WORKING.md

  echo ""
  echo "=== INBOX ==="
  ls ~/workspace/inbox/ 2>/dev/null | head -20 || echo "Inbox empty"

  echo ""
  echo "=== GIT ACTIVITY (last 24h) ==="
  for dir in ~/projects/*/; do
    local PROJ
    PROJ=$(basename "$dir")
    if [ -d "$dir/.git" ]; then
      local COMMITS
      COMMITS=$(git -C "$dir" log --oneline --since="24 hours ago" --all 2>/dev/null) || true
      if [ -n "$COMMITS" ]; then
        echo "[$PROJ]"
        echo "$COMMITS" | head -10
        local BRANCH
        BRANCH=$(git -C "$dir" branch --show-current 2>/dev/null) || true
        echo "  (on branch: $BRANCH)"
        echo ""
      fi
    fi
  done

  echo ""
  echo "=== RECENT SESSION ACTIVITY ==="
  local LATEST_SESSION
  LATEST_SESSION=$(ls -t ~/.claude/projects/-root/*.jsonl 2>/dev/null | head -1) || true
  if [ -n "$LATEST_SESSION" ]; then
    local LAST_MOD CUTOFF
    LAST_MOD=$(stat -c %Y "$LATEST_SESSION" 2>/dev/null) || true
    CUTOFF=$(date -d "24 hours ago" +%s)
    if [ -n "$LAST_MOD" ] && [ "$LAST_MOD" -gt "$CUTOFF" ] 2>/dev/null; then
      echo "Active session found (modified $(date -d @$LAST_MOD '+%H:%M'))"
      grep -o '"tool":"[^"]*"' "$LATEST_SESSION" 2>/dev/null | sort | uniq -c | sort -rn | head -10
    fi
  fi

  echo ""
  echo "=== SKILLS CHANGES (last 24h) ==="
  find ~/.claude/skills/ -name "*.md" -mtime -1 2>/dev/null | while read f; do
    echo "  $(basename $(dirname $f))/$(basename $f)"
  done || echo "No skill changes"

  echo ""
  echo "=== DEPLOYMENTS ==="
  local MC_DIST=~/projects/mission-control/dist/index.html
  if [ -f "$MC_DIST" ]; then
    local MC_MOD MC_CUTOFF
    MC_MOD=$(stat -c %Y "$MC_DIST" 2>/dev/null) || true
    MC_CUTOFF=$(date -d "24 hours ago" +%s)
    if [ -n "$MC_MOD" ] && [ "$MC_MOD" -gt "$MC_CUTOFF" ] 2>/dev/null; then
      echo "Mission Control: rebuilt $(date -d @$MC_MOD '+%Y-%m-%d %H:%M')"
      local MC_STATUS
      MC_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8090/ 2>/dev/null) || true
      echo "  HTTP status: $MC_STATUS"
    else
      echo "Mission Control: no recent deploy"
    fi
  fi

  echo ""
  echo "=== TASK BOARD METRICS ==="
  local TASKS_RAW
  TASKS_RAW=$(sb_get "tasks?select=status,created_at,updated_at")
  if [ -n "$TASKS_RAW" ] && [ "$TASKS_RAW" != "[]" ]; then
    echo "$TASKS_RAW" | python3 -c "
import sys, json
from datetime import datetime, timedelta, timezone
tasks = json.loads(sys.stdin.read())
counts = {}
for t in tasks:
    s = t.get('status','unknown')
    counts[s] = counts.get(s, 0) + 1
print('Status breakdown:')
for s in ['todo','in_progress','review','backlog','done']:
    if s in counts:
        print(f'  {s}: {counts[s]}')
total = len(tasks)
done = counts.get('done', 0)
active = total - done
print(f'Active: {active} | Total: {total}')
week_ago = datetime.now(timezone.utc) - timedelta(days=7)
done_this_week = 0
created_this_week = 0
for t in tasks:
    try:
        if t.get('status') == 'done' and t.get('updated_at'):
            if datetime.fromisoformat(t['updated_at']) > week_ago:
                done_this_week += 1
    except: pass
    try:
        if t.get('created_at'):
            if datetime.fromisoformat(t['created_at']) > week_ago:
                created_this_week += 1
    except: pass
print(f'7-day velocity: {done_this_week} closed / {created_this_week} opened')
" 2>/dev/null || echo "Could not compute task metrics"
  else
    echo "No task data available"
  fi

  echo ""
  echo "=== OPEN TASKS ==="
  sb_get "tasks?status=not.in.(done,archived)&select=title,status,priority&order=priority.asc,created_at.asc" || echo "Could not fetch tasks"

  echo ""
  echo "=== WORKFLOW METRICS (7 days) ==="
  local WEEK_AGO
  WEEK_AGO=$(date -u -d "7 days ago" +%Y-%m-%dT%H:%M:%SZ)
  local RUNS_RAW
  RUNS_RAW=$(sb_get "runs?select=workflow_id,status,started_at,completed_at&started_at=gte.${WEEK_AGO}&order=started_at.desc")
  if [ -n "$RUNS_RAW" ] && [ "$RUNS_RAW" != "[]" ]; then
    echo "$RUNS_RAW" | python3 -c "
import sys, json
from datetime import datetime
runs = json.loads(sys.stdin.read())
total = len(runs)
by_wf = {}
for r in runs:
    wf = r.get('workflow_id','unknown')
    if wf not in by_wf:
        by_wf[wf] = {'total': 0, 'completed': 0, 'failed': 0, 'durations': []}
    by_wf[wf]['total'] += 1
    if r.get('status') == 'completed':
        by_wf[wf]['completed'] += 1
        if r.get('started_at') and r.get('completed_at'):
            try:
                s = datetime.fromisoformat(r['started_at'])
                e = datetime.fromisoformat(r['completed_at'])
                by_wf[wf]['durations'].append((e - s).total_seconds())
            except: pass
    elif r.get('status') == 'failed':
        by_wf[wf]['failed'] += 1
completed = sum(v['completed'] for v in by_wf.values())
failed = sum(v['failed'] for v in by_wf.values())
rate = (completed / total * 100) if total else 0
print(f'Overall: {total} runs, {completed} completed, {failed} failed ({rate:.0f}% success)')
for wf, stats in sorted(by_wf.items()):
    avg_dur = ''
    if stats['durations']:
        avg_s = sum(stats['durations']) / len(stats['durations'])
        avg_dur = f', avg {avg_s:.0f}s'
    print(f'  {wf}: {stats[\"completed\"]}/{stats[\"total\"]} ok, {stats[\"failed\"]} failed{avg_dur}')
" 2>/dev/null || echo "Could not compute workflow metrics"
  else
    echo "No workflow runs in last 7 days"
  fi

  echo ""
  echo "=== RECENT RUNS ==="
  sb_get "runs?select=workflow_id,status,started_at&order=started_at.desc&limit=5" || echo "Could not fetch runs"

  echo ""
  echo "=== SYSTEM HEALTH ==="
  sb_get "heartbeats?select=bot_status,disk_free,ram_free,uptime,created_at&order=created_at.desc&limit=1" || echo "Could not fetch heartbeat"

  echo ""
  echo "=== RECENT EVENTS (24h) ==="
  local DAY_AGO
  DAY_AGO=$(date -u -d "24 hours ago" +%Y-%m-%dT%H:%M:%SZ)
  local EVENTS
  EVENTS=$(sb_get "events?select=type,source,created_at&created_at=gte.${DAY_AGO}&order=created_at.desc&limit=15")
  if [ -n "$EVENTS" ] && [ "$EVENTS" != "[]" ]; then
    echo "$EVENTS" | python3 -c "
import sys, json
events = json.loads(sys.stdin.read())
counts = {}
for e in events:
    t = e.get('type','unknown')
    counts[t] = counts.get(t, 0) + 1
for t, c in sorted(counts.items(), key=lambda x: -x[1]):
    print(f'  {t}: {c}')
" 2>/dev/null || echo "$EVENTS"
  else
    echo "No events in last 24h"
  fi

  echo ""
  echo "=== FAILED STEPS ==="
  sb_get "steps?status=eq.failed&select=id,step_id,run_id,agent,started_at&order=started_at.desc&limit=5" || echo "No failed steps"
}

# ============================================================
# STEP 2: Summarize via Claude
# ============================================================
summarize() {
  local DATA="$1"
  local PROMPT
  PROMPT=$(cat "$PROMPT_FILE")

  echo "${PROMPT}

Data:
${DATA}" | env -u CLAUDECODE claude --print --model haiku
}

# ============================================================
# MAIN
# ============================================================
log "Starting morning brief"

# Gather
DATA=$(gather_data 2>&1) || {
  notify_failure "data gathering failed"
  exit 1
}

# Summarize
BRIEF=$(summarize "$DATA" 2>&1) || {
  notify_failure "Claude summarization failed"
  exit 1
}

# Strip STATUS: done prefix
BRIEF=$(echo "$BRIEF" | sed '1{/^STATUS:/d}' | sed '/^$/d')

# Deliver
~/scripts/telegram-send.sh "Good morning! Here's your standup:

${BRIEF}" || {
  notify_failure "Telegram delivery failed"
  exit 1
}

# Log success
log_event "morning_brief_completed" "{\"status\": \"ok\"}"
log "Morning brief delivered"
