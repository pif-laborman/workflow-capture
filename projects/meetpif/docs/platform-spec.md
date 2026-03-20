# Meetpif — Platform Specification

**Project**: Managed AI chief of staff platform
**Author**: Pif
**Date**: 2026-02-28
**Status**: Updated 2026-03-20 — Aligned with execution plan decisions (D1–D12). Architecture: platform-first, single Supabase with tenant isolation, centrally managed scripts. Briefs migrated to bash scripts with `briefs` table (2026-03-20). Daily notes + nightly consolidation not yet multi-tenant. See `execution-plan.md` for operational detail.

---

## 1. Vision

Pif is a managed AI chief of staff. Polsia, but fair.

Users define their goals. Their assistant works on them every day — planning, executing, reporting. They wake up to progress. Unlike Polsia ($49/mo + 20% revenue share), Pif charges a flat fee and takes half the cut: 10% on platform-facilitated revenue. The infrastructure is managed for you — updates, monitoring, backups, all handled. You bring your Claude subscription and a Telegram bot. We handle everything else.

The first user is Pavol's girlfriend. The system reuses Pif's battle-tested scripts, Mission Control dashboard, memory architecture, and workflow engine — all centrally managed at `/opt/assistant-platform/`, with per-user data isolated via Linux users and Supabase tenant IDs.

**Core principle**: One platform, many instances. Code lives in the platform (root-owned, read-only). User data lives in `~/` per Linux user. All instances share a single Supabase project with RLS-enforced tenant isolation.

**Positioning**: "Your AI chief of staff, maintained for you. $49/mo. 10% on what it earns you. Half of Polsia's rate. Your data is isolated and exportable." Same category as Polsia — but human-in-the-loop, fairly priced, fully maintained.

**The daily cycle is the product.** Not the feature list, not the tech stack. The core value prop is: every day, your assistant plans work aligned to your goals, executes approved tasks, and reports results. This is what we sell, what we demo, and what the landing page leads with.

**The Gumroad model.** Pif is to AI assistants what Gumroad is to digital products. The platform handles infrastructure, updates, and operations. You focus on your goals. When the assistant generates revenue through platform-provided tools (sub-apps, automated services), we take a fair cut. If it doesn't generate revenue, you just pay the flat fee.

---

## 2. MVP Scope

What Pif gets on day one:

| Component | Description | Source |
|-----------|-------------|--------|
| **Mission Control** | Kanban task board, activity feed, credential vault | /opt/assistant-platform/mc/ (shared, single codebase) |
| **Telegram bot** | Conversational interface via Telegram | claude-code-telegram (per-instance install) |
| **Heartbeat** | Autonomous task triage + execution on schedule | /opt/assistant-platform/scripts/heartbeat.sh |
| **QMD** | Fast knowledge search across memory + life files | npm install -g @tobilu/qmd |
| **Memory layer** | WORKING.md, daily notes, life/ PARA structure | Rendered from /opt/assistant-platform/templates/ |
| **Morning brief** | Daily summary delivered to Telegram at user's wake time. Per-tenant config in `briefs` table. | /opt/assistant-platform/scripts/morning-brief.sh (multi-tenant via `--brief-id`) |
| **Evening standup** | EOD review, proposals, working memory update. Per-tenant config in `briefs` table. | /opt/assistant-platform/scripts/evening-standup.sh (multi-tenant via `--brief-id`) |
| **Daily notes** | Hourly activity log created by heartbeat, summary filled by evening standup | **Not multi-tenant ready.** Filesystem-based (`~/memory/daily/`). Needs storage decision. |
| **Nightly consolidation** | Auto-extract durable knowledge from daily notes into ~/life/ PARA files, sync auto-memory, rebuild QMD index | Seeded for all tenants. Script needs `$HOME` parameterization before it works for non-Pif instances. |
| **Credential system** | assistant-creds CLI + encrypted logins table (tenant-isolated) | /opt/assistant-platform/bin/assistant-creds |
| **Antfarm CLI** | Multi-agent workflow orchestration (feature dev, bug fix, security audit, etc.) | antfarm binary + workflow YAMLs (centrally managed) |
| **Comment system** | Supabase Realtime listener — spawns Claude session per MC task comment | /opt/assistant-platform/scripts/comment-listener.js |
| **MCP connections** | User can add their own MCP servers (Supabase, Slack, Notion, etc.) via ~/.mcp.json | Rendered from template |
| **Ralph persona** | Separate Linux user with restricted access — handles operations that need root delegation | Ralph user setup + SOUL.md |
| **GOG CLI** | Google Workspace integration (Gmail, Calendar, Drive, Contacts, Sheets, Docs) | Pre-installed, user authenticates their own Google account |
| **Pre-installed skills** | Three-tier model: Core (always included), Library (opt-in), Pif-only (never shared) | Symlinks from /opt/assistant-platform/skills/ |

