# Meetpif — Execution Plan

**Created**: 2026-03-07
**Status**: Active — working document. Update as phases complete.
**Companion**: `spec.md` (product spec), `competitive-landscape.md` (market context)

This is the operational map. Every task, every decision, every dependency. We work through this linearly and update it as we go.

---

## Decisions (Locked)

These were resolved in the March 7 planning session. Do not revisit without Pavol's explicit say-so.

| # | Decision | Resolution |
|---|----------|------------|
| D1 | Architecture | **Platform + Instance separation.** Code at `/opt/assistant-platform/` (root-owned, read-only). User data at `~/` per Linux user. |
| D2 | Auth model | **Claude OAuth BYOK.** Users connect their Claude subscription via OAuth PKCE flow in MC settings. Tokens stored encrypted in `tenant_claude_credentials`, auto-refreshed within 5 min of expiry. Spawners call `/api/internal/claude-config` for per-tenant config dir. No fallback to shared credentials. _(Updated 2026-03-13)_ |
| D3 | Google OAuth | **SSO for MC login first.** Workspace scope expansion (Calendar, Gmail, Drive) deferred to Phase 2. |
| D4 | Supabase | **Single project, tenant isolation.** All instances share Pif's existing Supabase project (ndtlmjekfxaxcowfbrms). Every table gets a `tenant_id` column. RLS policies enforce isolation — each instance only sees its own data. One project to manage, one set of migrations, no project limits. MC API server filters by tenant_id. RLS is defense-in-depth. |
| D5 | Customization scope | Users customize **soul and memory files** (SOUL.md, USER.md, WORKING.md, ~/life/). Same structure as Pif. No MISSION.md — goals live in WORKING.md and SOUL.md. Everything else comes from the platform. |
| D6 | Scripts & workflows | **Centrally managed.** Users inherit all scripts, workflows, heartbeat logic from the platform. Only the heartbeat **schedule** is per-user. Users cannot create or modify workflows in MVP. |
| D7 | Codebase access | Users **cannot modify the codebase.** No git access to MC source. No script editing. Platform code is read-only. |
| D8 | Update propagation | Pavol rebuilds `/opt/assistant-platform/`, restarts services. All instances get updates immediately. No user action required. |
| D9 | Build approach | **Platform-first.** Clean architecture from day 1. No quick-and-dirty copy that needs refactoring later. |
| D10 | Backup | Pre-work snapshot at `/root/backups/pre-rif-platform/2026-03-07/`. Git tag `pre-rif-platform-2026-03-07` on MC repo. |
| D11 | Skills | **Three-tier model.** Core (always included), Library (opt-in per instance), Pif-only (never shared). Delivered via symlinks from platform to instance `~/.claude/skills/`. Manifest-driven. |
| D12 | Workflows | **Centrally managed with per-instance schedules.** Workflow logic in platform, schedule timing in instance Supabase. Manifest-driven registry. Users cannot create/modify workflows in MVP. |

---

## Architecture Overview

```
/opt/assistant-platform/                 ← ROOT-OWNED, READ-ONLY FOR USERS
├── mc/                                  ← Mission Control (single source)
│   ├── dist/                            ← Built frontend (nginx serves per-instance)
│   ├── server/                          ← API server code (runs per-instance, different env)
│   ├── node_modules/                    ← Shared dependencies
│   └── package.json
├── scripts/                             ← Shared operational scripts
│   ├── heartbeat.sh                     ← Centrally managed heartbeat
│   ├── pif-runner.py                    ← Workflow runner
│   ├── telegram-send.sh                 ← Telegram delivery
│   ├── pif-creds.js                     ← Credential CLI
│   ├── comment-listener.js             ← Supabase Realtime → Claude session
│   ├── nightly-consolidation.sh        ← Knowledge extraction
│   └── ...
├── templates/                           ← Instance provisioning templates
│   ├── SOUL.md.tmpl
│   ├── TOOLS.md.tmpl
│   ├── CLAUDE.md.tmpl
│   ├── USER.md.tmpl
│   ├── WORKING.md.tmpl
│   ├── MEMORY.md.tmpl
│   ├── HEARTBEAT.md.tmpl
│   ├── pif-env.tmpl
│   ├── (nginx-instance.conf.tmpl removed — single shared nginx config)
│   ├── systemd/
│   │   ├── instance-telegram.service.tmpl
│   │   ├── instance-heartbeat.service.tmpl
│   │   ├── instance-heartbeat.timer.tmpl
│   │   ├── instance-comment-listener.service.tmpl
│   │   ├── instance-schedule-checker.timer.tmpl
│   │   ├── instance-claude-refresh.service.tmpl  ← vestigial (server-side auto-refresh)
│   │   └── instance-claude-refresh.timer.tmpl    ← vestigial (server-side auto-refresh)
│   ├── mc-api.env.tmpl
│   ├── telegram.env.tmpl
│   ├── mcp.json.tmpl
│   └── branding.json.tmpl
├── patches/                             ← Patches for third-party dependencies
│   └── telegram/
│       ├── validators.py.patch          ← Extra dirs + tilde expansion fix
│       └── sdk_integration.py.patch     ← Dynamic CLAUDE.md loading
├── bin/                                 ← Shared CLI tools / wrappers
│   ├── assistant-creds                  ← Symlink or wrapper to pif-creds.js
│   ├── provision-instance.sh            ← Master provisioner script
│   ├── update-platform.sh              ← Pull + rebuild + restart
│   ├── sync-skills.sh                  ← Recreate skill symlinks for instances
│   └── sync-workflows.sh              ← Sync workflow schedules to instance Supabase
├── skills/                              ← Tiered skill registry
│   ├── manifest.json                    ← Skill metadata + tier classification
│   ├── core/                            ← Always included (all instances)
│   │   ├── systematic-debugging/
│   │   ├── verification-before-completion/
│   │   ├── test-driven-development/
│   │   ├── modern-python/
│   │   ├── antfarm-workflows/
│   │   ├── designing-workflow-skills/
│   │   └── git-cleanup/
│   └── library/                         ← Opt-in per instance
│       ├── direct-response-copy/
│       ├── ux-ui/
│       ├── seo-audit/
│       ├── write-blog/
│       ├── newsletter/
│       ├── content-strategy/
│       ├── cold-outreach/
│       ├── brand-namer/
│       ├── linkedin-post-writer/
│       ├── linkedin-hook-writer/
│       ├── headline-crafter/
│       ├── prd/
│       ├── deck-replication/
│       └── design-system-builder/
└── workflows/                           ← Shared workflow definitions (moved below skills)
    ├── manifest.json                    ← Workflow metadata + schedule defaults
    ├── morning-brief.yml
    ├── evening-standup.yml
    ├── nightly-consolidation.yml
    ├── weekly-review.yml
    ├── content-factory.yml
    ├── inbox-processing.yml
    └── feature-dev.yml

/home/<instance>/                        ← USER-OWNED, PER-INSTANCE DATA
├── agents/<name>/
│   ├── SOUL.md                          ← User's personality (from template, then customized)
│   ├── TOOLS.md                         ← Generated from template with user's actual services
│   └── HEARTBEAT.md                     ← Generated from template
├── memory/
│   ├── WORKING.md                       ← User's operational state (includes goals/priorities)
│   ├── USER.md                          ← User's profile
│   └── daily/                           ← Daily notes (created by heartbeat/briefings)
├── life/                                ← User's PARA knowledge
│   ├── projects/
│   ├── areas/
│   ├── resources/
│   └── archives/
├── .claude/
│   ├── CLAUDE.md                        ← Bootstrap: "You are <Name>..."
│   ├── settings.json                    ← Claude Code permissions
│   ├── skills/                          ← Symlinks to platform skills
│   │   ├── systematic-debugging → /opt/assistant-platform/skills/core/systematic-debugging
│   │   ├── write-blog → /opt/assistant-platform/skills/library/write-blog  (if enabled)
│   │   └── ...
│   └── projects/-/memory/MEMORY.md      ← Auto-memory
├── .pif-env                             ← Bootstrap credentials (Supabase URL, anon key, master password)
├── data/
│   ├── branding.json                    ← MC branding config (name, colors, feature toggles)
│   └── skills.json                      ← Which library skills this instance has enabled
└── logs/                                ← Instance-specific logs
```

### How Updates Flow

1. Pavol makes an improvement (MC feature, script fix, workflow change)
2. Changes committed to MC repo or edited in `/opt/assistant-platform/`
3. Run: `cd /opt/assistant-platform/mc && git pull && npm run build`
4. For script changes: files already in `/opt/assistant-platform/scripts/` — immediate
5. Restart affected services: `systemctl restart *-mc-api *-heartbeat` etc.
6. All instances pick up the change — zero user involvement

### How Instance Isolation Works

