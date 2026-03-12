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
BOT_STATUS=$(systemctl is-active claude-telegram 2>/dev/null || echo "unknown")
DISK_FREE=$(df -h / | tail -1 | awk '{print $4}')
RAM_FREE=$(free -h | grep Mem | awk '{print $3 " / " $2}')
UPTIME_INFO=$(uptime -p 2>/dev/null || echo "unknown")

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
        \"tenant_id\": \"${TENANT_ID}\"
    }")

if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
    echo "Heartbeat sent to Supabase (bot=${BOT_STATUS}, disk=${DISK_FREE}, ram=${RAM_FREE})"
else
    echo "ERROR: Heartbeat insert failed (HTTP ${HTTP_CODE})"
fi

# Ping external uptime monitor (if configured)
if [ -n "$UPTIME_PING_URL" ]; then
    curl -s "$UPTIME_PING_URL" > /dev/null
    echo "Pinged uptime monitor"
else
    echo "No uptime ping URL configured (PIF_UPTIME_PING_URL not set)"
fi
