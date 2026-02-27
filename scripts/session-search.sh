#!/bin/bash
# session-search.sh — Search across Pif's session history
# Sources: Claude Code JSONL transcripts, Telegram bot.db, history.jsonl
#
# Usage:
#   session-search.sh <query> [--source all|jsonl|bot|history] [--recent N_DAYS]

set -euo pipefail

QUERY="${1:?Usage: session-search.sh <query> [--source all|jsonl|bot|history] [--recent N_DAYS]}"
SOURCE="all"
RECENT_DAYS=0

shift
while [[ $# -gt 0 ]]; do
  case "$1" in
    --source) SOURCE="$2"; shift 2 ;;
    --recent) RECENT_DAYS="$2"; shift 2 ;;
    *) shift ;;
  esac
done

JSONL_DIR="$HOME/.claude/projects/-root"
HISTORY="$HOME/.claude/history.jsonl"
BOT_DB="$HOME/data/bot.db"
INDEX_FILE="$HOME/.claude/session-index.txt"

echo "=== Session Search: \"${QUERY}\" ==="
echo ""

# 1. Search history.jsonl (lightweight — user prompts only)
if [[ "$SOURCE" == "all" || "$SOURCE" == "history" ]]; then
  echo "--- History Index (user prompts) ---"
  FOUND=0
  grep -i "$QUERY" "$HISTORY" 2>/dev/null | python3 -c "
import sys, json
from datetime import datetime
for line in sys.stdin:
    try:
        obj = json.loads(line)
        ts = obj.get('timestamp', 0)
        dt = datetime.fromtimestamp(ts/1000).strftime('%Y-%m-%d %H:%M')
        sid = obj.get('sessionId', '?')[:8]
        display = obj.get('display', '')[:120]
        print(f'  [{dt}] ({sid}...) {display}')
    except: pass
" && FOUND=1 || true
  [[ "$FOUND" -eq 0 ]] && echo "  (no matches)"
  echo ""
fi

# 2. Search bot.db (Telegram conversations)
if [[ "$SOURCE" == "all" || "$SOURCE" == "bot" ]]; then
  echo "--- Telegram Bot Messages ---"
  if [[ -f "$BOT_DB" ]]; then
    RECENT_FILTER=""
    if [[ "$RECENT_DAYS" -gt 0 ]]; then
      RECENT_FILTER="AND timestamp >= datetime('now', '-${RECENT_DAYS} days')"
    fi
    RESULTS=$(sqlite3 "$BOT_DB" "
      SELECT datetime(timestamp) as ts,
             substr(session_id, 1, 8) as sid,
             substr(prompt, 1, 150) as prompt_preview
      FROM messages
      WHERE (prompt LIKE '%$(echo "$QUERY" | sed "s/'/''/g")%'
             OR response LIKE '%$(echo "$QUERY" | sed "s/'/''/g")%')
      ${RECENT_FILTER}
      ORDER BY timestamp DESC
      LIMIT 10;
    " 2>/dev/null || true)
    if [[ -n "$RESULTS" ]]; then
      echo "$RESULTS" | while IFS='|' read -r ts sid preview; do
        echo "  [${ts}] (${sid}...) ${preview}"
      done
    else
      echo "  (no matches)"
    fi
  else
    echo "  (bot.db not found)"
  fi
  echo ""
fi

# 3. Search JSONL session files (full transcripts)
if [[ "$SOURCE" == "all" || "$SOURCE" == "jsonl" ]]; then
  echo "--- Session Transcripts (JSONL) ---"
  MATCHES=0
  for f in "$JSONL_DIR"/*.jsonl; do
    [ -f "$f" ] || continue
    [[ "$(basename "$f")" == "history.jsonl" ]] && continue

    # If --recent, skip old files by modification time
    if [[ "$RECENT_DAYS" -gt 0 ]]; then
      FILE_AGE=$(( ($(date +%s) - $(stat -c %Y "$f")) / 86400 ))
      [[ "$FILE_AGE" -gt "$RECENT_DAYS" ]] && continue
    fi

    SID=$(basename "$f" .jsonl)
    HITS=$(grep -ic "$QUERY" "$f" 2>/dev/null || true)
    HITS=${HITS:-0}
    if [[ "$HITS" -gt 0 ]]; then
      FILE_DATE=$(date -d @"$(stat -c %Y "$f")" +%Y-%m-%d 2>/dev/null || echo "unknown")
      FILE_SIZE=$(du -h "$f" | cut -f1)
      echo "  Session ${SID:0:8}... (${FILE_DATE}, ${HITS} matches, ${FILE_SIZE})"
      # Show first 3 matching context snippets
      grep -i "$QUERY" "$f" 2>/dev/null | head -3 | python3 -c "
import sys, json
query = '${QUERY}'.lower()
for line in sys.stdin:
    try:
        obj = json.loads(line)
        msg = obj.get('message', {})
        content = msg.get('content', '')
        if isinstance(content, list):
            content = ' '.join(str(c) for c in content)
        content = str(content)
        role = msg.get('role', obj.get('type', '?'))
        idx = content.lower().find(query)
        if idx >= 0:
            start = max(0, idx - 60)
            end = min(len(content), idx + len(query) + 60)
            snippet = content[start:end].replace('\n', ' ')
            print(f'    [{role}] ...{snippet}...')
    except: pass
" 2>/dev/null || true
      MATCHES=$((MATCHES + 1))
    fi
  done
  [[ "$MATCHES" -eq 0 ]] && echo "  (no matches)"
  echo ""
fi

# 4. Search session index if it exists
if [[ -f "$INDEX_FILE" && ("$SOURCE" == "all" || "$SOURCE" == "index") ]]; then
  echo "--- Session Index (summaries) ---"
  grep -i "$QUERY" "$INDEX_FILE" 2>/dev/null | head -10 || echo "  (no matches)"
  echo ""
fi

echo "=== Search complete ==="