- **Linux users**: Each instance is a separate Linux user (`rif`, `zoe`, etc.). `chmod 700` on home dirs.
- **Supabase tenancy**: All instances share Pif's Supabase project. Each instance has a unique `tenant_id`. RLS policies + API-level filtering ensure each instance only sees its own tasks, projects, comments, schedules, and credentials.
- **Systemd services**: Named per-instance (`rif-telegram.service`, `rif-heartbeat.service`). Run as the instance's Linux user. MC API is shared (one process, multi-tenant) — not per-instance.
- **nginx**: Single `meetpif.com` server block. One API server handles all tenants — tenant determined by authenticated session, not by URL.
- **Claude Code**: Each instance connects their own Claude subscription via OAuth BYOK in MC settings. Tokens stored encrypted in `tenant_claude_credentials`, auto-refreshed server-side. No CLI `claude login` needed.
- **Telegram**: Each instance has its own bot token.
- **No cross-reads**: Instance user can't read `/root/` (Pif) or other instance home dirs. Platform at `/opt/` is read-only.

### How Skills Are Managed

Skills are Claude Code capabilities — each is a directory with a `SKILL.md` file that teaches Claude how to perform a specific task (write copy, run workflows, debug systematically, etc.).

**Three tiers of skills:**

| Tier | Location | Who manages | Examples |
|------|----------|-------------|---------|
| **Core** | `/opt/assistant-platform/skills/core/` | Pavol (platform) | `systematic-debugging`, `verification-before-completion`, `test-driven-development`, `modern-python`, `antfarm-workflows`, `designing-workflow-skills` |
| **Library** | `/opt/assistant-platform/skills/library/` | Pavol (platform) | `direct-response-copy`, `ux-ui`, `seo-audit`, `write-blog`, `newsletter`, `content-strategy`, `cold-outreach`, `brand-namer`, `linkedin-post-writer` |
| **Pif-only** | `/root/.claude/skills/` (not in platform) | Pavol (Pif-specific) | `sense-of-humor`, `voice-guide`, `voice-check`, `ralph`, `gog`, `weekly-update`, `font-pairing` |

**How it works:**

1. **Platform manifest** — `/opt/assistant-platform/skills/manifest.json` declares all available skills with metadata:

```json
{
  "skills": [
    {
      "id": "systematic-debugging",
      "tier": "core",
      "description": "Use when encountering any bug or unexpected behavior",
      "included_by_default": true
    },
    {
      "id": "write-blog",
      "tier": "library",
      "description": "Generate SEO-optimized blog posts",
      "included_by_default": false
    }
  ]
}
```

2. **Instance skill config** — Each instance declares which library skills to enable in `~/data/skills.json`:

```json
{
  "enabled_skills": ["write-blog", "newsletter", "content-strategy"]
}
```

Core skills are always included. Library skills are opt-in per instance. Pif-only skills never leave Pif.

3. **Symlink delivery** — The provisioner (and `sync-skills.sh`) creates symlinks from the instance's `~/.claude/skills/` to the platform:

```
~/.claude/skills/systematic-debugging → /opt/assistant-platform/skills/core/systematic-debugging
~/.claude/skills/write-blog → /opt/assistant-platform/skills/library/write-blog
```

4. **Update flow** — When Pavol improves a skill on the platform, all instances pick it up immediately (symlinks point to the source). No per-instance action needed.

5. **Sync script** — `/opt/assistant-platform/bin/sync-skills.sh [instance-name|--all]` recreates symlinks for one or all instances based on their `skills.json`. Run after:
   - Adding a new skill to the platform
   - Changing an instance's `skills.json`
   - Provisioning a new instance

