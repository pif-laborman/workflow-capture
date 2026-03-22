#!/bin/bash
# telegram-send.sh — Send a message via Telegram Bot API
# Usage: ~/scripts/telegram-send.sh "Your message here"
#        ~/scripts/telegram-send.sh --chat-id 123456789 "Your message here"
# Called by workflow steps and brief scripts to deliver results.

set -euo pipefail

source ~/.pif-env

# Fetch Telegram creds from pif-creds if not in env
if [ -z "${PIF_TELEGRAM_TOKEN:-}" ] || [ -z "${PIF_TELEGRAM_USER_ID:-}" ]; then
    _TG_JSON=$(pif-creds get "Telegram Bot" --json 2>/dev/null || echo '{}')
    PIF_TELEGRAM_TOKEN="${PIF_TELEGRAM_TOKEN:-$(echo "$_TG_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('password',''))" 2>/dev/null)}"
    PIF_TELEGRAM_USER_ID="${PIF_TELEGRAM_USER_ID:-$(echo "$_TG_JSON" | python3 -c "import sys,json; import re; n=json.load(sys.stdin).get('notes',''); m=re.search(r'\d{5,}', n); print(m.group() if m else '')" 2>/dev/null)}"
fi

# Parse --chat-id flag
CHAT_ID="${PIF_TELEGRAM_USER_ID}"
if [ "${1:-}" = "--chat-id" ]; then
    CHAT_ID="${2:-}"
    shift 2
fi

MESSAGE="${1:-}"

if [ -z "$MESSAGE" ]; then
    echo "Usage: telegram-send.sh [--chat-id ID] \"message\"" >&2
    exit 1
fi

# Telegram Bot API sendMessage
# Try Markdown first, fall back to plain text if parsing fails
RESPONSE=$(curl -s -X POST "https://api.telegram.org/bot${PIF_TELEGRAM_TOKEN}/sendMessage" \
    -d chat_id="${CHAT_ID}" \
    -d parse_mode="HTML" \
    --data-urlencode text="${MESSAGE}")

OK=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('ok', False))" 2>/dev/null || echo "False")

if [ "$OK" = "True" ]; then
    echo "Message sent successfully"
else
    # HTML parse failed — retry without parse_mode (plain text)
    echo "HTML send failed, retrying as plain text..." >&2
    RESPONSE=$(curl -s -X POST "https://api.telegram.org/bot${PIF_TELEGRAM_TOKEN}/sendMessage" \
        -d chat_id="${CHAT_ID}" \
        --data-urlencode text="${MESSAGE}")

    OK=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('ok', False))" 2>/dev/null || echo "False")

    if [ "$OK" = "True" ]; then
        echo "Message sent successfully (plain text fallback)"
    else
        echo "Failed to send message: $RESPONSE" >&2
        exit 1
    fi
fi
