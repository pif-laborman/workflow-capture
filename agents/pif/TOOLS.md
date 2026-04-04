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

**Two credential sources — check BOTH before saying a key isn't available:**

1. **`pif-creds`** — Mission Control's `logins` table (AES-256-GCM encrypted). For passwords, API keys stored manually.
2. **Nango connectors** — OAuth tokens and API keys linked via the Connectors UI. These are NOT in pif-creds. Use the Connector Token API to list and fetch them (see below).

**Rule:** Never tell Pavol a credential is missing without first checking both `pif-creds list` AND `GET /api/connector-token` (Nango).

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
- `pif-creds set <service> <password>` — save or update a credential
  - Optional flags: `--url URL`, `--username USER`, `--notes NOTES`
  - If the service already exists, it updates in place
- `pif-creds delete <service>` — delete a credential

**Convention for new credentials:** Store via `pif-creds set` or the Mission Control UI. Scripts fetch at startup with `pif-creds get`. Never add secrets to `.pif-env` or systemd unit files.

**Python subprocess trap:** When a Python script resolves a key into a variable (`KEY = pif-creds ...`), subprocess children don't inherit it. Always `os.environ["PIF_SUPABASE_SERVICE_ROLE_KEY"] = KEY` immediately after resolving. Bash `export` does this automatically; Python does not. This has caused dispatch failures twice.

## Quick Reference — Pavol's Calendar & Email

> **"my calendar" / "my meetings" / "my email"** → always means `pavol.dzurjanin@duvo.ai`
>
> Use Nango Google Calendar / Gmail connectors. Pavol's account must be connected via Mission Control Connectors UI.
> For Pif's own account (pif.laborman@gmail.com), use Pif's Nango connector tokens (`$CONNECTOR_TOKEN_GOOGLE_MAIL`, `$CONNECTOR_TOKEN_GOOGLE_CALENDAR`).

## External Services

### Supabase (primary database)
- **URL:** `$PIF_SUPABASE_URL/rest/v1/`
- **Tables:** runs, steps, events, heartbeats, policies, schedules, triggers, tasks, messages
- **Access:** curl, Python, MCP server
- **MCP:** Configured in `~/.mcp.json` (HTTP, bearer token auth)
- **Schema rename:** `~/scripts/rename-schema.sh <old> <new> [test-table]` — atomic rename with PostgREST reconfiguration:
  1. `ALTER SCHEMA old RENAME TO new`
  2. Update `pgrst.db_schemas` (ALTER ROLE + Management API)
  3. `NOTIFY pgrst, 'reload config'`
  4. Smoke test (REST GET on test-table)
  5. Telegram confirmation
  Never do these steps manually — the kiddlo→bobli rename broke prod because step 2 was missed.

### Telegram Bot
- **Bot:** @pif_laborman_bot
- **Service:** `claude-telegram.service` (systemd, always running)
- **Send script:** `~/scripts/telegram-send.sh`
- **Package:** `claude-code-telegram` v1.3.0 (installed via `uv tool` from git, pinned to rev)
- **Patches:** 7 local patches in `~/scripts/patches/` (tilde path support, truthiness fix, system prompt, tool summaries, etc.)
- **NEVER run `uv tool upgrade claude-code-telegram` or `uv tool upgrade --all`** — this will overwrite patches and may break the service
- **To upgrade:** `bash ~/scripts/upgrade-telegram-bot.sh v1.X.0` (installs, re-applies patches, restarts, verifies)
- **To check patch health:** `bash ~/scripts/apply-patches.sh --check`
- **Heartbeat auto-detects** missing patches and re-applies them

### GitHub
- **Account:** pif-laborman
- **CLI:** `gh` (authenticated via `GH_TOKEN`)
- **Repos:** antfarm, mission-control, pif-setup, simple-stuff

