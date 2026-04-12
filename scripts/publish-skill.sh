#!/usr/bin/env bash
# publish-skill.sh - Publish a Claude skill to the meetpif marketplace
# Usage: bash ~/scripts/publish-skill.sh <slug> [--dry-run]
#
# Does everything:
# 1. Reads SKILL.md from ~/.claude/skills/<slug>/
# 2. Generates DR-copy-quality marketplace copy via claude CLI
# 3. Creates Stripe product + price ($9)
# 4. Inserts marketplace_products row in Supabase
# 5. Copies skill to MC library
# 6. Adds entry to manifest.json
# 7. Restarts mission-control-api
#
# Requires: ~/.pif-env, pif-creds, claude CLI, jq, curl

set -euo pipefail

SLUG="${1:-}"
MODE="${2:-}"
PRICE_CENTS=900
SKILL_DIR="$HOME/.claude/skills/$SLUG"
MC_LIBRARY="/opt/assistant-platform/mc/skills/library"
MANIFEST="/opt/assistant-platform/mc/skills/manifest.json"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[publish]${NC} $1"; }
warn() { echo -e "${YELLOW}[publish]${NC} $1"; }
fail() { echo -e "${RED}[publish]${NC} $1"; exit 1; }

# Validation
[ -z "$SLUG" ] && fail "Usage: publish-skill.sh <slug> [--dry-run|--update]"
[ ! -f "$SKILL_DIR/SKILL.md" ] && fail "No SKILL.md at $SKILL_DIR/SKILL.md"

# Load env
source ~/.pif-env
SERVICE_KEY=$(pif-creds get "Supabase")
STRIPE_KEY=$(pif-creds get "Stripe")

# Extract frontmatter
SKILL_NAME=$(sed -n '/^---$/,/^---$/p' "$SKILL_DIR/SKILL.md" | grep '^name:' | sed 's/^name: *//' | tr -d '"')
SKILL_DESC=$(sed -n '/^---$/,/^---$/p' "$SKILL_DIR/SKILL.md" | grep '^description:' | sed 's/^description: *//' | tr -d '"')

[ -z "$SKILL_NAME" ] && fail "Could not extract 'name' from SKILL.md frontmatter"
[ -z "$SKILL_DESC" ] && fail "Could not extract 'description' from SKILL.md frontmatter"

log "Skill: $SKILL_NAME ($SLUG)"
log "Description: $SKILL_DESC"

