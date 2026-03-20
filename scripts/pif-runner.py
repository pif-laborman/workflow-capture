#!/usr/bin/env python3
"""
pif-runner.py — Workflow engine for Pif Laborman

Parses YAML workflow definitions, executes steps via bash or claude --print,
tracks state in Supabase, handles retries and escalation.

Usage:
    python3 ~/scripts/pif-runner.py <workflow-id> [task description]
    python3 ~/scripts/pif-runner.py --check-schedules
    python3 ~/scripts/pif-runner.py --check-triggers
    python3 ~/scripts/pif-runner.py --recover-stuck
"""

import fcntl
import json
import os
import re
import subprocess
import sys
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from pathlib import Path

import requests
import yaml

# --- Configuration ---

# Ensure .pif-env is sourced so env vars are available to this process
# and all child bash subprocesses (prevents "JWT empty" errors)
_pif_env = Path.home() / ".pif-env"
if _pif_env.exists():
    with open(_pif_env) as _f:
        for _line in _f:
            _line = _line.strip()
            if _line and not _line.startswith("#"):
                # Strip optional 'export ' prefix and parse KEY="VALUE"
                _line = _line.removeprefix("export ").strip()
                if "=" in _line:
                    _key, _, _val = _line.partition("=")
                    _val = _val.strip().strip('"').strip("'")
                    os.environ.setdefault(_key.strip(), _val)

WORKFLOWS_DIR = Path.home() / "workflows"
SCRIPTS_DIR = Path.home() / "scripts"
AGENTS_DIR = Path.home() / "agents"

SUPABASE_URL = os.environ.get("PIF_SUPABASE_URL", "")

# Service role key — needed for RLS-bypassing writes (runs, steps, events).
# Priority: MC API env file (authoritative) → env var fallback.
SUPABASE_KEY = ""
try:
    for _line in open("/etc/mission-control-api.env"):
        if _line.startswith("SUPABASE_SERVICE_KEY="):
            SUPABASE_KEY = _line.strip().split("=", 1)[1]
            break
except Exception:
    pass
if not SUPABASE_KEY:
    SUPABASE_KEY = os.environ.get("PIF_SUPABASE_SERVICE_ROLE_KEY",
                                   os.environ.get("PIF_SUPABASE_ANON_KEY", ""))
SUPABASE_HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation",
}

TELEGRAM_SEND = SCRIPTS_DIR / "telegram-send.sh"

# Default tenant for Pif's own operations (Pavol's tenant)
PIF_TENANT_ID = "c2818981-bcb9-4fde-83d8-272d72c7a3d1"

# Workflow progress pings — sends Telegram updates at each step transition
PROGRESS_PING_ENABLED = True
PROGRESS_PING_MIN_STEPS = 3  # Only ping for workflows with 3+ steps


def send_progress_ping(workflow_name: str, step_id: str, step_index: int, total_steps: int, status: str):
    """Send a Telegram progress update at step transitions."""
    if not PROGRESS_PING_ENABLED:
        return
    icons = {"started": "▶️", "completed": "✅", "failed": "❌"}
    icon = icons.get(status, "⏳")
    msg = f"{icon} {workflow_name} [{step_index}/{total_steps}]: {step_id} {status}"
    try:
        subprocess.run(
            [str(TELEGRAM_SEND), msg],
            capture_output=True, timeout=15,
        )
    except Exception:
        pass  # Don't let ping failures break the workflow


# --- "Still working" auto-ping ---
# Sends Telegram ping if a step runs longer than STILL_WORKING_THRESHOLD_SEC.
# Repeats every STILL_WORKING_INTERVAL_SEC until the step finishes.

STILL_WORKING_THRESHOLD_SEC = 90
STILL_WORKING_INTERVAL_SEC = 90


def start_still_working_timer(workflow_name: str, step_id: str) -> threading.Event:
    """Start a background thread that pings Telegram if step takes >90s.
    Returns an Event to signal when the step is done."""
    stop_event = threading.Event()

    def _ping_loop():
        # Wait for initial threshold
        if stop_event.wait(STILL_WORKING_THRESHOLD_SEC):
            return  # Step finished before threshold
        # Step is still running — start pinging
        while not stop_event.is_set():
            try:
                subprocess.run(
                    [str(TELEGRAM_SEND), f"Still working on {workflow_name}/{step_id}..."],
                    capture_output=True, timeout=15,
                )
            except Exception:
                pass
            if stop_event.wait(STILL_WORKING_INTERVAL_SEC):
                return

    t = threading.Thread(target=_ping_loop, daemon=True)
    t.start()
    return stop_event


