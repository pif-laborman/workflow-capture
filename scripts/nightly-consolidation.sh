#!/bin/bash
# nightly-consolidation.sh — QMD Phase 4
# Reads today's daily note + session transcripts, extracts durable knowledge
# into life/ PARA files, syncs auto-memory, rebuilds QMD index.
# Runs at 2:30 AM CET (1:30 AM UTC) via Supabase schedule.
#
# Usage: ~/scripts/nightly-consolidation.sh                     # Admin (Pif) — full run
#        ~/scripts/nightly-consolidation.sh --tenant-id <uuid>  # Single tenant — knowledge extraction only
#        ~/scripts/nightly-consolidation.sh --all-tenants        # All provisioned tenants + system maintenance
#        ~/scripts/nightly-consolidation.sh --brief-id <uuid>    # From briefs table (dispatcher)

set -euo pipefail

source ~/.pif-env
source ~/scripts/brief-lib.sh

# Resolve the home directory for a tenant by UUID
tenant_home() {
  local TID="$1"
  if [ "$TID" = "$ADMIN_UUID" ]; then
    echo "$HOME"
    return
  fi
  local INSTANCE
  INSTANCE=$(curl -s "${PIF_SUPABASE_URL}/rest/v1/tenants?id=eq.${TID}&select=instance_name"     -H "apikey: ${PIF_SUPABASE_SERVICE_ROLE_KEY}"     -H "Authorization: Bearer ${PIF_SUPABASE_SERVICE_ROLE_KEY}"     | python3 -c "import sys,json; rows=json.loads(sys.stdin.read()); print(rows[0].get('instance_name','') if rows else '')" 2>/dev/null) || true
  if [ -n "$INSTANCE" ] && [ -d "/home/$INSTANCE" ]; then
    echo "/home/$INSTANCE"
  else
    echo "$HOME/tenants/${TID}"  # fallback
  fi
}

LOG="/root/logs/nightly-consolidation.log"
TS=$(date '+%Y-%m-%d %H:%M')
TODAY=$(date +%Y-%m-%d)
ADMIN_UUID="c2818981-bcb9-4fde-83d8-272d72c7a3d1"

log() { echo "${TS} — $1" >> "$LOG"; }

# --- Parse args ---
MODE="admin"
TENANT_ID=""
BRIEF_ID=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --all-tenants) MODE="all"; shift ;;
    --tenant-id) MODE="single"; TENANT_ID="$2"; shift 2 ;;
    --brief-id) MODE="brief"; BRIEF_ID="$2"; shift 2 ;;
    *) shift ;;
  esac
done

# If launched via brief, load config to get tenant_id
if [ "$MODE" = "brief" ]; then
  load_brief_config "$BRIEF_ID" || { echo "Failed to load brief $BRIEF_ID" >&2; exit 1; }
  TENANT_ID="$BRIEF_TENANT_ID"
  MODE="single"
fi

# Kill any stale consolidation processes (>20 min old)
kill_stale() {
  local STALE_PIDS
  STALE_PIDS=$(pgrep -f "nightly-consolidation" -d ' ' | tr ' ' '\n' | grep -v "^$$" || true)
  for pid in $STALE_PIDS; do
    if [ -d "/proc/$pid" ]; then
      AGE_SEC=$(( $(date +%s) - $(stat -c %Y /proc/$pid) ))
      if [ "$AGE_SEC" -gt 1200 ]; then
        kill -9 "$pid" 2>/dev/null && log "Killed stale process $pid (age: ${AGE_SEC}s)"
        pkill -9 -P "$pid" 2>/dev/null || true
      fi
    fi
  done
}