**What users CAN'T do (MVP):**
- Create their own skills (no write access to platform, and we don't support instance-local skills yet)
- Modify platform skills (symlinks are read-only to non-root)
- Enable skills not in the platform manifest

**Future (post-MVP):**
- Users create instance-local skills in `~/.claude/skills/local/` — these take precedence over platform skills of the same name
- Skill marketplace: users submit skills → Pavol reviews → adds to library tier

### How Workflows Are Managed

Workflows are multi-step automation pipelines (morning briefing, evening standup, nightly consolidation, etc.) executed by `pif-runner.py`.

**Two-layer resolution:**

```
/opt/assistant-platform/workflows/          ← Platform workflows (source of truth)
├── manifest.json                           ← Registry of all workflows + metadata
├── morning-brief.yml
├── evening-standup.yml
├── nightly-consolidation.yml
├── weekly-review.yml
├── content-factory.yml
├── inbox-processing.yml
└── feature-dev.yml                         ← Antfarm-powered workflows

Instance has NO workflow files.             ← Clean separation
Schedule config lives in Supabase.          ← Per-instance schedules
```

**How it works:**

1. **Platform manifest** — `/opt/assistant-platform/workflows/manifest.json` declares all workflows:

```json
{
  "workflows": [
    {
      "id": "morning-brief",
      "name": "Morning Brief",
      "description": "Daily standup delivered to Telegram",
      "schedule_type": "cron",
      "default_schedule": "0 7 * * *",
      "required_services": ["telegram"],
      "included_by_default": true
    },
    {
      "id": "content-factory",
      "name": "Content Factory",
      "description": "Multi-format content pipeline",
      "schedule_type": "manual",
      "default_schedule": null,
      "required_services": [],
      "included_by_default": false
    }
  ]
}
```

2. **pif-runner.py refactoring** — The runner resolves workflow paths in order:
   1. `$PLATFORM_DIR/workflows/{id}.yml` (platform — always checked first)
   2. Falls back with error if not found (no instance-local workflows in MVP)

```python
PLATFORM_DIR = Path(os.environ.get("ASSISTANT_PLATFORM_DIR", "/opt/assistant-platform"))
WORKFLOWS_DIR = PLATFORM_DIR / "workflows"
```

3. **Per-instance schedules** — Each instance's Supabase `schedules` table controls when workflows run. The workflow logic is the same for everyone; only the timing differs.

```sql
-- Instance's Supabase
INSERT INTO schedules (workflow_id, cron_expression, enabled)
VALUES ('morning-brief', '0 8 * * *', true);  -- This user wants briefing at 8am
```

4. **Workflow parameterization** — Workflows reference environment variables, not hardcoded paths. The runner injects instance context:
   - `$HOME` — instance user's home directory
   - `$ASSISTANT_NAME` — from branding config
   - `$TELEGRAM_CHAT_ID` — from instance credentials
   - `$SUPABASE_URL` — shared (from platform config)
   - `$TENANT_ID` — per-instance (from `.pif-env`)

5. **Update flow** — Pavol edits a workflow YAML in the platform directory. All instances pick it up on next execution (runner reads from platform dir). No restart needed — workflows are read fresh on each run.

6. **Adding a new workflow:**
   1. Create `{id}.yml` in `/opt/assistant-platform/workflows/`
   2. Add entry to `manifest.json`
   3. Run `/opt/assistant-platform/bin/sync-workflows.sh --all` — inserts default schedule into each instance's Supabase (disabled by default for non-default workflows)
   4. Enable per-instance via MC settings or direct Supabase update

**What users CAN'T do (MVP):**
- Create custom workflows
- Modify workflow logic
- Override a platform workflow with a local one

**What users CAN do:**
- Enable/disable workflows via their schedules table
- Change workflow timing (cron expression)
- Trigger any enabled workflow manually via Telegram or MC

**Future (post-MVP):**
- Instance-local workflow overrides in `~/workflows/custom/{id}.yml` — takes precedence over platform version
- User-created workflows in `~/workflows/custom/` — registered in their own Supabase, not the platform manifest
- Workflow parameter overrides in `~/data/workflow-config.json` — customize gather sources, delivery format, etc. without touching the YAML

### How Scripts Are Managed

Scripts are the atomic units — heartbeat, telegram-send, credential CLI, consolidation, etc.

**Resolution:** All scripts live at `/opt/assistant-platform/scripts/`. Instance services (systemd) reference them directly. No copies in user home dirs.

**Parameterization:** Every script reads its context from:
- `$HOME` — which user's data to operate on
- `$ASSISTANT_PLATFORM_DIR` — where platform code lives (default: `/opt/assistant-platform`)
- `~/.pif-env` — instance credentials (sourced at script start)

**PATH setup:** During provisioning, the instance user's `.bashrc` gets:

```bash
export ASSISTANT_PLATFORM_DIR="/opt/assistant-platform"
export PATH="$ASSISTANT_PLATFORM_DIR/bin:$ASSISTANT_PLATFORM_DIR/scripts:$PATH"
```

This means `pif-runner.py`, `assistant-creds`, `telegram-send.sh` etc. are callable from anywhere without absolute paths.

**Update flow:** Edit script in `/opt/assistant-platform/scripts/`, restart affected services. Immediate for all instances.

---

## Phase 0A: Platform Foundation

**Goal**: Create `/opt/assistant-platform/` and move shared code there. Pif keeps working exactly as before — this is additive, not disruptive.

### 0A.1 — Create platform directory structure

```bash
mkdir -p /opt/assistant-platform/{mc,scripts,workflows,templates/systemd,bin,skills}
```

**Acceptance**: Directory exists with correct structure.

### 0A.2 — Clone MC into platform directory

Clone the MC repo into `/opt/assistant-platform/mc/`. This becomes the canonical location for MC code. Pif's existing `/root/projects/mission-control/` continues to work for development — think of `/opt/` as the "production install."

```bash
cd /opt/assistant-platform
git clone <mc-repo-url> mc
cd mc && npm install && npm run build
```

For the API server:
```bash
cd /opt/assistant-platform/mc/server && npm install && npm run build
```

**Acceptance**: `dist/` exists and is servable. API server compiles.

### 0A.3 — Copy shared scripts to platform

Copy (not move — Pif's originals stay for now) operational scripts into `/opt/assistant-platform/scripts/`:

| Script | Source | Notes |
|--------|--------|-------|
| `heartbeat.sh` | `~/scripts/pif-heartbeat.sh` | Needs parameterization (home dir, service names) |
| `pif-runner.py` | `~/scripts/pif-runner.py` | Needs `$HOME` awareness |
| `telegram-send.sh` | `~/scripts/telegram-send.sh` | Already generic enough |
| `pif-creds.js` | `~/scripts/pif-creds.js` | Rename to `assistant-creds` or keep as-is |
| `comment-listener.js` | `~/scripts/comment-listener.js` | Needs parameterized Supabase URL |
| `nightly-consolidation.sh` | `~/scripts/nightly-consolidation.sh` | Needs `$HOME` awareness |
| `schedule-checker.sh` | `~/scripts/schedule-checker.sh` | Needs parameterized service names |
| `morning-brief.sh` | (if standalone) | Or workflow-driven via pif-runner |
| `gog-auth.sh` | `~/scripts/gog-auth.sh` | Phase 2 — not needed for MVP |

**Key refactoring principle**: Every script must resolve paths relative to the calling user's `$HOME`, not hardcoded `/root/`. Environment variables (`$ASSISTANT_HOME`, `$ASSISTANT_NAME`) replace hardcoded paths.

**Acceptance**: Scripts in `/opt/assistant-platform/scripts/` are parameterized and can run as any user.

### 0A.4 — Set up workflow registry

1. Copy all workflow YAMLs to `/opt/assistant-platform/workflows/`:
```bash
cp ~/workflows/*.yml /opt/assistant-platform/workflows/
```

2. Audit each YAML for hardcoded `/root/` paths — replace with `$HOME` or environment variable references.

3. Create `/opt/assistant-platform/workflows/manifest.json`:
```json
{
  "workflows": [
    { "id": "morning-brief", "name": "Morning Brief", "schedule_type": "cron", "default_schedule": "0 7 * * *", "required_services": ["telegram"], "included_by_default": true },
    { "id": "evening-standup", "name": "Evening Standup", "schedule_type": "cron", "default_schedule": "0 21 * * *", "required_services": ["telegram"], "included_by_default": true },
    { "id": "nightly-consolidation", "name": "Nightly Consolidation", "schedule_type": "cron", "default_schedule": "0 1 * * *", "required_services": [], "included_by_default": true },
    { "id": "weekly-review", "name": "Weekly Review", "schedule_type": "cron", "default_schedule": "0 18 * * 5", "required_services": [], "included_by_default": true },
    { "id": "inbox-processing", "name": "Inbox Processing", "schedule_type": "manual", "default_schedule": null, "required_services": ["gog"], "included_by_default": false },
    { "id": "content-factory", "name": "Content Factory", "schedule_type": "manual", "default_schedule": null, "required_services": [], "included_by_default": false }
  ]
}
```

4. Create `/opt/assistant-platform/bin/sync-workflows.sh` — reads manifest, inserts/updates default schedules into an instance's Supabase `schedules` table. Respects existing user overrides (doesn't clobber custom cron expressions).

**Acceptance**: Manifest exists. All YAMLs parameterized. Sync script can populate an instance's schedules table.

### 0A.5 — Set up skill registry

1. Create tier directories:
```bash
mkdir -p /opt/assistant-platform/skills/{core,library}
```

2. Copy skills into appropriate tiers:

**Core** (always included for all instances):
```bash
for skill in systematic-debugging verification-before-completion test-driven-development modern-python antfarm-workflows designing-workflow-skills git-cleanup; do
  cp -r ~/.claude/skills/$skill /opt/assistant-platform/skills/core/
done
```

**Library** (opt-in per instance):
```bash
for skill in direct-response-copy ux-ui seo-audit write-blog newsletter content-strategy cold-outreach brand-namer linkedin-post-writer linkedin-hook-writer headline-crafter prd deck-replication design-system-builder; do
  cp -r ~/.claude/skills/$skill /opt/assistant-platform/skills/library/
done
```

**Pif-only** (NOT copied — stay in `/root/.claude/skills/`):
- `sense-of-humor`, `voice-guide`, `voice-check`, `ralph`, `gog`, `weekly-update`, `font-pairing`

3. Create `/opt/assistant-platform/skills/manifest.json` — lists all skills with tier, description, and default inclusion status.

4. Create `/opt/assistant-platform/bin/sync-skills.sh` — reads manifest + instance's `~/data/skills.json`, creates/updates symlinks in `~/.claude/skills/`:
   - Always symlinks all `core/` skills
   - Symlinks `library/` skills only if listed in instance's `skills.json`
   - Removes symlinks for disabled library skills
   - Never touches files that aren't symlinks (preserves any instance-local skills in the future)

**Acceptance**: Skills organized by tier. Manifest exists. Sync script creates correct symlinks for a test instance.

### 0A.6 — Refactor pif-runner.py for platform workflow resolution

Current state: `pif-runner.py` resolves workflows from `Path.home() / "workflows"` with a `custom/` subfolder fallback.

Refactored state:
```python
PLATFORM_DIR = Path(os.environ.get("ASSISTANT_PLATFORM_DIR", "/opt/assistant-platform"))
WORKFLOWS_DIR = PLATFORM_DIR / "workflows"

def load_workflow(workflow_id: str) -> dict:
    path = WORKFLOWS_DIR / f"{workflow_id}.yml"
    if not path.exists():
        raise FileNotFoundError(f"Workflow '{workflow_id}' not found in {WORKFLOWS_DIR}")
    with open(path) as f:
        return yaml.safe_load(f)
```

Also audit all other path references in `pif-runner.py`:
- Step execution context should use `$HOME` for data paths (daily notes, WORKING.md, etc.)
- Workflow YAML references should use `$ASSISTANT_PLATFORM_DIR` for scripts
- Telegram delivery should resolve from platform scripts dir

**Acceptance**: `pif-runner.py` in platform dir loads workflows from platform dir, operates on calling user's `$HOME` data.

### 0A.8 — Create update script

`/opt/assistant-platform/bin/update-platform.sh` — pulls latest MC code, rebuilds, and restarts all instance services.

```bash
#!/bin/bash
# Usage: update-platform.sh [--restart-services]
cd /opt/assistant-platform/mc
git pull
npm install
npm run build
cd server && npm install && npm run build
if [[ "$1" == "--restart-services" ]]; then
  # Restart all instance API + heartbeat services
  systemctl restart *-mc-api.service
  systemctl restart *-heartbeat.service
fi
echo "Platform updated."
```

**Acceptance**: Running `update-platform.sh` rebuilds MC and optionally restarts services.

### 0A.9 — Verify Pif still works

After creating the platform directory, verify Pif's existing setup is untouched:
- meetpif.com loads
- Telegram bot responds
- Heartbeat runs
- Comment listener active

**This phase is additive only.** Pif doesn't move to the platform directory yet — that's optional later.

---

## Phase 0B: MC Refactoring

**Goal**: Make Mission Control multi-tenant (branding, auth, data isolation). Blog, landing page, timeline, and public feed remain Pif-only features — they are NOT exposed to other tenants.

### 0B.1 — Extract branding into runtime config

Create `/opt/assistant-platform/mc/src/config/branding.ts`:

```typescript
interface BrandingConfig {
  assistantName: string;
  ownerName: string;
  primaryColor: string;
  logoUrl: string;
}

// Default config — overridden per-tenant via /api/branding
const DEFAULT_BRANDING: BrandingConfig = {
  assistantName: 'Assistant',
  ownerName: 'User',
  primaryColor: '#f59e0b',
  logoUrl: '/logo.svg',
};
```

No feature toggles in branding config. Blog, landing, timeline, and public feed are Pif-only features hardcoded in the router (see 0B.4). Other tenants get the dashboard only.

**Approach**: Runtime injection via `/api/branding`. Single build artifact, per-instance config via the API server reading from the `tenants` table (or `~/data/branding.json`). No per-instance rebuilds.

### 0B.2 — Replace hardcoded "Pif" references

Audit and replace every hardcoded "Pif" in MC's **dashboard/task/settings** views:
- `index.html` title → injected from branding
- `PifLogo.tsx` → `AssistantLogo.tsx` (generic, reads logoUrl from branding)
- Sidebar "Pif Laborman" text → `branding.assistantName`
- Any hardcoded color in dashboard → use design tokens / branding config

**Leave alone**: LandingPage, BlogPage, Timeline, PublicFeed — these stay hardcoded as Pif content. They don't need to be generic because no other tenant will ever see them.

**Acceptance**: MC dashboard renders correctly with any `branding.json`. No "Pif" visible in the dashboard when logged in as a non-Pif tenant.

### 0B.3 — Add /api/branding endpoint

The MC API server returns branding for the authenticated tenant:

```
GET /api/branding → { assistantName, ownerName, primaryColor, logoUrl }
```

Source: `tenants` table (name, primary_color columns) or `~/data/branding.json` from the tenant's home dir.

Frontend fetches this on app load, before rendering the dashboard.

**Acceptance**: MC frontend dynamically shows the correct assistant name and branding per tenant.

### 0B.4 — Pif-only routes (blog, landing, timeline, public feed)

Blog, Landing, Timeline, and PublicFeed routes are **Pif-only** — hardcoded to only render for Pif's tenant. They are NOT feature-toggled or configurable.

```typescript
// Router: Pif-only public routes (no auth required)
// These render Pif's content for unauthenticated visitors at meetpif.com
<Route path="/" element={<LandingPage />} />
<Route path="/blog/*" element={<BlogPage />} />
<Route path="/timeline" element={<TimelinePage />} />

// Authenticated routes (all tenants)
<Route path="/mc/*" element={<AuthRequired><Dashboard /></AuthRequired>} />
```

**Unauthenticated visitors** see Pif's public pages (landing, blog, timeline) — same as today. After login, all tenants see the dashboard with their own branding.

Non-Pif tenants never see blog/landing/timeline/public feed routes. There are no toggles for these — they simply don't exist outside Pif's context.

**Acceptance**: Pif's public pages work as before. A non-Pif tenant logging in goes straight to dashboard. No blog/landing/timeline routes accessible to other tenants.

### 0B.5 — Google SSO for MC login

Replace the current password-based login with Google OAuth SSO.

**Google Cloud setup**: DONE (2026-03-07). Credentials stored in MC logins table as "Google OAuth".
- Client ID: `535507959054-brp41vdi1vut197me9i4u8i0nfe21o86.apps.googleusercontent.com`
- Client secret: stored encrypted in logins table (`pif-creds get "Google OAuth"`)
- Authorized redirect URI: `https://meetpif.com/api/auth/google/callback`
- One OAuth app shared across all tenants.

**Components to build:**
1. **MC API** — `/api/auth/google` redirect, `/api/auth/google/callback` handler
2. **MC frontend** — "Sign in with Google" button on login page
3. **Session management** — JWT or cookie-based session after OAuth callback
4. **User allowlist** — Not open registration. `tenant_users` table maps emails to tenants.

**Tenant resolution flow (single URL, multi-tenant):**
1. User visits `meetpif.com` → clicks "Sign in with Google"
2. OAuth callback receives email
3. API looks up email in `tenant_users` table → finds `tenant_id`
4. If no matching tenant → login rejected ("No account found")
5. Session created with `tenant_id` embedded
6. Frontend fetches `/api/branding` → API returns branding for that tenant
7. MC renders dashboard with tenant's branding (name, colors)

**Pavol's access**: Pavol's email maps to Pif's tenant. He can also be added to any other tenant's `tenant_users` as admin:

```sql
CREATE TABLE tenant_users (
  tenant_id UUID REFERENCES tenants(id),
  email TEXT NOT NULL,
  role TEXT DEFAULT 'owner',  -- 'owner' or 'admin'
  PRIMARY KEY (tenant_id, email)
);
```

**Fallback**: Keep password login as an alternative (useful for instances without Google accounts, or for Pavol accessing any instance). Google SSO is the default, password is the escape hatch.

**Acceptance**: User clicks "Sign in with Google" → Google OAuth flow → redirected back to MC dashboard with tenant-specific branding → logged in. Unknown emails rejected.

### 0B.6 — Add tenant isolation to Supabase schema

This is the core multi-tenancy migration. All data tables get a `tenant_id` column + RLS policies.

**Step 1 — Create tenants table:**
```sql
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,              -- "Pif", "Zoe", etc.
  instance_name TEXT UNIQUE NOT NULL,  -- Linux username: "rif", "zoe"
  owner_email TEXT,
  primary_color TEXT DEFAULT '#f59e0b',
  logo_url TEXT DEFAULT '/logo.svg',
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**Step 2 — Register Pif as a tenant:**
```sql
INSERT INTO tenants (id, name, instance_name, owner_email, primary_color)
VALUES (gen_random_uuid(), 'Pif Laborman', 'pif', 'pavol.dzurjanin@duvo.ai', '#D8FF66');
```

**Step 3 — Add tenant_id to all data tables:**

Tables to migrate: `tasks`, `projects`, `task_comments`, `task_status_transitions`, `activity_log`, `schedules`, `logins`, `heartbeats`, `task_attachments`, `workflows`, `workflow_runs`, `workflow_steps`, `workflow_stories` (antfarm tables).

For each table:
```sql
ALTER TABLE <table> ADD COLUMN tenant_id UUID REFERENCES tenants(id);
UPDATE <table> SET tenant_id = '<pif-tenant-uuid>';  -- backfill existing data
ALTER TABLE <table> ALTER COLUMN tenant_id SET NOT NULL;
CREATE INDEX idx_<table>_tenant ON <table>(tenant_id);
```

**Step 4 — Enable RLS on all data tables:**
```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON <table>
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

**Step 5 — MC API server sets tenant context on every request:**
```typescript
// Middleware: set tenant_id from authenticated user's session
const { data } = await supabase.rpc('set_tenant', { tid: user.tenant_id });
// Or: await supabase.query("SET LOCAL app.tenant_id = $1", [tenantId]);
```

Alternatively (simpler for MVP): use the service role key (bypasses RLS) and filter by `tenant_id` in every query at the application level. RLS acts as defense-in-depth.

**Step 6 — Update MC API queries:**
Every Supabase query in the MC API adds `.eq('tenant_id', tenantId)`. The tenant_id comes from the authenticated user's session (after Google SSO, the user's email maps to a tenant via the `tenant_users` table).