# UPDATE MODE: regenerate copy + sync files for an existing marketplace product
if [ "$MODE" = "--update" ]; then
  log "UPDATE mode: regenerating marketplace copy and syncing files..."

  # Verify it exists
  EXISTING=$(curl -s "$PIF_SUPABASE_URL/rest/v1/marketplace_products?slug=eq.$SLUG&select=slug,id" \
    -H "apikey: $PIF_SUPABASE_ANON_KEY" -H "Authorization: Bearer $SERVICE_KEY")
  if echo "$EXISTING" | python3 -c "import sys,json; d=json.load(sys.stdin); exit(1 if d else 0)" 2>/dev/null; then
    fail "Skill '$SLUG' not found in marketplace. Use publish-skill.sh without --update to create it."
  fi

  # Sync skill files to MC library
  mkdir -p "$MC_LIBRARY/$SLUG"
  # Use cp -f to handle hardlinked files (same inode = same file)
  cp -rf "$SKILL_DIR"/* "$MC_LIBRARY/$SLUG/" 2>/dev/null || {
    # If cp fails (e.g. same file), check if content matches
    if diff -q "$SKILL_DIR/SKILL.md" "$MC_LIBRARY/$SLUG/SKILL.md" >/dev/null 2>&1; then
      log "Files already in sync (hardlinked)"
    else
      fail "Failed to sync files to $MC_LIBRARY/$SLUG/"
    fi
  }
  log "Synced files to $MC_LIBRARY/$SLUG/"

  # Update manifest description (in case frontmatter changed)
  python3 -c "
import json
with open('$MANIFEST') as f:
    manifest = json.load(f)
for s in manifest['skills']:
    if s['id'] == '$SLUG':
        s['description'] = '''$SKILL_DESC'''
        break
with open('$MANIFEST', 'w') as f:
    json.dump(manifest, f, indent=2)
    f.write('\n')
print('Manifest updated')
"

  # Regenerate marketplace copy, detect category, update Supabase (reuses same flow below)
  # Falls through to copy generation, then patches instead of inserts
  UPDATE_EXISTING=true
  # Continue to category detection and copy generation...
fi

# Check if already published (only for new publishes)
if [ "${UPDATE_EXISTING:-}" != "true" ]; then
  EXISTING=$(curl -s "$PIF_SUPABASE_URL/rest/v1/marketplace_products?slug=eq.$SLUG&select=slug" \
    -H "apikey: $PIF_SUPABASE_ANON_KEY" -H "Authorization: Bearer $SERVICE_KEY")
  if echo "$EXISTING" | python3 -c "import sys,json; d=json.load(sys.stdin); exit(0 if d else 1)" 2>/dev/null; then
    fail "Skill '$SLUG' already exists in marketplace. Use --update to refresh copy, or delete it first."
  fi
fi

# Detect category from description or skill content
CATEGORY=$(python3 -c "
desc = '''$SKILL_DESC'''.lower()
content_start = open('$SKILL_DIR/SKILL.md').read()[:500].lower()
combined = desc + ' ' + content_start
if any(w in combined for w in ['copy', 'write', 'blog', 'newsletter', 'headline', 'voice', 'content']):
    print('writing')
elif any(w in combined for w in ['seo', 'outreach', 'email', 'linkedin', 'instagram', 'story', 'marketing', 'lead']):
    print('marketing')
elif any(w in combined for w in ['ui', 'ux', 'design', 'font', 'deck', 'slide', 'visual', 'frontend', 'css', 'video', 'seedance']):
    print('design')
elif any(w in combined for w in ['strategy', 'prd', 'validate', 'business', 'clone', 'plan']):
    print('strategy')
else:
    print('development')
")

log "Category: $CATEGORY"

# Generate marketplace copy via Claude
log "Generating marketplace copy..."

# Write prompt to temp file to avoid bash quoting hell
PROMPT_FILE=$(mktemp /tmp/skill_prompt_XXXXX.txt)
cat > "$PROMPT_FILE" << PROMPTEOF
You are a direct response copywriter. Your ONLY job is to output a JSON object. No explanation, no questions, no preamble. Just the JSON.

Here is a Claude Code skill file. Write marketplace product copy for it.

SKILL NAME: $SKILL_NAME
SKILL DESCRIPTION: $SKILL_DESC

SKILL CONTENT (first 100 lines):
$(head -100 "$SKILL_DIR/SKILL.md")

Respond with ONLY this JSON (fill in every field):
{"title": "<2-4 word human title>", "tagline": "<punchy hook under 80 chars, creates curiosity or contrast>", "description": "<250-400 chars, story-driven. Open with the pain or status quo. Show what changes. Be specific. No jargon.>", "capabilities": ["<specific capability 1>", "<specific capability 2>", "<specific capability 3>", "<specific capability 4>"]}

Rules: never use comprehensive/robust/cutting-edge/leverage/utilize/streamline/delve. Never use em dashes. Write like a smart friend selling this, not a product manager describing it. Tagline must create desire or fear of missing out. Description must open with a problem. Capabilities must be specific and concrete.

YOUR RESPONSE MUST BE ONLY THE JSON OBJECT. NO OTHER TEXT.
PROMPTEOF

COPY_PROMPT=$(cat "$PROMPT_FILE")
rm -f "$PROMPT_FILE"

# Write parser to temp file (avoids bash quoting issues with regex)
PARSER_SCRIPT=$(mktemp /tmp/parse_copy_XXXXX.py)
cat > "$PARSER_SCRIPT" << 'PYEOF'
import sys, json, re
raw = sys.stdin.read().strip()
# Strip system-reminder tags that claude CLI may inject
raw = re.sub(r'<system-reminder>.*?</system-reminder>', '', raw, flags=re.DOTALL).strip()
# Strip markdown fences
raw = re.sub(r'^```json\s*', '', raw)
raw = re.sub(r'\s*```\s*$', '', raw)
raw = raw.strip()
# Find the JSON object in the output
match = re.search(r'\{[\s\S]*\}', raw)
if not match:
    print(f"ERROR: No JSON found in output: {raw[:200]}", file=sys.stderr)
    sys.exit(1)
parsed = json.loads(match.group())
assert len(parsed.get('tagline', '')) <= 100, 'Tagline too long'
assert len(parsed.get('capabilities', [])) == 4, 'Need exactly 4 capabilities'
print(json.dumps(parsed))
PYEOF

CLAUDE_RAW=$(echo "$COPY_PROMPT" | claude --print --model opus 2>/dev/null || true)
if [ -z "$CLAUDE_RAW" ]; then
  fail "Claude CLI returned empty output. Check API availability."
fi
COPY_JSON=$(echo "$CLAUDE_RAW" | python3 "$PARSER_SCRIPT")
rm -f "$PARSER_SCRIPT"

if [ -z "$COPY_JSON" ]; then
  fail "Failed to generate marketplace copy. Claude output was empty or invalid."
fi

TITLE=$(echo "$COPY_JSON" | jq -r '.title')
TAGLINE=$(echo "$COPY_JSON" | jq -r '.tagline')
DESCRIPTION=$(echo "$COPY_JSON" | jq -r '.description')

log "Title: $TITLE"
log "Tagline: $TAGLINE"
log "Description: $(echo "$DESCRIPTION" | head -c 80)..."

if [ "$MODE" = "--dry-run" ]; then
  warn "DRY RUN: would create Stripe product, Supabase row, manifest entry, and MC library copy"
  echo ""
  echo "$COPY_JSON" | python3 -m json.tool
  exit 0
fi

if [ "${UPDATE_EXISTING:-}" = "true" ]; then
  # UPDATE: patch the existing marketplace row with new copy
  log "Updating marketplace product copy..."
  SUPA_PAYLOAD=$(echo "$COPY_JSON" | python3 -c "
import sys, json
copy = json.load(sys.stdin)
payload = {
    'title': copy['title'],
    'tagline': copy['tagline'],
    'description': copy['description'],
    'capabilities': copy['capabilities'],
    'category': '$CATEGORY'
}
print(json.dumps(payload))
")
  UPDATE_RESULT=$(curl -s -X PATCH "$PIF_SUPABASE_URL/rest/v1/marketplace_products?slug=eq.$SLUG" \
    -H "apikey: $PIF_SUPABASE_ANON_KEY" \
    -H "Authorization: Bearer $SERVICE_KEY" \
    -H "Content-Type: application/json" \
    -H "Prefer: return=representation" \
    -d "$SUPA_PAYLOAD")
  PRODUCT_ID=$(echo "$UPDATE_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])" 2>/dev/null)
  [ -z "$PRODUCT_ID" ] && fail "Supabase update failed: $UPDATE_RESULT"
  log "Updated marketplace product: $PRODUCT_ID"

  # Restart API
  log "Restarting mission-control-api..."
  systemctl restart mission-control-api
  sleep 2
  if systemctl is-active --quiet mission-control-api; then
    log "API restarted successfully"
  else
    warn "API restart may have failed. Check: systemctl status mission-control-api"
  fi

  echo ""
  echo -e "${GREEN}=== Updated: $TITLE ===${NC}"
  echo "  Slug:      $SLUG"
  echo "  Tagline:   $TAGLINE"
  echo "  Files:     synced to $MC_LIBRARY/$SLUG/"
  echo "  Manifest:  updated"
  echo "  Copy:      refreshed"
  echo ""
  exit 0
fi

# NEW PUBLISH: create Stripe product, price, Supabase row, manifest entry, MC library copy

# Create Stripe product
log "Creating Stripe product..."
STRIPE_PRODUCT=$(curl -s https://api.stripe.com/v1/products \
  -u "$STRIPE_KEY:" \
  -d "name=$TITLE" \
  -d "description=$SKILL_DESC" \
  -d "metadata[skill_slug]=$SLUG")
STRIPE_PRODUCT_ID=$(echo "$STRIPE_PRODUCT" | jq -r '.id')
[ "$STRIPE_PRODUCT_ID" = "null" ] && fail "Stripe product creation failed: $(echo "$STRIPE_PRODUCT" | jq -r '.error.message')"
log "Stripe product: $STRIPE_PRODUCT_ID"

# Create Stripe price
STRIPE_PRICE=$(curl -s https://api.stripe.com/v1/prices \
  -u "$STRIPE_KEY:" \
  -d "product=$STRIPE_PRODUCT_ID" \
  -d "unit_amount=$PRICE_CENTS" \
  -d "currency=usd")
STRIPE_PRICE_ID=$(echo "$STRIPE_PRICE" | jq -r '.id')
[ "$STRIPE_PRICE_ID" = "null" ] && fail "Stripe price creation failed: $(echo "$STRIPE_PRICE" | jq -r '.error.message')"
log "Stripe price: $STRIPE_PRICE_ID (\$$(echo "scale=2; $PRICE_CENTS/100" | bc))"

# Get next sort_order
SORT_ORDER=$(curl -s "$PIF_SUPABASE_URL/rest/v1/marketplace_products?select=sort_order&order=sort_order.desc&limit=1" \
  -H "apikey: $PIF_SUPABASE_ANON_KEY" -H "Authorization: Bearer $SERVICE_KEY" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print((d[0]['sort_order'] or 0) + 1 if d else 1)
")

# Build Supabase payload
SUPA_PAYLOAD=$(echo "$COPY_JSON" | python3 -c "
import sys, json
copy = json.load(sys.stdin)
payload = {
    'slug': '$SLUG',
    'title': copy['title'],
    'tagline': copy['tagline'],
    'description': copy['description'],
    'category': '$CATEGORY',
    'capabilities': copy['capabilities'],
    'delivery_type': 'md',
    'price_cents': $PRICE_CENTS,
    'stripe_product_id': '$STRIPE_PRODUCT_ID',
    'stripe_price_id': '$STRIPE_PRICE_ID',
    'published': True,
    'sort_order': $SORT_ORDER
}
print(json.dumps(payload))
")

# Insert marketplace_products row
log "Inserting marketplace product..."
INSERT_RESULT=$(curl -s "$PIF_SUPABASE_URL/rest/v1/marketplace_products" \
  -H "apikey: $PIF_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d "$SUPA_PAYLOAD")
PRODUCT_ID=$(echo "$INSERT_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])" 2>/dev/null)
[ -z "$PRODUCT_ID" ] && fail "Supabase insert failed: $INSERT_RESULT"
log "Marketplace product: $PRODUCT_ID"

# Copy skill to MC library
log "Copying to MC library..."
mkdir -p "$MC_LIBRARY/$SLUG"
cp -r "$SKILL_DIR"/* "$MC_LIBRARY/$SLUG/"
log "Copied to $MC_LIBRARY/$SLUG/"

# Add to manifest.json
log "Updating manifest.json..."
python3 -c "
import json
with open('$MANIFEST') as f:
    manifest = json.load(f)

# Check if already in manifest
if any(s['id'] == '$SLUG' for s in manifest['skills']):
    print('Already in manifest, skipping')
else:
    manifest['skills'].append({
        'id': '$SLUG',
        'name': '$TITLE',
        'tier': 'library',
        'min_tier': 'pro',
        'category': '$CATEGORY',
        'description': '''$SKILL_DESC''',
        'included_by_default': False
    })
    with open('$MANIFEST', 'w') as f:
        json.dump(manifest, f, indent=2)
        f.write('\n')
    print('Added to manifest')
"

# Restart API
log "Restarting mission-control-api..."
systemctl restart mission-control-api
sleep 2
if systemctl is-active --quiet mission-control-api; then
  log "API restarted successfully"
else
  warn "API restart may have failed. Check: systemctl status mission-control-api"
fi

# Summary
echo ""
echo -e "${GREEN}=== Published: $TITLE ===${NC}"
echo "  Slug:           $SLUG"
echo "  Category:       $CATEGORY"
echo "  Stripe product: $STRIPE_PRODUCT_ID"
echo "  Stripe price:   $STRIPE_PRICE_ID (\$$(echo "scale=2; $PRICE_CENTS/100" | bc))"
echo "  Supabase ID:    $PRODUCT_ID"
echo "  MC library:     $MC_LIBRARY/$SLUG/"
echo "  Manifest:       updated"
echo "  API:            restarted"
echo ""
echo "  Tagline: $TAGLINE"
echo ""