# --- Supabase helpers ---

# Tables that have a tenant_id column (per migration 015)
_TENANT_TABLES = {
    "runs", "events", "heartbeats", "tasks", "task_comments",
    "task_status_transitions", "messages", "projects", "schedules",
    "triggers", "policies", "logins", "recordings", "activity_feed",
}

def sb_insert(table: str, data: dict) -> dict:
    """Insert a row into a Supabase table."""
    if "tenant_id" not in data and table in _TENANT_TABLES:
        data = {**data, "tenant_id": PIF_TENANT_ID}
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers=SUPABASE_HEADERS,
        json=data,
        timeout=30,
    )
    r.raise_for_status()
    rows = r.json()
    return rows[0] if rows else data


def sb_update(table: str, match: dict, data: dict):
    """Update rows in a Supabase table matching conditions."""
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    params = {f"{k}": f"eq.{v}" for k, v in match.items()}
    r = requests.patch(url, headers=SUPABASE_HEADERS, params=params, json=data, timeout=30)
    r.raise_for_status()


def sb_select(table: str, params: dict) -> list:
    """Select rows from a Supabase table."""
    headers = {**SUPABASE_HEADERS, "Prefer": "return=representation"}
    r = requests.get(f"{SUPABASE_URL}/rest/v1/{table}", headers=headers, params=params, timeout=30)
    r.raise_for_status()
    return r.json()


def log_event(event_type: str, source: str, data: dict):
    """Log an event to the events table."""
    sb_insert("events", {"type": event_type, "source": source, "data": data})


def get_policy(key: str, default=None):
    """Read a policy value from Supabase."""
    rows = sb_select("policies", {"key": f"eq.{key}"})
    if rows:
        return json.loads(rows[0]["value"]) if isinstance(rows[0]["value"], str) else rows[0]["value"]
    return default


# --- Workflow loading ---

def load_workflow(workflow_id: str) -> dict:
    """Load a workflow YAML file by ID."""
    path = WORKFLOWS_DIR / f"{workflow_id}.yml"
    if not path.exists():
        # Check custom/ subdirectory
        path = WORKFLOWS_DIR / "custom" / f"{workflow_id}.yml"
    if not path.exists():
        raise FileNotFoundError(f"Workflow not found: {workflow_id}")
    with open(path) as f:
        return yaml.safe_load(f)


# --- Cap gates (VoxYZ pattern) ---

def can_start_workflow(workflow_id: str) -> tuple[bool, str]:
    """Check if a workflow can start (dedup + concurrency + cooldown)."""
    # Check if already running
    running = sb_select("runs", {
        "workflow_id": f"eq.{workflow_id}",
        "status": "eq.running",
    })
    if running:
        return False, f"Workflow {workflow_id} is already running"

    # Cooldown: skip if same workflow completed/failed within the last 2 minutes
    cooldown_since = (datetime.now(timezone.utc) - timedelta(minutes=2)).isoformat()
    recent = sb_select("runs", {
        "workflow_id": f"eq.{workflow_id}",
        "completed_at": f"gt.{cooldown_since}",
    })
    if recent:
        return False, f"Workflow {workflow_id} completed within last 2 minutes (cooldown)"

    # Check max concurrent
    max_concurrent = get_policy("max_concurrent_workflows", default=2)
    all_running = sb_select("runs", {"status": "eq.running"})
    if len(all_running) >= max_concurrent:
        return False, f"Max concurrent workflows reached ({max_concurrent})"

    return True, ""


# --- Template injection ---

# Max size for a single template variable value (bytes).
# The full rendered prompt must fit in a single execve argument (MAX_ARG_STRLEN = 128KB on Linux).
# With ~35KB of agent context overhead, cap each variable at 60KB to stay safe.
MAX_TEMPLATE_VAR_SIZE = 60_000

