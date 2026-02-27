#!/bin/bash
# pif-heartbeat.sh — Two-stage proactive heartbeat
# Stage 1: Haiku triages infra + workflow health + tasks (cheap, fast)
# Stage 2: Opus acts on one task if found (only when there's real work)
# Runs hourly via cron. Alerts Pavol via Telegram only when needed.

set -euo pipefail

source ~/.pif-env

LOG="/root/logs/pif-heartbeat.log"
TS=$(date '+%Y-%m-%d %H:%M')

log() { echo "${TS} — $1" >> "$LOG"; }

# ─── DND-aware Telegram send ───────────────────────────────────────
# Suppresses notifications midnight–7 AM CET. Heartbeat still runs.
notify() {
    local CET_HOUR=$(TZ="Europe/Prague" date '+%H')
    if [ "$CET_HOUR" -ge 0 ] && [ "$CET_HOUR" -lt 7 ]; then
        log "DND (${CET_HOUR}:xx CET): suppressed message: ${1:0:100}"
        return 0
    fi
    ~/scripts/telegram-send.sh "$1"
}

# ─── Kill stale heartbeat processes ──────────────────────────────────
# Previous runs may have hung. Kill any heartbeat claude processes older than 30 min.
STALE_PIDS=$(pgrep -f "pif-heartbeat" -d ' ' | tr ' ' '\n' | grep -v "^$$\$" || true)
if [ -n "$STALE_PIDS" ]; then
    for pid in $STALE_PIDS; do
        # Check if process is older than 30 minutes
        if [ -d "/proc/$pid" ]; then
            AGE_SEC=$(( $(date +%s) - $(stat -c %Y /proc/$pid) ))
            if [ "$AGE_SEC" -gt 1800 ]; then
                kill -9 "$pid" 2>/dev/null && log "Killed stale heartbeat process $pid (age: ${AGE_SEC}s)"
                # Also kill any child processes
                pkill -9 -P "$pid" 2>/dev/null || true
            fi
        fi
    done
fi

HAIKU_TIMEOUT=180
HAIKU_MAX_TURNS=4

JSON_SCHEMA='{"type":"object","properties":{"alerts":{"type":"array","items":{"type":"string"}},"task":{"anyOf":[{"type":"object","properties":{"id":{"type":"string"},"title":{"type":"string"},"description":{"type":"string"}},"required":["id","title"]},{"type":"null"}]}},"required":["alerts","task"]}'

# ─── Stage 0: Run Antfarm Medic ──────────────────────────────────────
# Medic handles workflow-level health (stuck steps, stalled/zombie runs).
# Run it first so Haiku triage has fresh data in antfarm_medic_checks.

log "Stage 0: Running antfarm medic"
antfarm medic run >>"$LOG" 2>&1 || log "WARN: antfarm medic run failed (non-fatal)"

# ─── Stage 1: Haiku Triage ───────────────────────────────────────────

log "Stage 1: Haiku triage starting"

RAW=$(timeout "${HAIKU_TIMEOUT}s" claude --model haiku \
  -p "Read ~/agents/pif/HEARTBEAT.md. It contains ONE bash command that gathers all data — run it in a single tool call. Then evaluate the output and return structured JSON. Do not split into multiple commands." \
  --output-format json \
  --json-schema "$JSON_SCHEMA" \
  --permission-mode dontAsk \
  --no-session-persistence \
  --max-turns "$HAIKU_MAX_TURNS" \
  2>>"$LOG") || {
    EXIT_CODE=$?
    if [ "$EXIT_CODE" -eq 124 ]; then
        log "ERROR: Haiku triage timed out after ${HAIKU_TIMEOUT}s"
        notify "Pif Heartbeat: Haiku triage timed out (${HAIKU_TIMEOUT}s). Check logs."
    else
        log "ERROR: Haiku triage failed (exit $EXIT_CODE)"
        notify "Pif Heartbeat: Haiku triage failed. Check logs."
    fi
    exit 1
}