**Acceptance**: Pif's existing data is tagged with Pif's tenant_id. A second test tenant sees zero data. Queries without tenant filtering return nothing (RLS blocks).

### 0B.7 — Add role tags to activity feed

Add `role` column (nullable text) to `task_comments` and `activity_log` tables. Update MC frontend to render role tags.

Roles: Scheduler, Briefer, Builder, Memory Keeper, Inbox Manager, Ops.

Scripts populate the role when posting activity (e.g., heartbeat posts as "Scheduler", morning brief as "Briefer").

**Acceptance**: Activity feed shows colored role tags. New column exists in both tables.

### 0B.8 — Test MC with branding config + tenant isolation

Deploy a test branding config and verify:
- Custom assistant name renders in dashboard
- Pif's public pages (blog, landing, timeline) still work for unauthenticated visitors
- Non-Pif tenant sees dashboard only — no blog/landing/timeline routes
- Google SSO login works
- Role tags appear in activity feed
- No "Pif" leaks into non-Pif tenant's dashboard
- Tenant isolation: create a test tenant, verify it sees zero existing data
- Pif's data unchanged after tenant migration (all existing rows tagged correctly)

**Acceptance**: MC is multi-tenant with Pif-only public features preserved.

---

## Phase 0C: Instance Provisioner

**Goal**: A script that creates a fully working assistant instance from scratch.

### 0C.1 — Create template files

All templates live at `/opt/assistant-platform/templates/`. Each uses `{{VARIABLE}}` placeholders replaced by `envsubst` during provisioning.

| Template | Variables | Purpose |
|----------|-----------|---------|
| `SOUL.md.tmpl` | `NAME`, `OWNER_NAME`, `VOICE_TONE`, `DND_START`, `DND_END`, `TIMEZONE` | Assistant personality |
| `TOOLS.md.tmpl` | `NAME`, `SUPABASE_URL`, `TELEGRAM_BOT_USERNAME`, `DOMAIN` | Service inventory |
| `CLAUDE.md.tmpl` | `NAME`, `OWNER_NAME`, `HOME_DIR` | Claude Code bootstrap |
| `USER.md.tmpl` | `OWNER_NAME`, `TIMEZONE`, `WORK_CONTEXT`, `DND_HOURS` | Owner profile |
| `WORKING.md.tmpl` | `NAME` | Initial operational state (includes goals/priorities section) |
| `MEMORY.md.tmpl` | `NAME`, `OWNER_NAME` | Auto-memory seed |
| `HEARTBEAT.md.tmpl` | `NAME`, `SERVICES_LIST` | Heartbeat instructions |
| `pif-env.tmpl` | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `CREDS_PASSWORD`, `TENANT_ID` | Credential bootstrap (shared Supabase URL/keys from platform, per-instance tenant_id) |
| `branding.json.tmpl` | `NAME`, `OWNER_NAME`, `PRIMARY_COLOR` | MC branding (name + color only — no feature toggles) |
| ~~`nginx-instance.conf.tmpl`~~ | — | **Removed.** All instances share `meetpif.com` nginx config. No per-instance server blocks. |
| ~~`mc-api.env.tmpl`~~ | — | **Removed.** MC API is shared (one process, multi-tenant). Env configured once at platform level, not per-instance. |
| `telegram.env.tmpl` | `BOT_TOKEN`, `BOT_USERNAME`, `ALLOWED_USERS`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Telegram bot env |
| `mcp.json.tmpl` | `SUPABASE_MCP_URL`, `SUPABASE_PAT` | MCP connections |
| `settings.json.tmpl` | `HOME_DIR`, `INSTANCE_NAME` | Claude Code permissions — deny access to `/root/`, `/home/` (except own), destructive system commands. Allow read on `/opt/assistant-platform/`. |
| `systemd/*.tmpl` | `USER`, `HOME_DIR`, `API_PORT`, `PLATFORM_DIR` | Service definitions |

