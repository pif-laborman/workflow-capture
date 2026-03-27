#!/bin/bash
# ensure-daily-note.sh — Create today's daily note if it doesn't exist
# Usage: ~/scripts/ensure-daily-note.sh                     # Pif (admin) only
#        ~/scripts/ensure-daily-note.sh --all-tenants       # All provisioned tenants
#        ~/scripts/ensure-daily-note.sh --tenant-id <uuid>  # Specific tenant
# Called by cron at midnight and by workflows that need today's note.

set -euo pipefail

source ~/.pif-env

ADMIN_UUID="c2818981-bcb9-4fde-83d8-272d72c7a3d1"
TODAY=$(date +%Y-%m-%d)

create_daily_note() {
  local NOTE_DIR="$1"
  local NOTE_PATH="${NOTE_DIR}/${TODAY}.md"

  if [ -f "$NOTE_PATH" ]; then
    echo "Daily note already exists: $NOTE_PATH"
    return 0
  fi

  mkdir -p "$NOTE_DIR"
  cat > "$NOTE_PATH" << TEMPLATE
# Daily Note — ${TODAY}

## Events

## Tasks

## Notes

TEMPLATE

  # Match ownership to parent dir (so tenant users can write)
  local OWNER
  OWNER=$(stat -c '%U:%G' "$NOTE_DIR" 2>/dev/null) || true
  if [ -n "$OWNER" ] && [ "$OWNER" != "root:root" ]; then
    chown "$OWNER" "$NOTE_PATH"
  fi

  echo "Created daily note: $NOTE_PATH"
}

resolve_tenant_dir() {
  local TID="$1"
  if [ "$TID" = "$ADMIN_UUID" ]; then
    echo "$HOME/memory/daily"
    return
  fi
  local INSTANCE
  INSTANCE=$(curl -s "${PIF_SUPABASE_URL}/rest/v1/tenants?id=eq.${TID}&select=instance_name" \
    -H "apikey: ${PIF_SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Authorization: Bearer ${PIF_SUPABASE_SERVICE_ROLE_KEY}" \
    | python3 -c "import sys,json; rows=json.loads(sys.stdin.read()); print(rows[0].get('instance_name','') if rows else '')" 2>/dev/null) || true
  if [ -n "$INSTANCE" ] && [ -d "/home/$INSTANCE" ]; then
    echo "/home/$INSTANCE/memory/daily"
  else
    echo "$HOME/tenants/${TID}/memory/daily"  # fallback
  fi
}

# --- Parse args ---
MODE="admin"
TENANT_ID=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --all-tenants) MODE="all"; shift ;;
    --tenant-id) MODE="single"; TENANT_ID="$2"; shift 2 ;;
    *) shift ;;
  esac
done

case "$MODE" in
  admin)
    create_daily_note "$HOME/memory/daily"
    ;;
  single)
    NOTE_DIR=$(resolve_tenant_dir "$TENANT_ID")
    create_daily_note "$NOTE_DIR"
    ;;
  all)
    # Admin first
    create_daily_note "$HOME/memory/daily"
    # All active tenants from Supabase
    TENANTS=$(curl -s "${PIF_SUPABASE_URL}/rest/v1/tenants?select=id,instance_name&status=neq.pending_onboarding" \
      -H "apikey: ${PIF_SUPABASE_SERVICE_ROLE_KEY}" \
      -H "Authorization: Bearer ${PIF_SUPABASE_SERVICE_ROLE_KEY}" \
      | python3 -c "
import sys, json
rows = json.loads(sys.stdin.read())
for r in rows:
    tid = r.get('id','')
    inst = r.get('instance_name','')
    if tid and inst:
        print(f'{tid} {inst}')
" 2>/dev/null) || true
    while IFS=' ' read -r TID INSTANCE; do
      [ "$TID" = "$ADMIN_UUID" ] && continue
      [ -d "/home/$INSTANCE" ] || continue
      create_daily_note "/home/$INSTANCE/memory/daily"
    done <<< "$TENANTS"
    ;;
esac
