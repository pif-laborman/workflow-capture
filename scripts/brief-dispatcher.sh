#!/bin/bash
# brief-dispatcher.sh — Queries all enabled briefs and runs any that are due.
# Called by the schedule checker every minute (via Supabase schedules).
#
# For each enabled brief with a delivery_target, checks if the cron matches
# the current time and runs the appropriate script.
#
# Dedup: uses last_run_at column in briefs table (survives reboots).
# Window: fires if cron was due at any point in the last 6 minutes.
#
# Usage: ~/scripts/brief-dispatcher.sh

set -euo pipefail
source ~/.pif-env
source ~/scripts/brief-lib.sh

LOG="/root/logs/brief-dispatcher.log"
TS=$(date '+%Y-%m-%d %H:%M')

log() { echo "${TS} — $1" >> "$LOG"; }

# Fetch all enabled briefs with last_run_at for dedup
BRIEFS=$(sb_get "briefs?enabled=eq.true&select=id,name,cron_expression,timezone,last_run_at" 2>/dev/null) || {
  log "Failed to fetch briefs"
  exit 1
}

# Check if any are due (window-based: fired if cron matched any minute in last 6min)
# Uses last_run_at from DB for dedup instead of /tmp marker files.
echo "$BRIEFS" | python3 -c "
import sys, json
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo

briefs = json.loads(sys.stdin.read())
if not briefs:
    sys.exit(0)

def cron_field_matches(field_val, cron_val):
    if cron_val == '*':
        return True
    for part in cron_val.split(','):
        part = part.strip()
        if '/' in part:
            base, interval = part.split('/', 1)
            if field_val % int(interval) == 0:
                return True
        elif '-' in part:
            lo, hi = part.split('-', 1)
            if int(lo) <= field_val <= int(hi):
                return True
        else:
            if int(part) == field_val:
                return True
    return False

def cron_matches_time(cron_expr, t):
    parts = cron_expr.strip().split()
    if len(parts) != 5:
        return False
    fields = [t.minute, t.hour, t.day, t.month, (t.weekday() + 1) % 7]
    for field_val, cron_val in zip(fields, parts):
        if not cron_field_matches(field_val, cron_val):
            return False
    return True

def was_due_recently(cron_expr, tz_name, window_minutes=6):
    try:
        now = datetime.now(ZoneInfo(tz_name))
    except Exception:
        now = datetime.now(timezone.utc)
    for offset in range(window_minutes):
        t = (now - timedelta(minutes=offset)).replace(second=0, microsecond=0)
        if cron_matches_time(cron_expr, t):
            return t
    return None

for b in briefs:
    due_at = was_due_recently(b['cron_expression'], b.get('timezone', 'UTC'))
    if due_at:
        # Dedup via last_run_at: skip if already ran within this cron window
        last_run = b.get('last_run_at')
        if last_run:
            try:
                lr = datetime.fromisoformat(last_run.replace('Z', '+00:00'))
                due_utc = due_at.astimezone(timezone.utc)
                # If last_run is after the due time, already fired
                if lr >= due_utc:
                    continue
            except Exception:
                pass
        print(f'{b[\"id\"]}|{b[\"name\"]}')
" 2>/dev/null | while IFS='|' read -r BRIEF_ID BRIEF_NAME; do
  log "Brief due: ${BRIEF_NAME} (${BRIEF_ID})"

  # Update last_run_at immediately to prevent double-firing
  KEY=$(_sb_key)
  curl -s -X PATCH "${PIF_SUPABASE_URL}/rest/v1/briefs?id=eq.${BRIEF_ID}" \
    -H "apikey: ${KEY}" \
    -H "Authorization: Bearer ${KEY}" \
    -H "Content-Type: application/json" \
    -H "Prefer: return=minimal" \
    -d "{\"last_run_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" >/dev/null 2>&1

  # Determine which script to run based on brief name
  case "$BRIEF_NAME" in
    morning*)
      SCRIPT=~/scripts/morning-brief.sh
      ;;
    evening*)
      SCRIPT=~/scripts/evening-standup.sh
      ;;
    weekly*)
      SCRIPT=~/scripts/weekly-review.sh
      ;;
    nightly*)
      SCRIPT=~/scripts/nightly-consolidation.sh
      ;;
    *)
      # Custom briefs default to morning-brief style (gather + summarize + deliver)
      SCRIPT=~/scripts/morning-brief.sh
      ;;
  esac

  # Spawn as independent transient systemd unit — survives dispatcher service exit
  systemd-run --no-block --unit="brief-${BRIEF_NAME}-${BRIEF_ID:0:8}" \
    --setenv=HOME=/root \
    bash "$SCRIPT" --brief-id "$BRIEF_ID" >> "$LOG" 2>&1
  log "Started ${BRIEF_NAME} (unit: brief-${BRIEF_NAME}-${BRIEF_ID:0:8})"
done

log "Dispatcher check complete"