# Extract structured_output from the wrapper JSON
PARSED=$(python3 -c "
import sys, json
raw = sys.stdin.read().strip()
if not raw:
    print('PARSE_ERROR: empty output from Haiku', file=sys.stderr)
    sys.exit(1)
try:
    wrapper = json.loads(raw)
    # Check for max_turns exhaustion — means Haiku didn't finish
    if wrapper.get('subtype') == 'error_max_turns':
        print(f'PARSE_ERROR: Haiku hit max_turns ({wrapper.get(\"num_turns\", \"?\")} turns, cost \${wrapper.get(\"total_cost_usd\", \"?\")})', file=sys.stderr)
        sys.exit(1)
    data = wrapper.get('structured_output') or wrapper.get('result')
    if isinstance(data, str):
        data = json.loads(data)
    if not isinstance(data, dict) or 'alerts' not in data:
        raise ValueError(f'Missing alerts field in: {json.dumps(data)[:200]}')
    print(json.dumps(data))
except json.JSONDecodeError as e:
    print(f'PARSE_ERROR: invalid JSON: {e}', file=sys.stderr)
    print(raw[:500], file=sys.stderr)
    sys.exit(1)
except Exception as e:
    print(f'PARSE_ERROR: {e}', file=sys.stderr)
    print(raw[:500], file=sys.stderr)
    sys.exit(1)
" <<< "$RAW" 2>>"$LOG") || {
    log "ERROR: Could not parse Haiku output"
    log "Raw output: ${RAW:0:500}"
    # Don't spam Telegram on every failure — only alert if this is the 3rd consecutive miss
    FAIL_COUNT_FILE="/tmp/pif-heartbeat-fail-count"
    FAIL_COUNT=$(cat "$FAIL_COUNT_FILE" 2>/dev/null || echo 0)
    FAIL_COUNT=$((FAIL_COUNT + 1))
    echo "$FAIL_COUNT" > "$FAIL_COUNT_FILE"
    if [ "$FAIL_COUNT" -ge 3 ]; then
        notify "Pif Heartbeat: Haiku triage failed ${FAIL_COUNT}x in a row. Check logs."
        echo 0 > "$FAIL_COUNT_FILE"
    else
        log "Parse failure #${FAIL_COUNT} — suppressing Telegram alert (threshold: 3)"
    fi
    exit 1
}

# Reset consecutive failure counter on success
echo 0 > /tmp/pif-heartbeat-fail-count

