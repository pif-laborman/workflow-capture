#!/bin/bash
# nightly-consolidation.sh — QMD Phase 4
# Reads today's daily note + session transcripts, extracts durable knowledge
# into ~/life/ PARA files, syncs auto-memory, rebuilds QMD index.
# Runs at 2:30 AM CET (1:30 AM UTC) via Supabase schedule.

set -euo pipefail

source ~/.pif-env

LOG="/root/logs/nightly-consolidation.log"
TS=$(date '+%Y-%m-%d %H:%M')
TODAY=$(date +%Y-%m-%d)

log() { echo "${TS} — $1" >> "$LOG"; }

log "Starting nightly consolidation for ${TODAY}"

# Kill any stale consolidation processes (>20 min old)
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

DAILY_NOTE="$HOME/memory/daily/${TODAY}.md"
if [ ! -f "$DAILY_NOTE" ]; then
    log "No daily note for ${TODAY} — nothing to consolidate"
    exit 0
fi

# Check if daily note has meaningful content (more than just the header)
LINE_COUNT=$(wc -l < "$DAILY_NOTE")
if [ "$LINE_COUNT" -lt 5 ]; then
    log "Daily note too short (${LINE_COUNT} lines) — skipping"
    exit 0
fi

TIMEOUT=600
MAX_TURNS=15

PROMPT=$(cat <<'PROMPT_EOF'
You are Pif Laborman running nightly knowledge consolidation. Your job is to extract durable facts from today's daily note and update the knowledge graph in ~/life/.

## Instructions

1. Read today's daily note: ~/memory/daily/TODAY_DATE.md
2. Read all ~/life/ files (projects/, areas/, resources/) to understand current state
3. Read ~/memory/WORKING.md for operational context
4. For each significant event or learning in the daily note, decide:
   - Is this a **durable fact** (will still be true next week)? → Update the relevant ~/life/ file
   - Is this **ephemeral** (task status, session-specific)? → Skip it
   - Is this a **new entity** not yet tracked? → Create a new file in the right PARA category
5. After all updates, update ~/.claude/projects/-/memory/MEMORY.md (auto-memory) with any changes to the condensed snapshot
6. Run: qmd update
7. Print CONSOLIDATION_RESULT with a brief summary of what was updated

## Rules
- Do NOT duplicate information already in ~/life/ files — only add genuinely new facts
- Do NOT include timestamps or session-specific details in ~/life/ files — those belong in daily notes
- Keep ~/life/ files factual and concise — entity summaries, not event logs
- If nothing new is worth extracting, say so and skip the writes
- Do NOT modify daily notes or WORKING.md — those are not your responsibility here

## Examples of durable facts
- "Apify account created, username quintillionth_labyrinth, free plan $5/mo"
- "Mission Control API runs on port 8091, nginx proxies from 8090"
- "GOG People API is now enabled in GCP console"

## Examples of ephemeral (skip these)
- "Run #15 is currently in planner step"
- "Heartbeat triage timed out at 15:00"
- "Synced credentials from root to ralph"
PROMPT_EOF
)

# Replace TODAY_DATE placeholder
PROMPT="${PROMPT//TODAY_DATE/$TODAY}"

# Allow spawning claude from within another claude session (e.g. during testing)
unset CLAUDECODE 2>/dev/null || true

log "Running Claude consolidation (timeout ${TIMEOUT}s, max-turns ${MAX_TURNS})"

OUTPUT=$(timeout "${TIMEOUT}s" claude -p "$PROMPT" \
    --model sonnet \
    --output-format text \
    --permission-mode dontAsk \
    --no-session-persistence \
    --max-turns "$MAX_TURNS" \
    2>>"$LOG") || {
    EXIT_CODE=$?
    if [ "$EXIT_CODE" -eq 124 ]; then
        log "ERROR: Consolidation timed out after ${TIMEOUT}s"
    else
        log "ERROR: Claude exited with code ${EXIT_CODE}"
    fi
    exit 1
}

log "Consolidation output: $(echo "$OUTPUT" | tail -5)"

# Always rebuild QMD index as a safety net (Claude should do it too, but belt + suspenders)
qmd update >> "$LOG" 2>&1 || log "WARN: qmd update failed (non-fatal)"

log "Nightly consolidation complete for ${TODAY}"
