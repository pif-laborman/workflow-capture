# TOOLS.md — Pif's Toolbox

Everything Pif has access to, in one place. If it's not here, you don't have it.

## System

- **OS:** Ubuntu 24.04 LTS
- **VPS:** Hostinger (srv1381201)
- **User:** root
- **Timezone:** CET
- **Ollama:** v0.16.1, service disabled, only has kimi-k2.5:cloud model
- **Whisper:** set up and working (transcribe.py)

## Credentials

**Single source of truth:** Mission Control's `logins` table (AES-256-GCM encrypted).

`~/.pif-env` holds only the **bootstrap trio** needed to reach the logins table:

| Variable | Purpose |
|----------|---------|
| `PIF_SUPABASE_URL` | Supabase REST URL |
| `PIF_SUPABASE_ANON_KEY` | Read logins table (RLS allows anon) |
| `PIF_CREDS_PASSWORD` | Decrypt logins entries |

**`pif-creds` CLI** (`/usr/local/bin/pif-creds`):
- `pif-creds list` — list all service names
- `pif-creds get <service>` — decrypted password
- `pif-creds get <service> --notes` — decrypted notes
- `pif-creds get <service> --json` — full record
- `pif-creds export` — shell export statements for all services

**Convention for new credentials:** Always store in the logins table via Mission Control UI. Scripts fetch at startup with `pif-creds get`. Never add secrets to `.pif-env` or systemd unit files.

## External Services

### Supabase (primary database)
- **URL:** `$PIF_SUPABASE_URL/rest/v1/`
- **Tables:** runs, steps, events, heartbeats, policies, schedules, triggers, tasks, messages
- **Access:** curl, Python, MCP server
- **MCP:** Configured in `~/.mcp.json` (HTTP, bearer token auth)

### Telegram Bot
- **Bot:** @pif_laborman_bot
- **Service:** `claude-telegram.service` (systemd, always running)
- **Send script:** `~/scripts/telegram-send.sh`

### GitHub
- **Account:** pif-laborman
- **CLI:** `gh` (authenticated via `GH_TOKEN`)
- **Repos:** antfarm, mission-control, pif-setup, simple-stuff

### Gmail / GOG CLI (Google Workspace)
- **Account:** pif.laborman@gmail.com
- **Services:** Gmail, Calendar, Drive, Contacts, Sheets, Docs
- **SMTP:** Direct send via app password
- **Config:** `~/.config/gogcli/credentials.json`, `client_secret.json`
- **Quick start** (copy-paste, no exploration):
  ```bash
  source ~/.pif-env
  export GOG_KEYRING_PASSWORD=$(pif-creds get "GOG (Google Workspace CLI)")
  export GOG_ACCOUNT=pif.laborman@gmail.com
  gog <command>
  ```
- **Known issue:** Contacts API not enabled in GCP console
- **Auth workaround:** `--remote --step 2` is buggy. Use curl token exchange + `gog auth tokens import` instead
- **Refresh token:** expires in ~7 days — if auth fails, run `bash ~/scripts/gog-auth.sh`

### Pavol's Work Google (read-only, delegated access)
- **Account:** pavol.dzurjanin@duvo.ai
- **Scopes:** gmail.readonly, calendar.readonly
- **Authenticated in GOG** — same keyring, just add `--account pavol.dzurjanin@duvo.ai`
- **GCP project:** pif-cli (app in testing mode, Pavol added as test user)
- **DEFAULT for "my meetings/calendar/email"** — when Pavol asks about his schedule, always check this account first

### Apify (web scraping)
- **Account:** quintillionth_labyrinth (free tier — $5/mo, 25 concurrent runs)
- **CLI:** `apify` (npm global)
- **Use cases:** YouTube transcripts, web scraping

### Cloudflare (DNS, SSL, domain)
- **Domain:** meetpif.com (registered via Cloudflare Registrar)
- **Zone ID:** ad4f196027669fe0fcafe3b5c19ec0a0
- **API Token:** `$CLOUDFLARE_API_TOKEN` — scoped to meetpif.com (DNS edit, Zone Settings edit)
- **Origin CA Key:** `$CLOUDFLARE_ORIGIN_CA_KEY` — for generating Origin CA certificates
- **SSL:** Full (Strict), Origin CA cert expires 2041
- **Features enabled:** Always HTTPS, min TLS 1.2, HSTS, Brotli

### HubSpot (duvo.ai CRM)
- **Portal:** 146757926 (EU datacenter)
- **App:** "Pif CRM Reader" (Private App, read-only)
- **Token:** `$HUBSPOT_ACCESS_TOKEN` (pat-eu1-...)
- **MCP:** `@hubspot/mcp-server` configured in `~/.mcp.json`
- **API base:** `https://api.hubapi.com`
- **Working:** contacts, companies, calls, notes, meetings
- **Missing scope:** `sales-email-read` (emails return 403 until added)
- **Client Secret:** stored in logins table (encrypted notes)

### Notion (duvo.ai workspace)
- **Workspace:** Duvo workspace (05c83143-1c8e-4a6f-89dc-8c9b5722119e)
- **Integration:** "ASC Knowledge Base" (read-only)
- **Token:** stored in logins table
- **MCP:** `@notionhq/notion-mcp-server` configured in `~/.mcp.json`
- **API base:** `https://api.notion.com/v1/`
- **Access:** Only pages explicitly shared with the integration are visible. Ask workspace owner to share pages via "..." > Connections > "ASC Knowledge Base".