### Google Workspace (via Nango)
- **Infra:** `nango.meetpif.com` — OAuth tokens auto-refresh, no manual maintenance
- **Pif's account:** pif.laborman@gmail.com — connected via Nango
- **Services:** Gmail, Calendar, Drive, Docs, Sheets, Slides, Ads (google-ads integration added 2026-04-03; needs Pavol's account connection + developer token)
- **Scopes:** Full read+write on all services (see MC connectors route for exact scopes)
- **Pavol's account:** pavol.dzurjanin@duvo.ai — needs Nango connection via MC Connectors UI
- **DEFAULT for "my meetings/calendar/email"** — when Pavol asks about his schedule, always check Pavol's account
### Connector Token API (for tenant Pifs)
Two systems for accessing Nango tokens through MC — **never expose Nango directly (port 8091/3003)**.

**1. Frontend API** (`/api/connectors/*`) — JWT-authenticated, powers Connectors UI
- `GET /api/connectors/providers` — list Nango provider templates
- `GET /api/connectors/connections` — tenant's active connections (with email resolution)
- `GET /api/connectors/token/:connectionId` — fresh access token proxy
- `POST /api/connectors/connect` — create OAuth connect session (supports reconnect)
- Auth: standard MC JWT (same as all `/api/*` routes)

**2. Tenant Pif API** (`/api/connector-token/*`) — HMAC-authenticated, for agent use
- `GET /api/connector-token/:provider` — fresh OAuth token for a provider
- `GET /api/connector-token` — list available connectors for the tenant
- Auth headers: `x-tenant-id: <tenant_id>` + `Authorization: Bearer <hmac_key>`
- HMAC key derivation: `HMAC-SHA256(MC_JWT_SECRET, "connector:" + tenant_id)`
- Response: `{ "access_token": "...", "provider": "google-mail", "expires_at": "..." }`
- Supports all Nango auth modes: OAuth, API_KEY, BASIC

**For admin Pif (this instance):** Use the tenant Pif API with admin tenant_id, or the env vars injected by meetpif-messaging (`$CONNECTOR_TOKEN_GOOGLE_MAIL`, etc.).

**Source files:**
- Frontend routes: `/opt/assistant-platform/mc/server/src/routes/connectors.ts`
- Tenant Pif routes: `/opt/assistant-platform/mc/server/src/routes/auth.ts` (lines ~385-540)
- Mount point: `/opt/assistant-platform/mc/server/src/index.ts`

### Apify (web scraping)
- **Account:** quintillionth_labyrinth (free tier — $5/mo, 25 concurrent runs)
- **CLI:** `apify` (npm global)
- **Use cases:** YouTube transcripts, web scraping

### Cloudflare (DNS, SSL, domain)
- **Domain:** meetpif.com (registered via Cloudflare Registrar)
- **Zone ID:** ad4f196027669fe0fcafe3b5c19ec0a0
- **Account email:** pif.laborman@gmail.com
- **API Token** (logins "Cloudflare" password field): scoped token — Zone Settings only, NO DNS permissions despite the name "Edit zone DNS"
- **Global API Key** (logins "Cloudflare" notes, line 3): full access, use for DNS writes and anything the scoped token can't do
  - Auth: `X-Auth-Email: pif.laborman@gmail.com` + `X-Auth-Key: <global-key>` headers
  - **Always use Global API Key for DNS operations** — the scoped token cannot read or write DNS records
- **Origin CA Key** (logins "Cloudflare" notes, line 2): for generating Origin CA certificates
- **SSL:** Full (Strict), Origin CA cert expires 2041
- **Features enabled:** Always HTTPS, min TLS 1.2, HSTS, Brotli

### Resend (transactional email)
- **Domain:** meetpif.com (verified, eu-west-1)
- **Capabilities:** sending + receiving
- **API Key:** stored in logins table (`pif-creds get "Resend"`)
- **Inbound email:** MX record → Resend → webhook → forward to pif.laborman@gmail.com
- **Webhook:** `https://meetpif.com/webhook/resend` (Resend ID: `36bf779b-fe27-4587-a5c0-52253c024527`)
- **Webhook signing secret:** `whsec_oDgojtFXVXHHtBxbxkAM+ixkWVqLOg5S`
- **Service:** `resend-webhook.service` (port 8092, proxied via nginx)

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

### Duvo API (agent orchestration API)
- **Base URL:** `https://api.duvo.ai/v1`
- **Docs:** `https://api.duvo.ai/v1/documentation` (Swagger UI) / `https://api.duvo.ai/v1/documentation/json` (OpenAPI spec)
- **Auth:** Bearer token (`Authorization: Bearer <key>`)
- **Credential:** `pif-creds get "duvo.ai API"` (note: exact name is `duvo.ai API`, not `Duvo API`)
- **User:** pavol.dzurjanin@duvo.ai
- **Note:** No MCP integration (direct HTTP calls via curl/fetch).
- **Capabilities:**
  - **Agents** — list, create, get (`/v1/agents`, `/v1/agents/{agent_id}`)
  - **Builds** — list, create, get agent configurations (`/v1/builds`, `/v1/agents/{agent_id}/builds`)
  - **Runs** — start agent runs, poll status, send/receive messages, stop, respond to human-in-the-loop requests (`/v1/runs`, `/v1/runs/{run_id}/messages`, `/v1/runs/{run_id}/stop`, `/v1/runs/{run_id}/human-requests/{request_id}/respond`)
  - **Sandboxes** — create file sandboxes, upload files (direct ≤10MB or presigned URL), list files (`/v1/sandboxes`, `/v1/sandboxes/{sandbox_id}/files`)
- **What this means:** Full programmatic agent execution. We can trigger duvo agents from MC or scripts, feed them files via sandboxes, interact mid-run, handle approval gates, and retrieve results. Not just data access — this is an orchestration API.

### Stripe (payments & billing)
- **Account:** Pavol's Stripe (acct_1NYrlr...)
- **Key:** Restricted key `rk_live_...` — stored in logins table (`pif-creds get "Stripe"`)
- **MCP:** `@stripe/mcp` configured in `~/.mcp.json`
- **Permissions:** Read & Write on Products, Prices, Customers, Subscriptions, Invoices, Payment Links, Checkout Sessions
- **Tools:** create/list products, prices, customers, subscriptions, invoices, payment links, coupons, refunds, balance, docs search
- **Limits:** List endpoints cap at 100 objects per call. No webhook management.

### Adding New MCP Integrations

Follow the checklist: `~/memory/research/mcp-integration-checklist.md`

Standard flow: get token → store in logins table → add to `~/.mcp.json` → restart session → test → update TOOLS.md.

### Healthchecks.io
- **Ping URL:** `$PIF_UPTIME_PING_URL`
- **Script:** `~/scripts/pif-heartbeat.sh`

## Voice / TTS

**Liam voice** — Pif's audio voice for all Telegram voice memos.

- **Reference audio:** `/tmp/pif-young-british/1_liam.mp3` (British ElevenLabs preview, 3.1s)
- **Reference transcript:** `"A man who doesn't trust himself can never really trust anyone else."`
- **Model:** Qwen3-TTS 1.7B on HuggingFace Spaces (`Qwen/Qwen3-TTS`)
- **API endpoint:** `/generate_voice_clone`
- **Output → Telegram:** Convert WAV → OGG (libopus 48k) → `sendVoice`

**Quick snippet:**
```python
from gradio_client import Client, handle_file
client = Client("Qwen/Qwen3-TTS")
audio_path, status = client.predict(
    ref_audio=handle_file("/tmp/pif-young-british/1_liam.mp3"),
    ref_text="A man who doesn't trust himself can never really trust anyone else.",
    target_text="<your text here>",
    language="Auto",
    use_xvector_only=False,
    model_size="1.7B",
    api_name="/generate_voice_clone"
)
# then: ffmpeg -y -i audio_path -c:a libopus -b:a 48k output.ogg
# then: curl sendVoice to Telegram
```

**Note:** gradio_client is already installed system-wide. Rate-limited by HuggingFace ZeroGPU queue — production calls may queue 30-60s.

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
- Command: `antfarm workflow run <workflow> "task" --repo /opt/assistant-platform/mc`
- **Default repo for Mission Control work:** `/opt/assistant-platform/mc` (NOT `/root/projects/mission-control`)

## Running Services

| Service | Port | Purpose |
|---------|------|---------|
| claude-telegram.service | — | Telegram bot with Claude Code agent (pinned v1.3.0 + 7 patches) |
| meetpif-messaging.service | — | Multi-channel messaging: Telegram, Slack, task comments (Supabase Realtime) |
| mission-control-api.service | 8091 | Mission Control API (Express backend) |
| nginx.service | 80/443/8090 | Reverse proxy — meetpif.com (Cloudflare Origin CA) |
| resend-webhook.service | 8092 | Inbound email webhook → forward to Gmail |
| docker.service | — | Container runtime |
| cron.service | — | Schedule checker (every minute) |

## Helper Scripts (~/scripts/)

| Script | Purpose |
|--------|---------|
| pif-runner.py | Workflow engine — loads YAML, executes steps, manages state |
| apply-patches.sh | Re-apply Pif's 7 patches to claude-code-telegram after upgrade |
| upgrade-telegram-bot.sh | Safe upgrade wrapper: install + patch + restart + verify |
| pif-heartbeat.sh | System health check & uptime ping |
| telegram-send.sh | Send messages to Pavol via Telegram |
| antfarm-dispatch.py | Process antfarm workflow steps |
| antfarm-evaluator.py | Evaluate antfarm step outputs |
| pif-creds.js | Fetch & decrypt credentials from logins table (`pif-creds get <service>`) |
| comment-listener.js | RETIRED — replaced by comments_bot.py in meetpif-messaging |
| check-inbox.sh | Monitor inbox directory |
| ensure-daily-note.sh | Create daily note if missing |
| health-report.sh | Generate system health report |
| session-index.py | Index Claude Code session transcripts |
| session-search.sh | Search indexed sessions |
| sync-projects.sh | Backup projects to GitHub |
| transcribe.py | Audio transcription |
| push-all.sh | Batch git push |

## Cron

Two entries — everything else is in the Supabase schedules table:
```
* * * * * . /root/.pif-env && python3 /root/scripts/pif-runner.py --check-schedules
17 2 * * * . /root/.pif-env && python3 /root/scripts/gong-transcripts.py --days 2 --sync >> /root/logs/gong-sync.log 2>&1
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
