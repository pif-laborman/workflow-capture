#!/bin/bash
# health-report.sh — System health report to Supabase + external uptime monitor ping
# Usage: ~/scripts/health-report.sh
# Runs every 5 minutes via Supabase schedule. Writes health data to Supabase heartbeats
# table and pings external uptime monitor (dead-man's switch).

set -euo pipefail

source ~/.pif-env

SUPABASE_URL="$PIF_SUPABASE_URL"
SUPABASE_KEY="${PIF_SUPABASE_SERVICE_ROLE_KEY:-$(pif-creds get Supabase 2>/dev/null)}"
UPTIME_PING_URL="${PIF_UPTIME_PING_URL:-$(pif-creds get 'Uptime Monitoring (Healthchecks.io)' 2>/dev/null)}"

# Gather health data
BOT_STATUS=$(systemctl is-active meetpif-messaging 2>/dev/null || echo "unknown")
DISK_FREE=$(df -h / | tail -1 | awk '{print $4}')
RAM_FREE=$(free -h | grep Mem | awk '{print $3 " / " $2}')
UPTIME_INFO=$(uptime -p 2>/dev/null || echo "unknown")

# Per-adapter liveness checks
# Comments: check liveness file age (written every 30s by watchdog)
COMMENTS_STATUS="unknown"
if [ -f /var/lib/meetpif-messaging/adapter-comments-alive ]; then
    ALIVE_AGE=$(( $(date +%s) - $(stat -c %Y /var/lib/meetpif-messaging/adapter-comments-alive) ))
    if [ "$ALIVE_AGE" -lt 120 ]; then
        COMMENTS_STATUS="active"
    else
        COMMENTS_STATUS="stale (${ALIVE_AGE}s)"
    fi
elif systemctl is-active meetpif-messaging &>/dev/null; then
    COMMENTS_STATUS="no-liveness-file"
fi

# Telegram: check journal for recent getUpdates (runs every 10s)
TG_LAST=$(journalctl -u meetpif-messaging.service --since "5 minutes ago" --no-pager 2>/dev/null | grep -c "getUpdates" || true)
if [ "$TG_LAST" -gt 0 ]; then
    TELEGRAM_STATUS="active"
else
    TELEGRAM_STATUS="stale"
fi

# Slack: check journal for recent Socket Mode session
SLACK_LAST=$(journalctl -u meetpif-messaging.service --since "2 hours ago" --no-pager 2>/dev/null | grep -c "slack_bolt" || true)
if [ "$SLACK_LAST" -gt 0 ]; then
    SLACK_STATUS="active"
else
    SLACK_STATUS="stale"
fi

ADAPTER_STATUS="tg=${TELEGRAM_STATUS},comments=${COMMENTS_STATUS},slack=${SLACK_STATUS}"

# Write heartbeat to Supabase
TENANT_ID="${PIF_TENANT_ID:-c2818981-bcb9-4fde-83d8-272d72c7a3d1}"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${SUPABASE_URL}/rest/v1/heartbeats" \
    -H "apikey: ${SUPABASE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_KEY}" \
    -H "Content-Type: application/json" \
    -H "Prefer: return=minimal" \
    -d "{
        \"bot_status\": \"${BOT_STATUS}\",
        \"disk_free\": \"${DISK_FREE}\",
        \"ram_free\": \"${RAM_FREE}\",
        \"uptime\": \"${UPTIME_INFO}\",
        \"tenant_id\": \"${TENANT_ID}\",
        \"ollama_status\": \"${ADAPTER_STATUS}\"
    }")

if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
    echo "Heartbeat sent (bot=${BOT_STATUS}, adapters=${ADAPTER_STATUS}, disk=${DISK_FREE})"
else
    echo "ERROR: Heartbeat insert failed (HTTP ${HTTP_CODE})"
fi

# Alert on stale adapters (dedup: max 1 alert per hour per adapter)
for ADAPTER_CHECK in "comments:${COMMENTS_STATUS}" "telegram:${TELEGRAM_STATUS}" "slack:${SLACK_STATUS}"; do
    ADAPTER_NAME="${ADAPTER_CHECK%%:*}"
    ADAPTER_VAL="${ADAPTER_CHECK##*:}"
    ALERT_STAMP="/tmp/adapter-alert-${ADAPTER_NAME}"
    if [ "$ADAPTER_VAL" != "active" ] && [ "$ADAPTER_VAL" != "unknown" ]; then
        if [ ! -f "$ALERT_STAMP" ] || [ $(( $(date +%s) - $(stat -c %Y "$ALERT_STAMP") )) -gt 3600 ]; then
            touch "$ALERT_STAMP"
            echo "ALERT: ${ADAPTER_NAME} adapter is ${ADAPTER_VAL}"
            # Send Telegram alert
            bash ~/scripts/telegram-send.sh "⚠️ Adapter *${ADAPTER_NAME}* is *${ADAPTER_VAL}*. Service: meetpif-messaging" 2>/dev/null || true
        fi
    else
        rm -f "$ALERT_STAMP" 2>/dev/null
    fi
done

# Ping external uptime monitor (if configured)
if [ -n "$UPTIME_PING_URL" ]; then
    curl -s "$UPTIME_PING_URL" > /dev/null
    echo "Pinged uptime monitor"
else
    echo "No uptime ping URL configured (PIF_UPTIME_PING_URL not set)"
fi
