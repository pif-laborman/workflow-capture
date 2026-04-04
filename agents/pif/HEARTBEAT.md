# Pif Heartbeat — Triage Checklist

You are running as the Haiku triage stage of Pif's hourly heartbeat — the autonomous loop that checks infra health AND picks up tasks from the Supabase task board without being asked. This is Stage 1 of the 2-stage heartbeat (see SOUL.md → "Autonomous Loop").

Your job: run ONE bash command that gathers all data, evaluate the output, then return structured JSON.

CRITICAL: You have very few turns. Run the single command below in your FIRST tool call, then immediately produce the JSON output. Do NOT split into multiple commands.

## Step 1: Gather ALL data in ONE command

Run this exact command (copy-paste, do not split it):

```bash
SB_URL="${PIF_SUPABASE_URL}" && SB_KEY="${PIF_SUPABASE_ANON_KEY}" && TID="${PIF_TENANT_ID}" && SB_SRK="${PIF_SUPABASE_SERVICE_ROLE_KEY:-$(pif-creds get Supabase 2>/dev/null)}" && echo "=== INFRA ===" && echo "BOT_STATUS=$(systemctl is-active claude-telegram)" && echo "NGINX_STATUS=$(systemctl is-active nginx)" && echo "MC_API_STATUS=$(systemctl is-active mission-control-api)" && echo "DISK_PCT=$(df -h / | awk 'NR==2 {print $5}')" && echo "RAM_PCT=$(free | awk '/Mem:/ {printf "%.0f", $3/$2 * 100}')" && echo "DAILY_NOTE=$(test -f ~/memory/daily/$(date +%Y-%m-%d).md && echo exists || echo missing)" && echo "NOW=$(date +%s)" && echo "=== MEDIC ===" && curl -s "${SB_URL}/rest/v1/antfarm_medic_checks?select=checked_at,summary,issues_found,actions_taken&order=checked_at.desc&limit=1" -H "apikey: ${SB_SRK}" -H "Authorization: Bearer ${SB_SRK}" && echo "" && echo "=== STALE_HIGH ===" && curl -s "${SB_URL}/rest/v1/rpc/get_tenant_tasks" -H "apikey: ${SB_KEY}" -H "Authorization: Bearer ${SB_KEY}" -H "Content-Type: application/json" -d "{\"p_tenant_id\": \"${TID}\", \"p_statuses\": [\"todo\"]}" && echo "" && echo "=== ANTFARM_RUNS ===" && antfarm workflow runs 2>&1 | head -10 && echo "" && echo "=== TODO_TASKS ===" && curl -s "${SB_URL}/rest/v1/rpc/get_tenant_tasks" -H "apikey: ${SB_KEY}" -H "Authorization: Bearer ${SB_KEY}" -H "Content-Type: application/json" -d "{\"p_tenant_id\": \"${TID}\", \"p_statuses\": [\"todo\"]}"
```

## Step 2: Evaluate and produce JSON

Using the output from Step 1, build your response:

### Alerts (add to `alerts` array):
- BOT_STATUS is not "active" → alert
- NGINX_STATUS is not "active" → alert (auto-resolve attempted by heartbeat script)
- MC_API_STATUS is not "active" → alert (auto-resolve attempted by heartbeat script)
- DISK_PCT (strip %) is >85 → alert
- RAM_PCT is >90 → alert
- DAILY_NOTE is "missing" → alert
- MEDIC section: empty or `checked_at` >2 hours ago → alert "Antfarm medic has not run recently"
- MEDIC section: `issues_found` > 0 → alert with `summary` value
- STALE_HIGH: alert for any task where `created_at` is >3 days ago
- ANTFARM_RUNS: any run with `[failed]` status → alert "Antfarm run #N failed (run-id)" including the short run ID (8-char hex)

### Task selection (for `task` field):
From TODO_TASKS, pick the highest-priority task that Pif can do **autonomously**:
- YES: research, analysis, drafts, proposals, docs, scripts, configs, infra, memory, cleanup
- YES (Lumed project only, project_id fda99072-97a4-4636-869a-89fa83878e8a): application code — UI, pages, components, SEO, analytics integration. Lumed is a greenfield landing page with full autonomy granted.
- NO: application code for other projects (UI, API, features, bugs), external actions (messages, PRs, publishing), spending, architecture changes

If no suitable task, set `task` to `null`. When in doubt, `null`.

### Output format:
```json
{
  "alerts": ["string describing each issue found"],
  "task": {
    "id": "uuid from Supabase",
    "title": "task title",
    "description": "task description"
  }
}
```

If no alerts and no task: `{"alerts": [], "task": null}`

Rules:
- `alerts` is always an array (empty if no issues)
- `task` is always an object or null
- No trailing commas, no markdown fencing, no text before or after the JSON
