#!/bin/bash
# Post-commit hook: log recent commits so briefs have fresh ground truth.
# Appends to ~/memory/.recent-commits.log — brief generator reads this
# to know what shipped since last brief, even if WORKING.md is stale.

LOG="$HOME/memory/.recent-commits.log"
REPO=$(basename "$(git rev-parse --show-toplevel 2>/dev/null)")
HASH=$(git rev-parse --short HEAD)
MSG=$(git log -1 --pretty=format:%s)
TS=$(date +%Y-%m-%dT%H:%M:%S)

echo "[$TS] $REPO $HASH $MSG" >> "$LOG"

# Keep only last 50 entries to prevent unbounded growth
if [ "$(wc -l < "$LOG")" -gt 50 ]; then
    tail -50 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi
