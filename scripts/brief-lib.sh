#!/bin/bash
# brief-lib.sh — Shared library for brief scripts (morning, evening, custom)
# Source this file, don't execute it directly.
#
# Provides: sb_get, sb_post, log_event, load_brief_config, deliver_brief,
#           extract_field, share_file, and modular section gatherers.

# Guard against direct execution
[[ "${BASH_SOURCE[0]}" == "${0}" ]] && { echo "Source this file, don't run it." >&2; exit 1; }

# --- Supabase credentials (cached for session) ---
_SRK=""
_sb_key() {
  if [ -z "$_SRK" ]; then
    _SRK=$(grep 'SUPABASE_SERVICE_KEY=' /etc/mission-control-api.env 2>/dev/null | cut -d= -f2) || _SRK="${PIF_SUPABASE_ANON_KEY}"
  fi
  echo "$_SRK"
}

sb_get() {
  local KEY; KEY=$(_sb_key)
  curl -s "${PIF_SUPABASE_URL}/rest/v1/${1}" \
    -H "apikey: ${KEY}" \
    -H "Authorization: Bearer ${KEY}" 2>/dev/null
}

sb_post() {
  local TABLE="$1" DATA="$2"
  local KEY; KEY=$(_sb_key)
  curl -s -X POST "${PIF_SUPABASE_URL}/rest/v1/${TABLE}" \
    -H "apikey: ${KEY}" \
    -H "Authorization: Bearer ${KEY}" \
    -H "Content-Type: application/json" \
    -H "Prefer: return=representation" \
    -d "$DATA" 2>/dev/null
}

# --- File sharing ---
# Usage: share_file <local_path>
# Returns: public Supabase URL for the file (or empty on failure)
_MC_TOKEN=""
_mc_token() {
  if [ -z "$_MC_TOKEN" ]; then
    _MC_TOKEN=$(grep 'MC_API_TOKEN=' /etc/mission-control-api.env 2>/dev/null | cut -d= -f2)
  fi
  echo "$_MC_TOKEN"
}

share_file() {
  local FILE_PATH="$1"
  local TOKEN; TOKEN=$(_mc_token)
  if [ -z "$TOKEN" ]; then
    echo "" >&2
    return 1
  fi
  curl -s -X POST "http://localhost:8091/api/fs/share?path=${FILE_PATH}" \
    -H "x-mc-token: ${TOKEN}" 2>/dev/null \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('url',''))" 2>/dev/null
}

# --- Event logging ---
# Usage: brief_log_event <type> <source> <json_data> [tenant_id]
brief_log_event() {
  local TYPE="$1" SOURCE="$2" DATA="$3" TENANT="${4:-${BRIEF_TENANT_ID:-}}"
  local PAYLOAD="{\"type\": \"${TYPE}\", \"source\": \"${SOURCE}\", \"data\": ${DATA}"
  [ -n "$TENANT" ] && PAYLOAD="${PAYLOAD}, \"tenant_id\": \"${TENANT}\""
  PAYLOAD="${PAYLOAD}}"
  sb_post "events" "$PAYLOAD" >/dev/null 2>&1 || true
}

