#!/usr/bin/env python3
"""
antfarm-dispatch.py — Dispatcher for antfarm workflows

Polls for pending antfarm steps, claims them, invokes claude with the
right agent identity, and reports results back via the antfarm CLI.

Usage:
    antfarm-dispatch.py --once          # single pass, exit (for schedule)
    antfarm-dispatch.py                 # poll until no runs remain
    antfarm-dispatch.py --run-id <id>   # only dispatch for one specific run

The schedule checker runs this every 5 minutes when enabled. Enable the
antfarm-dispatch schedule when starting a run, the script auto-disables
it when no running runs remain.
"""

import json
import logging
import os
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

import re
import requests
import yaml

# --- Configuration ---

AGENTS_DIR = Path.home() / "agents"
WORKFLOWS_DIR = Path.home() / "projects" / "antfarm" / "workflows"
LOGS_DIR = Path.home() / "logs"
SCRIPTS_DIR = Path.home() / "scripts"
TELEGRAM_SEND = SCRIPTS_DIR / "telegram-send.sh"

ACTIVE_FLAG = Path("/tmp/antfarm-active")
IDLE_SCAN_FILE = Path("/tmp/antfarm-last-scan")
IDLE_SCAN_INTERVAL = 300  # 5 min fallback scan when flag absent

SUPABASE_URL = os.environ.get("PIF_SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("PIF_SUPABASE_SERVICE_ROLE_KEY", "")
if not SUPABASE_KEY:
    try:
        import subprocess as _sp
        _result = _sp.run(
            ["bash", "-c", "set -a; source ~/.pif-env 2>/dev/null; source ~/.env 2>/dev/null; set +a; pif-creds get Supabase"],
            capture_output=True, text=True, check=True,
        )
        SUPABASE_KEY = _result.stdout.strip()
    except Exception:
        SUPABASE_KEY = os.environ.get("PIF_SUPABASE_ANON_KEY", "")

# Export so antfarm CLI subprocesses inherit the resolved key
os.environ["PIF_SUPABASE_SERVICE_ROLE_KEY"] = SUPABASE_KEY
os.environ["PIF_SUPABASE_URL"] = SUPABASE_URL
SUPABASE_HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation",
}

ROLE_CONFIG = {
    "analysis":     {"cmd": ["claude", "-p", "--dangerously-skip-permissions", "--output-format", "json", "--model", "opus"],
                     "user": "ralph", "timeout": 900},
    "coding":       {"cmd": ["claude", "-p", "--dangerously-skip-permissions", "--output-format", "json", "--model", "opus"],
                     "user": "ralph", "timeout": 1800},
    "verification": {"cmd": ["claude", "-p", "--dangerously-skip-permissions", "--output-format", "json", "--model", "opus"],
                     "user": "ralph", "timeout": 1500},
    "testing":      {"cmd": ["claude", "-p", "--dangerously-skip-permissions", "--output-format", "json", "--model", "opus"],
                     "user": "ralph", "timeout": 1500},
}

# --- Logging ---

LOGS_DIR.mkdir(exist_ok=True)
log = logging.getLogger("antfarm-dispatch")
log.setLevel(logging.INFO)
_fmt = logging.Formatter("%(asctime)s %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
_fh = logging.FileHandler(LOGS_DIR / "antfarm-dispatch.log")
_fh.setFormatter(_fmt)
log.addHandler(_fh)
# Only add StreamHandler when running interactively (not via cron redirect)
if sys.stderr.isatty():
    _sh = logging.StreamHandler()
    _sh.setFormatter(_fmt)
    log.addHandler(_sh)


# --- Supabase helpers ---

def sb_select(table: str, params: dict) -> list:
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers=SUPABASE_HEADERS, params=params,
    )
    r.raise_for_status()
    return r.json()


def sb_update(table: str, match: dict, data: dict):
    params = {k: f"eq.{v}" for k, v in match.items()}
    r = requests.patch(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers=SUPABASE_HEADERS, params=params, json=data,
    )
    r.raise_for_status()


