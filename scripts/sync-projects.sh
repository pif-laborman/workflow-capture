#!/bin/bash
# sync-projects.sh — Sync ~/projects/ directories to Supabase projects table
# VPS is source of truth. Creates missing entries, removes orphans.
# Runs via Supabase schedule.

set -euo pipefail
source ~/.pif-env

PROJECTS_DIR="$HOME/projects"
API="${PIF_SUPABASE_URL}/rest/v1"
_SB_KEY="${PIF_SUPABASE_SERVICE_ROLE_KEY:-$(pif-creds get Supabase 2>/dev/null)}"
HEADERS=(-H "apikey: ${_SB_KEY}" \
         -H "Authorization: Bearer ${_SB_KEY}" \
         -H "Content-Type: application/json" \
         -H "Prefer: return=representation")

# Random color palette for new projects
COLORS=("#6366f1" "#f59e0b" "#10b981" "#ef4444" "#8b5cf6" "#ec4899" "#14b8a6" "#f97316")

# 1. Get directory slugs from VPS
VPS_SLUGS=()
for dir in "$PROJECTS_DIR"/*/; do
  [ -d "$dir" ] || continue
  slug=$(basename "$dir")
  VPS_SLUGS+=("$slug")
done

# 2. Get project slugs from Supabase
SUPABASE_PROJECTS=$(curl -s "$API/projects?select=id,slug" "${HEADERS[@]}")
SUPABASE_SLUGS=$(echo "$SUPABASE_PROJECTS" | python3 -c "
import sys, json
for p in json.load(sys.stdin):
    print(p['slug'])
" 2>/dev/null || true)

# 3. Create missing projects in Supabase
for slug in "${VPS_SLUGS[@]}"; do
  if ! echo "$SUPABASE_SLUGS" | grep -qx "$slug"; then
    # Generate a display name from slug
    name=$(echo "$slug" | sed 's/-/ /g' | python3 -c "import sys; print(sys.stdin.read().strip().title())")
    color=${COLORS[$((RANDOM % ${#COLORS[@]}))]}

    curl -s -X POST "$API/projects" "${HEADERS[@]}" \
      -d "{\"name\": \"$name\", \"slug\": \"$slug\", \"color\": \"$color\"}" > /dev/null
    echo "Created: $slug ($name)"

    # Log event
    curl -s -X POST "$API/events" "${HEADERS[@]}" \
      -d "{\"type\": \"project_synced\", \"source\": \"sync-projects\", \"data\": {\"slug\": \"$slug\", \"action\": \"created\"}}" > /dev/null
  fi
done

# 4. Remove orphan projects from Supabase (no matching directory)
for supabase_slug in $SUPABASE_SLUGS; do
  found=false
  for vps_slug in "${VPS_SLUGS[@]}"; do
    if [[ "$supabase_slug" == "$vps_slug" ]]; then
      found=true
      break
    fi
  done

  if [[ "$found" == "false" ]]; then
    # Check for tasks attached to this project before removing
    project_id=$(echo "$SUPABASE_PROJECTS" | python3 -c "
import sys, json
for p in json.load(sys.stdin):
    if p['slug'] == '$supabase_slug':
        print(p['id'])
        break
" 2>/dev/null)

    task_count=$(curl -s "$API/tasks?project_id=eq.$project_id&select=id" \
      "${HEADERS[@]}" 2>/dev/null | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")

    if [[ "$task_count" -gt 0 ]]; then
      echo "Orphan kept (has $task_count tasks): $supabase_slug"
    else
      curl -s -X DELETE "$API/projects?slug=eq.$supabase_slug" "${HEADERS[@]}" > /dev/null
      echo "Removed orphan: $supabase_slug"
    fi
  fi
done

echo "Sync complete"