# --- Brief config loader ---
# Queries the briefs table and exports config as env vars.
# Usage: load_brief_config <brief_id>
# Sets: BRIEF_NAME, BRIEF_MODEL, BRIEF_DELIVERY_CHANNEL, BRIEF_DELIVERY_TARGET,
#       BRIEF_SECTIONS (space-separated), BRIEF_PROMPT, BRIEF_TIMEZONE, BRIEF_TENANT_ID
load_brief_config() {
  local BRIEF_ID="$1"
  local RAW
  RAW=$(sb_get "briefs?id=eq.${BRIEF_ID}&select=*" | python3 -c "
import sys, json
rows = json.loads(sys.stdin.read())
if not rows:
    print('ERROR: Brief not found')
    sys.exit(1)
b = rows[0]
print(f'BRIEF_NAME=\"{b[\"name\"]}\"')
print(f'BRIEF_MODEL=\"{b[\"model\"]}\"')
print(f'BRIEF_DELIVERY_CHANNEL=\"{b.get(\"delivery_channel\",\"telegram\")}\"')
print(f'BRIEF_DELIVERY_TARGET=\"{b.get(\"delivery_target\",\"\")}\"')
sections = b.get('sections', [])
print(f'BRIEF_SECTIONS=\"{\" \".join(sections)}\"')
print(f'BRIEF_TIMEZONE=\"{b.get(\"timezone\",\"UTC\")}\"')
print(f'BRIEF_TENANT_ID=\"{b[\"tenant_id\"]}\"')
prompt = b.get('prompt') or ''
# Prompt can be multiline — write to temp file
if prompt:
    import tempfile, os
    fd, path = tempfile.mkstemp(prefix='brief-prompt-', suffix='.md')
    with os.fdopen(fd, 'w') as f:
        f.write(prompt)
    print(f'BRIEF_PROMPT_FILE={path}')
else:
    print('BRIEF_PROMPT_FILE=')
" 2>/dev/null) || { echo "Failed to load brief config" >&2; return 1; }

  if echo "$RAW" | grep -q "^ERROR:"; then
    echo "$RAW" >&2
    return 1
  fi

  eval "$RAW"
  export BRIEF_NAME BRIEF_MODEL BRIEF_DELIVERY_CHANNEL BRIEF_DELIVERY_TARGET
  export BRIEF_SECTIONS BRIEF_TIMEZONE BRIEF_TENANT_ID BRIEF_PROMPT_FILE
}

# --- Delivery ---
# Usage: deliver_brief <message> [channel] [target]
# Falls back to BRIEF_DELIVERY_CHANNEL / BRIEF_DELIVERY_TARGET if not provided.
deliver_brief() {
  local MSG="$1"
  local CHANNEL="${2:-${BRIEF_DELIVERY_CHANNEL:-telegram}}"
  local TARGET="${3:-${BRIEF_DELIVERY_TARGET:-}}"

  case "$CHANNEL" in
    telegram)
      if [ -n "$TARGET" ]; then
        ~/scripts/telegram-send.sh --chat-id "$TARGET" "$MSG"
      else
        ~/scripts/telegram-send.sh "$MSG"
      fi
      ;;
    *)
      echo "Unsupported delivery channel: $CHANNEL" >&2
      return 1
      ;;
  esac
}

# --- Field extraction from Claude output ---
# Usage: extract_field "<output>" "<KEY>"
extract_field() {
  local OUTPUT="$1"
  local KEY="$2"
  echo "$OUTPUT" | sed 's/\*\*//g' | python3 -c "
import sys, re
text = sys.stdin.read()
pattern = r'^${KEY}:\s*(.*?)(?=^[A-Z_]+:|\Z)'
m = re.search(pattern, text, re.MULTILINE | re.DOTALL)
if m:
    print(m.group(1).strip())
" 2>/dev/null
}

# ============================================================
# SECTION GATHERERS
# Each function gathers data for one section. Tenant-scoped
# via BRIEF_TENANT_ID where applicable.
# ============================================================

# Sections backed by Supabase (multi-tenant ready)
section_tasks() {
  local TID="${BRIEF_TENANT_ID:-}"
  local FILTER=""
  [ -n "$TID" ] && FILTER="&tenant_id=eq.${TID}"

  echo "=== TASK BOARD METRICS ==="
  local TASKS_RAW
  TASKS_RAW=$(sb_get "tasks?select=status,created_at,updated_at${FILTER}")
  if [ -n "$TASKS_RAW" ] && [ "$TASKS_RAW" != "[]" ]; then
    echo "$TASKS_RAW" | python3 -c "
import sys, json
from datetime import datetime, timedelta, timezone
tasks = json.loads(sys.stdin.read())
counts = {}
for t in tasks:
    s = t.get('status','unknown')
    counts[s] = counts.get(s, 0) + 1
print('By status:')
for s in ['todo','in_progress','review','blocked','backlog','done']:
    if s in counts:
        print(f'  {s}: {counts[s]}')
total = len(tasks)
print(f'Total: {total}')
week_ago = datetime.now(timezone.utc) - timedelta(days=7)
done_this_week = sum(1 for t in tasks if t.get('status')=='done' and t.get('updated_at') and datetime.fromisoformat(t['updated_at']) > week_ago)
created_this_week = sum(1 for t in tasks if t.get('created_at') and datetime.fromisoformat(t['created_at']) > week_ago)
print(f'7-day velocity: {done_this_week} closed / {created_this_week} opened')
" 2>/dev/null || echo "Could not compute task metrics"

    echo ""
    echo "=== OPEN TASKS ==="
    sb_get "tasks?status=not.in.(done,archived)&select=title,status,priority&order=priority.asc,created_at.asc${FILTER}" || echo "Could not fetch tasks"
  else
    echo "No task data available"
  fi
}