**Acceptance**: All templates created, documented, and tested with sample values.

### 0C.2 — Create instance config schema

`instance.conf` — the input to the provisioner. Documented example at `/opt/assistant-platform/templates/instance.conf.example`:

```bash
# Instance Configuration
INSTANCE_NAME="rif"                      # Linux username + service prefix
ASSISTANT_NAME="Zoe"                     # Display name
OWNER_NAME="Girlfriend"                  # Human's name
OWNER_EMAIL="girlfriend@gmail.com"       # For Google SSO allowlist

# Supabase (shared project, tenant isolation)
# All instances use Pif's Supabase. Tenant ID isolates data.
TENANT_ID=""                             # Auto-generated UUID during provisioning
# SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY are shared — injected from platform config

# Telegram
TELEGRAM_BOT_TOKEN="123456:ABC..."
TELEGRAM_BOT_USERNAME="rif_bot"
TELEGRAM_ALLOWED_USERS="123456789"       # Telegram user ID

# No per-instance domain needed — all instances share meetpif.com
# Tenant determined by authenticated user's email → tenants table

# Personalization (filled during onboarding, can be blank initially)
TIMEZONE="CET"
DND_START="23:00"
DND_END="07:00"
PRIMARY_COLOR="#f59e0b"
VOICE_TONE="warm, friendly, concise"

# Heartbeat schedule
HEARTBEAT_INTERVAL_MIN="30"
HEARTBEAT_OFFSET_MIN="15"               # Offset from :00 to avoid collision with Pif

# Claude Code
# (User connects via OAuth BYOK in MC settings — no CLI login needed)
```

**Acceptance**: Schema documented with all fields and defaults.

### 0C.3 — Create tenant registration script

Script that registers a new tenant in Pif's existing Supabase project:

1. Generate a new UUID for `tenant_id`
2. Insert into `tenants` table: `{ id, name, instance_name, owner_email, created_at }`
3. Seed initial data for the tenant:
   - Default project entry in `projects` (with `tenant_id`)
   - Default schedules in `schedules` (with `tenant_id`)
   - Bootstrap credentials in `logins` (with `tenant_id`)
4. Output the `tenant_id`

**Input**: Instance name, assistant name, owner email.
**Output**: Tenant UUID.

The shared Supabase URL, anon key, and service role key come from platform config (Pif's existing `.pif-env`).

**Acceptance**: Script creates a tenant with seeded data. Queries filtered by that tenant_id return only its data.

### 0C.4 — Write provision-instance.sh

The master provisioner. Takes `instance.conf` as input and does everything:

```
provision-instance.sh <instance.conf>
  ├── Phase 1:  Validate config (all required vars present)
  ├── Phase 2:  Create Linux user + home directory structure
  │             ├── agents/<name>/
  │             ├── memory/ (+ daily/)
  │             ├── life/ (projects/, areas/, resources/, archives/)
  │             ├── .claude/ (+ projects/-/memory/)
  │             ├── data/
  │             └── logs/
  ├── Phase 3:  Render templates → write config files into user's home
  ├── Phase 4:  Verify Claude Code CLI accessible (system-wide binary, no per-user install)
  ├── Phase 5:  Configure QMD collections for instance user
  │             └── Create ~/.config/qmd/index.yml with instance paths (~/life/, ~/memory/, etc.)
  ├── Phase 6:  Symlink platform skills into user's ~/.claude/skills/
  ├── Phase 7:  Configure MCP connections (~/.mcp.json from template)
  ├── Phase 8:  Set up Telegram bot (install claude-code-telegram, apply patches, env file)
  ├── Phase 9:  Create + enable systemd services
  │             ├── <instance>-telegram.service
  │             ├── <instance>-heartbeat.timer + .service
  │             ├── <instance>-comment-listener.service
  │             ├── <instance>-schedule-checker.timer
  │             └── (claude-refresh removed — server-side auto-refresh via OAuth BYOK)
  ├── Phase 10: Set file permissions (chmod 700 home, chmod 600 .pif-env)
  │             Configure Claude Code settings.json with security restrictions:
  ├── Phase 11: Run initial QMD index build (system-wide binary, per-user index)
  ├── Phase 12: Smoke test
  │             ├── Telegram bot responds (send test message)
  │             ├── MC login works (Google SSO with instance email)
  │             └── Supabase connection works (query via API)
  └── Phase 13: Report success
```

Each phase is **idempotent** — can re-run safely if interrupted. Each phase logs to `/home/<instance>/logs/provision.log`.

**What the provisioner does NOT do** (requires user interaction):
- Claude OAuth BYOK — user connects their Claude subscription via MC settings after first login
- Google account authentication for GOG — deferred to Phase 2
- Personalization (SOUL.md, USER.md, WORKING.md content) — done in post-provision onboarding session

**Acceptance**: Running provisioner on a fresh config creates a fully working instance (minus Claude OAuth connection).

### 0C.5 — Create deprovision script

`deprovision-instance.sh <instance-name>` — clean removal:

1. Stop and disable all systemd services
2. Remove nginx config, reload
3. Remove systemd unit files
4. Optionally archive home directory to backups
5. Remove Linux user
6. Optionally purge tenant data from Supabase (delete all rows with matching `tenant_id`)

**Safety**: Requires `--confirm` flag. Archives by default, deletes only with `--purge`.

**Acceptance**: Clean removal with no leftover services or configs.

### 0C.6 — Test provisioner with throwaway instance

Create a test instance (`test-instance`) on the VPS:
1. Run tenant registration → new tenant in shared Supabase
2. Run full provisioner
3. Verify all services running
4. Verify MC login works with test email (sees test branding)
5. Deprovision cleanly

**Acceptance**: Full provision → test → deprovision cycle completes successfully.

---

## Phase 0D: Pif Migration (Optional)

**Goal**: Migrate Pif to use the platform directory for shared code. This makes Pif consistent with all other instances.

**This is optional and can be deferred.** Pif can continue running from `/root/` as-is. But if we want Pif to benefit from the same update mechanism, we should eventually point Pif's services at `/opt/assistant-platform/` too.

### 0D.1 — Point Pif's nginx at platform dist/

Update Pif's nginx config to serve MC frontend from `/opt/assistant-platform/mc/dist/` instead of `/root/projects/mission-control/dist/`.

### 0D.2 — Point Pif's MC API at platform server code

Update `mission-control-api.service` to run from `/opt/assistant-platform/mc/server/`.

### 0D.3 — Create Pif's branding.json

```json
{
  "assistantName": "Pif Laborman",
  "ownerName": "Pavol",
  "primaryColor": "#D8FF66",
  "logoUrl": "/pif-logo.svg"
}
```

Note: No feature toggles needed. Blog, landing, timeline are hardcoded as Pif-only in the router (0B.4). Allowed emails are in the `tenant_users` table (0B.5).

### 0D.4 — Verify Pif works on platform code

Full smoke test: meetpif.com loads, blog works, timeline works, Telegram responds, heartbeat fires.

**Acceptance**: Pif runs from platform code identically to before.

---

## Phase 1: Deploy Pif (Pavol's Girlfriend)

**Goal**: Get girlfriend's assistant running.

**Prerequisites**: Phase 0A + 0B + 0C complete.

### 1.1 — Pavol sets up accounts

Pavol handles (or guides girlfriend through):

| Step | Who | Action |
|------|-----|--------|
| 1.1a | Pavol | Register new tenant in Supabase via tenant registration script (shared project, new tenant_id) |
| 1.1b | Girlfriend | Create Telegram bot via @BotFather. Send token + her Telegram user ID to Pavol. |
| 1.1c | Girlfriend | Subscribe to Claude Code (Pro or Max) at claude.ai |
| 1.1d | Pavol | Fill in `instance.conf` with all collected values |

### 1.2 — Run provisioner

No DNS setup needed — all instances share `meetpif.com`. Tenant isolation is handled by auth, not by URL.

```bash
/opt/assistant-platform/bin/provision-instance.sh /path/to/rif.conf
```

Wait for all 14 phases to complete.

### 1.3 — Claude OAuth BYOK connection

User logs into MC, navigates to Settings → Claude Connection, and clicks "Connect Claude". This triggers the OAuth PKCE flow — user authenticates with Anthropic in the browser, and MC stores the encrypted tokens in `tenant_claude_credentials`. Server-side auto-refresh handles token lifecycle. No CLI access needed.

### 1.4 — Personalization session

Pavol sits with girlfriend (or does via Telegram) and fills in:
- **USER.md** — her name, timezone, work context, DND hours
- **SOUL.md** — tweak voice/tone if she wants (otherwise defaults are fine)
- **WORKING.md** — her current projects and priorities
- **branding.json** — pick a color, confirm assistant name

### 1.5 — Smoke test

- [ ] MC dashboard loads at `https://meetpif.com` (logged in as her email)
- [ ] Google SSO login works — sees Pif branding, not Pif
- [ ] Telegram bot responds to messages
- [ ] Heartbeat fires on schedule
- [ ] Morning briefing arrives (trigger manually for test)
- [ ] Evening standup arrives (trigger manually for test)
- [ ] Comment listener creates Claude session on MC comment
- [ ] QMD search works across her files
- [ ] Credential vault works
- [ ] All services survive `systemctl restart`

### 1.6 — Hand off

"Say hello to Pif." Girlfriend starts using it. Pavol monitors for the first few days.

---

## Phase 2: Scale & Polish

**Goal**: Make it easier to deploy more instances, add Workspace integration, harden operations.

### 2.1 — Google Workspace scope expansion

Extend the Google OAuth flow to request Calendar, Gmail, Drive scopes. When the user SSOs into MC, they also authorize Workspace access. Store the refresh token in the instance's logins table.

Replace GOG CLI's separate auth flow with the MC OAuth token. Scripts use the stored refresh token for Google API calls.

**Benefit**: One login, everything connected. No separate `gog-auth.sh` step.

### 2.2 — ~~Onboarding chat~~ **Pulled forward to Phase 0E**

Conversational onboarding chat UI shipped in 0E (2026-03-09). Steps 1-3 (Welcome, Naming, Personality) and background intelligence API implemented. Remaining steps (4-7: Google Workspace, Telegram deep link, Provisioning, First Task) to be added as future PRDs.

### 2.3 — Instance health dashboard

A view in Pif's MC (not the user's) showing all deployed instances:
- Service status (up/down)
- Last heartbeat time
- Supabase tenant data health
- Disk/RAM usage per instance

