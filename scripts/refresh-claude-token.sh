#\!/bin/bash
# Refresh Claude OAuth token for root (admin agents, Ralph, pif).
# Runs every ~50 min via Supabase schedule → pif-runner.
#
# Tenant tokens are refreshed by the MC server's claude-config endpoint
# (via refreshTenantTokensIfNeeded in helpers.ts) on every session spawn.
# This script only handles root, which runs claude -p directly without
# going through the session pool.
#
# Strategy:
#   1. Read refresh_token from credentials.json
#   2. POST to platform.claude.com/v1/oauth/token directly
#   3. Write new access_token + refresh_token back to credentials.json
#   4. Sync to Ralph and admin tenant pif (same Pavol account)
#   5. On failure, retry once then alert (dedup — max 1 per hour)

export PATH="/root/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
export HOME=/root
LOG=/root/logs/token-refresh.log
ERR_LOG=/root/logs/token-refresh-errors.log
ALERT_STAMP=/tmp/token-refresh-last-alert
CREDS=/root/.claude/.credentials.json
LAST_TOKEN_FILE=/tmp/token-refresh-last-written
CLIENT_ID="9d1c250a-e61b-44d9-88ed-5944d1962f5e"
TOKEN_URL="https://platform.claude.com/v1/oauth/token"

log() { echo "$(date -u '+%Y-%m-%d %H:%M:%S') - $1" >> "$LOG"; }

log "Refreshing Claude token..."

# --- Direct OAuth refresh via Python ---
attempt_refresh() {
    python3 << 'PYEOF'
import json, sys, urllib.request, urllib.error, time, os, shutil, traceback

try:
    CREDS = os.environ["CREDS_PATH"]
    CLIENT_ID = os.environ["CLIENT_ID"]
    TOKEN_URL = os.environ["TOKEN_URL"]

    with open(CREDS) as f:
        creds = json.load(f)

    oauth = creds.get("claudeAiOauth", {})
    refresh_token = oauth.get("refreshToken")
    if not refresh_token:
        print("ERROR: No refreshToken in credentials", file=sys.stderr)
        sys.exit(1)

    payload = json.dumps({
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": CLIENT_ID,
    }).encode()

    req = urllib.request.Request(
        TOKEN_URL,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "claude-cli/1.0",
            "Accept": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"HTTP {e.code}: {body}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Request failed: {e}", file=sys.stderr)
        sys.exit(1)

    if "access_token" not in data:
        print(f"No access_token in response: {list(data.keys())}", file=sys.stderr)
        sys.exit(1)

    oauth["accessToken"] = data["access_token"]
    if "refresh_token" in data:
        oauth["refreshToken"] = data["refresh_token"]
    if "expires_in" in data:
        oauth["expiresAt"] = int(time.time() * 1000) + (data["expires_in"] * 1000)

    creds["claudeAiOauth"] = oauth

    tmp = CREDS + ".tmp"
    with open(tmp, "w") as f:
        json.dump(creds, f, indent=2)
    shutil.move(tmp, CREDS)
    os.chmod(CREDS, 0o600)
    # Restore ACL so ralph can read via symlink (chmod wipes ACLs)
    import subprocess as _acl_sp
    _acl_sp.run(["setfacl", "-m", "u:ralph:rw,m::rw", CREDS],
                capture_output=True, timeout=5)

    ttl_min = data.get("expires_in", 0) / 60
    print(f"OK access={data['access_token'][:15]}... ttl={ttl_min:.0f}min")
except SystemExit:
    raise
except Exception:
    traceback.print_exc(file=sys.stderr)
    sys.exit(1)
PYEOF
}

export CREDS_PATH="$CREDS" CLIENT_ID TOKEN_URL

