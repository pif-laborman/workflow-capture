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

# ─── Kill stale claude processes ─────────────────────────────────────
# Previous Stage 2 runs may have hung (V8 busy-spin after completing work).
# Match actual claude/node processes owned by current user, not the script name.
# IMPORTANT: Exclude processes that are children of any telegram bot service —
# those are active bot sessions, not stale leftovers.
BOT_PIDS=""
for svc in claude-telegram.service meetpif-telegram.service; do
    _pid=$(systemctl show -p MainPID "$svc" 2>/dev/null | cut -d= -f2)
    [ -n "$_pid" ] && [ "$_pid" != "0" ] && BOT_PIDS="$BOT_PIDS $_pid"
done
STALE_PIDS=$(pgrep -u "$(id -u)" -f "claude" -d ' ' 2>/dev/null | tr ' ' '\n' | grep -v "^$$\$" || true)
if [ -n "$STALE_PIDS" ]; then
    for pid in $STALE_PIDS; do
        if [ -d "/proc/$pid" ]; then
            # Skip if this process is a telegram bot or a descendant of one
            IS_BOT_CHILD=false
            for BOT_PID in $BOT_PIDS; do
                if [ "$pid" = "$BOT_PID" ]; then
                    IS_BOT_CHILD=true
                    break
                fi
                # Walk up the process tree to check ancestry
                WALK_PID="$pid"
                for _ in 1 2 3 4 5; do
                    WALK_PPID=$(ps -o ppid= -p "$WALK_PID" 2>/dev/null | tr -d ' ')
                    if [ -z "$WALK_PPID" ] || [ "$WALK_PPID" = "1" ] || [ "$WALK_PPID" = "0" ]; then
                        break
                    fi
                    if [ "$WALK_PPID" = "$BOT_PID" ]; then
                        IS_BOT_CHILD=true
                        break
                    fi
                    WALK_PID="$WALK_PPID"
                done
                [ "$IS_BOT_CHILD" = true ] && break
            done
            if [ "$IS_BOT_CHILD" = true ]; then
                continue
            fi

            AGE_SEC=$(( $(date +%s) - $(stat -c %Y /proc/$pid) ))
            if [ "$AGE_SEC" -gt 1800 ]; then
                log "Killing stale claude process $pid (age: ${AGE_SEC}s)"
                kill "$pid" 2>/dev/null || true
                sleep 5
                # Force kill if still alive
                if [ -d "/proc/$pid" ]; then
                    kill -9 "$pid" 2>/dev/null && log "Force-killed $pid (ignored SIGTERM)"
                fi
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
# Antfarm needs PIF_SUPABASE_SERVICE_ROLE_KEY (not in .pif-env — fetch via pif-creds).

# ─── Stage 0a: Ralph credential symlink health ───────────────────────
# If symlink broke (e.g. file was delete+recreated), recreate it
if [ ! -L /home/ralph/.claude/.credentials.json ]; then
    log "WARN: Ralph credentials symlink missing — recreating"
    rm -f /home/ralph/.claude/.credentials.json
    ln -s /root/.claude/.credentials.json /home/ralph/.claude/.credentials.json
    setfacl -m u:ralph:rw /root/.claude/.credentials.json
    setfacl -m u:ralph:x /root/.claude
    notify "Pif Heartbeat: Ralph credential symlink was broken — recreated."
fi

# ─── Stage 0b: Telegram bot patch health ─────────────────────────────
# Detect if patches drifted (e.g. accidental uv tool upgrade)
if ! bash /root/scripts/apply-patches.sh --check >>"$LOG" 2>&1; then
    log "WARN: Telegram bot patches missing — re-applying"
    bash /root/scripts/apply-patches.sh >>"$LOG" 2>&1 && \
        systemctl restart claude-telegram.service && \
        notify "Pif Heartbeat: telegram bot patches were missing — re-applied and restarted." || \
        notify "Pif Heartbeat: telegram bot patches missing and re-apply FAILED. Manual intervention needed."
fi

log "Stage 0: Running antfarm medic"
export PIF_SUPABASE_SERVICE_ROLE_KEY="${PIF_SUPABASE_SERVICE_ROLE_KEY:-$(pif-creds get Supabase 2>/dev/null)}"
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