# Extract alerts count and task presence
ALERT_COUNT=$(python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(len(d['alerts']))" <<< "$PARSED")
HAS_TASK=$(python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print('yes' if d['task'] else 'no')" <<< "$PARSED")

log "Triage result: ${ALERT_COUNT} alerts, task=${HAS_TASK}"

# ─── Stage 1.5: Auto-resolve before alerting ────────────────────────
# Try to fix things ourselves. Only alert Pavol on what we can't handle.

if [ "$ALERT_COUNT" -gt 0 ]; then
    PARSED=$(python3 -c "
import sys, json, subprocess

d = json.loads(sys.stdin.read())
remaining = []

for alert in d['alerts']:
    resolved = False
    a = alert.lower()

    # Auto-restart nginx
    if 'nginx' in a and ('not active' in a or 'down' in a or 'inactive' in a):
        r = subprocess.run(['systemctl', 'start', 'nginx'], capture_output=True, timeout=15)
        if r.returncode == 0:
            resolved = True

    # Auto-restart mission-control-api
    elif 'mission control api' in a or 'mc_api' in a or 'mission-control-api' in a:
        r = subprocess.run(['systemctl', 'start', 'mission-control-api'], capture_output=True, timeout=15)
        if r.returncode == 0:
            resolved = True

    # GOG failure — try token refresh
    elif 'gog' in a or 'google tools' in a:
        # Attempt gog auth refresh
        r = subprocess.run(['gog', 'auth', 'refresh'], capture_output=True, timeout=30)
        if r.returncode == 0:
            # Verify it works now
            v = subprocess.run(['gog', 'gmail', 'search', 'test', '--limit', '1'],
                             capture_output=True, timeout=30)
            if v.returncode == 0:
                resolved = True

    # Auto-resume failed antfarm runs (max 3 resumes per run to prevent infinite loops)
    elif 'antfarm run' in a and 'failed' in a:
        import re
        m = re.search(r'#(\d+)\s+.*?\(([0-9a-f]{8})\)', alert)
        if m:
            run_id = m.group(2)
            counter_file = f'/tmp/antfarm-resume-{run_id}'
            try:
                count = int(open(counter_file).read().strip())
            except: count = 0
            if count >= 3:
                pass  # Don't resolve — let the alert reach Pavol
            else:
                r = subprocess.run(['antfarm', 'workflow', 'resume', run_id], capture_output=True, timeout=30)
                if r.returncode == 0:
                    open(counter_file, 'w').write(str(count + 1))
                    import os
                    sb_url = os.environ.get('PIF_SUPABASE_URL', '')
                    sb_key = os.environ.get('PIF_SUPABASE_SERVICE_ROLE_KEY', '')
                    if not sb_key:
                        try:
                            import subprocess as _sp2
                            sb_key = _sp2.run(['pif-creds', 'get', 'Supabase'], capture_output=True, text=True, check=True).stdout.strip()
                        except: pass
                    if sb_url and sb_key:
                        import urllib.request
                        req = urllib.request.Request(
                            f'{sb_url}/rest/v1/schedules?id=eq.antfarm-dispatch',
                            data=b'{\"enabled\": true}',
                            headers={'apikey': sb_key, 'Authorization': f'Bearer {sb_key}',
                                     'Content-Type': 'application/json', 'Prefer': 'return=minimal'},
                            method='PATCH')
                        try: urllib.request.urlopen(req, timeout=10)
                        except: pass
                    resolved = True

    if not resolved:
        remaining.append(alert)

d['alerts'] = remaining
print(json.dumps(d))
" <<< "$PARSED" 2>>"$LOG") || {
        log "WARN: Auto-resolve script failed, keeping original alerts"
    }

    # Recount after auto-resolution
    ALERT_COUNT=$(python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(len(d['alerts']))" <<< "$PARSED")
    log "After auto-resolve: ${ALERT_COUNT} alerts remaining"
fi

# ─── Send alerts if any remain after auto-resolve ────────────────────

if [ "$ALERT_COUNT" -gt 0 ]; then
    ALERT_MSG=$(python3 -c "
import sys, json
d = json.loads(sys.stdin.read())
lines = ['*Pif Heartbeat*'] + ['- ' + a for a in d['alerts']]
print('\n'.join(lines))
" <<< "$PARSED")
    notify "$ALERT_MSG"
    log "Alerts sent to Telegram"
fi

# ─── Stage 2: Opus Action (only if task found) ───────────────────────

if [ "$HAS_TASK" = "no" ]; then
    log "No task to act on. All clear."
    exit 0
fi

TASK_TITLE=$(python3 -c "import sys,json; print(json.loads(sys.stdin.read())['task']['title'])" <<< "$PARSED")

log "Stage 2: Spawning full Pif session for task '${TASK_TITLE}'"

# No timeout — stale process cleanup at top of script handles hangs (>30 min)
claude \
  -p "Heartbeat triggered. Haiku triage found a task you can work on: '${TASK_TITLE}'. Check the task queue in Supabase and work through what you can. Follow your normal autonomy boundaries from SOUL.md." \
  --permission-mode dontAsk \
  --no-session-persistence \
  >>"$LOG" 2>&1 || {
    log "ERROR: Pif session failed (exit $?)"
    notify "Pif Heartbeat: Session failed on task '${TASK_TITLE}'. Check logs."
    exit 1
}

log "Stage 2 complete: Pif session finished"