### Slack (duvo.ai workspace)
- **Workspace:** duvo.ai (T08E21J5C1H)
- **Bot:** pif_laborman (Pif Reader app, A0AHZNXJD41)
- **Token:** stored in logins table (xoxb-...)
- **MCP:** `@modelcontextprotocol/server-slack` configured in `~/.mcp.json`
- **Scopes:** channels:read, channels:history, groups:read, groups:history, users:read, im:history
- **Access:** Read-only. Can see 50+ public channels.

### Healthchecks.io
- **Ping URL:** `$PIF_UPTIME_PING_URL`
- **Script:** `~/scripts/pif-heartbeat.sh`

## CLI Tools

| Tool | Path | Purpose |
|------|------|---------|
| claude | ~/.local/bin/claude | Claude Code CLI (model: claude-opus-4-6) |
| python3 | /usr/bin/python3 | Python runtime |
| node / npm | /usr/bin/node | Node.js runtime (npm 10.9.4) |
| gh | /usr/bin/gh | GitHub CLI |
| curl | /usr/bin/curl | HTTP requests |
| jq | /usr/bin/jq | JSON processing |
| sqlite3 | /usr/bin/sqlite3 | SQLite queries |
| psql | /usr/bin/psql | PostgreSQL client |
| docker | /usr/bin/docker | Container runtime |
| playwright | (pip) | Browser automation (Chromium) — headless browsing, screenshots, PDF gen |

## NPM Global Packages

| Package | Version | Purpose |
|---------|---------|---------|
| qmd | 1.0.7 | Markdown search (BM25 + vector) — `qmd search "query"` |
| apify-cli | 1.2.1 | Apify web scraping CLI |
| clawdhub | 0.3.0 | Claude Hub package registry |
| openclaw | 2026.2.14 | Agent runtime & orchestration |
| antfarm | 0.5.1 | Multi-agent workflow orchestration (symlink → ~/projects/antfarm) |

## Workflows

**Runner:** `python3 ~/scripts/pif-runner.py <workflow-id> "<task>"`

| Workflow | File | Schedule | Purpose |
|----------|------|----------|---------|
| morning-brief | morning-brief.yml | 8am CET daily | Daily standup report |
| evening-standup | evening-standup.yml | 9pm CET daily | EOD review & WORKING.md update |
| weekly-review | weekly-review.yml | Sunday 10am | Memory maintenance & pattern analysis |
| content-factory | content-factory.yml | Manual | Newsletter pipeline (research→write→edit→deliver) |

**Trigger map:**

| Trigger | Workflow |
|---------|----------|
| "morning brief" or 8am schedule | `morning-brief` |
| "evening standup" or 9pm schedule | `evening-standup` |
| Sunday 10am schedule | `weekly-review` |
| "process inbox" or new file detected | `inbox-processing` |
| "research X" | `content-research` |

**Antfarm workflows:** feature-dev, bug-fix, security-audit, content-factory, infra-build
- Command: `antfarm workflow run <workflow> "task" --repo /path`

## Running Services

| Service | Port | Purpose |
|---------|------|---------|
| claude-telegram.service | — | Telegram bot with Claude Code agent |
| comment-listener.service | — | Realtime task comment → Claude session spawner |
| mission-control-api.service | 8091 | Mission Control API (Express backend) |
| nginx.service | 80/443/8090 | Reverse proxy — meetpif.com (Cloudflare Origin CA) |
| docker.service | — | Container runtime |
| cron.service | — | Schedule checker (every minute) |

## Helper Scripts (~/scripts/)

| Script | Purpose |
|--------|---------|
| pif-runner.py | Workflow engine — loads YAML, executes steps, manages state |
| pif-heartbeat.sh | System health check & uptime ping |
| telegram-send.sh | Send messages to Pavol via Telegram |
| antfarm-dispatch.py | Process antfarm workflow steps |
| antfarm-evaluator.py | Evaluate antfarm step outputs |
| pif-creds.js | Fetch & decrypt credentials from logins table (`pif-creds get <service>`) |
| comment-listener.js | Listen for task comments, spawn Claude sessions to respond |
| check-inbox.sh | Monitor inbox directory |
| ensure-daily-note.sh | Create daily note if missing |
| health-report.sh | Generate system health report |
| session-index.py | Index Claude Code session transcripts |
| session-search.sh | Search indexed sessions |
| sync-projects.sh | Backup projects to GitHub |
| transcribe.py | Audio transcription |
| gog-auth.sh | Google Workspace authentication helper |
| push-all.sh | Batch git push |

## Cron

Single entry — everything else is in the Supabase schedules table:
```
* * * * * . /root/.pif-env && python3 /root/scripts/pif-runner.py --check-schedules
```
Logs: `/root/logs/schedule-checker.log`

## Data Storage

| Store | Type | Purpose |
|-------|------|---------|
| Supabase | PostgreSQL (managed) | All state — runs, tasks, events, schedules |
| /root/data/bot.db | SQLite (1.9MB) | Telegram interaction logging |
| ~/memory/ | Markdown files | Operational state (ephemeral) |
| ~/life/ | Markdown files | Durable knowledge (PARA structure) |

## Rate Limits

Check Supabase `policies` table before heavy operations:
- max_concurrent_workflows: 2
- max_claude_steps_per_hour: 10
- heartbeat_alert_after_missed: 3
- Apify free tier: $5/mo credits, 25 concurrent runs, 100 schedules

## Docker (do not touch)

OpenClaw container on port 54440. Leave it alone.