# --- Workflow loading ---

_wf_cache: dict = {}


def load_workflow(workflow_id: str) -> dict:
    if workflow_id in _wf_cache:
        return _wf_cache[workflow_id]
    path = WORKFLOWS_DIR / workflow_id / "workflow.yml"
    with open(path) as f:
        wf = yaml.safe_load(f)
    _wf_cache[workflow_id] = wf
    return wf


def get_role(workflow_id: str, agent_name: str) -> str:
    wf = load_workflow(workflow_id)
    for agent in wf.get("agents", []):
        if agent["id"] == agent_name:
            return agent.get("role", "analysis")
    return "analysis"


def get_agent_model(workflow_id: str, agent_name: str) -> str | None:
    """Get per-agent model override from workflow YAML, if any."""
    wf = load_workflow(workflow_id)
    for agent in wf.get("agents", []):
        if agent["id"] == agent_name:
            return agent.get("model")
    return None


def get_step_config(workflow_id: str, step_id: str) -> dict:
    """Get expects and on_fail config for a step from workflow YAML."""
    wf = load_workflow(workflow_id)
    for step in wf.get("steps", []):
        if step["id"] == step_id:
            return {
                "expects": step.get("expects", ""),
                "on_fail": step.get("on_fail", {}),
                "max_retries": step.get("max_retries",
                                        step.get("on_fail", {}).get("max_retries", 2)),
            }
    return {"expects": "", "on_fail": {}, "max_retries": 2}


# --- Agent context ---

def build_prompt(agent_name: str, task_input: str) -> str:
    """Prepend agent identity files to the task input."""
    agent_dir = AGENTS_DIR / agent_name
    parts = []
    for fname in ("AGENTS.md", "SOUL.md", "IDENTITY.md", "TOOLS.md"):
        fp = agent_dir / fname
        if fp.exists():
            parts.append(fp.read_text().strip())
    parts.append(f"Task:\n{task_input}")
    return "\n---\n".join(parts)


# --- Ralph credential sync ---

def sync_ralph_credentials():
    subprocess.run(
        ["bash", "-c",
         "cp /root/.claude/.credentials.json /home/ralph/.claude/.credentials.json && "
         "chown ralph:ralph /home/ralph/.claude/.credentials.json && "
         "chmod 600 /home/ralph/.claude/.credentials.json"],
        timeout=10, capture_output=True,
    )


# --- Antfarm CLI wrappers ---

def antfarm_peek(agent_id: str) -> bool:
    r = subprocess.run(
        ["antfarm", "step", "peek", agent_id],
        capture_output=True, text=True, timeout=30,
    )
    return "HAS_WORK" in r.stdout


def antfarm_claim(agent_id: str) -> dict | None:
    r = subprocess.run(
        ["antfarm", "step", "claim", agent_id],
        capture_output=True, text=True, timeout=30,
    )
    if "NO_WORK" in r.stdout:
        return None
    try:
        return json.loads(r.stdout)
    except json.JSONDecodeError:
        log.error(f"Claim parse error for {agent_id}: {r.stdout[:200]}")
        return None


def antfarm_complete(step_id: str, output: str) -> dict:
    r = subprocess.run(
        ["antfarm", "step", "complete", step_id],
        input=output, capture_output=True, text=True, timeout=30,
    )
    try:
        return json.loads(r.stdout)
    except json.JSONDecodeError:
        log.error(f"Complete parse error for {step_id}: {r.stdout[:200]}")
        return {}