def render_template(template: str, variables: dict) -> str:
    """Replace {{variable}} placeholders with values from prior steps."""
    def replacer(match):
        key = match.group(1).strip()
        val = variables.get(key, "")
        if len(val) > MAX_TEMPLATE_VAR_SIZE:
            val = val[:MAX_TEMPLATE_VAR_SIZE] + f"\n\n[... truncated from {len(val)} to {MAX_TEMPLATE_VAR_SIZE} bytes ...]"
        return val
    return re.sub(r"\{\{(\w+)\}\}", replacer, template)


# --- Output parsing ---

def parse_output(output: str) -> dict:
    """Parse KEY: value pairs from step output, supporting multi-line values.

    A separator line (--- or blank) after a short single-line value commits
    that key immediately, preventing trailing free-form text from being
    accumulated into numeric/short fields like PROPOSAL_COUNT.
    """
    variables = {"_raw": output}
    pending_key = None
    pending_value = ""
    pending_is_short = False  # True if value so far is a single short line

    def commit():
        nonlocal pending_key, pending_value, pending_is_short
        if pending_key:
            variables[pending_key.lower()] = pending_value.strip()
        pending_key = None
        pending_value = ""
        pending_is_short = False

    for line in output.split("\n"):
        m = re.match(r"^([A-Z_]+):\s*(.*)", line)
        if m:
            commit()
            pending_key = m.group(1)
            pending_value = m.group(2)
            pending_is_short = 0 < len(pending_value.strip()) < 20
        elif pending_key:
            # If the pending value is short (e.g. a number) and we hit a
            # blank line or separator, commit it to avoid accumulating junk.
            if pending_is_short and (not line.strip() or line.strip().startswith("---")):
                commit()
            else:
                pending_value += "\n" + line
                if line.strip():
                    pending_is_short = False

    commit()
    return variables


# --- Step execution ---

def get_agent_model(agent_name: str) -> str | None:
    """Look up an agent's default_model from Supabase. Returns None if not found."""
    try:
        rows = sb_select("agents", {"id": f"eq.{agent_name}", "select": "default_model"})
        if rows and rows[0].get("default_model"):
            return rows[0]["default_model"]
    except Exception:
        pass
    return None


def build_agent_context(agent_name: str) -> str:
    """Build identity context string for a named agent."""
    agent_dir = AGENTS_DIR / agent_name
    if not agent_dir.exists():
        return ""
    parts = []
    for fname in ["SOUL.md", "IDENTITY.md", "TOOLS.md"]:
        fpath = agent_dir / fname
        if fpath.exists():
            parts.append(fpath.read_text())
    # Also include shared AGENTS.md
    shared = AGENTS_DIR / "AGENTS.md"
    if shared.exists():
        parts.insert(0, shared.read_text())
    return "\n\n---\n\n".join(parts)