### 2.4 — Docker packaging

Package the platform directory as a Docker image:
- `Dockerfile` builds MC + installs all scripts/tools
- `docker-compose.yml` mounts user data volumes
- Published to GitHub Container Registry
- `docker pull` + `docker-compose up` for BYOS users

### 2.5 — Systemd resource limits

Add `MemoryMax`, `CPUQuota` to instance services to prevent one runaway instance from affecting others.

### 2.6 — Automated backups

Nightly backup of each instance's `~/memory/` and `~/life/` to an offsite location (S3, Backblaze B2, or Supabase Storage).

### 2.7 — Update notifications

When Pavol runs `update-platform.sh`, each instance's Telegram bot sends a notification: "Platform updated. New features: [changelog summary]."

---

## Phase 3: Monetization & Growth

**Goal**: Turn Pif into a product others can pay for.

### 3.1 — Pricing tiers (from spec Section 16)

| Tier | Price | What |
|------|-------|------|
| Starter | Free | Templates + docs. BYOS (Docker). Community support. |
| Managed | $49/mo | Pif deploys + maintains on shared infra. Monitoring, updates, support. |
| Dedicated | $99/mo | Own VPS. Pif deploys, user owns. Priority support. |

### 3.2 — Stripe integration

Payment processing for Managed/Dedicated tiers. Webhook triggers provisioner on successful subscription.

### 3.3 — Public activity feed

Opt-in `/live` route on MC showing sanitized activity feed. Marketing tool for prospective users.

### 3.4 — Landing page

`meetpif.com` or `meetpif.com/rif` — product landing page. "Your AI chief of staff you actually own."

### 3.5 — Polsia migration page

`/from-polsia` — revenue share calculator, side-by-side comparison, migration guide.

### 3.6 — Product Hunt launch

After 3+ successful deployments with real testimonials.

### 3.7 — $1M Challenge dashboard

Public build tracking Pif building a real SaaS (Rekon). Revenue counter, commit history, task feed.

---

## Execution Order & Dependencies

```
Phase 0A (Platform Foundation)
    └──→ Phase 0B (MC Refactoring)
              └──→ Phase 0C (Instance Provisioner)
                        ├──→ Phase 0D (Open Registration) [parallel]
                        │         └──→ Phase 0E (Onboarding Overhaul)
                        └──→ Phase 1 (Deploy Pif)
                                  └──→ Phase 2 (Scale & Polish)
                                            └──→ Phase 3 (Monetization)
```

**Critical path**: 0A → 0B → 0C → 1. 0D/0E run in parallel and feed into Phase 1.

---

## Infrastructure Dependencies

These are prerequisites that must exist before the provisioner can run.

### Node.js availability

Claude Code CLI is a standalone binary at `/usr/local/bin/claude-bin` (symlinked from `/usr/local/bin/claude`). Accessible to all users — no per-user install needed. Auth tokens are managed server-side via OAuth BYOK — the MC API writes per-tenant credentials to `/tmp/claude-tenants/<tenant_id>/.claude/` on demand. No per-user `claude login` needed.

Node.js is installed system-wide. Instance users need it for npm packages (e.g., comment-listener dependencies) but not for Claude Code or QMD themselves.

QMD is already installed system-wide at `/usr/bin/qmd`. No per-user install needed — each instance just needs its own `~/.config/qmd/index.yml` (collections config) and runs `qmd update` to build its index. The index is stored per-user under `~/.config/qmd/`.

**Verification**: `su - rif -c "node --version && npm --version"` should work.

### SSL certificate

No changes needed. meetpif.com already has a Cloudflare Origin CA cert. All instances share the same URL (`meetpif.com`), so no wildcard cert or per-subdomain certs required.

### Google OAuth redirect URI

Single redirect URI: `https://meetpif.com/api/auth/google/callback`. One URI for all tenants — the authenticated email maps to a tenant via the `tenants` table. No per-instance URIs needed.

### Telegram bot patches

The current `claude-code-telegram` project requires 3 patches that get lost on upgrade:
1. `validators.py` — extra dirs + tilde expansion fix
2. `sdk_integration.py` — dynamic CLAUDE.md loading

**Central storage**: Patches stored at `/opt/assistant-platform/patches/telegram/`:
```
/opt/assistant-platform/patches/telegram/
├── validators.py.patch
└── sdk_integration.py.patch
```

The provisioner applies these after installing `claude-code-telegram`. The `update-platform.sh` script re-applies patches after any telegram bot upgrade.

### Claude Code token refresh per instance

~~Per-instance systemd timers replaced by server-side auto-refresh (2026-03-13).~~

The MC API server's `refreshTenantTokensIfNeeded()` function auto-refreshes OAuth tokens within 5 min of expiry. Called on every `/api/internal/claude-config` request (from comment-listener, antfarm-dispatch, heartbeat). No per-instance timer needed.

Pif's own `~/scripts/refresh-claude-token.sh` (50-min timer) still runs separately — Pif doesn't use the tenant credential system.

The `instance-claude-refresh.service.tmpl` and `instance-claude-refresh.timer.tmpl` in the templates directory are now vestigial and can be removed during next provisioner cleanup.

### Telegram bot Python environment

`claude-code-telegram` is a Python project. Each instance needs:
- Python 3.11+ (already system-wide on the VPS)
- `uv` or `pip` for installing the bot and its dependencies
- Bot installed under the instance user's home (e.g., `~/.local/` or a venv)

The provisioner installs it via `uv pip install` or `pip install --user` under the instance user.

---

## Deferred from MVP (Explicit Scope Cuts)

These were in the original spec but are explicitly deferred. They are NOT in the provisioner or Phase 1.

| Component | Spec Reference | Deferred To | Reason |
|-----------|---------------|-------------|--------|
| **Ralph persona** | Spec Section 4.2, Step 2.11 | Phase 2 | Adds complexity (extra Linux user, permissions, SOUL.md). Girlfriend doesn't need delegated ops on day 1. |
| **GOG CLI** | Spec Section 4.2, Step 2.12 | Phase 2 (Google Workspace scope expansion) | Requires separate Google OAuth flow. Will be unified with MC SSO in Phase 2.1. |
| **Antfarm CLI** — ~~deferred~~ | — | **Included in MVP.** System-wide binary at `/usr/bin/antfarm`. Users can run workflows (`antfarm workflow run`) and check status, but cannot install/uninstall/update workflows. Antfarm tables need `tenant_id` + RLS (add to 0B.6 migration). |
| **Public activity feed** | Spec Section 8.4 | Phase 3 | Marketing feature, not core functionality. |
| **Custom skills** | Skills architecture | Phase 2+ | Users can't create skills in MVP. Platform skills only. |
| **Workflow overrides** | Workflow architecture | Phase 2+ | Users can't modify workflow logic in MVP. |