def antfarm_fail(step_id: str, error: str) -> dict:
    try:
        r = subprocess.run(
            ["antfarm", "step", "fail", step_id, error[:2000]],
            capture_output=True, text=True, timeout=30,
        )
        result = json.loads(r.stdout)
        return result
    except (json.JSONDecodeError, subprocess.TimeoutExpired, Exception) as e:
        log.error(f"Fail CLI error for {step_id}: {e} — falling back to direct DB update")
        # Fallback: directly mark step and run as failed in DB
        try:
            step_rows = sb_select("antfarm_steps", {
                "id": f"eq.{step_id}",
                "select": "run_id,retry_count,max_retries",
            })
            if step_rows:
                step = step_rows[0]
                new_retry = step.get("retry_count", 0) + 1
                max_retries = step.get("max_retries", 2)
                now_ts = datetime.now(timezone.utc).isoformat()

                if new_retry > max_retries:
                    sb_update("antfarm_steps", {"id": step_id}, {
                        "status": "failed", "output": error[:2000],
                        "retry_count": new_retry, "updated_at": now_ts,
                    })
                    sb_update("antfarm_runs", {"id": step["run_id"]}, {
                        "status": "failed", "updated_at": now_ts,
                    })
                    log.info(f"Fallback: marked step={step_id} and run={step['run_id'][:8]} as failed")
                    return {"retrying": False, "runFailed": True}
                else:
                    sb_update("antfarm_steps", {"id": step_id}, {
                        "status": "pending", "retry_count": new_retry,
                        "updated_at": now_ts,
                    })
                    log.info(f"Fallback: reset step={step_id} to pending (retry {new_retry}/{max_retries})")
                    return {"retrying": True, "runFailed": False}
        except Exception as db_err:
            log.error(f"Fallback DB update also failed for {step_id}: {db_err}")
        return {}


# --- Token usage tracking ---

def parse_claude_json(raw_stdout: str) -> dict:
    """Parse JSON output from claude --output-format json.

    Returns dict with 'text' (the actual response) and 'usage' (token metrics).
    Falls back gracefully if output isn't valid JSON.
    """
    try:
        data = json.loads(raw_stdout)
    except (json.JSONDecodeError, TypeError):
        return {"text": raw_stdout, "usage": {}}

    text = data.get("result", raw_stdout)
    usage_raw = data.get("usage", {})
    model_usage = data.get("modelUsage", {})

    # Aggregate across all models in modelUsage (usually just one)
    input_tokens = 0
    output_tokens = 0
    cache_read = 0
    cache_write = 0
    cost = data.get("total_cost_usd", 0) or 0
    model_id = ""

    for mid, mu in model_usage.items():
        model_id = mid
        input_tokens += mu.get("inputTokens", 0)
        output_tokens += mu.get("outputTokens", 0)
        cache_read += mu.get("cacheReadInputTokens", 0)
        cache_write += mu.get("cacheCreationInputTokens", 0)

    # Fallback to top-level usage if modelUsage was empty
    if not model_usage:
        input_tokens = usage_raw.get("input_tokens", 0)
        output_tokens = usage_raw.get("output_tokens", 0)
        cache_read = usage_raw.get("cache_read_input_tokens", 0)
        cache_write = usage_raw.get("cache_creation_input_tokens", 0)

    return {
        "text": text,
        "usage": {
            "model": model_id,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cache_read_tokens": cache_read,
            "cache_write_tokens": cache_write,
            "cost_usd": cost,
            "session_id": data.get("session_id", ""),
            "duration_ms": data.get("duration_ms", 0),
        },
    }


def record_token_usage(usage: dict, *, source: str, run_id: str | None = None,
                        step_id: str | None = None, agent: str | None = None,
                        workflow_id: str | None = None,
                        duration_seconds: float = 0):
    """INSERT a row into token_usage. Best-effort — never raises."""
    if not usage or not usage.get("output_tokens"):
        return
    try:
        row = {
            "source": source,
            "session_id": usage.get("session_id"),
            "run_id": run_id,
            "step_id": step_id,
            "agent": agent,
            "workflow_id": workflow_id,
            "model": usage.get("model"),
            "input_tokens": usage.get("input_tokens", 0),
            "output_tokens": usage.get("output_tokens", 0),
            "cache_read_tokens": usage.get("cache_read_tokens", 0),
            "cache_write_tokens": usage.get("cache_write_tokens", 0),
            "cost_usd": usage.get("cost_usd", 0),
            "duration_seconds": duration_seconds,
        }
        requests.post(
            f"{SUPABASE_URL}/rest/v1/token_usage",
            headers=SUPABASE_HEADERS, json=row, timeout=10,
        )
    except Exception as e:
        log.error(f"Failed to record token usage: {e}")