def execute_step(step: dict, variables: dict, run_id: str) -> tuple[bool, str, dict]:
    """
    Execute a single workflow step. Returns (success, output, parsed_variables).
    """
    agent = step.get("agent", "bash")
    step_id = step["id"]
    rendered_input = render_template(step.get("input", ""), variables)

    # Record step start
    step_row = sb_insert("steps", {
        "run_id": run_id,
        "step_id": step_id,
        "agent": agent,
        "agent_name": step.get("agent_name", "pif"),
        "model": step.get("model"),
        "status": "running",
        "input": rendered_input,
        "started_at": datetime.now(timezone.utc).isoformat(),
    })
    step_db_id = step_row.get("id")

    # Start still-working timer
    wf_name = variables.get("_workflow_name", variables.get("_workflow_id", "workflow"))
    stop_ping = start_still_working_timer(wf_name, step_id)

    try:
        if agent == "bash":
            result = subprocess.run(
                ["bash", "-c", rendered_input],
                capture_output=True, text=True, timeout=120,
            )
            output = result.stdout + result.stderr
            success = result.returncode == 0

        elif agent in ("claude", "ollama"):
            # Build the prompt with agent identity context
            agent_name = step.get("agent_name", "pif")
            context = build_agent_context(agent_name)
            prompt = rendered_input
            if context:
                prompt = f"{context}\n\n---\n\nTask:\n{rendered_input}"

            model = step.get("model") or get_agent_model(agent_name) or "sonnet"
            cmd = ["claude", "--print", "--model", model]
            # Unset CLAUDECODE to allow nested claude calls from workflow runner
            env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}
            result = subprocess.run(
                cmd, input=prompt, capture_output=True, text=True, timeout=300, env=env,
            )
            output = result.stdout
            success = result.returncode == 0

        elif agent == "claude-code":
            # Interactive claude with full tool access (file ops, git, web search)
            agent_name = step.get("agent_name", "pif")
            context = build_agent_context(agent_name)
            prompt = rendered_input
            if context:
                prompt = f"{context}\n\n---\n\nTask:\n{rendered_input}"

            model = step.get("model") or get_agent_model(agent_name) or "sonnet"
            cmd = ["claude", "-p", "--model", model, "--output-format", "text"]
            # Unset CLAUDECODE to allow nested claude calls from workflow runner
            env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}
            result = subprocess.run(
                cmd, input=prompt, capture_output=True, text=True, timeout=600, env=env,
            )
            output = result.stdout
            success = result.returncode == 0

        else:
            output = f"Unknown agent type: {agent}"
            success = False

    except subprocess.TimeoutExpired:
        output = f"Step {step_id} timed out"
        success = False
    except Exception as e:
        output = f"Step {step_id} error: {e}"
        success = False
    finally:
        # Stop the still-working ping thread
        stop_ping.set()

    # Strip markdown bold from output for reliable KEY: value parsing
    output_clean = output.replace("**", "")

    # Check expects pattern if defined
    expects = step.get("expects")
    if success and expects:
        if expects == "exit 0":
            pass  # Already checked via returncode
        elif expects not in output_clean:
            success = False
            output += f"\n[EXPECTS FAILED] Expected '{expects}' in output"

    # Parse output variables
    parsed = parse_output(output_clean)

    # Update step in Supabase
    status = "done" if success else "failed"
    if step_db_id:
        sb_update("steps", {"id": f"{step_db_id}"}, {
            "status": status,
            "output": output[:10000],  # Truncate large outputs
            "variables": parsed,
            "completed_at": datetime.now(timezone.utc).isoformat(),
        })

    log_event(
        "step_completed" if success else "step_failed",
        f"workflow:{variables.get('_workflow_id', 'unknown')}",
        {"step_id": step_id, "agent": agent, "success": success},
    )

    return success, output, parsed


# --- Retry logic ---

def handle_failure(step: dict, variables: dict, run_id: str, steps: list) -> bool:
    """Handle step failure with retry/escalation. Returns True if recovered."""
    on_fail = step.get("on_fail")
    if not on_fail:
        return False

    retry_step_id = on_fail.get("retry_step", step["id"])
    max_retries = on_fail.get("max_retries", 2)

    # Track retries
    retry_key = f"_retries_{retry_step_id}"
    retries = variables.get(retry_key, 0)

    if retries < max_retries:
        variables[retry_key] = retries + 1
        # Find the step to retry
        for s in steps:
            if s["id"] == retry_step_id:
                # Update step retries in Supabase
                print(f"  Retrying step '{retry_step_id}' (attempt {retries + 1}/{max_retries})")
                success, output, parsed = execute_step(s, variables, run_id)
                if success:
                    # Merge parsed variables
                    for k, v in parsed.items():
                        if k == "_raw":
                            variables[f"{s['id']}_output"] = v
                        else:
                            variables[k] = v
                            variables[f"{s['id']}_{k}"] = v

                    # Recheck: re-run the original failing step after retry succeeds
                    if on_fail.get("recheck"):
                        print(f"  Rechecking step '{step['id']}' after retry")
                        rc_success, rc_output, rc_parsed = execute_step(step, variables, run_id)
                        for k, v in rc_parsed.items():
                            if k == "_raw":
                                variables[f"{step['id']}_output"] = v
                            else:
                                variables[k] = v
                                variables[f"{step['id']}_{k}"] = v
                        if rc_success:
                            return True
                        # Recheck failed — another retry cycle
                        return handle_failure(step, variables, run_id, steps)

                    return True
                # Retry failed, recurse
                return handle_failure(step, variables, run_id, steps)
        return False

    # Exhausted retries — escalate
    on_exhausted = on_fail.get("on_exhausted", {})
    if on_exhausted.get("notify") == "telegram":
        msg = f"Workflow failed at step '{step['id']}' after {max_retries} retries.\nRun: {run_id}"
        subprocess.run([str(TELEGRAM_SEND), msg], capture_output=True)
    return False