# ─── Stage 1.75: Append to daily note ─────────────────────────────
# Gather last-hour activity from all sources and append to today's daily note.
# Pure bash + python — no AI call, just structured facts.

TIMEZONE="${PIF_TIMEZONE:-Europe/Prague}"
DAILY_NOTE="$HOME/memory/daily/$(TZ="$TIMEZONE" date +%Y-%m-%d).md"
HOUR_AGO=$(date -u -d '1 hour ago' '+%Y-%m-%d %H:%M:%S')
HOUR_TAG=$(TZ="$TIMEZONE" date '+%H:%M')

export PIF_HEARTBEAT_TZ="$TIMEZONE"
NOTE_LINES=$(python3 << 'PYEOF'
import json, os, sqlite3, subprocess, sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

lines = []
now = datetime.now(timezone.utc)
hour_ago = now - timedelta(hours=1)
hour_ago_iso = hour_ago.strftime("%Y-%m-%dT%H:%M:%SZ")

# Use tenant timezone to compute local-date boundary in UTC
# This prevents writing yesterday's messages into today's daily note
import subprocess as _tz_sp
_tz = os.environ.get("PIF_HEARTBEAT_TZ", "UTC")
_tz_env = {**os.environ, "TZ": _tz}
_local_date = _tz_sp.run(["date", "+%Y-%m-%d"], capture_output=True, text=True, env=_tz_env).stdout.strip()
_local_midnight_utc = _tz_sp.run(
    ["date", "-u", "-d", f"TZ=\"{_tz}\" {_local_date} 00:00:00", "+%Y-%m-%dT%H:%M:%S+00:00"],
    capture_output=True, text=True
).stdout.strip()

# Last heartbeat marker — used to avoid re-appending messages from previous heartbeat
_marker_file = os.path.expanduser("~/.cache/pif-heartbeat-last-ts")
try:
    _last_ts = open(_marker_file).read().strip()
except Exception:
    _last_ts = hour_ago_iso.replace("Z", "+00:00")

# Use the later of: last heartbeat marker or 1 hour ago
_cutoff = max(_last_ts, hour_ago.strftime("%Y-%m-%dT%H:%M:%S+00:00"))
# But never earlier than local midnight (prevents yesterday bleed)
_cutoff = max(_cutoff, _local_midnight_utc)

# 1. Telegram messages since last heartbeat (no overlap, no yesterday bleed)
try:
    db = sqlite3.connect(os.path.expanduser("~/data/bot.db"))
    rows = db.execute(
        "SELECT timestamp, substr(prompt, 1, 120) as p "
        "FROM messages WHERE timestamp > ? ORDER BY timestamp",
        (_cutoff,)
    ).fetchall()
    db.close()
    if rows:
        lines.append("Telegram:")
        for ts, p in rows:
            # ts is ISO with tz — extract HH:MM in local time
            try:
                from datetime import datetime as _dt
                _utc_dt = _dt.fromisoformat(ts.replace("+00:00", "+00:00"))
                # Convert to tenant timezone for display
                _local_ts = _tz_sp.run(
                    ["date", "-d", _utc_dt.strftime("%Y-%m-%d %H:%M:%S UTC"), "+%H:%M"],
                    capture_output=True, text=True, env=_tz_env
                ).stdout.strip()
            except Exception:
                _local_ts = ts[11:16]
            short = p.strip().replace("\n", " ")
            lines.append(f"  - [{_local_ts}] {short}")
except Exception:
    pass

# 2. Git commits from last hour (both repos)
for repo, label in [("/root", "pif-infra"), ("/opt/assistant-platform", "assistant-platform")]:
    try:
        result = subprocess.run(
            ["git", "-C", repo, "log", f"--after={hour_ago_iso}", "--oneline", "--all"],
            capture_output=True, text=True, timeout=5
        )
        commits = [l.strip() for l in result.stdout.strip().split("\n") if l.strip()]
        if commits:
            lines.append(f"Commits ({label}):")
            for c in commits:
                lines.append(f"  - {c}")
    except Exception:
        pass

# 3. Task status changes from last hour
try:
    sb_url = os.environ.get("PIF_SUPABASE_URL", "")
    sb_key = os.environ.get("PIF_SUPABASE_SERVICE_ROLE_KEY", "")
    if not sb_key:
        r = subprocess.run(["pif-creds", "get", "Supabase"], capture_output=True, text=True, timeout=5)
        sb_key = r.stdout.strip()
    if sb_url and sb_key:
        import urllib.request
        url = f"{sb_url}/rest/v1/tasks?select=title,status&updated_at=gte.{hour_ago_iso}&order=updated_at.desc&limit=10"
        req = urllib.request.Request(url, headers={
            "apikey": sb_key, "Authorization": f"Bearer {sb_key}"
        })
        resp = urllib.request.urlopen(req, timeout=10)
        tasks = json.loads(resp.read())
        if tasks:
            lines.append("Task changes:")
            for t in tasks:
                lines.append(f"  - [{t['status']}] {t['title'][:80]}")
except Exception:
    pass

# 4. Session transcripts modified in last hour (extract first user prompt as topic)
try:
    session_dir = Path.home() / ".claude" / "projects" / "-root"
    hour_ago_ts = hour_ago.timestamp()
    recent = []
    for f in session_dir.glob("*.jsonl"):
        if f.stat().st_mtime >= hour_ago_ts:
            # Extract first user message as topic
            with open(f) as fh:
                for line in fh:
                    try:
                        obj = json.loads(line)
                        msg = obj.get("message", {})
                        if msg.get("role") == "user":
                            content = msg.get("content", "")
                            if isinstance(content, list):
                                content = " ".join(
                                    c.get("text", "") if isinstance(c, dict) else str(c)
                                    for c in content
                                )
                            content = content.strip().replace("\n", " ")[:100]
                            if content and not content.startswith("<"):
                                recent.append(content)
                            break
                    except Exception:
                        continue
    if recent:
        lines.append("Active sessions:")
        for topic in recent[:5]:  # max 5
            lines.append(f"  - {topic}")
except Exception:
    pass

# 5. New tenants created today (daily running total)
try:
    if sb_url and sb_key:
        _today_iso = _local_date + "T00:00:00Z"
        url = f"{sb_url}/rest/v1/tenants?select=name,created_at&created_at=gte.{_today_iso}&order=created_at.asc"
        req = urllib.request.Request(url, headers={
            "apikey": sb_key, "Authorization": f"Bearer {sb_key}"
        })
        resp = urllib.request.urlopen(req, timeout=10)
        new_tenants = json.loads(resp.read())
        if new_tenants:
            lines.append(f"New tenants today ({len(new_tenants)}):")
            for t in new_tenants:
                lines.append(f"  - {t['name']}")
except Exception:
    pass

# 6. Workflow events from last hour
try:
    if sb_url and sb_key:
        url = (f"{sb_url}/rest/v1/events?type=in.(workflow_started,workflow_completed,workflow_failed)"
               f"&created_at=gte.{hour_ago_iso}&order=created_at.asc&limit=10")
        req = urllib.request.Request(url, headers={
            "apikey": sb_key, "Authorization": f"Bearer {sb_key}"
        })
        resp = urllib.request.urlopen(req, timeout=10)
        events = json.loads(resp.read())
        if events:
            lines.append("Workflows:")
            for e in events:
                src = e.get("source", "").replace("workflow:", "")
                lines.append(f"  - {e['type'].replace('workflow_', '')} {src}")
except Exception:
    pass

# Save current timestamp as marker for next heartbeat (dedup)
os.makedirs(os.path.expanduser("~/.cache"), exist_ok=True)
with open(os.path.expanduser("~/.cache/pif-heartbeat-last-ts"), "w") as _mf:
    _mf.write(now.strftime("%Y-%m-%dT%H:%M:%S+00:00"))

if lines:
    print("\n".join(lines))
else:
    print("")
PYEOF
)