# --- Step execution ---

def execute_agent(agent_name: str, role: str, prompt: str, repo: str,
                   model: str | None = None) -> dict:
    """Invoke claude with the right identity and execution mode.

    Returns dict with 'success', 'output'/'error', and 'usage' (token metrics).
    """
    config = ROLE_CONFIG.get(role, ROLE_CONFIG["analysis"])
    # Deep copy cmd list so we don't mutate ROLE_CONFIG
    config = {**config, "cmd": list(config["cmd"])}
    if model:
        try:
            idx = config["cmd"].index("--model")
            config["cmd"][idx + 1] = model
        except (ValueError, IndexError):
            config["cmd"].extend(["--model", model])

    # Write prompt to temp file (readable by ralph)
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".md", delete=False, prefix="antfarm-"
    ) as f:
        f.write(prompt)
        prompt_file = f.name
    os.chmod(prompt_file, 0o644)

    try:
        if config["user"] == "ralph":
            sync_ralph_credentials()
            cmd_str = " ".join(config["cmd"])
            shell_cmd = (
                f'unset CLAUDECODE; cd "{repo}" && {cmd_str} < "{prompt_file}"'
            )
            result = subprocess.run(
                ["su", "-", "ralph", "-c", shell_cmd],
                capture_output=True, text=True, timeout=config["timeout"],
            )
        else:
            cmd_str = " ".join(config["cmd"])
            shell_cmd = f'cd "{repo}" && {cmd_str} < "{prompt_file}"'
            result = subprocess.run(
                ["bash", "-c", shell_cmd],
                capture_output=True, text=True, timeout=config["timeout"],
            )

        if result.returncode == 0:
            parsed = parse_claude_json(result.stdout)
            return {"success": True, "output": parsed["text"], "usage": parsed["usage"]}
        else:
            err = (result.stderr or result.stdout or "unknown error")[:2000]
            return {"success": False, "error": err, "usage": {}}
    except subprocess.TimeoutExpired:
        return {"success": False, "error": f"Timed out after {config['timeout']}s", "usage": {}}
    except Exception as e:
        return {"success": False, "error": str(e), "usage": {}}
    finally:
        try:
            os.unlink(prompt_file)
        except OSError:
            pass


# --- Cross-step retry ---

def parse_output_key_values(output: str) -> dict:
    """Parse KEY: value pairs from agent output (mirrors antfarm's parseOutputKeyValues)."""
    result = {}
    pending_key = None
    pending_value = ""

    def commit():
        nonlocal pending_key, pending_value
        if pending_key and not pending_key.startswith("STORIES_JSON"):
            result[pending_key.lower()] = pending_value.strip()
        pending_key = None
        pending_value = ""

    for line in output.split("\n"):
        m = re.match(r'^([A-Z_]+):\s*(.*)', line)
        if m:
            commit()
            pending_key = m.group(1)
            pending_value = m.group(2)
        elif pending_key:
            pending_value += "\n" + line
    commit()
    return result