section_workflows() {
  local TID="${BRIEF_TENANT_ID:-}"
  local FILTER=""
  [ -n "$TID" ] && FILTER="&tenant_id=eq.${TID}"
  local WEEK_AGO
  WEEK_AGO=$(date -u -d "7 days ago" +%Y-%m-%dT%H:%M:%SZ)

  echo "=== WORKFLOW METRICS (7 days) ==="
  local RUNS_RAW
  RUNS_RAW=$(sb_get "runs?select=workflow_id,status,started_at,completed_at&started_at=gte.${WEEK_AGO}&order=started_at.desc${FILTER}")
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
  sb_get "runs?select=workflow_id,status,started_at&order=started_at.desc&limit=5${FILTER}" || echo "Could not fetch runs"

  echo ""
  echo "=== FAILED STEPS ==="
  sb_get "steps?status=eq.failed&select=id,step_id,run_id,agent,started_at&order=started_at.desc&limit=5" || echo "No failed steps"
}

section_system_health() {
  local TID="${BRIEF_TENANT_ID:-}"
  local FILTER=""
  [ -n "$TID" ] && FILTER="&tenant_id=eq.${TID}"

  echo "=== SYSTEM HEALTH ==="
  sb_get "heartbeats?select=bot_status,disk_free,ram_free,uptime,created_at&order=created_at.desc&limit=1${FILTER}" || echo "Could not fetch heartbeat"
}

section_events() {
  local TID="${BRIEF_TENANT_ID:-}"
  local FILTER=""
  [ -n "$TID" ] && FILTER="&tenant_id=eq.${TID}"
  local DAY_AGO
  DAY_AGO=$(date -u -d "24 hours ago" +%Y-%m-%dT%H:%M:%SZ)

  echo "=== RECENT EVENTS (24h) ==="
  local EVENTS
  EVENTS=$(sb_get "events?select=type,source,created_at&created_at=gte.${DAY_AGO}&order=created_at.desc&limit=15${FILTER}")
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
}

section_proposals() {
  echo "=== PREVIOUS IMPROVEMENT PROPOSALS ==="
  tail -30 ~/memory/improvement-proposals.md 2>/dev/null || echo "No prior proposals"
}

section_telegram_history() {
  local TODAY
  TODAY=$(date +%Y-%m-%d)
  echo "=== TELEGRAM INTERACTIONS TODAY ==="
  sqlite3 /root/data/bot.db "
    SELECT datetime(timestamp) as ts, substr(prompt, 1, 200) as prompt
    FROM messages
    WHERE date(timestamp) = date('now')
    ORDER BY timestamp;
  " 2>/dev/null || echo "No interactions today"
}

section_learnings() {
  echo "=== RECENT LEARNINGS ==="
  tail -20 ~/memory/.learnings/LEARNINGS.md 2>/dev/null || echo "None"
}

# Pif-only sections (local filesystem, not multi-tenant)
section_git_activity() {
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
}

section_deployments() {
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
}

section_daily_notes() {
  local YESTERDAY
  YESTERDAY=$(date -d "yesterday" +%Y-%m-%d)
  echo "=== YESTERDAY'S NOTE ==="
  cat ~/memory/daily/${YESTERDAY}.md 2>/dev/null || echo "No note for yesterday"
  echo ""
  echo "=== TODAY'S NOTE ==="
  cat ~/memory/daily/$(date +%Y-%m-%d).md 2>/dev/null || echo "No daily note yet"
}

section_working_state() {
  echo "=== WORKING STATE ==="
  cat ~/memory/WORKING.md 2>/dev/null || echo "No working state"
}

section_inbox() {
  echo "=== INBOX ==="
  ls ~/workspace/inbox/ 2>/dev/null | head -20 || echo "Inbox empty"
}

section_session_activity() {
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
}

section_skills_changes() {
  echo "=== SKILLS CHANGES (last 24h) ==="
  find ~/.claude/skills/ -name "*.md" -mtime -1 2>/dev/null | while read f; do
    echo "  $(basename $(dirname $f))/$(basename $f)"
  done || echo "No skill changes"
}

# --- Run sections by name ---
# Usage: gather_sections "tasks workflows system_health events"
gather_sections() {
  local SECTIONS="$1"
  for section in $SECTIONS; do
    local fn="section_${section}"
    if type "$fn" &>/dev/null; then
      echo ""
      $fn
    else
      echo ""
      echo "=== UNKNOWN SECTION: ${section} ==="
    fi
  done
}