# --- Main workflow runner ---

def run_workflow(workflow_id: str, task: str = "", triggered_by: str = "manual"):
    """Execute a complete workflow."""
    # Load workflow
    workflow = load_workflow(workflow_id)
    steps = workflow.get("steps", [])
    if not steps:
        print(f"Workflow {workflow_id} has no steps")
        return False

    # Cap gate check
    can_run, reason = can_start_workflow(workflow_id)
    if not can_run:
        print(f"Cannot start workflow: {reason}")
        log_event("workflow_skipped", "runner", {
            "workflow": workflow_id, "reason": reason,
        })
        return False

    # Create run record
    run_id = str(uuid.uuid4())
    sb_insert("runs", {
        "id": run_id,
        "workflow_id": workflow_id,
        "task": task or workflow.get("description", ""),
        "status": "running",
        "triggered_by": triggered_by,
    })

    log_event("workflow_started", f"workflow:{workflow_id}", {
        "run_id": run_id, "task": task, "triggered_by": triggered_by,
    })

    print(f"Starting workflow: {workflow.get('name', workflow_id)} (run {run_id[:8]}...)")

    # Initialize variables with workflow metadata
    variables = {
        "_workflow_id": workflow_id,
        "_workflow_name": workflow.get("name", workflow_id),
        "_run_id": run_id,
        "_task": task,
    }

    # Execute steps sequentially
    all_success = True
    total_steps = len(steps)
    ping_enabled = total_steps >= PROGRESS_PING_MIN_STEPS
    wf_name = workflow.get("name", workflow_id)

    for step_index, step in enumerate(steps, 1):
        step_id = step["id"]
        print(f"  Step: {step_id} (agent={step.get('agent', 'bash')})")

        if ping_enabled:
            send_progress_ping(wf_name, step_id, step_index, total_steps, "started")

        success, output, parsed = execute_step(step, variables, run_id)

        # Store parsed variables with step prefix for template injection
        for k, v in parsed.items():
            if k == "_raw":
                variables[f"{step_id}_output"] = v
            else:
                variables[k] = v  # Also store without prefix for convenience
                variables[f"{step_id}_{k}"] = v

        if success:
            print(f"  Step '{step_id}' completed")
            if ping_enabled:
                send_progress_ping(wf_name, step_id, step_index, total_steps, "completed")
        else:
            print(f"  Step '{step_id}' failed")
            if ping_enabled:
                send_progress_ping(wf_name, step_id, step_index, total_steps, "failed")
            recovered = handle_failure(step, variables, run_id, steps)
            if not recovered:
                all_success = False
                break

    # Finalize run
    final_status = "completed" if all_success else "failed"
    sb_update("runs", {"id": run_id}, {
        "status": final_status,
        "completed_at": datetime.now(timezone.utc).isoformat(),
    })

    log_event(f"workflow_{final_status}", f"workflow:{workflow_id}", {
        "run_id": run_id,
    })

    print(f"Workflow {final_status}: {workflow_id} (run {run_id[:8]}...)")

    # Notify on failure
    if not all_success:
        subprocess.run(
            [str(TELEGRAM_SEND), f"Workflow '{workflow_id}' failed. Run: {run_id[:8]}"],
            capture_output=True,
        )

    return all_success


# --- Schedule checker ---

def run_command(schedule_id: str, command: str):
    """Execute a bash command from a schedule. Lightweight — no run/step records."""
    try:
        result = subprocess.run(
            ["bash", "-c", command],
            capture_output=True, text=True, timeout=600,
        )
        success = result.returncode == 0
        output = (result.stdout + result.stderr).strip()
        if not success:
            print(f"  Command failed: {output[:200]}")
            log_event("command_failed", f"schedule:{schedule_id}", {
                "command": command, "output": output[:500],
            })
        else:
            print(f"  Command OK: {output[:100]}")
    except subprocess.TimeoutExpired:
        print(f"  Command timed out: {command}")
        log_event("command_timeout", f"schedule:{schedule_id}", {"command": command})
    except Exception as e:
        print(f"  Command error: {e}")
        log_event("command_error", f"schedule:{schedule_id}", {"command": command, "error": str(e)})