if [ -n "$NOTE_LINES" ] && [ "$NOTE_LINES" != "" ]; then
    # Only append if there's actual content
    echo "" >> "$DAILY_NOTE"
    echo "## ~${HOUR_TAG} — heartbeat" >> "$DAILY_NOTE"
    echo "$NOTE_LINES" >> "$DAILY_NOTE"
    log "Appended hourly update to daily note"
else
    log "No activity in last hour — skipping daily note append"
fi

# ─── Stage 1.75b: Refresh WORKING.md ──────────────────────────────────
# Haiku reads current WORKING.md + today's daily note, outputs a refreshed
# version that reflects actual current state. Cheap (~1 Haiku call), prevents
# the evening standup from regurgitating stale "In flight" / "Blockers".

WORKING_REFRESH_TIMEOUT=120

WORKING_FILE="$HOME/memory/WORKING.md"
if [ -f "$WORKING_FILE" ] && [ -f "$DAILY_NOTE" ]; then
    TODAY_FORMATTED=$(TZ="$TIMEZONE" date '+%Y-%m-%d')
    WORKING_PROMPT_FILE=$(mktemp /tmp/working-refresh-XXXXX.txt)
    cat > "$WORKING_PROMPT_FILE" <<WORKING_PROMPT
You are refreshing WORKING.md to reflect the current state. Today is ${TODAY_FORMATTED}.