**Explicitly NOT in MVP:**
- Blog / landing page / public website
- Loom Video Library
- Sentry integration
- Full skills library (only antfarm-workflows + designing-workflow-skills pre-installed — user builds more over time)

---

## 3. Architecture

> **Locked decisions D1–D12 are in `execution-plan.md`.** This section describes the product-level architecture. The execution plan has implementation detail.

### 3.1 Platform + Instance Model

All code lives in `/opt/assistant-platform/` (root-owned, read-only for users). Each user gets a Linux user account with their own home directory for data only.

```
/opt/assistant-platform/                 ← ROOT-OWNED, READ-ONLY
├── mc/                                  ← Mission Control (single codebase)
│   ├── dist/                            ← Built frontend (nginx serves per-instance)
│   └── server/                          ← API server (runs per-instance, different env)
├── scripts/                             ← Shared operational scripts
├── templates/                           ← Instance provisioning templates
├── skills/                              ← Three-tier skill library
│   ├── core/                            ← Always included
│   ├── library/                         ← Opt-in per instance
│   └── pif-only/                        ← Never shared
├── patches/                             ← Telegram bot patches
└── bin/                                 ← CLI tools + provisioner

/home/<instance>/                        ← PER-USER DATA
├── agents/<name>/SOUL.md, TOOLS.md      ← Identity (user-customizable)
├── memory/WORKING.md, USER.md, daily/   ← Working memory (user-customizable)
├── life/                                ← PARA knowledge structure
├── .claude/                             ← Claude config + auto-memory
└── .pif-env                             ← Bootstrap credentials
```

**Key principles:**
- Users customize **soul and memory files** only (SOUL.md, USER.md, WORKING.md, ~/life/)
- Users **cannot modify** platform code, scripts, or workflows
- Updates propagate instantly: rebuild `/opt/assistant-platform/`, restart services
- No git access to MC source for users

### 3.2 Supabase: Single Project, Tenant Isolation

All instances share Pif's existing Supabase project. Every table gets a `tenant_id` column. RLS policies enforce isolation — each instance only sees its own data.

**Why single project:** One project to manage, one set of migrations, no project limits, simpler ops. MC API server filters by `tenant_id`. RLS is defense-in-depth.

### 3.3 External Accounts Required (Per User)

| Account | Purpose | Free Tier | Setup Difficulty |
|---------|---------|-----------|-----------------|
| **Anthropic** | Claude Code subscription (Pro $20/mo or Max $100/mo) | No | Easy (web signup) |
| **Telegram** | Bot via BotFather | Yes | Easy (chat with @BotFather) |
| **Google** | OAuth SSO for MC login | Yes | Easy (existing Google account) |

**Total minimum cost**: ~$20/mo (Claude Pro subscription). Claude Max ($100/mo) recommended for heavier usage.

**Note**: No separate Supabase or Cloudflare accounts needed — instances run on the shared platform infrastructure.

---

## 4. Onboarding Flow

### 4.1 Philosophy

The user should never need to figure out what to do next. The onboarding is a guided conversation — Pif walks the user through each step, confirms completion, and moves to the next.

The onboarding runs on **Pif's infrastructure**. Once setup is complete, the user's own assistant takes over on their own Claude credentials.

### 4.2 Onboarding Steps

#### Phase 1: Account Creation (User does in browser, guided by chat)

**Step 1.1 — Telegram bot**
- Chat: "Let's create your Telegram bot. Open Telegram, search for @BotFather, send /newbot"
- User provides: bot token + their Telegram user ID

**Step 1.2 — Claude Code subscription**
- Chat: "Go to claude.ai, subscribe to Claude Pro ($20/mo) or Max ($100/mo)."
- User runs `claude login` on the server to authenticate

**Step 1.3 — Choose your assistant's name**
- Chat: "What do you want to call your assistant?"
- User provides: name (e.g., "Zoe")

**No Supabase signup needed** — instances share Pif's existing Supabase project with tenant isolation (D4).

#### Phase 2: Server Setup (Pif runs `provision-instance.sh`)

The provisioner script handles everything:

1. Creates Linux user + directory structure
2. Assigns `tenant_id` in Supabase, creates RLS-isolated data
3. Renders templates → writes config files (SOUL.md, TOOLS.md, CLAUDE.md, USER.md, WORKING.md, etc.)
4. Configures MC API with instance-specific env (tenant_id, API port)
5. Deploys Telegram bot (install, patch, systemd)
6. Sets up heartbeat + workflow schedules in Supabase
7. Installs Claude Code CLI, QMD, Antfarm under user account
8. Creates comment listener service
9. Sets up Ralph persona (separate Linux user, restricted permissions)
10. Configures MCP connections (~/.mcp.json with Supabase pre-configured)
11. Symlinks skills from platform to instance `~/.claude/skills/`