def check_schedules():
    """Check Supabase schedules and run any that are due."""
    schedules = sb_select("schedules", {"enabled": "eq.true"})
    now_utc = datetime.now(timezone.utc)

    for sched in schedules:
        last_run = sched.get("last_run_at")
        cron_expr = sched.get("cron_expression", "")
        workflow_id = sched.get("workflow_id") or ""
        command = sched.get("command") or ""
        sched_id = sched.get("id", "unknown")
        sched_tz = sched.get("timezone") or "UTC"

        if not cron_expr or (not workflow_id and not command):
            continue

        # Convert current time to the schedule's timezone for cron evaluation
        try:
            now = now_utc.astimezone(ZoneInfo(sched_tz))
        except (KeyError, Exception):
            now = now_utc  # Fall back to UTC if timezone is invalid

        # Simple cron check: parse cron and see if we're within the minute
        if should_run_now(cron_expr, last_run, now):
            sb_update("schedules", {"id": sched_id}, {
                "last_run_at": now_utc.isoformat(),
            })
            if workflow_id:
                print(f"Schedule due: {workflow_id}")
                run_workflow(workflow_id, triggered_by=f"schedule:{sched_id}")
            elif command:
                print(f"Schedule due: {sched_id} (command)")
                run_command(sched_id, command)

    # Also evaluate triggers on every schedule check
    check_triggers()


def _cron_field_matches(field_val: int, cron_val: str) -> bool:
    """Check if a single cron field matches the current value.
    Supports: *, literal, */N, N-M, N,M,O and combinations (e.g. 1-5,7)."""
    if cron_val == "*":
        return True
    # Split on comma for lists (e.g. "1,3,5" or "1-5,7")
    for part in cron_val.split(","):
        part = part.strip()
        if "/" in part:
            base, interval = part.split("/", 1)
            if field_val % int(interval) == 0:
                return True
        elif "-" in part:
            lo, hi = part.split("-", 1)
            if int(lo) <= field_val <= int(hi):
                return True
        else:
            if int(part) == field_val:
                return True
    return False


def should_run_now(cron_expr: str, last_run_at: str | None, now: datetime) -> bool:
    """Simple cron matching — checks if current time matches cron expression.
    Supports: minute hour day-of-month month day-of-week (standard 5-field).
    Field syntax: *, N, N-M, */N, N,M,O and combinations."""
    parts = cron_expr.strip().split()
    if len(parts) != 5:
        return False

    # If ran in the last 59 seconds, skip
    if last_run_at:
        try:
            last = datetime.fromisoformat(last_run_at.replace("Z", "+00:00"))
            if (now - last).total_seconds() < 59:
                return False
        except (ValueError, TypeError):
            pass

    fields = [now.minute, now.hour, now.day, now.month, now.weekday()]
    # weekday: cron uses 0=Sun, Python uses 0=Mon — convert
    cron_weekday = (now.weekday() + 1) % 7  # Convert to 0=Sun

    for i, (field_val, cron_val) in enumerate(zip(fields, parts)):
        if i == 4:
            field_val = cron_weekday
        if not _cron_field_matches(field_val, cron_val):
            return False
    return True


# --- Trigger evaluation (VoxYZ pattern: event → trigger → workflow) ---

MEMORY_DIR = Path.home() / "memory"


def evaluate_trigger_condition(config: dict | None, event_type: str) -> bool:
    """Evaluate optional trigger condition from config field.
    Returns True if condition passes (or no condition defined)."""
    if not config:
        return True

    condition = config.get("condition", "")

    if condition == "working_md_older_than_hours":
        hours = config.get("hours", 24)
        working_md = MEMORY_DIR / "WORKING.md"
        if working_md.exists():
            age_hours = (time.time() - working_md.stat().st_mtime) / 3600
            return age_hours > hours
        return True  # Missing file counts as stale

    # Unknown condition — pass by default
    return True