---

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| MC refactoring breaks Pif's instance | High | Git tag + backup taken. Pif stays on `/root/projects/mission-control/` until platform is verified. Phase 0B changes happen in the platform MC clone, not Pif's working copy. |
| Google OAuth consent screen rejected | Medium | Start with "Testing" mode (100 user limit). Apply for verification when ready to scale. |
| RLS misconfiguration leaks data between tenants | High | Defense-in-depth: API filters by tenant_id in application code AND RLS enforces at DB level. Test with two tenants before deploying Pif. Audit RLS policies in 0C.3. |
| Shared VPS resource contention | Medium | Offset heartbeat schedules. Add systemd resource limits (Phase 2.5). Monitor. |
| Claude Code subscription cost for users | Medium | Clear pricing docs. Claude Pro ($20/mo) is the minimum. Max ($100/mo) for heavy use. |
| Script path refactoring introduces bugs | Medium | Test with throwaway instance (0C.6) before deploying Pif. |
| ~~Girlfriend can't run `claude login`~~ | ~~Low~~ | ~~Eliminated by OAuth BYOK — user connects via MC settings in the browser. No CLI access needed.~~ |
| Claude OAuth token expires silently | Medium | Server-side auto-refresh on every `/api/internal/claude-config` call. Tokens refreshed within 5 min of expiry. If refresh fails, spawner gets an error response and retries. Risk reduced from High — no longer dependent on external timer reliability. |
| Telegram bot patches lost on upgrade | Medium | Patches stored centrally in platform. update-platform.sh re-applies after upgrade. |
| Google OAuth redirect URIs don't scale | ~~Eliminated~~ | Single shared URL (`meetpif.com`) — one redirect URI for all tenants. |

---

## Tracking

Update this section as phases complete.

| Phase | Status | Started | Completed | Notes |
|-------|--------|---------|-----------|-------|
| 0A | **Complete** | 2026-03-07 | 2026-03-07 | US-002→US-009. 269 tests. Platform at `/opt/assistant-platform/` fully operational. |
| 0B | **Deployed** | 2026-03-07 | 2026-03-08 | PR #13 merged, deployed to meetpif.com, migrations 001-005 + 007 applied + backfilled. Google SSO working. See notes below. |
| 0C | **Merged to main** | 2026-03-08 | 2026-03-08 | Antfarm run completed 12 stories. Reviewer fixes applied. Merged to main. Provisioner + deprovision scripts ready. |
| 0D (Open Reg) | **Deployed** | 2026-03-08 | 2026-03-08 | Open registration + onboarding wizard + security hardening. Merged to main. Migrations 008-009 applied. Provision watcher daemon running. See notes below. |
| 0E (Onboarding) | **Merged** | 2026-03-09 | 2026-03-09 | Conversational onboarding replacing wizard. 3 PRDs (Chat UI, Steps 1-3, Background Intel). All merged to assistant-platform main. Migration 010 ready. See notes below. |
| 1 | **Ready** | — | — | All prerequisites met. Claude OAuth BYOK deployed (2026-03-13). Migrations 001-005, 007-018 applied. Can provision first real instance. |
| 2 | Not started | — | — | Phase 2.2 (onboarding chat) pulled forward into 0E. |
| 3 | Not started | — | — | |

### 0B deployment notes (2026-03-08)

**Completed:**
- ✅ Platform clone updated (`/opt/assistant-platform/mc/` pulled + built)
- ✅ Deployed to meetpif.com via `redeploy.sh`
- ✅ Migrations 001-003 applied (tenants + tenant_users tables, Pif tenant seeded)
- ✅ Migrations 004-005 applied (tenant_id columns on 14 tables + indexes)
- ✅ All existing rows backfilled with Pif tenant_id — zero NULLs
- ✅ Migration 007 applied (role column on task_comments)
- ✅ Env vars set: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SUPABASE_SERVICE_KEY`
- ✅ Google SSO login working (dzurjanin.pavol@gmail.com → owner)
- ✅ Added `owner_name` column to tenants (set to "Pavol") — branding uses explicit name instead of deriving from email

**Migration fixes applied during deployment:**
- `task_attachments` → `comment_attachments` (004)
- `workflow_runs/steps/stories` → `antfarm_runs/steps/stories` (005)
- `activity_log` removed from 004 + 007 (table does not exist)

**Deferred:**
- Migration 006 (RLS policies) — skipped for now. The API now uses `SUPABASE_SERVICE_KEY` which bypasses RLS, but enabling RLS requires confirming no scripts use the anon key for data queries. Safe to enable later.
- `MC_JWT_SUB` env var not set (defaults to "owner")
- `GOOGLE_REDIRECT_URI` hardcoded in server code to `https://meetpif.com/api/auth/google/callback`

### 0C progress notes (2026-03-08)

**Antfarm run `80eb4c0d` — feature-dev workflow, 12 user stories:**
- US-001: platform.env + instance config schema (40 tests)
- US-002: SOUL.md.tmpl from Pif's SOUL.md (30 tests)
- US-003: TOOLS.md.tmpl from Pif's TOOLS.md (38 tests)
- US-004: CLAUDE.md, USER.md, WORKING.md templates (38 tests)
- US-005: pif-env, branding.json, telegram.env templates (40 tests)
- US-006: systemd service + timer templates (82 tests)
- US-007: verify-templates.sh comprehensive test (95 tests)
- US-008: register-tenant.sh with Supabase API (61 tests)
- US-009: provision-instance.sh phases 1-6 (109 tests)
- US-010: provision-instance.sh phases 7-11 (81 tests)
- US-011: deprovision-instance.sh (76 tests)
- US-012: verify-provision.sh integration test (64 tests)