```
/home/<instance>/
├── agents/<name>/
│   ├── SOUL.md          (generated from template)
│   ├── TOOLS.md         (generated from template)
│   └── HEARTBEAT.md     (simplified, centrally managed)
├── memory/
│   ├── WORKING.md       (empty initial state — goals go here)
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

> See `execution-plan.md` Phase 0A–0C for full provisioner implementation detail.

#### Phase 3: Personalization (User does via chat)

**Step 3.1 — User profile**
- Chat: "Tell me a bit about yourself so your assistant knows who you are."
- Collects: name, timezone, work context, communication preferences, DND hours
- Writes to USER.md

**Step 3.2 — Goals**
- Chat: "What do you want your assistant to accomplish? What are your top goals?"
- Goals are written into WORKING.md and SOUL.md (no separate MISSION.md — per D5)

**Step 3.3 — Initial projects**
- Chat: "What are you working on right now?"
- Creates initial project entries in Supabase + WORKING.md

**Step 3.4 — Briefing preferences**
- Chat: "What time do you want your morning briefing? And your evening review?"
- Updates schedule entries in Supabase

**Step 3.5 — Personality tuning**
- Chat: "How should your assistant communicate? Formal? Casual? Brief? Detailed?"
- Updates SOUL.md voice/tone section

**Step 3.6 — Smoke test**
- Triggers heartbeat cycle → verifies Telegram delivery
- Sends test task to MC → verifies it appears on the board
- All green → "Your assistant is ready. Say hello!"

---

## 5. Templating System

Templates live at `/opt/assistant-platform/templates/`. Rendered during provisioning with `envsubst`.

### 5.1 Templates

| Template | Variables |
|----------|-----------|
| `SOUL.md.tmpl` | `{{NAME}}`, `{{OWNER_NAME}}`, `{{VOICE_TONE}}`, `{{DND_START}}`, `{{DND_END}}`, `{{TIMEZONE}}` |
| `TOOLS.md.tmpl` | `{{NAME}}`, `{{TENANT_ID}}`, `{{TELEGRAM_BOT_USERNAME}}` |
| `CLAUDE.md.tmpl` | `{{NAME}}`, `{{OWNER_NAME}}`, `{{AGENT_DIR}}` |
| `USER.md.tmpl` | `{{OWNER_NAME}}`, `{{TIMEZONE}}`, `{{WORK_CONTEXT}}`, `{{COMMS_PREFS}}`, `{{DND_HOURS}}` |
| `WORKING.md.tmpl` | `{{NAME}}` (minimal initial state — goals go here) |
| `MEMORY.md.tmpl` | `{{NAME}}`, `{{OWNER_NAME}}`, condensed system state |
| `HEARTBEAT.md.tmpl` | `{{SERVICES_TO_MONITOR}}` |
| `pif-env.tmpl` | `{{SUPABASE_URL}}`, `{{SUPABASE_ANON_KEY}}`, `{{CREDS_PASSWORD}}`, `{{TENANT_ID}}` |
| `mc-api.env.tmpl` | `{{API_TOKEN}}`, `{{LOGIN_PASSWORD}}`, `{{JWT_SECRET}}`, `{{TENANT_ID}}`, `{{API_PORT}}` |
| `telegram.env.tmpl` | `{{BOT_TOKEN}}`, `{{BOT_USERNAME}}`, `{{ALLOWED_USERS}}`, `{{TENANT_ID}}` |
| `mcp.json.tmpl` | `{{SUPABASE_MCP_URL}}`, `{{TENANT_ID}}` |
| `branding.json.tmpl` | `{{NAME}}`, `{{PRIMARY_COLOR}}`, `{{LOGO_URL}}` |
| `systemd/*.tmpl` | Service unit templates for telegram, heartbeat, comment-listener, schedule-checker, claude-refresh |

### 5.2 Template Engine

Simple `envsubst` replacement. The provisioner script (`provision-instance.sh`) reads an instance config and renders all templates in one pass.

---

## 6. Setup Script Architecture

> **Full implementation detail in `execution-plan.md` Phase 0A–0C.**

### 6.1 provision-instance.sh

The master provisioner at `/opt/assistant-platform/bin/provision-instance.sh`. Creates a complete instance from a config file.

Phases: validate config → create Linux user → assign tenant_id → render templates → deploy Telegram bot → create systemd services → install CLIs → symlink skills → run smoke test.

Each phase is idempotent — can re-run safely if interrupted.

### 6.2 update-platform.sh

Pulls latest code, rebuilds MC, restarts all instance services. All instances get updates immediately.

### 6.3 Onboarding Chat (Phase 2)

A Claude-powered chat on meetpif.com that collects user info, generates config, and calls the provisioner. Runs on Pif's Claude credentials. Phase 2 work — MVP uses manual provisioning.

---

## 7. Resource & Isolation Considerations

### 7.1 Resource Requirements Per Instance

Each instance adds:
- CPU: +intermittent spikes (heartbeat every 30 min, staggered across instances)
- RAM: +1-2GB (MC API process + Telegram bot + occasional Claude sessions)
- Disk: +1-2GB (memory files, daily notes — MC code is shared, not per-instance)

**Recommendation**: 8GB+ RAM for 2-3 instances. Stagger heartbeat schedules (Pif at :00/:30, instance 1 at :15/:45, etc.).

### 7.2 Port Allocation

MC API ports are assigned sequentially per instance (8091, 8092, 8093...). Nginx serves all instances on port 443 via server blocks.

### 7.3 Process Isolation

All instance services run as the instance's Linux user. Cannot read other users' files or kill other users' processes. Services follow the naming pattern `<instance>-telegram.service`, `<instance>-heartbeat.timer`, etc.

### 7.4 Backup Strategy

- Instance memory files: `/home/<instance>/memory/`, `/home/<instance>/life/`
- Supabase data: tenant-isolated within shared project (Supabase handles backups)
- Platform code: git repo at `/opt/assistant-platform/`

---

## 8. Mission Control Adaptations

### 8.1 Single Codebase, Tenant Isolation

One MC codebase at `/opt/assistant-platform/mc/`. Each instance runs its own MC API process with a different env file (different `tenant_id`, API port, JWT secret, branding config).

**What varies per instance:**
- `mc-api.env` — tenant_id, API port, JWT secret, login password
- `branding.json` — assistant name, primary color, logo, feature toggles
- nginx server block — subdomain routing to the instance's API port

**What's shared (read-only):**
- All React components, hooks, utilities (built once, served from `/opt/assistant-platform/mc/dist/`)
- Express API code
- Supabase migrations (run once, shared tables with `tenant_id` column)

**Auth**: Google SSO for MC login (D3). Workspace scope expansion deferred to Phase 2.

### 8.2 Branding Variables

A small config object in the MC frontend that controls:
```typescript
// src/config/branding.ts
export const BRANDING = {
  assistantName: 'Zoe',          // from template
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

Polsia names its agents (CEO, Engineer, Growth Manager) — it makes the product feel like a team, not a tool. Pif doesn't fake separate agents, but frames capabilities as named roles in the UI.

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

Polsia's polsia.com/live shows a real-time public feed of agent activity. Pif should support this as an opt-in feature.

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

Pif's heartbeat is simpler than Pif's (no antfarm, no GOG, fewer services).

### 9.1 Goal-Driven HEARTBEAT.md

The heartbeat is the engine of the daily cycle. Every 30 minutes, it triages what to work on — prioritized by the user's goals in WORKING.md and SOUL.md (no separate MISSION.md — per D5).

The triage command checks:
- **Goal alignment** — are there tasks on the board that map to the user's stated goals? If not, propose some.
- systemctl status of instance services (telegram, mc-api)
- Disk and RAM usage
- Daily note existence
- Stale high-priority tasks from Supabase (tenant-filtered)
- Open TODO tasks (same query pattern as Pif)

**Simplified from Pif's version:** Fewer service checks, no antfarm medic, no GOG health probe.

### 9.2 Simplified Auto-Resolve

- Restart rif-telegram, rif-mc-api if down
- No GOG token refresh (user adds GOG later if they want)
- No antfarm run resume

### 9.3 Schedule Offset

If sharing VPS with Pif, offset heartbeat by 15 minutes to avoid CPU contention:
- Pif: `:00` and `:30`
- Pif: `:15` and `:45`

---

## 10. Briefing Adaptations

### 10.1 Morning Brief

Simplified gather step:
- Today's daily note + WORKING.md (same)
- Git activity across ~/projects/ (same pattern, different home dir)
- Task board metrics from Supabase (tenant-filtered, same queries)
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

Once deployed, the instance runs on the user's own:
- Claude Code subscription (Pro/Max — for heartbeat, Telegram bot, briefings)
- Telegram bot token (for messaging)

Supabase data is tenant-isolated within the shared project — no separate Supabase account needed.

### 11.3 Credential Storage

Same pattern as Pif:
- `/home/<instance>/.pif-env` — bootstrap credentials (Supabase URL, anon key, master password, tenant_id)
- `logins` table in Supabase (tenant-filtered) — everything else (encrypted AES-256-GCM)
- `assistant-creds get <service>` — CLI to fetch any credential (symlink to platform's pif-creds.js)

---

## 12. Security Considerations

### 12.1 Platform Isolation

- **Privilege escalation**: Instance users have no sudo. Can't read /root/ (Pif's home) or other users' home directories.
- **Resource exhaustion**: Mitigate with `systemd` resource limits (MemoryMax, CPUQuota) per instance.
- **Credential isolation**: Each instance's `.pif-env` is `chmod 600`. Root policy: "Pif does not read instance credentials."
- **Data isolation**: Supabase RLS policies enforce `tenant_id` filtering. MC API double-checks with server-side filtering.
- **Platform code**: Read-only for all instance users. No git access, no script editing (D7).

### 12.2 Claude Code Permissions

Instance `settings.json` restricts:
- Cannot access /root/ (Pif's files) or other instance home directories
- Cannot modify `/opt/assistant-platform/` (read-only)
- Cannot run destructive system commands (same deny list as Pif)

---

## 13. Domain Strategy

**Decision**: Hosted on **meetpif.com** as a path-based route or subdomain. Each deployed assistant gets their own MC login — no separate domain needed for MVP.

For Pavol's girlfriend: she navigates to her MC URL on meetpif.com (e.g., `user.meetpif.com`), logs in via Google SSO, and sees her own task board backed by tenant-isolated data. Pif's MC and the user's MC are separate nginx server blocks sharing the same codebase.

---

## 14. Task Breakdown

> **Detailed task breakdown with dependencies is in `execution-plan.md`.** This section provides the high-level phase overview.

### Phase 0: Platform Foundation
- 0A: Directory structure, tenant migration, MC API tenant filtering, provisioner script
- 0B: Templates (SOUL.md, TOOLS.md, CLAUDE.md, etc.), branding config
- 0C: Service templates (Telegram, heartbeat, comment listener), smoke tests
- 0D: Skills framework (three-tier model, symlink delivery)

### Phase 1: Deploy First Instance (Pavol's Girlfriend)
- Girlfriend creates Telegram bot + subscribes to Claude Pro/Max
- Run `provision-instance.sh` with her config
- Personalization session (USER.md, goals in WORKING.md, schedule)
- Smoke test and hand off

### Phase 2: Scalability + Growth
- Onboarding chat (meetpif.com/onboard)
- Google Workspace scope expansion (Calendar, Gmail, Drive)
- Polsia-competitive features (public activity feed, migration page, sub-apps, $1M Challenge)
- Product Hunt launch

### Phase 3: Polish
- MC branding customization UI
- Systemd resource limits per instance
- Multi-assistant management dashboard

---

## 15. Sub-App Ecosystem (Phase 2+)

Polsia generates branded micro-apps on `*.polsia.app` subdomains — PipeSpark (AI SDR), PersonaForge (brand manager), etc. Each is a living demo that converts prospects who never visit polsia.com. We copy this model with real depth.

### 15.1 The Concept

Each Pif-powered assistant can build and deploy web-facing tools for its user. These deploy to `*.meetpif.com` subdomains (or user's own domain). Each sub-app is:
- Built by the assistant using Antfarm feature-dev workflows
- Deployed to the user's own Vercel/Cloudflare account (not ours — they own it)
- Listed on a public directory at `meetpif.com` as social proof

### 15.2 Starter Templates

Ship with Pif Phase 2:

| Template | What It Does | Complexity |
|----------|-------------|-----------|
| **Landing Page** | AI-generated landing page for user's business/project | Low — static HTML + Tailwind |
| **Status Page** | Public dashboard showing assistant activity (ties into 8.4 public feed) | Low — reads activity_log |
| **Contact Form** | Smart contact form that auto-triages to MC tasks | Medium — webhook → Supabase insert |
| **Micro-SaaS Scaffold** | FastAPI + Supabase + Stripe template for launching a paid product | High — full stack scaffold |

### 15.3 Pif vs Polsia Sub-Apps

| | Polsia | Pif |
|---|--------|-----|
| Hosting | Render, under Polsia's account | User's own Vercel/Cloudflare |
| Ownership | Polsia controls deployment | User owns everything |
| Depth | ~50 lines of Express.js scaffolding | Real templates with actual logic |
| If platform dies | Sub-apps die with it | Sub-apps keep running |

**Not in MVP.** This is Phase 2+ work. But the architecture decisions in Phase 0 (user owns their own deploy accounts) enable it naturally.

---

## 16. Pricing Strategy

**Updated 2026-03-10.** Freemium model with feature-gated tiers. Free tier builds the funnel; paid tier unlocks the money-making capabilities.

### 16.1 Pricing Tiers

| Tier | Price | What You Get | Gate |
|------|-------|--------------|------|
| **Free** | $0 (BYOK — bring your own Claude API key) | Full ops layer: task board, daily cycles, persistent memory, Telegram, briefings. Core Pif experience. | Feature-limited (see 16.2) |
| **Pro** | $49/mo | Everything in Free + Antfarm workflows, premium skills library, custom workflow builder, advanced integrations, priority processing, unlimited projects. | Full access |
| **Custom** | Contact us | Dedicated instance, bespoke workflows, white-glove onboarding, SLA, team deployment. | Enterprise |

Revenue share (10%) kicks in Phase 2+ when platform-facilitated revenue channels exist (sub-apps, Stripe Connect). Until then, flat fee only.

### 16.2 Free vs Pro Feature Gate

The free tier is not a demo — it's the real product with capability limits. The gate is on the *output multiplier*, not the input capacity.

**Free (ops layer):**
- Task board + status management
- Daily briefings + nightly consolidation
- Persistent memory (WORKING.md, daily notes)
- Telegram bot integration
- Basic skill execution (user-defined skills only)
- Up to 3 active projects

**Pro-only (business layer):**
- Antfarm (autonomous workflow execution — PRDs, code generation, deployment)
- Premium skills library (business-launching, revenue-generating workflows built by Pavol)
- Custom workflow builder
- Advanced integrations (Stripe, analytics, monitoring)
- Unlimited active projects
- Priority processing queue

**Conversion strategy:** Free users receive newsletters showcasing Pro features (Antfarm runs, skill demos, revenue outcomes). Individual skill purchases available as a middle path before full subscription upgrade.

### 16.3 Weekly vs Monthly Pricing — Decision Record

**Considered:** $12/week ($624/year, +6.1% over monthly).

**Decision: Stay monthly.** Rationale:

1. **Transaction costs eat the gain.** Stripe's $0.30/txn × 52 = $15.60/year vs × 12 = $3.60/year. Net annual gain after fees: ~$24, not $36.
2. **Churn surface area.** Weekly = 52 decision points/year vs 12. Industry data: weekly subscriptions show 15-25% higher churn than monthly. At pre-scale (<100 users), retention matters more than extraction per user.
3. **Category signal.** Weekly billing is standard for consumer apps (dating, fitness). B2B/productivity tools bill monthly or annually. Weekly pricing for an "AI chief of staff" undermines the professional positioning.
4. **Value delivery cadence.** Pif's value compounds over days and weeks (memory builds, patterns emerge, workflows optimize). Monthly billing aligns with the value realization window. Weekly doesn't give enough time for the "aha."

**Revisit when:** 500+ subscribers and churn data proves monthly users are retention-stable. Could A/B test weekly at that point.

### 16.4 What the User Pays Separately

- Claude Code subscription: $20/mo (Pro) or $100/mo (Max)

That's it. No Supabase costs (shared project, D4). No VPS costs (shared infrastructure). No domain costs (hosted on meetpif.com).

### 16.5 The Anti-Polsia Pitch

**Half the rate, fully managed.**

| | Polsia | Pif |
|---|--------|-----|
| Base fee | $49/mo | $49/mo |
| Revenue share | 20% | 10% |
| Free tier | No | Yes (full ops layer) |
| At $10K/mo revenue | $2,049/mo | $1,049/mo |
| At $100K/mo revenue | $20,049/mo | $10,049/mo |
| Human-in-the-loop | No | Yes |
| Data exportable | No | Yes |

Marketing angle: "Start free. Upgrade when Pif starts making you money. And even then — half of what Polsia charges."

---

## 16B. Multi-Tenant Claude Auth — Code Paste Flow

**Added 2026-03-10.** Each tenant connects their own Claude subscription through MC. No API keys, no terminal, no local scripts — same UX as Claude Code's own login, but inside Mission Control.

### 16B.1 How It Works

Claude Code's OAuth uses an out-of-band code flow: the auth server shows the user a code in the browser, user pastes it back. We replicate this exactly — MC generates the auth link, user pastes the code back into MC instead of a terminal.

### 16B.2 The Flow

```
┌──────────────┐                    ┌─────────────────┐
│  MC Web UI    │                    │  Claude OAuth    │
└──────┬───────┘                    └────────┬────────┘
       │                                      │
  1. Click "Connect Claude"                   │
       │                                      │
  2. MC server generates:                     │
     - PKCE code_verifier + challenge         │
     - Authorization URL                      │
     - Stores code_verifier per tenant        │
       │                                      │
  3. MC UI shows:                             │
     "Click to authorize" (link)              │
     + code input field                       │
       │                                      │
  4. User clicks link ────────────────────►   │
       │                                      │
       │                              5. User logs into
       │                                 Claude, authorizes
       │                                      │
       │                              6. Claude shows
       │                                 authorization code
       │                                      │
  7. User copies code,                        │
     pastes into MC input                     │
       │                                      │
  8. MC server exchanges                      │
     code + code_verifier ────────────────►   │
       │                                      │
  9. ◄──────────────────────────── tokens     │
       │                                      │
 10. Encrypt + store                          │
     per tenant                               │
       │                                      │
 11. UI shows                                 │
     "Claude connected ✓"                     │
```

### 16B.3 What Gets Built

**Supabase tables:**

```sql
-- PKCE state for pending authorizations (step 2)
CREATE TABLE claude_auth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  code_verifier TEXT NOT NULL,             -- PKCE secret (server-only)
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,         -- created_at + 10 min
  used BOOLEAN DEFAULT false
);

-- Per-tenant Claude credentials (step 10)
CREATE TABLE tenant_claude_credentials (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id),
  encrypted_access_token TEXT NOT NULL,    -- AES-256-GCM encrypted
  encrypted_refresh_token TEXT NOT NULL,
  expires_at BIGINT,                       -- ms timestamp
  scopes TEXT[],
  subscription_type TEXT,                  -- 'pro', 'max', etc.
  connected_at TIMESTAMPTZ DEFAULT now(),
  last_refreshed_at TIMESTAMPTZ,
  status TEXT DEFAULT 'active'             -- 'active', 'expired', 'revoked'
);
```

**MC API endpoints:**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/auth/claude/start` | POST | Generate PKCE pair, store code_verifier, return authorize URL (authed) |
| `/api/auth/claude/complete` | POST | Accept pasted code, exchange for tokens using stored code_verifier (authed) |
| `/api/auth/claude/status` | GET | Check if tenant has connected Claude (authed) |
| `/api/auth/claude/disconnect` | POST | Revoke and delete stored credentials (authed) |

**`POST /api/auth/claude/start` response:**
```json
{
  "authorize_url": "https://platform.claude.com/v1/oauth/authorize?client_id=...&code_challenge=...&response_type=code&scope=user:inference+user:profile",
  "session_id": "uuid",
  "expires_in": 600
}
```

**`POST /api/auth/claude/complete` request:**
```json
{
  "session_id": "uuid",
  "code": "the-code-user-pasted"
}
```

Server looks up the `code_verifier` from `claude_auth_sessions`, exchanges code + code_verifier at Claude's token endpoint, encrypts and stores tokens.

**Per-tenant token refresh:**

Extend the existing refresh cron to iterate all tenants:
1. Query `tenant_claude_credentials` where `expires_at` is within 15 minutes
2. For each: decrypt refresh_token, POST to Claude's token endpoint, encrypt and store new tokens
3. On failure: set `status = 'expired'`, notify tenant via Telegram

**MC UI component:**

"Connect Claude" card in Settings or onboarding step 1:
- State: not started → "Connect Claude" button
- State: awaiting code → shows authorize link (opens in new tab) + text input for the code
- State: connected → shows "Claude Max connected ✓" + last refreshed + disconnect button

### 16B.4 Security Considerations

- **PKCE protects the flow.** Even if someone intercepts the authorization code, they can't exchange it without the code_verifier (stored server-side, never sent to the browser).
- **Encryption at rest.** Tokens encrypted with AES-256-GCM, key derived from `MC_JWT_SECRET` + tenant_id.
- **Session TTL.** Auth sessions expire in 10 minutes. Code_verifier is deleted after use.
- **No tokens in browser.** The code the user pastes is a one-time authorization code, not a token. Token exchange happens server-to-server.
- **Revocation.** "Disconnect" deletes tokens from Supabase. User can also revoke from Claude account settings.

### 16B.5 What the User Sees

**In onboarding (after Google login):**

> **Connect your Claude subscription**
> Pif runs on your Claude account. You keep control, we keep the lights on.
>
> 1. [Authorize with Claude →] _(opens new tab)_
> 2. Log in and approve access
> 3. Copy the code and paste it here:
>
> `[_________________________]` [Connect]

**After connecting:**

> ✓ **Claude Max** connected
> Last refreshed: 2 minutes ago
> [Disconnect]

### 16B.6 Future: Direct OAuth (No Copy-Paste)

If Anthropic whitelists `meetpif.com` as a redirect URI, the flow simplifies to a standard OAuth redirect — user clicks, authorizes, gets redirected back to MC automatically. No code to copy. Reach out to Anthropic about registering as an OAuth client when the platform has traction.

---

## 17. Distribution Strategy

### 17.1 Product Hunt Launch (Phase 2)

Plan a Product Hunt launch for Pif v1. The "Gumroad for AI assistants" angle resonates with indie hackers and solo founders.

**Launch narrative**: "We built an AI chief of staff that's been running 24/7 since early 2026. Now you can have one too. $49/mo + 10% on what it earns you. Half of Polsia's rate. Fully managed. Human-in-the-loop."

**Timing**: After 3+ successful deployments (Pavol's girlfriend + 2 beta testers). Need real testimonials, not just Pif's own dogfooding.

### 17.2 Twitter / Social Presence

- Create @rif_app (or similar) account
- Daily threads: "Here's what Pif did for a real user today" — screenshots of morning briefs, task completions, activity feeds
- The solo-founder narrative works for us too: "Pif (an AI) built Pif (a product) for humans. No employees."

### 17.3 Polsia Migration Landing Page

Dedicated page at `meetpif.com/from-polsia` (or `meetpif.com/migrate`):
- Side-by-side Polsia vs Pif comparison (20% vs 10%)
- Revenue share calculator: "Enter your monthly revenue. Here's what you'd save switching from Polsia."
- One-click migration guide
- Target users who hit the 20% ceiling

### 17.4 Content Marketing

- Blog posts on meetpif.com: "Why We Built Pif" / "Why 10% Instead of 20%" / "What Polsia Gets Right (And Wrong)"
- These double as SEO for "autonomous AI assistant," "AI chief of staff," "Polsia alternative"

---

## 18. $1M Challenge — Public Build

### 18.1 The Concept

Polsia runs a "$1M Challenge" at 1m-challenge.polsia.app — an AI tries to earn $1M from $0. Currently at $0 revenue, 0 tasks. It's a marketing stunt.

We do it for real.

### 18.2 Our Version

**"Watch Pif build a real business from $0."**

Not a contrived challenge with $5 site roasts. A documented journey of Pif autonomously building and shipping a real SaaS product (Rekon or Brandmint), with every decision, commit, and dollar tracked publicly.

| Aspect | Polsia's Version | Pif's Version |
|--------|-----------------|---------------|
| Products | $5 site roasts, $10 idea validators | Real SaaS (Rekon: AI pricing intelligence) |
| Transparency | Black box | Open-source tooling, public commit history |
| Human involvement | "Fully autonomous" (unverified) | Pavol approves key decisions (honest, relatable) |
| Dashboard | Task list + revenue counter | Full MC activity feed, public git log, Stripe revenue |

### 18.3 Implementation

- Landing page: `challenge.meetpif.com` or `1m.meetpif.com`
- Live dashboard showing: revenue, tasks completed, commits pushed, customers acquired, costs incurred
- Powered by MC's public activity feed (Section 8.4)
- Weekly blog posts documenting progress
- This doubles as marketing for both Pif (the platform) and Rekon (the product being built)

**Not in MVP.** Requires a working Pif deployment + Rekon in production. Target: Phase 2+.

---

## 19. Resolved Decisions

> **Decisions D1–D12 are the authoritative set, locked in `execution-plan.md` on 2026-03-07.** This table is a summary.

| # | Question | Decision |
|---|----------|----------|
| D1 | Architecture | Platform + Instance separation. Code at `/opt/assistant-platform/`, user data at `~/` per Linux user. |
| D2 | Auth model | Claude Code subscription (Pro/Max). User runs `claude login`. Not API key. |
| D3 | Google OAuth | SSO for MC login first. Workspace scope expansion deferred to Phase 2. |
| D4 | Supabase | Single project, tenant isolation. All instances share Pif's Supabase. `tenant_id` + RLS. |
| D5 | Customization scope | Users customize soul + memory files only. No MISSION.md — goals in WORKING.md and SOUL.md. |
| D6 | Scripts & workflows | Centrally managed. Users inherit from platform. Only heartbeat schedule is per-user. |
| D7 | Codebase access | Users cannot modify platform code. No git access. Read-only. |
| D8 | Update propagation | Rebuild platform, restart services. All instances get updates immediately. |
| D9 | Build approach | Platform-first. Clean architecture from day 1. |
| D10 | Backup | Pre-work snapshot before migration. Git tag on MC repo. |
| D11 | Skills | Three-tier: Core (always), Library (opt-in), Pif-only (never shared). Symlink delivery. |
| D12 | Workflows | Centrally managed with per-instance schedules. Manifest-driven. |

## 20. Open Questions

None. All questions resolved.

---

## 21. Success Criteria

MVP is done when:

- [ ] Pif responds to Telegram messages from Pavol's girlfriend
- [ ] Mission Control dashboard loads and shows task board
- [ ] Heartbeat runs every 30 minutes and triages tasks
- [ ] Morning briefing arrives at configured time
- [ ] Evening standup arrives at configured time
- [ ] Nightly consolidation runs and updates ~/life/ files
- [ ] QMD search works across Pif's memory and life files
- [ ] Credential vault works (encrypt, store, retrieve)
- [ ] Antfarm workflows execute (at minimum: `antfarm medic run` passes)
- [ ] Comment listener spawns Claude session on MC task comment
- [ ] MCP connections work (at minimum: Supabase MCP responds)
- [ ] Ralph persona is functional (can execute delegated operations)
- [ ] GOG CLI authenticated and can access user's Google account
- [ ] All services survive a VPS reboot (systemd enables)
- [ ] Tenant isolation works — instance sees only its own data in Supabase
- [ ] Pif and instances coexist without interfering with each other
