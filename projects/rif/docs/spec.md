# Rif — Specification Document

**Project**: Deploy-your-own AI chief of staff
**Codename**: Rif (also the name of the first deployed assistant — for Pavol's girlfriend)
**Author**: Pif
**Date**: 2026-02-28
**Status**: Updated 2026-03-01 — Polsia playbook integrated per Pavol's directive. New sections: 15 (Sub-Apps), 16 (Pricing), 17 (Distribution), 18 ($1M Challenge). Ready for Phase 0.

---

## 1. Vision

Rif is a deploy-your-own AI chief of staff. Polsia, but you own it.

Users define their goals. Rif works on them every night — planning, executing, reporting. They wake up to progress. Unlike Polsia ($49/mo + 20% revenue share, hosted on their infra), Rif runs on the user's own server, their own database, their own Claude subscription. No revenue share. No vendor lock-in. Full data ownership.

The first user is Pavol's girlfriend. The system reuses Pif's battle-tested scripts, Mission Control dashboard, memory architecture, and workflow engine — but scoped to a new identity, new Supabase project, and new Telegram bot.

**Core principle**: Pif is the template. Rif is the first fork. The onboarding system we build can produce more forks later.

**Positioning**: "Your AI co-founder you actually own. Tell it your goals. It works while you sleep. Wake up to progress." Same category as Polsia — but self-hosted, human-in-the-loop, zero revenue share.

**The daily cycle is the product.** Not the feature list, not the tech stack. The core value prop is: every day, your assistant plans work aligned to your goals, executes approved tasks, and reports results. This is what we sell, what we demo, and what the landing page leads with.

---

## 2. MVP Scope

What Rif gets on day one:

| Component | Description | Source |
|-----------|-------------|--------|
| **Mission Control** | Kanban task board, activity feed, credential vault | ~/projects/mission-control/ (fork) |
| **Telegram bot** | Conversational interface via Telegram | claude-code-telegram (fresh install) |
| **Heartbeat** | Autonomous task triage + execution on schedule | pif-heartbeat.sh (adapted) |
| **QMD** | Fast knowledge search across memory + life files | npm install -g @tobilu/qmd |
| **Memory layer** | WORKING.md, daily notes, life/ PARA structure | Directory scaffold + seed files |
| **Morning briefing** | Daily summary delivered to Telegram at user's wake time | morning-brief.yml (adapted) |
| **Evening standup** | EOD review, proposals, working memory update | evening-standup.yml (adapted) |
| **Nightly consolidation** | Auto-extract durable knowledge from daily notes into ~/life/ PARA files, sync auto-memory, rebuild QMD index | nightly-consolidation.yml (adapted) |
| **Credential system** | pif-creds CLI + encrypted logins table | pif-creds.js (copy as-is) |
| **Antfarm CLI** | Multi-agent workflow orchestration (feature dev, bug fix, security audit, etc.) | antfarm binary + workflow YAMLs (adapted) |
| **Comment system** | Supabase Realtime listener — spawns Claude session per MC task comment | comment-listener.js (adapted) |
| **MCP connections** | User can add their own MCP servers (Supabase, Slack, Notion, etc.) via ~/.mcp.json | Template + onboarding guidance |
| **Ralph persona** | Separate Linux user with restricted access — handles operations that need root delegation | Ralph user setup + SOUL.md |
| **GOG CLI** | Google Workspace integration (Gmail, Calendar, Drive, Contacts, Sheets, Docs) | Pre-installed, user authenticates their own Google account |

| **Pre-installed skills** | `antfarm-workflows` (workflow orchestration) + `designing-workflow-skills` (skill creation guide) | Copied from Pif's ~/.claude/skills/ |

**Explicitly NOT in MVP:**
- Blog / landing page / public website
- Loom Video Library
- Sentry integration
- Full skills library (only antfarm-workflows + designing-workflow-skills pre-installed — user builds more over time)

---

## 3. Architecture

### 3.1 Two Deployment Models

#### Option A: Shared VPS (Recommended for Pavol's Girlfriend)

Rif runs on Pavol's existing Hostinger VPS alongside Pif, isolated via a separate Linux user.

```
VPS (srv1381201.hstgr.cloud)
├── root (Pif)
│   ├── ~/projects/mission-control/   ← Pif's MC (port 443)
│   ├── ~/scripts/                     ← Pif's scripts
│   ├── ~/memory/                      ← Pif's memory
│   └── ...
│
└── rif (new Linux user)
    ├── ~/projects/mission-control/    ← Rif's MC (port 8443 or subdomain)
    ├── ~/scripts/                      ← Rif's scripts (copied from Pif)
    ├── ~/memory/                       ← Rif's memory
    ├── ~/agents/rif/                   ← Rif's identity (SOUL.md, TOOLS.md)
    ├── ~/life/                         ← Rif's PARA knowledge
    ├── ~/.claude/                      ← Rif's Claude config
    └── ~/.pif-env                      ← Rif's bootstrap credentials
```

**Pros:**
- Zero additional hosting cost ($0/mo)
- Pif can help manage/debug Rif's setup (same machine)
- Shared nginx — just add a new server block
- Fast to set up (hours, not days)

**Cons:**
- Shared CPU/RAM (current VPS: likely sufficient for 2 assistants)
- If VPS goes down, both assistants go down
- Slightly more complex isolation (separate user, careful permissions)
- Rif's user needs `claude` CLI installed under their own account

**Isolation approach:**
- Separate Linux user `rif` with own home directory
- `chmod 700 /home/rif` — Pif can't read Rif's files (and vice versa, unless explicitly granted)
- Separate Supabase project (different URL + keys)
- Separate Telegram bot (different token)
- Separate Claude Code authentication (own Anthropic account or shared with usage limits)
- Separate nginx server block (e.g., `meetpif.com:443` or `rif.meetpif.com:443`)
- Separate systemd services (`rif-telegram.service`, `rif-heartbeat.timer`, `rif-mc-api.service`)

#### Option B: BYOS (Bring Your Own Server)

User provisions their own VPS (Hostinger, DigitalOcean, Hetzner, etc.) and runs the full setup script.

**Pros:**
- Complete isolation
- User owns their infrastructure
- Scales independently

**Cons:**
- Additional cost (~$5-15/mo for a VPS)
- More setup steps (DNS, SSL, server hardening)
- User needs SSH access (Pavol's girlfriend would need hand-holding)

**Recommendation for MVP**: Start with **Option A** (shared VPS) for Pavol's girlfriend. Build the setup scripts to be portable enough that Option B works later with minimal changes.

---

### 3.2 External Accounts Required (Per User)

Each Rif deployment needs the user to create these accounts:

| Account | Purpose | Free Tier | Setup Difficulty |
|---------|---------|-----------|-----------------|
| **Supabase** | Database, auth, realtime | Yes (2 free projects) | Easy (web signup) |
| **Anthropic** | Claude Code subscription (Pro $20/mo or Max $100/mo) | No | Easy (web signup) |
| **Telegram** | Bot via BotFather | Yes | Easy (chat with @BotFather) |
| **Cloudflare** | DNS + SSL (if custom domain) | Yes | Medium (domain transfer/setup) |
| **GitHub** | Mission Control repo fork (optional) | Yes | Easy |

**Total minimum cost**: ~$20/mo (Claude Pro subscription). Claude Max ($100/mo) recommended for heavier usage (frequent heartbeats, long Telegram sessions).

**Note**: User gets their own Claude Code subscription (Pro or Max). This provides terminal-based Claude Code access with included usage. The subscription is tied to their Anthropic account and authenticated via `claude login`.

---

## 4. Onboarding Flow

### 4.1 Philosophy

The user should never need to figure out what to do next. The onboarding is a guided conversation — Pif (via the meetpif.com onboarding chat or a shared Telegram channel) walks the user through each step, confirms completion, and moves to the next.

The onboarding assistant runs on **Pif's infrastructure and Claude credentials**. Once setup is complete, the user's own assistant (Rif) takes over on their own credentials.

### 4.2 Onboarding Steps

The onboarding is divided into 3 phases:

#### Phase 1: Account Creation (User does in browser, guided by chat)

**Step 1.1 — Supabase project (near-zero-friction setup)**
- Chat: "Let's create your database. Go to supabase.com and sign up with GitHub or email."
- Once signed up, chat guides them to create a **Personal Access Token** (Settings → Access Tokens → Generate new token)
- User pastes the token into the onboarding chat
- **From here, Pif does everything automatically via the Supabase Management API:**
  1. Creates a new Supabase project (name derived from assistant name, region auto-selected)
  2. Waits for project to be ready (~60s)
  3. Extracts project URL, anon key, and service role key from the API response
  4. Runs all 13 MC migrations programmatically
  5. Seeds initial data (schedules, default project)
  6. Creates the `logins` table and seeds bootstrap credentials
  7. Confirms success: "Your database is ready. I created a project called [name] in [region]."
- **User interaction: 2 clicks** (create token, paste it). Everything else is automated.
- The PAT is used only during setup and is NOT stored — it's discarded after project creation.

This is similar to how Lovable handles Supabase onboarding: user authenticates once, platform does the rest.

**Supabase Management API endpoints used:**
- `POST /v1/projects` — create project
- `GET /v1/projects/{ref}` — poll for ready status
- `GET /v1/projects/{ref}/api-keys` — extract anon + service role keys
- `POST /v1/projects/{ref}/database/query` — run migrations via SQL

**Fallback** (if Management API isn't available or user prefers manual):
- Chat walks user through creating project manually in the dashboard
- User copies project URL + anon key + service role key from Settings → API
- Chat provides a single SQL file to paste into the SQL Editor (all migrations bundled)

**Step 1.2 — Telegram bot**
- Chat: "Now let's create your Telegram bot. Open Telegram, search for @BotFather, send /newbot"
- User provides: bot token + their Telegram user ID
- Chat: "Send /start to your new bot. I'll verify it works."
- Chat confirms bot responds

**Step 1.3 — Claude Code subscription**
- Chat: "Go to claude.ai, create an account, and subscribe to Claude Pro ($20/mo) or Max ($100/mo)."
- Chat: "Now open your terminal and run `claude login` — follow the browser prompt to authenticate."
- Chat verifies Claude Code works with a test command (`claude -p "Say hello" --max-turns 1`)

**Step 1.4 — Choose your assistant's name**
- Chat: "What do you want to call your assistant?"
- User provides: name (e.g., "Rif")
- Chat generates SOUL.md, TOOLS.md, CLAUDE.md from templates with the chosen name

#### Phase 2: Server Setup (Pif does, with user watching)

For shared VPS (Option A):

**Step 2.1 — Create Linux user**
```bash
useradd -m -s /bin/bash rif
chmod 700 /home/rif
```

**Step 2.2 — Install Claude Code CLI**
```bash
su - rif
npm install -g @anthropic-ai/claude-code
claude login  # browser-based OAuth — user authenticates with their Claude subscription
```

**Step 2.3 — Deploy credentials system**
- Copy `pif-creds.js` to `/home/rif/scripts/`
- Create `/home/rif/.pif-env` with user's Supabase URL + anon key + chosen master password
- Create `logins` table in user's Supabase via migrations
- Seed initial credentials (Telegram token, master password)

**Step 2.4 — Deploy Mission Control**
- Clone MC repo into `/home/rif/projects/mission-control/`
- Run Supabase migrations against user's project (13 migrations)
- Configure `.env` with user's Supabase URL + anon key
- Configure `/etc/mission-control-api-rif.env` with MC secrets
- Build frontend (`npm run build`)
- Add nginx server block for rif's domain/subdomain
- Add systemd service for rif's MC API

**Step 2.5 — Deploy Telegram bot**
- Install claude-code-telegram under rif user
- Apply patches (validators.py + sdk_integration.py)
- Create `/home/rif/.env` with bot config
- Create + enable systemd service

**Step 2.6 — Deploy memory structure**
```
/home/rif/
├── agents/rif/
│   ├── SOUL.md          (generated from template + user's name choice)
│   ├── TOOLS.md         (generated from template + user's actual credentials/services)
│   └── HEARTBEAT.md     (adapted from Pif's, simplified)
├── memory/
│   ├── WORKING.md       (empty initial state)
│   ├── MISSION.md       (user's mission + top 3 goals — drives daily cycle)
│   ├── USER.md          (user profile — filled during onboarding)
│   └── daily/           (empty, first note created by heartbeat)
├── life/
│   ├── projects/
│   ├── areas/
│   ├── resources/
│   └── archives/
└── .claude/
    ├── CLAUDE.md        (bootstrap: "You are [Name]...")
    └── projects/-/memory/
        └── MEMORY.md    (initial auto-memory snapshot)
```

**Step 2.7 — Deploy heartbeat + workflows**
- Copy adapted heartbeat script to `/home/rif/scripts/`
- Copy adapted morning-brief.yml + evening-standup.yml + nightly-consolidation.yml
- Copy pif-runner.py
- Copy telegram-send.sh
- Register schedules in user's Supabase (morning brief, evening standup, heartbeat, nightly consolidation)
- Create systemd timer for heartbeat (every 30 min)
- Create heartbeat-watchdog

**Step 2.8 — Install QMD**
```bash
su - rif
npm install -g @tobilu/qmd
qmd update  # initial index build
```

**Step 2.9 — Deploy Antfarm CLI**
- Install antfarm binary under rif user
- Copy adapted workflow YAML files (feature-dev, bug-fix, security-audit, etc.)
- Configure antfarm to use rif's Supabase (export env vars in rif's profile)
- Verify `antfarm medic run` passes

**Step 2.10 — Deploy comment system**
- Copy comment-listener.js to `/home/rif/scripts/`
- Configure with rif's Supabase URL + anon key (fetches service role from logins at runtime)
- Create + enable systemd service (`rif-comment-listener.service`)
- Verify Realtime subscription connects

**Step 2.11 — Set up Ralph persona**
- Create `ralph-rif` Linux user (or `ralph` if this is a BYOS deploy)
- Grant traversal: `chmod o+x /home/rif`
- Create Ralph's SOUL.md (restricted permissions, delegated-ops persona)
- Configure Claude Code under ralph user with constrained settings.json
- Ralph handles: operations requiring different permission scope, root-delegated tasks

**Step 2.12 — Install GOG CLI**
```bash
su - rif
# Install GOG binary
# User authenticates their own Google account during onboarding:
bash ~/scripts/gog-auth.sh
```
- Pre-configured in TOOLS.md with the ready-to-use recipe
- User connects their Google account (Gmail, Calendar, Drive, etc.)

**Step 2.13 — Configure MCP connections**
- Create `~/.mcp.json` with Supabase MCP pre-configured (using rif's PAT)
- Template includes commented-out slots for Slack, Notion, HubSpot
- Chat: "Want to connect any other services? Slack, Notion, HubSpot? You can add these anytime later."

#### Phase 3: Personalization (User does via chat)

**Step 3.1 — Mission & Goals (Vision-First Onboarding)**
- Chat: "Before anything else — what do you want your assistant to accomplish? What's your mission?"
- Collects: 1-3 sentence mission statement + top 3 goals
- Chat: "These goals drive everything your assistant does. Every morning it plans work toward them. Every night it reports progress."
- Writes to `~/memory/MISSION.md` — referenced by every heartbeat, briefing, and daily cycle
- This is the first thing the user does. Everything else flows from it. (Copied from Polsia's vision-first onboarding — the single strongest UX decision they made.)

**Step 3.2 — User profile**
- Chat: "Tell me a bit about yourself so your assistant knows who you are."
- Collects: name, timezone, work context, communication preferences, DND hours
- Writes to USER.md

**Step 3.3 — Initial projects**
- Chat: "What are you working on right now? List your current projects."
- Creates initial project entries in Supabase + WORKING.md

**Step 3.4 — Briefing preferences**
- Chat: "What time do you want your morning briefing? And your evening review?"
- Updates schedule entries in Supabase

**Step 3.5 — Personality tuning**
- Chat: "How should your assistant communicate? Formal? Casual? Brief? Detailed?"
- Updates SOUL.md voice/tone section

**Step 3.6 — Smoke test**
- Chat triggers a heartbeat cycle → verifies Telegram delivery
- Chat sends a test task to Mission Control → verifies it appears on the board
- Chat: "Send a message to your bot in Telegram. I'll verify it responds."
- All green → "Your assistant is ready. Say hello!"

---

## 5. Templating System

The key to making this repeatable is a set of templates that get personalized during onboarding.

### 5.1 Templates to Create

| Template | Source | Variables |
|----------|--------|-----------|
| `SOUL.md.tmpl` | ~/agents/pif/SOUL.md | `{{NAME}}`, `{{OWNER_NAME}}`, `{{VOICE_TONE}}`, `{{DND_START}}`, `{{DND_END}}`, `{{TIMEZONE}}` |
| `TOOLS.md.tmpl` | ~/agents/pif/TOOLS.md | `{{NAME}}`, `{{VPS_HOST}}`, `{{SUPABASE_URL}}`, `{{TELEGRAM_BOT_USERNAME}}`, `{{DOMAIN}}` |
| `CLAUDE.md.tmpl` | ~/.claude/CLAUDE.md | `{{NAME}}`, `{{OWNER_NAME}}`, `{{AGENT_DIR}}` |
| `USER.md.tmpl` | ~/memory/USER.md | `{{OWNER_NAME}}`, `{{TIMEZONE}}`, `{{WORK_CONTEXT}}`, `{{COMMS_PREFS}}`, `{{DND_HOURS}}` |
| `WORKING.md.tmpl` | ~/memory/WORKING.md | `{{NAME}}` (minimal initial state) |
| `MISSION.md.tmpl` | ~/memory/MISSION.md | `{{MISSION_STATEMENT}}`, `{{GOAL_1}}`, `{{GOAL_2}}`, `{{GOAL_3}}` — drives daily cycle priorities |
| `MEMORY.md.tmpl` | ~/.claude/projects/-/memory/MEMORY.md | `{{NAME}}`, `{{OWNER_NAME}}`, condensed system state |
| `HEARTBEAT.md.tmpl` | ~/agents/pif/HEARTBEAT.md | `{{SERVICES_TO_MONITOR}}`, `{{SUPABASE_SCHEMA}}` |
| `morning-brief.yml.tmpl` | ~/workflows/morning-brief.yml | `{{HOME_DIR}}`, `{{TELEGRAM_CHAT_ID}}` |
| `evening-standup.yml.tmpl` | ~/workflows/evening-standup.yml | `{{HOME_DIR}}`, `{{TELEGRAM_CHAT_ID}}`, `{{MC_PROJECT_DIR}}` |
| `.env.telegram.tmpl` | /root/.env | `{{BOT_TOKEN}}`, `{{BOT_USERNAME}}`, `{{ALLOWED_USERS}}`, `{{SUPABASE_URL}}`, `{{SUPABASE_ANON_KEY}}` |
| `nginx.conf.tmpl` | MC nginx config | `{{DOMAIN}}`, `{{CERT_PATH}}`, `{{KEY_PATH}}`, `{{MC_DIST_PATH}}`, `{{API_PORT}}` |
| `mc-api.env.tmpl` | /etc/mission-control-api.env | `{{API_TOKEN}}`, `{{LOGIN_PASSWORD}}`, `{{JWT_SECRET}}` |
| `pif-env.tmpl` | ~/.pif-env | `{{SUPABASE_URL}}`, `{{SUPABASE_ANON_KEY}}`, `{{CREDS_PASSWORD}}` |
| `settings.json.tmpl` | ~/.claude/settings.json | `{{HOME_DIR}}`, `{{PIF_ENV_PATH}}` |
| `comment-listener.tmpl` | ~/scripts/comment-listener.js | `{{SUPABASE_URL}}`, `{{SUPABASE_ANON_KEY}}`, `{{CREDS_PASSWORD}}` |
| `ralph-soul.md.tmpl` | ~/agents/ralph/SOUL.md | `{{ASSISTANT_NAME}}`, `{{HOME_DIR}}` |
| `mcp.json.tmpl` | ~/.mcp.json | `{{SUPABASE_MCP_URL}}`, `{{SUPABASE_PAT}}` |
| `antfarm-env.tmpl` | Antfarm env exports in shell profile | `{{SUPABASE_URL}}`, `{{SUPABASE_SERVICE_ROLE_KEY}}` |
| `skills/` | Pre-installed skills directory (antfarm-workflows + designing-workflow-skills) | Copied as-is from Pif's ~/.claude/skills/ |

### 5.2 Template Engine

Simple `sed`/`envsubst` replacement. No need for Jinja or Handlebars — these are one-time renders during setup. A single `rif-setup.sh` script reads a config file with all variables and renders all templates.

```bash
# Example: rif-setup.sh reads rif.config and renders templates
source rif.config
envsubst < templates/SOUL.md.tmpl > /home/$AGENT_NAME/agents/$AGENT_NAME/SOUL.md
```

---

## 6. Setup Script Architecture

One master script (`rif-deploy.sh`) that Pif runs, plus an interactive wrapper for the onboarding chat.

### 6.1 rif-deploy.sh

```
rif-deploy.sh <config-file>
  ├── Phase 1:  Validate config (all required vars present)
  ├── Phase 2:  Create Linux user + directory structure
  ├── Phase 3:  Install CLI tools (claude, qmd, uv, claude-code-telegram, gog, antfarm)
  ├── Phase 4:  Render templates → write config files
  ├── Phase 5:  Run Supabase migrations (via Management API)
  ├── Phase 6:  Seed initial data (projects, schedules, logins)
  ├── Phase 7:  Deploy Mission Control (clone, build, nginx, systemd)
  ├── Phase 8:  Deploy Telegram bot (install, patch, systemd)
  ├── Phase 9:  Deploy heartbeat + workflows (scripts, timers)
  ├── Phase 10: Deploy Antfarm (binary, workflow YAMLs, env config)
  ├── Phase 11: Deploy comment listener (systemd)
  ├── Phase 12: Set up Ralph persona (user, permissions, SOUL.md)
  ├── Phase 13: Configure GOG (install, auth placeholder)
  ├── Phase 14: Configure MCP connections (~/.mcp.json)
  ├── Phase 15: Install pre-built skills (antfarm-workflows, designing-workflow-skills)
  ├── Phase 16: Smoke test (heartbeat cycle, Telegram ping, MC health, antfarm medic)
  └── Phase 17: Report success + hand off to user
```

Each phase is idempotent — can re-run safely if interrupted.

### 6.2 Onboarding Chat

A Claude-powered chat hosted on meetpif.com (or a Telegram channel) that:
1. Asks the user questions (account creation, preferences)
2. Collects credentials securely
3. Generates `rif.config` from answers
4. Calls `rif-deploy.sh` behind the scenes
5. Reports progress back to the user
6. Runs smoke tests and confirms success

**Runs on Pif's Claude credentials** — the user doesn't need their own Claude access until the setup is complete. Once their assistant is deployed, they switch to their own API key.

**Implementation**: A dedicated onboarding skill or a standalone FastAPI endpoint that wraps the Claude API. The chat interface can be a simple React page on meetpif.com (e.g., `meetpif.com/onboard`) with a WebSocket connection to the backend.

---

## 7. Shared VPS Considerations

### 7.1 Resource Requirements

Current VPS usage (Pif alone):
- CPU: Low (spikes during heartbeat Opus sessions)
- RAM: ~2-4GB typical
- Disk: ~10GB used

Adding Rif:
- CPU: +intermittent spikes (heartbeat every 30 min, offset from Pif's schedule)
- RAM: +1-2GB (MC API + Telegram bot + occasional Claude sessions)
- Disk: +2-5GB (MC build, memory files, daily notes)

**Recommendation**: If VPS has 8GB+ RAM, this is comfortable. If 4GB, consider upgrading or staggering heartbeat schedules (Pif at :00/:30, Rif at :15/:45).

### 7.2 Port Allocation

| Service | Pif | Rif |
|---------|-----|-----|
| nginx HTTPS | 443 | 443 (shared, different server blocks) |
| MC API | 8091 | 8092 |
| Telegram bot API | (internal) | (internal) |

### 7.3 Process Isolation

```
systemctl list-units 'rif-*'
  rif-telegram.service     ← User=rif
  rif-mc-api.service       ← User=rif
  rif-heartbeat.timer      ← triggers rif-heartbeat.service (User=rif)
```

All rif services run as Linux user `rif`. Cannot read Pif's files, cannot kill Pif's processes.

### 7.4 Backup Strategy

- Rif's memory files: `/home/rif/memory/`, `/home/rif/life/`
- Rif's Supabase: user's own project (Supabase handles backups)
- Rif's MC: git repo (push to user's GitHub)

---

## 8. Mission Control Adaptations

The current MC is single-user, single-assistant. For Rif, we need:

### 8.1 Fork, Don't Multi-Tenant

Each assistant gets their own MC deployment. No shared database, no multi-tenant auth. This is simpler, more isolated, and matches the "each user brings their own Supabase" model.

**What changes per fork:**
- `.env` — Supabase URL + anon key
- `supabase/seed.sql` — initial projects (user-specific)
- Landing page content (optional — can remove entirely for MVP)
- Blog page (remove — not in MVP scope)
- Pif logo/branding → user's assistant branding (name, colors)
- Sentry DSN → remove (not in MVP)

**What stays the same:**
- All React components, hooks, utilities
- Express API (including credential vault, file browser, skill editor)
- All Supabase migrations
- Kanban board, activity feed, task detail panel
- Login page (just update the password)

### 8.2 Branding Variables

A small config object in the MC frontend that controls:
```typescript
// src/config/branding.ts
export const BRANDING = {
  assistantName: 'Rif',          // from template
  ownerName: 'User',             // from template
  primaryColor: '#f59e0b',       // user picks during onboarding
  logoUrl: '/rif-logo.svg',      // generated or placeholder
  showBlog: false,               // MVP: off
  showLanding: false,            // MVP: off
  showTimeline: false,           // MVP: off
};
```

This is the minimal change needed to make MC feel like "yours" without rewriting components.

### 8.3 Named Roles in Activity Feed

Polsia names its agents (CEO, Engineer, Growth Manager) — it makes the product feel like a team, not a tool. Rif doesn't fake separate agents, but frames capabilities as named roles in the UI.

**Implementation**: Each activity feed entry and task comment includes a `role` tag showing which capability performed the action:

| Role | Maps To | Displayed As |
|------|---------|-------------|
| Scheduler | Heartbeat triage + schedule runner | "Scheduler" |
| Briefer | Morning brief + evening standup | "Briefer" |
| Builder | Antfarm feature-dev / bug-fix workflows | "Builder" |
| Memory Keeper | Nightly consolidation + QMD | "Memory Keeper" |
| Inbox Manager | Comment listener + Telegram handler | "Inbox Manager" |
| Ops | Ralph persona + service restarts | "Ops" |

**DB change**: Add `role` column (nullable text) to `task_comments` and `activity_log` tables. Populated by scripts when posting activity. MC frontend renders as a colored tag next to the author name.

**Why**: Makes the assistant feel capable and multi-faceted. "Your Scheduler moved 3 tasks" reads better than "pif updated status." Also helps users understand what their assistant actually does — each role is a capability they're paying for.

### 8.4 Public Activity Feed (Optional)

Polsia's polsia.com/live shows a real-time public feed of agent activity. Rif should support this as an opt-in feature.

**Implementation**: A public route on the MC frontend (`/live` or `/activity`) that shows a read-only, non-authenticated view of the activity feed. Controlled by a toggle in MC settings:

```typescript
// src/config/branding.ts
export const BRANDING = {
  // ... existing fields ...
  showPublicFeed: false,  // opt-in: expose activity feed publicly
  publicFeedUrl: '/live',
};
```

**What's shown**: Role name, action summary, timestamp. **What's NOT shown**: Task content, file paths, credentials, anything in the credential vault. The public feed is a marketing tool — "Watch your assistant work" — not a full audit log.

**Why**: Trust-building for prospective users. Also useful for the $1M Challenge / public build (Section 18). Polsia's live feed is one of their best conversion tools.

---

## 9. Heartbeat Adaptations

Rif's heartbeat is simpler than Pif's (no antfarm, no GOG, fewer services).

### 9.1 Mission-Driven HEARTBEAT.md

The heartbeat is the engine of the daily cycle. Every 30 minutes, it triages what to work on — prioritized by the user's goals in `~/memory/MISSION.md`.

The triage command checks:
- **MISSION.md alignment** — are there tasks on the board that map to the user's top 3 goals? If not, propose some.
- systemctl status of rif-telegram, nginx, rif-mc-api
- Disk and RAM usage
- Daily note existence
- Stale high-priority tasks from Supabase
- Open TODO tasks (same query pattern as Pif)

**Removed from Pif's version:**
- Antfarm medic check
- GOG API health
- Antfarm run status queries
- Multiple complex service checks

### 9.2 Simplified Auto-Resolve

- Restart rif-telegram, rif-mc-api if down
- No GOG token refresh (user adds GOG later if they want)
- No antfarm run resume

### 9.3 Schedule Offset

If sharing VPS with Pif, offset heartbeat by 15 minutes to avoid CPU contention:
- Pif: `:00` and `:30`
- Rif: `:15` and `:45`

---

## 10. Briefing Adaptations

### 10.1 Morning Brief

Simplified gather step:
- Today's daily note + WORKING.md (same)
- Git activity across ~/projects/ (same pattern, different home dir)
- Task board metrics from user's Supabase (same queries)
- System health from heartbeats table (same)

**Removed:**
- Skill changes (no skills in MVP)
- Deployment checks (no blog/landing)
- Workflow run metrics (no antfarm)

### 10.2 Evening Standup

Simplified:
1. `gather` — today's note, WORKING.md, Telegram interactions
2. `self-review` — bottlenecks, proposals (same pattern)
3. `summarize` — EOD summary
4. `update-working` — rewrite WORKING.md
5. `deliver` — send to Telegram

**Removed:**
- `log-proposals` (simplify — include proposals inline in summary)
- `update-timeline` (no blog/landing in MVP)

---

## 11. Credential Flow

### 11.1 During Onboarding (Pif's Credentials)

The onboarding chat runs on Pif's Anthropic API key. The user doesn't need Claude access yet. Pif's Claude is the "installer."

### 11.2 After Deployment (User's Credentials)

Once deployed, Rif runs on the user's own:
- Claude Code subscription (Pro/Max — for heartbeat, Telegram bot, briefings)
- Supabase project (for all data storage)
- Telegram bot token (for messaging)

The handoff is explicit: "Your assistant is now running on your own subscription. Pif is no longer involved."

### 11.3 Credential Storage

Same pattern as Pif:
- `/home/rif/.pif-env` — bootstrap trio (Supabase URL, anon key, master password)
- `logins` table in user's Supabase — everything else (encrypted AES-256-GCM)
- `pif-creds get <service>` — CLI to fetch any credential

(The CLI is named `pif-creds` but it's generic — it just reads from a Supabase `logins` table. We can rename it to `creds` or `rif-creds` for clarity.)

---

## 12. Security Considerations

### 12.1 Shared VPS Risks

- **Privilege escalation**: Rif user has no sudo. Can't read /root/ (Pif's home). Can't kill Pif's processes.
- **Resource exhaustion**: A runaway Rif heartbeat could consume CPU/RAM. Mitigate with `systemd` resource limits (MemoryMax, CPUQuota).
- **Credential isolation**: Rif's `.pif-env` is `chmod 600` under rif user. Pif cannot read it (unless root — but Pif IS root, so add explicit policy: "Pif does not read Rif's credentials").
- **Network isolation**: Both share the same IP. No conflict if using different domains/subdomains via nginx.

### 12.2 Onboarding Security

- User credentials (API keys, tokens) are transmitted via chat. The onboarding chat must:
  - Use HTTPS only
  - Not log credentials in plaintext
  - Immediately encrypt and store in user's Supabase logins table
  - Delete from chat context after storage

### 12.3 Claude Code Permissions

Rif's `settings.json` restricts:
- Cannot access /root/ (Pif's files)
- Cannot access other users' home directories
- Cannot run destructive system commands (same deny list as Pif)
- Cannot read/write Rif's `.pif-env` directly

---

## 13. Domain Strategy

**Decision**: Hosted on **meetpif.com** as a path-based route or subdomain. Each deployed assistant gets their own MC login — no separate domain needed for MVP.

For Pavol's girlfriend: she navigates to her MC URL on meetpif.com, logs in with her own password, and sees her own task board backed by her own Supabase. Pif's MC and Rif's MC are separate nginx server blocks on the same domain (or a subdomain like `rif.meetpif.com`).

For future users with BYOS: they can bring their own domain and point it at their own server.

---

## 14. Task Breakdown

### Phase 0: Templates + Setup Script (Foundation)

| # | Task | Priority | Est. |
|---|------|----------|------|
| 0.1 | Extract branding config from Mission Control (BRANDING object) | P1 | 2h |
| 0.2 | Create all 18 template files (SOUL.md.tmpl, TOOLS.md.tmpl, ralph-soul.md.tmpl, mcp.json.tmpl, etc.) | P1 | 6h |
| 0.3 | Write `rif-deploy.sh` — master setup script (17 phases) | P1 | 8h |
| 0.3a | Build Supabase auto-provisioner (Management API: create project, run migrations, extract keys) | P1 | 4h |
| 0.4 | Write `rif.config.example` — documented config file | P1 | 1h |
| 0.5 | Rename `pif-creds` to generic `assistant-creds` (or keep as-is) | P2 | 1h |
| 0.6 | Create simplified HEARTBEAT.md template | P1 | 2h |
| 0.7 | Create simplified morning-brief + evening-standup + nightly-consolidation workflow templates | P1 | 4h |
| 0.8 | Create Antfarm workflow templates (adapted from Pif's 5 workflows) | P1 | 3h |
| 0.9 | Create comment-listener.js template (adapted, parameterized for user's Supabase) | P1 | 2h |
| 0.10 | Create Ralph user setup script (user creation, permissions, SOUL.md, traversal grants) | P1 | 2h |
| 0.11 | Create GOG install + auth script template | P1 | 1h |
| 0.12 | Create MCP config template (~/.mcp.json with Supabase pre-configured, slots for user additions) | P1 | 1h |
| 0.13 | Package pre-installed skills (antfarm-workflows + designing-workflow-skills) for copy into user's ~/.claude/skills/ | P1 | 30m |
| 0.14 | Create `MISSION.md.tmpl` — mission statement + goals template, referenced by heartbeat + briefings | P1 | 1h |
| 0.15 | Add `role` column to `task_comments` + `activity_log` tables, update MC frontend to render role tags | P1 | 3h |
| 0.16 | Update heartbeat template to reference MISSION.md for goal-aligned task triage | P1 | 2h |
| 0.17 | Test full deploy script on a throw-away Linux user on current VPS | P1 | 4h |

### Phase 1: Deploy Rif (Pavol's Girlfriend)

| # | Task | Priority | Est. |
|---|------|----------|------|
| 1.1 | Girlfriend creates Supabase account + generates PAT (Pif auto-provisions project) | P1 | — |
| 1.2 | Girlfriend creates Telegram bot via BotFather | P1 | — |
| 1.3 | Girlfriend subscribes to Claude Pro/Max + runs `claude login` | P1 | — |
| 1.4 | Set up subdomain on meetpif.com (nginx server block + Cloudflare DNS) | P1 | 30m |
| 1.5 | Run `rif-deploy.sh` with girlfriend's credentials | P1 | 1h |
| 1.6 | Personalization session (USER.md, projects, schedule, voice) | P1 | 1h |
| 1.7 | Smoke test: heartbeat → Telegram, MC login, morning brief | P1 | 30m |
| 1.8 | Hand off: "Say hello to Rif" | P1 | — |

### Phase 2: Onboarding Chat (Scalable Version)

| # | Task | Priority | Est. |
|---|------|----------|------|
| 2.1 | Design onboarding conversation flow (state machine) | P2 | 3h |
| 2.2 | Build onboarding chat backend (FastAPI + Claude API) | P2 | 8h |
| 2.3 | Build onboarding chat frontend (React page on meetpif.com) | P2 | 6h |
| 2.4 | Integrate chat with rif-deploy.sh (chat triggers deploy phases) | P2 | 4h |
| 2.5 | Test end-to-end: non-technical user completes onboarding | P2 | 4h |

### Phase 2b: Polsia-Competitive Features

| # | Task | Priority | Est. |
|---|------|----------|------|
| 2b.1 | Build public activity feed route (`/live`) with privacy-safe filtering | P2 | 4h |
| 2b.2 | Build Polsia migration landing page (`/from-polsia`) with revenue share calculator | P2 | 4h |
| 2b.3 | Create sub-app templates (landing page, status page, contact form, micro-SaaS scaffold) | P2 | 8h |
| 2b.4 | Set up `*.rif.app` DNS wildcard + deployment pipeline for sub-apps | P2 | 4h |
| 2b.5 | Product Hunt launch prep (screenshots, copy, testimonials from 3+ users) | P2 | 6h |
| 2b.6 | Create Twitter @rif_app account + daily automation for "here's what Rif did today" threads | P2 | 3h |
| 2b.7 | Build $1M Challenge dashboard at `challenge.meetpif.com` (MC public feed + Stripe revenue widget) | P3 | 8h |
| 2b.8 | Write Polsia comparison blog posts (meetpif.com) — "Why No Revenue Share" / "Polsia vs Rif" | P2 | 4h |

### Phase 3: Polish + Extras (Post-MVP)

| # | Task | Priority | Est. |
|---|------|----------|------|
| 3.1 | MC branding customization UI (pick colors, name, logo in settings) | P3 | 4h |
| 3.2 | BYOS deployment guide (user runs on their own server) | P3 | 3h |
| 3.3 | Systemd resource limits (MemoryMax, CPUQuota per assistant) | P3 | 1h |
| 3.4 | Upgrade path: add skills, MCP connections, blog, etc. | P3 | ongoing |
| 3.5 | Multi-assistant management dashboard (Pif sees all deployed assistants) | P3 | 8h |

---

## 15. Sub-App Ecosystem (Phase 2+)

Polsia generates branded micro-apps on `*.polsia.app` subdomains — PipeSpark (AI SDR), PersonaForge (brand manager), etc. Each is a living demo that converts prospects who never visit polsia.com. We copy this model with real depth.

### 15.1 The Concept

Each Rif-powered assistant can build and deploy web-facing tools for its user. These deploy to `*.rif.app` subdomains (or user's own domain). Each sub-app is:
- Built by the assistant using Antfarm feature-dev workflows
- Deployed to the user's own Vercel/Cloudflare account (not ours — they own it)
- Listed on a public directory at `rif.app` as social proof

### 15.2 Starter Templates

Ship with Rif Phase 2:

| Template | What It Does | Complexity |
|----------|-------------|-----------|
| **Landing Page** | AI-generated landing page for user's business/project | Low — static HTML + Tailwind |
| **Status Page** | Public dashboard showing assistant activity (ties into 8.4 public feed) | Low — reads activity_log |
| **Contact Form** | Smart contact form that auto-triages to MC tasks | Medium — webhook → Supabase insert |
| **Micro-SaaS Scaffold** | FastAPI + Supabase + Stripe template for launching a paid product | High — full stack scaffold |

### 15.3 Rif vs Polsia Sub-Apps

| | Polsia | Rif |
|---|--------|-----|
| Hosting | Render, under Polsia's account | User's own Vercel/Cloudflare |
| Ownership | Polsia controls deployment | User owns everything |
| Depth | ~50 lines of Express.js scaffolding | Real templates with actual logic |
| If platform dies | Sub-apps die with it | Sub-apps keep running |

**Not in MVP.** This is Phase 2+ work. But the architecture decisions in Phase 0 (user owns their own deploy accounts) enable it naturally.

---

## 16. Pricing Strategy

Directly competitive with Polsia, but without the revenue share trap.

### 16.1 Tiers

| Tier | Price | What You Get | Target |
|------|-------|-------------|--------|
| **Starter** | Free | Templates, setup script, docs. You bring your own Claude sub + VPS. Community support via GitHub. | Developers, tinkerers, privacy maximalists |
| **Managed** | $49/mo | Pif deploys and maintains your assistant on shared infrastructure. Includes monitoring, updates, backup, Telegram + email support. | Non-technical users, Polsia migrants |
| **Dedicated** | $99/mo | Your own VPS, your own everything. Pif deploys, you own. Monthly health check, priority support. | Founders, power users |
| **Enterprise** | Custom | Multiple assistants, team deployment, custom integrations, SLA. | Companies |

### 16.2 What the User Always Pays Separately

- Claude subscription: $20/mo (Pro) or $100/mo (Max)
- Supabase: Free tier for most, $25/mo Pro if needed
- VPS (Starter/Dedicated): $5-15/mo (Hostinger/Hetzner)

### 16.3 The Anti-Polsia Pitch

**No revenue share. Ever.** This is the single strongest differentiator.

Polsia charges $49/mo + 20% of everything you earn. At $10K/mo revenue, that's $2,049/mo. At $100K/mo, it's $20,049/mo — more expensive than a human chief of staff.

Rif: $49/mo flat. Period. Your revenue is yours.

Marketing angle: "Paying Polsia 20% of your revenue? Switch to Rif. $49/mo flat. Own everything."

---

## 17. Distribution Strategy

### 17.1 Product Hunt Launch (Phase 2)

Plan a Product Hunt launch for Rif v1. The self-hosted angle is catnip for the indie hacker / privacy crowd.

**Launch narrative**: "We built an AI chief of staff that's been running 24/7 since early 2026. Now you can deploy your own. $49/mo. No revenue share. You own everything."

**Timing**: After 3+ successful deployments (Pavol's girlfriend + 2 beta testers). Need real testimonials, not just Pif's own dogfooding.

### 17.2 Twitter / Social Presence

- Create @rif_app (or similar) account
- Daily threads: "Here's what Rif did for a real user today" — screenshots of morning briefs, task completions, activity feeds
- The solo-founder narrative works for us too: "Pif (an AI) built Rif (a product) for humans. No employees."

### 17.3 Polsia Migration Landing Page

Dedicated page at `rif.app/from-polsia` (or `meetpif.com/migrate`):
- Side-by-side Polsia vs Rif comparison
- Revenue share calculator: "Enter your monthly revenue. Here's what you'd save."
- One-click migration guide
- Target users who hit the revenue share ceiling

### 17.4 Content Marketing

- Blog posts on meetpif.com: "Why We Built Rif" / "The Case Against Revenue Share" / "What Polsia Gets Right (And Wrong)"
- These double as SEO for "autonomous AI assistant," "AI chief of staff," "Polsia alternative"

---

## 18. $1M Challenge — Public Build

### 18.1 The Concept

Polsia runs a "$1M Challenge" at 1m-challenge.polsia.app — an AI tries to earn $1M from $0. Currently at $0 revenue, 0 tasks. It's a marketing stunt.

We do it for real.

### 18.2 Our Version

**"Watch Pif build a real business from $0."**

Not a contrived challenge with $5 site roasts. A documented journey of Pif autonomously building and shipping a real SaaS product (Rekon or Brandmint), with every decision, commit, and dollar tracked publicly.

| Aspect | Polsia's Version | Rif's Version |
|--------|-----------------|---------------|
| Products | $5 site roasts, $10 idea validators | Real SaaS (Rekon: AI pricing intelligence) |
| Transparency | Black box | Open-source tooling, public commit history |
| Human involvement | "Fully autonomous" (unverified) | Pavol approves key decisions (honest, relatable) |
| Dashboard | Task list + revenue counter | Full MC activity feed, public git log, Stripe revenue |

### 18.3 Implementation

- Landing page: `challenge.meetpif.com` or `1m.rif.app`
- Live dashboard showing: revenue, tasks completed, commits pushed, customers acquired, costs incurred
- Powered by MC's public activity feed (Section 8.4)
- Weekly blog posts documenting progress
- This doubles as marketing for both Rif (the platform) and Rekon (the product being built)

**Not in MVP.** Requires a working Rif deployment + Rekon in production. Target: Phase 2+.

---

## 19. Resolved Decisions

| # | Question | Decision |
|---|----------|----------|
| 1 | Anthropic subscription | She gets her own API key. Separate account, clean billing. |
| 2 | Domain | Hosted on meetpif.com (subdomain or path). No separate domain for MVP. |
| 3 | Assistant name | She picks during onboarding. "Rif" is the project codename, not necessarily the assistant name. |
| 4 | Supabase setup | User creates account + PAT. Pif automates project creation + migrations via Management API (Lovable-style). |
| 5 | Nightly consolidation | Include in MVP. Full knowledge extraction pipeline from day one. |
| 6 | Claude Code subscription | User gets their own Claude Code subscription (Pro or Max). Not API key. |
| 7 | Supabase Management API | **Verified**: works on free tier. `POST /v1/projects/{ref}/database/query` executes arbitrary SQL. `GET /v1/projects` lists projects. `GET /v1/organizations` lists orgs. All confirmed working with a free-tier PAT on Pif's own Supabase account. Full Lovable-style automation is feasible. |
| 8 | MC code sharing | **Single repo with branding config**. User gets upstream updates via `git pull`. Customization limited to BRANDING config object (name, colors, feature toggles). No forking — non-technical users don't modify MC code. If a user later wants deep customization, they can fork at that point. |

## 20. Open Questions

None. All questions resolved.

---

## 21. Success Criteria

MVP is done when:

- [ ] Rif responds to Telegram messages from Pavol's girlfriend
- [ ] Mission Control dashboard loads and shows task board
- [ ] Heartbeat runs every 30 minutes and triages tasks
- [ ] Morning briefing arrives at configured time
- [ ] Evening standup arrives at configured time
- [ ] Nightly consolidation runs and updates ~/life/ files
- [ ] QMD search works across Rif's memory and life files
- [ ] Credential vault works (encrypt, store, retrieve)
- [ ] Antfarm workflows execute (at minimum: `antfarm medic run` passes)
- [ ] Comment listener spawns Claude session on MC task comment
- [ ] MCP connections work (at minimum: Supabase MCP responds)
- [ ] Ralph persona is functional (can execute delegated operations)
- [ ] GOG CLI authenticated and can access user's Google account
- [ ] All services survive a VPS reboot (systemd enables)
- [ ] Pif and Rif coexist without interfering with each other
