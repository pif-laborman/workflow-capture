#!/bin/bash
# brief-dispatcher.sh — Queries all enabled briefs and runs any that are due.
# Called by the schedule checker every minute (via Supabase schedules).
#
# For each enabled brief with a delivery_target, checks if the cron matches
# the current time and runs the appropriate script.
#
# Usage: ~/scripts/brief-dispatcher.sh

set -euo pipefail
source ~/.pif-env
source ~/scripts/brief-lib.sh

LOG="/root/logs/brief-dispatcher.log"
TS=$(date '+%Y-%m-%d %H:%M')

log() { echo "${TS} — $1" >> "$LOG"; }

# Fetch all enabled briefs with a delivery target
BRIEFS=$(sb_get "briefs?enabled=eq.true&delivery_target=not.is.null&select=id,name,cron_expression,timezone" 2>/dev/null) || {
  log "Failed to fetch briefs"
  exit 1
}

# Check if any are due
echo "$BRIEFS" | python3 -c "
import sys, json
from datetime import datetime, timezone
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

def cron_matches_now(cron_expr, tz_name):
    parts = cron_expr.strip().split()
    if len(parts) != 5:
        return False
    try:
        now = datetime.now(ZoneInfo(tz_name))
    except Exception:
        now = datetime.now(timezone.utc)
    fields = [now.minute, now.hour, now.day, now.month, (now.weekday() + 1) % 7]
    for field_val, cron_val in zip(fields, parts):
        if not cron_field_matches(field_val, cron_val):
            return False
    return True

for b in briefs:
    if cron_matches_now(b['cron_expression'], b.get('timezone', 'UTC')):
        print(f'{b[\"id\"]}|{b[\"name\"]}')
" 2>/dev/null | while IFS='|' read -r BRIEF_ID BRIEF_NAME; do
  log "Brief due: ${BRIEF_NAME} (${BRIEF_ID})"

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

  # Run in background so one brief doesn't block others
  bash "$SCRIPT" --brief-id "$BRIEF_ID" >> "$LOG" 2>&1 &
  log "Started ${BRIEF_NAME} (pid $!)"
done

log "Dispatcher check complete"