# --- Per-tenant knowledge extraction ---
# Reads daily note from tenant's memory dir, extracts durable facts into tenant's life/ dir.
consolidate_tenant() {
  local TID="$1"
  local TENANT_DIR

  TENANT_DIR=$(tenant_home "$TID")

  local DAILY_NOTE="${TENANT_DIR}/memory/daily/${TODAY}.md"
  if [ ! -f "$DAILY_NOTE" ]; then
    log "Tenant ${TID:0:8}: No daily note — skipping"
    return 0
  fi

  local LINE_COUNT
  LINE_COUNT=$(wc -l < "$DAILY_NOTE")
  if [ "$LINE_COUNT" -lt 5 ]; then
    log "Tenant ${TID:0:8}: Daily note too short (${LINE_COUNT} lines) — skipping"
    return 0
  fi

  local TIMEOUT=600
  local MAX_TURNS=15

  local PROMPT
  PROMPT=$(cat <<PROMPT_EOF
You are running nightly knowledge consolidation for tenant ${TID:0:8}. Your job is to extract durable facts from today's daily note and update the knowledge graph.

## Paths (IMPORTANT — use these exact paths)
- Daily note: ${TENANT_DIR}/memory/daily/${TODAY}.md
- Life files: ${TENANT_DIR}/life/ (projects/, areas/, resources/, archives/)
- Working state: ${TENANT_DIR}/memory/WORKING.md
- Auto-memory: ${TENANT_DIR}/.claude/projects/-/memory/MEMORY.md

## Instructions

1. Read today's daily note: ${TENANT_DIR}/memory/daily/${TODAY}.md
2. Read all ${TENANT_DIR}/life/ files (projects/, areas/, resources/) to understand current state
3. Read ${TENANT_DIR}/memory/WORKING.md for operational context (if it exists)
4. For each significant event or learning in the daily note, decide:
   - Is this a **durable fact** (will still be true next week)? → Update the relevant life/ file
   - Is this **ephemeral** (task status, session-specific)? → Skip it
   - Is this a **new entity** not yet tracked? → Create a new file in the right PARA category
5. After all updates, update ${TENANT_DIR}/.claude/projects/-/memory/MEMORY.md with any changes
6. Print CONSOLIDATION_RESULT with a brief summary of what was updated

## Rules
- Do NOT duplicate information already in life/ files — only add genuinely new facts
- Do NOT include timestamps or session-specific details in life/ files — those belong in daily notes
- Keep life/ files factual and concise — entity summaries, not event logs
- If nothing new is worth extracting, say so and skip the writes
- Do NOT modify daily notes or WORKING.md — those are not your responsibility here

## Examples of durable facts
- "Apify account created, username quintillionth_labyrinth, free plan \$5/mo"
- "Mission Control API runs on port 8091, nginx proxies from 8090"
- "GOG People API is now enabled in GCP console"

## Examples of ephemeral (skip these)
- "Run #15 is currently in planner step"
- "Heartbeat triage timed out at 15:00"
- "Synced credentials from root to ralph"
PROMPT_EOF
  )

  unset CLAUDECODE 2>/dev/null || true

  log "Tenant ${TID:0:8}: Running consolidation (timeout ${TIMEOUT}s, max-turns ${MAX_TURNS})"

  local OUTPUT
  OUTPUT=$(timeout "${TIMEOUT}s" claude -p "$PROMPT" \
      --model sonnet \
      --output-format text \
      --permission-mode dontAsk \
      --no-session-persistence \
      --max-turns "$MAX_TURNS" \
      2>>"$LOG") || {
      EXIT_CODE=$?
      if [ "$EXIT_CODE" -eq 124 ]; then
          log "Tenant ${TID:0:8}: ERROR — timed out after ${TIMEOUT}s"
      else
          log "Tenant ${TID:0:8}: ERROR — Claude exited with code ${EXIT_CODE}"
      fi
      return 1
  }

  log "Tenant ${TID:0:8}: Consolidation done: $(echo "$OUTPUT" | tail -3)"

  # Update and embed qmd index for this tenant
  local INSTANCE; INSTANCE=$(basename "$TENANT_DIR")
  HOME="$TENANT_DIR" qmd update >> "$LOG" 2>&1 &&     HOME="$TENANT_DIR" qmd embed >> "$LOG" 2>&1 &&     log "Tenant ${TID:0:8}: QMD index updated" ||     log "WARN: Tenant ${TID:0:8}: qmd update/embed failed (non-fatal)"
}

# --- System maintenance (Pif-only) ---
run_system_maintenance() {
  # QMD index rebuild
  qmd update >> "$LOG" 2>&1 || log "WARN: qmd update failed (non-fatal)"
  qmd embed >> "$LOG" 2>&1 || log "WARN: qmd embed failed (non-fatal)"

  # Supabase retention cleanup
  SB_KEY="${PIF_SUPABASE_SERVICE_ROLE_KEY:-$(pif-creds get Supabase 2>/dev/null)}"
  CUTOFF=$(date -u -d '7 days ago' '+%Y-%m-%dT%H:%M:%SZ')

  heartbeats_deleted=$(curl -s -o /dev/null -w '%{http_code}' \
      -X DELETE "${PIF_SUPABASE_URL}/rest/v1/heartbeats?created_at=lt.${CUTOFF}" \
      -H "apikey: ${SB_KEY}" \
      -H "Authorization: Bearer ${SB_KEY}" \
      -H "Prefer: return=representation" \
      -H "Content-Type: application/json")

  if [ "$heartbeats_deleted" = "200" ]; then
      log "Retention: pruned heartbeats older than 7 days"
  else
      log "WARN: heartbeats cleanup returned HTTP ${heartbeats_deleted}"
  fi

  # Schema drift detection
  log "Running schema sync"
  ~/scripts/schema-sync.sh --fix >> "$LOG" 2>&1 && log "Schema in sync" || log "WARN: schema drift detected — check SCHEMA.md"
}

# --- Main ---
kill_stale

log "Starting nightly consolidation (mode=${MODE}) for ${TODAY}"

case "$MODE" in
  admin)
    consolidate_tenant "$ADMIN_UUID"
    run_system_maintenance
    ;;
  single)
    consolidate_tenant "$TENANT_ID"
    # System maintenance runs only for admin tenant
    if [ "$TENANT_ID" = "$ADMIN_UUID" ]; then
      run_system_maintenance
    fi
    ;;
  all)
    # Run all tenants sequentially
    for TDIR in "$HOME/tenants"/*/; do
      TID=$(basename "$TDIR")
      consolidate_tenant "$TID"
    done
    run_system_maintenance
    ;;
esac

log "Nightly consolidation complete for ${TODAY}"