def handle_retry_step(run: dict, current_step_id: str, step_config: dict,
                      output: str) -> bool:
    """Handle cross-step retry when output doesn't match expects.

    Returns True if retry was handled, False if normal completion should proceed.
    """
    expects = step_config.get("expects", "")
    if not expects or expects in output:
        return False  # Output matches — no retry needed

    on_fail = step_config.get("on_fail", {})
    retry_target = on_fail.get("retry_step")
    max_retries = on_fail.get("max_retries", step_config.get("max_retries", 2))

    run_id = run["id"]
    context = run.get("context") or {}
    if isinstance(context, str):
        context = json.loads(context)

    # Merge output KEY:VALUE pairs into context (so feedback is available)
    parsed = parse_output_key_values(output)
    for k, v in parsed.items():
        context[k] = v

    # Store the full output under {step_id}_output for the retry target
    workflow_id = run["workflow_id"]
    # Find current step's step_id (workflow-level) from DB
    current_steps = sb_select("antfarm_steps", {
        "id": f"eq.{current_step_id}",
        "select": "step_id",
    })
    current_step_name = current_steps[0]["step_id"] if current_steps else "unknown"
    context[f"{current_step_name}_output"] = output

    if not retry_target:
        # No cross-step retry — let normal fail path handle it
        sb_update("antfarm_runs", {"id": run_id}, {"context": context})
        return False

    # Track retry count
    retry_key = f"{current_step_name}_retry_count"
    retry_count = int(context.get(retry_key, "0")) + 1
    context[retry_key] = str(retry_count)

    if retry_count > max_retries:
        log.info(
            f"RETRY EXHAUSTED step={current_step_name} "
            f"retries={retry_count}/{max_retries}"
        )
        error_msg = f"Retries exhausted ({retry_count}/{max_retries})"

        # Directly mark step + run as failed (bypass CLI failStep which
        # has its own retry counter that conflicts with ours).
        sb_update("antfarm_steps", {"id": current_step_id}, {
            "status": "failed",
            "output": error_msg,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })

        # Also fail the retry target step if it's pending/waiting,
        # otherwise it gets re-dispatched and re-triggers this step.
        if retry_target:
            target_steps = sb_select("antfarm_steps", {
                "run_id": f"eq.{run_id}",
                "step_id": f"eq.{retry_target}",
                "select": "id,status",
            })
            for ts in target_steps:
                if ts["status"] in ("pending", "waiting"):
                    sb_update("antfarm_steps", {"id": ts["id"]}, {
                        "status": "failed",
                        "output": f"Blocked: {current_step_name} {error_msg}",
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    })

        sb_update("antfarm_runs", {"id": run_id}, {
            "status": "failed",
            "context": context,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
        log.info(f"RUN FAILED run={run_id[:8]} — {error_msg}")

        # Notify, cleanup, and evaluate (same as normal failure path)
        task = run.get("task", "unknown")
        notify(f"Antfarm run failed: {task}\n{error_msg}")
        cleanup_worktree(context)
        run_evaluator(run_id)

        return True

    log.info(
        f"RETRY_STEP step={current_step_name} → {retry_target} "
        f"retry={retry_count}/{max_retries}"
    )

    # Find the target step in DB and reset to pending
    target_steps = sb_select("antfarm_steps", {
        "run_id": f"eq.{run_id}",
        "step_id": f"eq.{retry_target}",
        "select": "id,status",
    })
    if target_steps:
        target_db_id = target_steps[0]["id"]
        sb_update("antfarm_steps", {"id": target_db_id}, {
            "status": "pending",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })

    # Reset current step to waiting (it will be re-triggered after target completes)
    sb_update("antfarm_steps", {"id": current_step_id}, {
        "status": "waiting",
        "output": output,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })

    # Save context with feedback
    sb_update("antfarm_runs", {"id": run_id}, {"context": context})

    return True


# --- Content-factory delivery ---

def deliver_content_factory(run: dict):
    """Send the final draft via Telegram when content-factory completes."""
    context = run.get("context") or {}
    if isinstance(context, str):
        context = json.loads(context)

    # Re-read context from DB to get latest (includes all merged outputs)
    run_id = run["id"]
    fresh = sb_select("antfarm_runs", {"id": f"eq.{run_id}", "select": "context"})
    if fresh:
        context = fresh[0].get("context") or context
        if isinstance(context, str):
            context = json.loads(context)

    draft = context.get("write_output", "")
    task = run.get("task", "unknown topic")

    if draft:
        # Truncate for Telegram (4096 char limit)
        header = f"Simple Stuff draft ready — {task}\n\n"
        max_body = 4000 - len(header)
        body = draft[:max_body]
        notify(header + body)
    else:
        notify(f"Content-factory completed for: {task}\n(No draft found in context)")
    log.info(f"Content-factory delivered for: {task}")


# --- Schedule management ---

def set_schedule_enabled(enabled: bool):
    try:
        sb_update("schedules", {"id": "antfarm-dispatch"}, {"enabled": enabled})
        log.info(f"Schedule {'enabled' if enabled else 'disabled'}")
    except Exception as e:
        log.error(f"Failed to update schedule: {e}")


# --- Notifications ---

def notify(message: str):
    try:
        subprocess.run([str(TELEGRAM_SEND), message], timeout=30, capture_output=True)
    except Exception as e:
        log.error(f"Notify failed: {e}")


def check_milestone(run_id: str, run_task: str):
    """Send a Telegram milestone notification at 25%/50%/75% completion."""
    try:
        steps = sb_select("antfarm_steps", {
            "run_id": f"eq.{run_id}",
            "select": "status",
        })
        if not steps:
            return
        total = len(steps)
        done = sum(1 for s in steps if s["status"] in ("completed", "skipped"))
        pct = int(done / total * 100) if total else 0

        # Check thresholds — use a flag file to avoid duplicate notifications
        flag_dir = Path(f"/tmp/antfarm-milestones-{run_id[:8]}")
        flag_dir.mkdir(exist_ok=True)

        for threshold in (25, 50, 75):
            flag = flag_dir / f"{threshold}"
            if pct >= threshold and not flag.exists():
                flag.touch()
                notify(f"Antfarm milestone: {run_task}\n{done}/{total} steps done ({pct}%)")
                break  # Only send one notification per step completion
    except Exception as e:
        log.error(f"Milestone check failed: {e}")


def run_evaluator(run_id: str):
    """Run post-completion evaluation (metrics, quality, pattern detection)."""
    try:
        evaluator_path = SCRIPTS_DIR / "antfarm-evaluator.py"
        result = subprocess.run(
            ["python3", str(evaluator_path), run_id],
            capture_output=True, text=True, timeout=60,
        )
        if result.returncode == 0:
            log.info(f"Evaluator completed for {run_id[:8]}")
        else:
            log.error(f"Evaluator failed for {run_id[:8]}: {result.stderr[:200]}")
    except Exception as e:
        log.error(f"Evaluator error for {run_id[:8]}: {e}")


# --- Flag-file gating ---

def should_dispatch() -> bool:
    """Check if dispatch should proceed, using local flag file to avoid unnecessary API calls.

    - Flag exists → dispatch (a run was recently started or is known active)
    - Flag absent → do a lightweight DB scan every IDLE_SCAN_INTERVAL seconds.
      If running runs found, touch the flag. If not, skip entirely.
    """
    if ACTIVE_FLAG.exists():
        return True

    # No flag — check if we should do a fallback scan
    if IDLE_SCAN_FILE.exists():
        age = time.time() - IDLE_SCAN_FILE.stat().st_mtime
        if age < IDLE_SCAN_INTERVAL:
            return False  # scanned recently, still idle

    # Fallback scan: 1 lightweight API call
    try:
        runs = sb_select("antfarm_runs", {"status": "eq.running", "select": "id", "limit": "1"})
        IDLE_SCAN_FILE.touch()
        if runs:
            ACTIVE_FLAG.touch()
            log.info("Fallback scan found running run — activating")
            return True
    except Exception as e:
        log.error(f"Fallback scan failed: {e}")

    return False


def clear_active_flag():
    """Remove the active flag when no runs are running."""
    try:
        ACTIVE_FLAG.unlink(missing_ok=True)
    except OSError:
        pass


# --- Worktree cleanup ---

def cleanup_worktree(context: dict):
    """Remove git worktree if one was created for this run."""
    wt = context.get("worktree_path", "")
    original = context.get("original_repo", "")
    if not wt or not original:
        return
    try:
        subprocess.run(
            ["git", "-C", original, "worktree", "remove", "--force", wt],
            capture_output=True, text=True, timeout=30,
        )
        log.info(f"Cleaned up worktree: {wt}")
    except Exception as e:
        log.error(f"Worktree cleanup failed: {e}")


# --- Main dispatch ---

def close_stale_runs():
    """Close runs where all steps are done but the run is still 'running',
    or runs stuck in 'running' for more than 4 hours.
    """
    try:
        running = sb_select("antfarm_runs", {
            "status": "eq.running",
            "select": "id,task,created_at,context",
        })
        now = datetime.now(timezone.utc)
        for run in running:
            run_id = run["id"]
            steps = sb_select("antfarm_steps", {
                "run_id": f"eq.{run_id}",
                "select": "id,status",
            })
            if not steps:
                continue

            # Check 1: all steps terminal → auto-close
            terminal = all(s["status"] in ("done", "completed", "skipped", "failed") for s in steps)
            if terminal:
                all_ok = all(s["status"] in ("done", "completed", "skipped") for s in steps)
                final_status = "completed" if all_ok else "failed"
                sb_update("antfarm_runs", {"id": run_id}, {
                    "status": final_status,
                    "completed_at": now.isoformat(),
                })
                task = run.get("task", "unknown")
                notify(f"Antfarm run auto-closed ({final_status}): {task}")
                log.info(f"AUTO-CLOSED run={run_id[:8]} status={final_status} task={task}")
                context = run.get("context") or {}
                if isinstance(context, str):
                    context = json.loads(context)
                cleanup_worktree(context)
                run_evaluator(run_id)
                continue

            # Check 2: run stuck for >4h → force-fail
            created = run.get("created_at", "")
            if created:
                try:
                    created_dt = datetime.fromisoformat(created.replace("Z", "+00:00"))
                    age_hours = (now - created_dt).total_seconds() / 3600
                    if age_hours > 4:
                        sb_update("antfarm_runs", {"id": run_id}, {
                            "status": "failed",
                            "updated_at": now.isoformat(),
                        })
                        # Also fail any non-terminal steps
                        for s in steps:
                            if s["status"] not in ("done", "completed", "skipped", "failed"):
                                sb_update("antfarm_steps", {"id": s.get("id", "")}, {
                                    "status": "failed",
                                    "output": f"Auto-failed: run stuck for {age_hours:.1f}h",
                                    "updated_at": now.isoformat(),
                                })
                        task = run.get("task", "unknown")
                        notify(f"Antfarm run force-failed (stuck {age_hours:.0f}h): {task}")
                        log.info(f"FORCE-FAILED run={run_id[:8]} age={age_hours:.1f}h task={task}")
                        context = run.get("context") or {}
                        if isinstance(context, str):
                            context = json.loads(context)
                        cleanup_worktree(context)
                        run_evaluator(run_id)
                except (ValueError, TypeError) as e:
                    log.error(f"Failed to parse created_at for {run_id[:8]}: {e}")
    except Exception as e:
        log.error(f"Stale run check failed: {e}")


def dispatch_once(run_id_filter: str | None = None) -> int:
    """Single dispatch pass. Returns number of steps dispatched."""
    params = {"status": "eq.running"}
    if run_id_filter:
        params["id"] = f"eq.{run_id_filter}"

    runs = sb_select("antfarm_runs", params)
    if not runs:
        log.info("No running runs — clearing flag, disabling schedule")
        clear_active_flag()
        set_schedule_enabled(False)
        return 0

    log.info(f"Found {len(runs)} running run(s)")
    dispatched = 0

    for run in runs:
        run_id = run["id"]
        workflow_id = run["workflow_id"]
        context = run.get("context") or {}
        if isinstance(context, str):
            context = json.loads(context)
        repo = context.get("worktree_path") or context.get("repo", "")

        try:
            wf = load_workflow(workflow_id)
        except FileNotFoundError:
            log.error(f"Workflow not found: {workflow_id}")
            continue

        for agent_def in wf.get("agents", []):
            agent_id = f"{workflow_id}_{agent_def['id']}"
            agent_name = agent_def["id"]
            role = agent_def.get("role", "analysis")
            model = agent_def.get("model")

            if not antfarm_peek(agent_id):
                continue

            claim = antfarm_claim(agent_id)
            if not claim:
                continue

            step_id = claim["stepId"]
            task_input = claim["input"]
            log.info(f"CLAIMED step={step_id} agent={agent_id} run={run_id[:8]}")

            prompt = build_prompt(agent_name, task_input)
            start = time.time()
            result = execute_agent(agent_name, role, prompt, repo, model=model)
            duration = time.time() - start

            # Record token usage (best-effort, never blocks dispatch)
            record_token_usage(
                result.get("usage", {}),
                source="antfarm",
                run_id=run_id,
                step_id=step_id,
                agent=agent_name,
                workflow_id=workflow_id,
                duration_seconds=duration,
            )

            if result["success"]:
                # Check expects / retry_step before completing
                # Find which workflow step this DB step belongs to
                step_rows = sb_select("antfarm_steps", {
                    "id": f"eq.{step_id}",
                    "select": "step_id",
                })
                wf_step_id = step_rows[0]["step_id"] if step_rows else ""
                step_cfg = get_step_config(workflow_id, wf_step_id)

                if handle_retry_step(run, step_id, step_cfg, result["output"]):
                    log.info(
                        f"RETRY_STEP step={step_id} agent={agent_id} "
                        f"duration={duration:.0f}s"
                    )
                    dispatched += 1
                    continue

                completion = antfarm_complete(step_id, result["output"])
                log.info(
                    f"COMPLETED step={step_id} agent={agent_id} "
                    f"duration={duration:.0f}s"
                )
                dispatched += 1

                # Milestone check (25%/50%/75% progress notifications)
                if not completion.get("runCompleted"):
                    check_milestone(run_id, run.get("task", "unknown"))

                if completion.get("runCompleted"):
                    task = run.get("task", "unknown")
                    if workflow_id == "content-factory":
                        deliver_content_factory(run)
                    else:
                        notify(f"Antfarm run completed: {task}")
                    log.info(f"RUN COMPLETED: {run_id[:8]} — {task}")
                    cleanup_worktree(context)
                    run_evaluator(run_id)
            else:
                fail_result = antfarm_fail(step_id, result["error"])
                log.info(
                    f"FAILED step={step_id} agent={agent_id} "
                    f"error={result['error'][:100]} duration={duration:.0f}s"
                )

                if fail_result.get("runFailed"):
                    task = run.get("task", "unknown")
                    notify(
                        f"Antfarm run failed: {task}\n{result['error'][:200]}"
                    )
                    log.info(f"RUN FAILED: {run_id[:8]} — {task}")
                    cleanup_worktree(context)
                    run_evaluator(run_id)

    # Check for stuck runs that should be auto-closed
    close_stale_runs()

    log.info(f"Pass complete — dispatched {dispatched} step(s)")
    return dispatched


# --- Entry point ---

def main():
    args = sys.argv[1:]
    run_id = None
    once = False

    i = 0
    while i < len(args):
        if args[i] == "--once":
            once = True
        elif args[i] == "--run-id" and i + 1 < len(args):
            run_id = args[i + 1]
            i += 1
        i += 1

    if once:
        # Flag-file gating: skip entirely if no work is expected
        if not run_id and not should_dispatch():
            return
        dispatch_once(run_id)
    else:
        log.info("Starting continuous dispatch loop")
        while True:
            runs = sb_select("antfarm_runs", {"status": "eq.running"})
            if run_id:
                runs = [r for r in runs if r["id"] == run_id]
            if not runs:
                log.info("No running runs — exiting continuous loop")
                clear_active_flag()
                set_schedule_enabled(False)
                break
            dispatch_once(run_id)
            time.sleep(15)


if __name__ == "__main__":
    main()