Rules:
- Update the date header to today
- Move completed items out of "Active / In Progress" — if today's notes show something shipped/deployed/merged, it's done
- Keep "Active / In Progress" items that still have outstanding work
- Update "Awaiting Pavol" only if today's notes show a decision was made
- Do NOT add new items — only reclassify existing ones based on evidence in today's notes
- Do NOT change "Improvement Proposals Queue" — leave it as-is
- Keep the same markdown structure and section headers
- Be concise — this is a state document, not a narrative

Current WORKING.md:
$(cat "$WORKING_FILE")

Today's daily note (evidence of what happened today):
$(cat "$DAILY_NOTE")

Output ONLY the updated WORKING.md content. No preamble, no explanation.
WORKING_PROMPT

    REFRESHED=$(timeout "${WORKING_REFRESH_TIMEOUT}s" cat "$WORKING_PROMPT_FILE" | \
      claude --model haiku --print --no-session-persistence 2>>"$LOG") || {
        log "WARN: WORKING.md refresh failed (non-fatal)"
        REFRESHED=""
    }
    rm -f "$WORKING_PROMPT_FILE"

    if [ -n "$REFRESHED" ] && [ ${#REFRESHED} -gt 100 ]; then
        echo "$REFRESHED" > "$WORKING_FILE"
        log "WORKING.md refreshed by Haiku (${#REFRESHED} chars)"
    else
        log "WORKING.md refresh skipped — output too short or empty"
    fi
fi

# ─── Stage 2: Opus Action (only if task found) ───────────────────────

if [ "$HAS_TASK" = "no" ]; then
    log "No task to act on. All clear."
    exit 0
fi

TASK_TITLE=$(python3 -c "import sys,json; print(json.loads(sys.stdin.read())['task']['title'])" <<< "$PARSED")

log "Stage 2: Spawning full Pif session for task '${TASK_TITLE}'"

STAGE2_TIMEOUT=1800  # 30 minutes max

timeout "${STAGE2_TIMEOUT}s" claude \
  -p "Heartbeat triggered. Haiku triage found a task you can work on: '${TASK_TITLE}'. Check the task queue in Supabase and work through what you can. Follow your normal autonomy boundaries from SOUL.md." \
  --permission-mode dontAsk \
  --no-session-persistence \
  >>"$LOG" 2>&1 || {
    EXIT_CODE=$?
    if [ "$EXIT_CODE" -eq 124 ]; then
        log "ERROR: Stage 2 timed out after ${STAGE2_TIMEOUT}s on task '${TASK_TITLE}'"
        notify "Pif Heartbeat: Stage 2 timed out (${STAGE2_TIMEOUT}s) on '${TASK_TITLE}'. Killing."
        # timeout -s TERM already sent; force-kill any lingering children
        pkill -9 -P $! 2>/dev/null || true
    else
        log "ERROR: Pif session failed (exit $EXIT_CODE)"
        notify "Pif Heartbeat: Session failed on task '${TASK_TITLE}'. Check logs."
    fi
    exit 1
}

log "Stage 2 complete: Pif session finished"