def check_triggers():
    """Evaluate trigger rules and fire workflows when conditions match."""
    triggers = sb_select("triggers", {"enabled": "eq.true"})
    now = datetime.now(timezone.utc)

    for trigger in triggers:
        trigger_id = trigger.get("id", "unknown")
        event_type = trigger.get("event_type", "")
        workflow_id = trigger.get("workflow_id", "")
        cooldown_min = trigger.get("cooldown_minutes", 60)
        last_fired = trigger.get("last_fired_at")
        config = trigger.get("config")

        command = trigger.get("command", "")

        if not event_type or (not workflow_id and not command):
            continue

        # Check cooldown
        if last_fired:
            try:
                last_fire_time = datetime.fromisoformat(last_fired.replace("Z", "+00:00"))
                if (now - last_fire_time).total_seconds() < cooldown_min * 60:
                    continue  # Still in cooldown
            except (ValueError, TypeError):
                pass

        # Check for matching events since last fire (or within cooldown window)
        since = last_fired or (now - timedelta(minutes=cooldown_min)).isoformat()
        recent_events = sb_select("events", {
            "type": f"eq.{event_type}",
            "created_at": f"gt.{since}",
        })

        if not recent_events:
            continue

        # Evaluate optional condition
        if not evaluate_trigger_condition(config, event_type):
            continue

        # Fire the trigger
        action = workflow_id or command
        print(f"Trigger fired: {trigger_id} ({event_type} → {action})")
        sb_update("triggers", {"id": trigger_id}, {
            "last_fired_at": now.isoformat(),
        })
        log_event("trigger_fired", f"trigger:{trigger_id}", {
            "event_type": event_type,
            "workflow_id": workflow_id,
            "command": command,
            "matching_events": len(recent_events),
        })
        if command:
            subprocess.Popen(command, shell=True)
        else:
            run_workflow(workflow_id, triggered_by=f"trigger:{trigger_id}")


# --- Stuck step recovery ---

def recover_stuck_steps():
    """Find and recover steps stuck in 'running' for >30 minutes."""
    threshold = (datetime.now(timezone.utc) - timedelta(minutes=30)).isoformat()
    stuck = sb_select("steps", {
        "status": "eq.running",
        "started_at": f"lt.{threshold}",
    })

    for step in stuck:
        retries = step.get("retries", 0)
        step_id = step.get("step_id", "unknown")
        run_id = step.get("run_id", "unknown")

        if retries < 2:
            print(f"Recovering stuck step: {step_id} (run {run_id[:8]}...)")
            sb_update("steps", {"id": str(step["id"])}, {
                "status": "retrying",
                "retries": retries + 1,
            })
            log_event("step_retrying", "recovery", {
                "step": step_id, "run": run_id, "attempt": retries + 1,
            })
        else:
            print(f"Stuck step exhausted retries: {step_id}")
            sb_update("steps", {"id": str(step["id"])}, {"status": "failed"})
            sb_update("runs", {"id": run_id}, {
                "status": "failed",
                "completed_at": datetime.now(timezone.utc).isoformat(),
            })
            log_event("step_failed_permanent", "recovery", {
                "step": step_id, "run": run_id,
            })
            subprocess.run(
                [str(TELEGRAM_SEND),
                 f"Stuck step '{step_id}' failed after {retries} retries. Run: {run_id[:8]}"],
                capture_output=True,
            )


# --- CLI ---

def main():
    if len(sys.argv) < 2:
        print("Usage:")
        print("  pif-runner.py <workflow-id> [task]")
        print("  pif-runner.py --check-schedules")
        print("  pif-runner.py --check-triggers")
        print("  pif-runner.py --recover-stuck")
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == "--check-schedules":
        # Lockfile prevents parallel check-schedules from piling up.
        # If a previous run is still going (workflow took >1 min), skip.
        lockfile = Path("/tmp/pif-check-schedules.lock")
        lock_fd = open(lockfile, "w")
        try:
            fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("Another check-schedules is already running, skipping")
            sys.exit(0)
        try:
            check_schedules()
        finally:
            fcntl.flock(lock_fd, fcntl.LOCK_UN)
            lock_fd.close()
    elif cmd == "--check-triggers":
        check_triggers()
    elif cmd == "--recover-stuck":
        recover_stuck_steps()
    else:
        task = " ".join(sys.argv[2:]) if len(sys.argv) > 2 else ""
        triggered_by = "telegram" if task else "manual"
        success = run_workflow(cmd, task=task, triggered_by=triggered_by)
        sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