**Reviewer feedback — 6 issues fixed manually after run:**
1. ✅ Python string injection in register-tenant.sh — switched from shell interpolation in Python heredocs to `os.environ[]`
2. ✅ INSTANCE_NAME format validation in deprovision-instance.sh — added same regex as provision-instance.sh to prevent path traversal
3. ✅ Sed delimiter escape in provision-instance.sh `render_template` — now escapes `|` (the delimiter) in addition to `&/\`
4. ✅ claude-refresh.service.tmpl — removed incorrect `ANTHROPIC_API_KEY_FILE` env; now sources `.pif-env` and fetches key via `pif-creds get Anthropic`
5. ✅ ALLOWED_USERS empty warning — provision-instance.sh now warns when Telegram bot would have no access control
6. ✅ verify-provision.sh dry-run — now checks all 11 phases complete, not just Phase 1

All 64 integration tests pass after fixes. Branch pushed to `origin/feat/phase-0c-instance-provisioner`.

**Antfarm dispatch bug found and fixed:**
- Retry exhaustion in `antfarm-dispatch.py` caused infinite reviewer loop — the dispatcher's context-based retry counter conflicted with the CLI's DB-based `retry_count`. When exhausted, `antfarm step fail` reset the step to pending instead of failing it. Fixed to directly mark step + run as failed via Supabase, bypassing the CLI's conflicting retry logic.

**0C completion:**
- ✅ Reviewer fixes committed
- ✅ Merged to main

**Remaining:** Test provisioner end-to-end with a throwaway instance (0C.6) — can be done as part of Phase 1 first deploy.

### 0D (Open Registration) deployment notes (2026-03-08)

**What shipped (two antfarm runs stacked on `feature/phase-0d-open-registration`):**

Run `57b1e57b` (completed) — Open registration feature:
- Google SSO auto-creates tenants (no more allowlist-only)
- OnboardingPage wizard (Welcome → Telegram Bot → Details → Submit/Provision)
- RequireOnboarding route wrapper redirects new users to onboarding
- Provision queue table + API endpoints (submit, status, retry)
- Provision watcher daemon polls queue and runs provision-instance.sh
- Bot token validation via Telegram API
- Rate limiting (1 pending provision per tenant)

Run `454b9796` (failed at test step, code changes complete) — Security hardening:
- US-001: Migration 009 — tenant_id on recordings + theme_settings tables
- US-002: Gate filesystem endpoints as owner-only (403 for non-Pif tenants)
- US-003: Gate skills, workflows, change-password as owner-only
- US-004: Tenant-scope recordings endpoints (all CRUD filtered by tenant_id)
- US-005: Tenant-scope theme settings (GET/PUT filtered by tenant_id)
- US-006: Bot token uniqueness check (prevents reuse across tenants)
- US-007: Race condition fix on auto-register (upsert + re-query)
- US-008: Status guard on onboarding submit (only when pending_onboarding) and retry (only when provision_failed)

**Infrastructure changes:**
- ✅ nginx + systemd switched to serve from `/opt/assistant-platform/mc/` (was `/root/projects/mission-control/`)
- ✅ Migration 008 applied (provision_queue table + tenants.status column)
- ✅ Migration 009 applied (tenant_id on recordings + theme_settings, backfilled, RLS policies added)
- ✅ Provision watcher daemon installed as systemd service, running

**Known test failures (14, all cosmetic):**
- `onboarding-submit.test.ts` (12 failures) and `onboarding-status-retry.test.ts` (2 failures) — brittle static string-matching tests that read source code with a fixed character window. The security hardening shifted code beyond the window. Not functional failures.

**Antfarm bugs fixed during this session:**
1. Retry exhaustion path in `antfarm-dispatch.py` skipped evaluator/notify/cleanup — added missing calls
2. Credential resolution in both `antfarm-dispatch.py` and `antfarm-evaluator.py` — now sources `~/.pif-env` for `pif-creds` fallback

### 0E (Onboarding Overhaul) notes (2026-03-09)

**What shipped:** Replaced the 0D form-based onboarding wizard with a conversational chat UI. Pulled forward Phase 2.2 (onboarding chat). Three PRDs executed via antfarm, all merged to `assistant-platform` main.

**Spec:** `~/projects/rif/docs/onboarding-spec.md` — 7-step conversational flow (Welcome → Naming → Personality → Google Workspace → Telegram deep link → Provisioning → First Task), background intelligence, post-onboarding email sequence, friction analysis.

**PRD 1 — Chat UI Component (antfarm run #34, `5281cbeb`):**
- 9 user stories implemented (US-001 through US-009)
- ChatMessage types + onboarding chat type system
- Chat container with sequential message reveal, typing indicator, Pif avatar
- Input types: text, URL, select, time
- Options message type (radio selection)
- Action buttons, progress bar, navigation (Back/Next)
- Branch: `feat/onboarding-chat-ui` → merged to main

**PRD 2 — Onboarding Steps 1-3 (antfarm run #35, `fa51e5eb`):**
- 7 user stories implemented (US-001 through US-007)
- State machine hook (`useOnboardingState`) with localStorage persistence
- Welcome, Naming, Personality step message builders
- Bridge to existing provision flow (submit + polling)
- API enhancements: quiet hours, LinkedIn URL, optional bot_token, name in JWT
- OnboardingPage rewrite using chat-based flow (old wizard removed)
- 137 new tests across 10 files
- Branch: `feat/onboarding-steps-1-3` → merged to main
- Note: review step stuck in `waiting` state (run marked `completed`), cosmetic antfarm bug

**PRD 3 — Background Intelligence API (antfarm run #36, `16ef07ff`):**
- 6 user stories implemented (US-001 through US-006)
- Migration 010: `background_intel` (JSONB), `background_intel_status`, `linkedin_status` columns on tenants
- Company lookup by email domain (freemail filter → website scrape for og:title/description)
- Web search via DuckDuckGo HTML for user name + company (extracts LinkedIn/Twitter/other mentions)
- Background intel pipeline orchestrator (runs company lookup + web search in parallel)
- Pipeline fires asynchronously via `setImmediate` on SSO auto-register — does not block login
- `GET /api/onboarding/background` — returns intel status + results for authenticated tenant
- `POST /api/onboarding/linkedin` — triggers Apify LinkedIn Profile Scraper, async polling for results
- In-memory rate limit: max 1 LinkedIn scrape per tenant per process lifetime
- 193 tests across 7 files
- Branch: `feature/background-intel-api` (on mission-control) → manually merged to assistant-platform main
- Manual merge required: PRD 3 was built on mission-control repo (path prefix `server/`) but target is assistant-platform (`mc/server/`). Existing auto-registration code (race-condition upsert, onboarding redirect, tenant status checks) preserved — only background intel trigger + name extraction added surgically.

**Merge notes:**
- PRDs 1+2 were merged directly to assistant-platform main (commits landed as individual story commits)
- PRD 3 required manual adaptation: path remapping (`server/` → `mc/server/`), preserving the superior auto-registration flow from 0D, skipping `google-oauth.test.ts` changes (assistant-platform already had correct auto-register test assertions)
- All three antfarm branches forked from the same mission-control commit (`b0783c0`), causing overlapping file conflicts between PRDs — resolved during merge

**Not yet applied:**
- ~~Migration 010 not yet run against Supabase~~ → **Applied 2026-03-12**
- ~~`APIFY_API_TOKEN` env var not yet set on the server~~ → **Set 2026-03-12** (in `platform.env` + `.pif-env`)
- ~~Resend email infrastructure (SPF/DKIM/DMARC DNS records on Cloudflare) not yet configured~~ → **Done**
- Steps 4-7 of onboarding flow (Google Workspace, Telegram deep link, Provisioning, First Task) — future PRDs

**Review suggestions (non-blocking, from antfarm run #36 reviewer):**
1. Move Apify token from query string to Authorization header
2. Make LinkedIn rate limit DB-backed instead of in-memory (survives restart)
3. Migrate static-analysis tests to behavioral tests
4. Extract background intel into its own module (out of index.ts)

### Multi-tenant template hardening (2026-03-12)

**Context:** Migration 012 (API-first RLS lockdown) was applied. Anon key is now read-only + tenant-scoped. All writes require service_role key or MC API.

**Changes shipped:**
- ✅ `pif-creds` — switched to service_role key for Supabase auth (backward-compat fallback to anon)
- ✅ `pif-env.tmpl` — added `PIF_SUPABASE_SERVICE_ROLE_KEY` export
- ✅ `TOOLS.md.tmpl` — documented API-first access model (anon=read-only, service_role=writes, frontend=MC API)
- ✅ `SOUL.md.tmpl` — task agency patterns reference service_role key for direct Supabase writes
- ✅ `USER.md.tmpl` — added `OWNER_EMAIL`, replaced static placeholder with `{{OWNER_CONTEXT}}` seeded from background intel JSONB
- ✅ `CLAUDE.md.tmpl` — documented service_role key in env and access model
- ✅ `provision-instance.sh` — added `SUPABASE_SERVICE_ROLE_KEY`, `OWNER_EMAIL`, `OWNER_CONTEXT` to template var list + export
- ✅ `provision-watcher.py` — added `build_owner_context()` function that converts `background_intel` JSONB (company, LinkedIn, web mentions) into readable markdown for USER.md; fetches from tenant row at provision time

**Migration status (updated 2026-03-12):**
- Applied: 001-005, 007-018
- Deferred: 006 (original RLS — superseded by 012+014)
- Note: 012 original SQL referenced wrong policy names (`tenant_isolation_*` vs actual `Allow anonymous *`). Fixed in repo. Media table excluded (doesn't exist yet).

---

*This document is the source of truth for Pif execution. Update it as work progresses. Don't let it drift from reality.*

### Post-0E infrastructure (2026-03-12 — 2026-03-13)

**MC Frontend API Migration (antfarm run #41, `2faf4568`):**
- Frontend now routes all data through the MC API server (no direct Supabase from browser)
- RLS enforced at DB level (migration 014) as defense-in-depth
- Drag-and-drop task reordering, PUT /api/tasks endpoint
- Deployed and running

**Multi-tenant completeness (migrations 013-018):**
- 013: Claude auth sessions + credentials tables
- 014: RLS enforcement (API-first lockdown)
- 015: tenant_id NOT NULL on core tables
- 016: tenant_id on agents, agent_workflow_config, antfarm_medic_checks (last 3 tables)
- 017: RLS policy tightening
- 018: Trigger tenant_id fix (record_task_status_transition copies tenant_id)
- All tables now have tenant_id with NOT NULL. Multi-tenant blocker fully cleared.

**MC frontend source consolidation (2026-03-13):**
- `mc/mc/src` is now a symlink → `../src`. Single canonical source at `mc/src/`.

**Tenant-scoped Claude execution (antfarm run #42, `bb459fc8`):**
- Claude OAuth BYOK — tenants connect their own Claude subscription via PKCE flow
- Encrypted token storage in `tenant_claude_credentials` (AES-256-GCM, HKDF per-tenant)
- Auto-refresh within 5 min of expiry via `refreshTenantTokensIfNeeded()`
- `POST /api/internal/claude-config` — internal endpoint for spawners (MC_API_TOKEN auth)
- `writeTenantCredentials()` — atomic write to `/tmp/claude-tenants/<tenant>/.claude/.credentials.json`
- comment-listener + antfarm-dispatch wired to use tenant credentials
- Onboarding seeds tenant config dir + CLAUDE.md template on first connection
- Disconnect cleans up credential files (preserves CLAUDE.md)
- **Note:** PR #6 wrote code to `server/src/` instead of `mc/server/src/`. Manually patched into canonical path. Antfarm verifier updated with path verification check to prevent recurrence.

**Risk register update:**
- "Claude OAuth token expires silently" → now mitigated by `refreshTenantTokensIfNeeded()` auto-refresh (5-min threshold) in addition to per-instance timer + alert.
