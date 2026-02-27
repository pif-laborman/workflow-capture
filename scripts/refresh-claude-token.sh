#!/bin/bash
export PATH="/root/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
export HOME=/root

echo "$(date -u '+%Y-%m-%d %H:%M:%S') - Refreshing Claude token..." >> /root/logs/token-refresh.log

timeout 120 claude -p "say ok" --max-turns 1 > /dev/null 2>&1
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    echo "$(date -u '+%Y-%m-%d %H:%M:%S') - Token refreshed successfully" >> /root/logs/token-refresh.log
else
    echo "$(date -u '+%Y-%m-%d %H:%M:%S') - Token refresh failed (exit $EXIT_CODE)" >> /root/logs/token-refresh.log
fi