# --- Drift detection: did something else change the token? ---
if [ -f "$LAST_TOKEN_FILE" ]; then
    EXPECTED_TOKEN=$(cat "$LAST_TOKEN_FILE" 2>/dev/null)
    CURRENT_TOKEN=$(python3 -c "import json; print(json.load(open('$CREDS')).get('claudeAiOauth',{}).get('accessToken','')[:30])" 2>/dev/null)
    if [ -n "$EXPECTED_TOKEN" ] && [ -n "$CURRENT_TOKEN" ] && [ "$EXPECTED_TOKEN" != "$CURRENT_TOKEN" ]; then
        log "TOKEN DRIFT DETECTED! Expected $EXPECTED_TOKEN, found $CURRENT_TOKEN — another process refreshed the token"
    fi
fi

# First attempt
RESULT=$(attempt_refresh 2>/tmp/token-refresh-stderr)
EXIT_CODE=$?

# Retry once on failure — preserve first error, re-read creds
if [ $EXIT_CODE -ne 0 ]; then
    FIRST_ERR=$(cat /tmp/token-refresh-stderr 2>/dev/null)
    log "First attempt failed (exit $EXIT_CODE): $FIRST_ERR — retrying in 5s..."
    sleep 5
    RESULT=$(attempt_refresh 2>/tmp/token-refresh-stderr)
    EXIT_CODE=$?
fi

if [ $EXIT_CODE -eq 0 ]; then
    log "Token refreshed successfully — $RESULT"
    # Save token prefix for drift detection
    python3 -c "import json; print(json.load(open('$CREDS')).get('claudeAiOauth',{}).get('accessToken','')[:30])" > "$LAST_TOKEN_FILE" 2>/dev/null

    # Ralph's credentials.json is a symlink to root's — no copy needed.
    # Only sync if someone broke the symlink (fallback).
    RALPH_CREDS="/home/ralph/.claude/.credentials.json"
    if [ -L "$RALPH_CREDS" ]; then
        log "Ralph credentials symlinked — no sync needed"
    elif [ -f "$CREDS" ]; then
        cp "$CREDS" "$RALPH_CREDS" 2>/dev/null
        chown ralph:ralph "$RALPH_CREDS" 2>/dev/null
        chmod 600 "$RALPH_CREDS" 2>/dev/null
        log "Synced credentials to Ralph (symlink missing — copied instead)"
    fi

    # Pif is a tenant — credentials managed by MC server's claude-config endpoint
    # via tenant_claude_credentials table. Do NOT copy root's token here — it
    # would invalidate the DB's refresh token and break the DB-backed flow.

    rm -f "$ALERT_STAMP"
else
    STDERR_CONTENT=""
    if [ -f /tmp/token-refresh-stderr ]; then
        STDERR_CONTENT=$(cat /tmp/token-refresh-stderr 2>/dev/null)
    fi
    # Include first attempt error if different
    FULL_ERR="$STDERR_CONTENT"
    if [ -n "${FIRST_ERR:-}" ] && [ "$FIRST_ERR" \!= "$STDERR_CONTENT" ]; then
        FULL_ERR="attempt1: $FIRST_ERR | attempt2: $STDERR_CONTENT"
    fi
    echo "$(date -u '+%Y-%m-%d %H:%M:%S') - Exit $EXIT_CODE: $FULL_ERR" >> "$ERR_LOG"
    log "Token refresh failed (exit $EXIT_CODE): $FULL_ERR"

    SHOULD_ALERT=true
    if [ -f "$ALERT_STAMP" ]; then
        LAST_ALERT=$(cat "$ALERT_STAMP" 2>/dev/null)
        NOW=$(date +%s)
        DIFF=$((NOW - LAST_ALERT))
        if [ $DIFF -lt 3600 ]; then
            SHOULD_ALERT=false
        fi
    fi

    if [ "$SHOULD_ALERT" = true ]; then
        ~/scripts/telegram-send.sh "⚠️ Claude token refresh failed (exit $EXIT_CODE): $FULL_ERR"
        date +%s > "$ALERT_STAMP"
    fi
fi

# Tenant tokens are NOT refreshed here — the MC server handles them
# via refreshTenantTokensIfNeeded() on every claude-config call.
