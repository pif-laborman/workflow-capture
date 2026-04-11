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
    "analysis":     {"cmd": ["claude", "-p", "--permission-mode", "bypassPermissions", "--output-format", "json", "--model", "opus"],
                     "user": "ralph", "timeout": 900},
    "coding":       {"cmd": ["claude", "-p", "--permission-mode", "bypassPermissions", "--output-format", "json", "--model", "opus"],
                     "user": "ralph", "timeout": 1800},
    "verification": {"cmd": ["claude", "-p", "--permission-mode", "bypassPermissions", "--output-format", "json", "--model", "opus"],
                     "user": "ralph", "timeout": 1500},
    "testing":      {"cmd": ["claude", "-p", "--permission-mode", "bypassPermissions", "--output-format", "json", "--model", "opus"],
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

# --- Process registry (parallel dispatch) ---

# Maps step_id -> {popen, run_id, agent_id, start_time, stdout_path, prompt_file,
#                  workflow_id, agent_name, role, run, context}
PROCESS_REGISTRY: dict = {}
AGENT_TIMEOUT_SECONDS = 1200  # 20 minutes
SHUTDOWN_REQUESTED = False  # Set by SIGTERM handler to stop daemon loop


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


# --- Antfarm CLI wrappers ---

def antfarm_peek(agent_id: str) -> bool:
    r = subprocess.run(
        ["antfarm", "step", "peek", agent_id],
        capture_output=True, text=True, timeout=30,
    )
    return "HAS_WORK" in r.stdout


def antfarm_claim(agent_id: str, run_id: str | None = None) -> dict | None:
    cmd = ["antfarm", "step", "claim", agent_id]
    if run_id:
        cmd.extend(["--run-id", run_id])
    r = subprocess.run(
        cmd,
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
    if repo and not Path(repo).is_dir():
        return {"success": False,
                "error": f"Repo path does not exist: {repo} — check --repo value",
                "usage": {}}

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
            # Ralph's credentials are at /home/ralph/.claude/.credentials.json
            # Written by MC server's writeTenantCredentials on admin token refresh.
            # Owned by ralph — no ACL needed.
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


def execute_agent_async(agent_name: str, role: str, prompt: str, repo: str,
                        model: str | None = None) -> dict | None:
    """Invoke claude asynchronously — returns immediately with Popen handle.

    Returns dict with 'popen' (Popen), 'stdout_path' (str), 'prompt_file' (str)
    on success, or None if the repo path doesn't exist.

    The caller is responsible for:
      - Polling popen.poll() to detect completion
      - Reading stdout_path for captured output
      - Deleting prompt_file and stdout_path after harvest
    """
    if repo and not Path(repo).is_dir():
        log.error(f"execute_agent_async: repo path does not exist: {repo}")
        return None

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

    # Open a temp file for stdout capture (not a pipe, to avoid deadlock)
    stdout_path = tempfile.mktemp(suffix=".log", prefix="antfarm-stdout-")

    try:
        stdout_fh = open(stdout_path, "w")

        if config["user"] == "ralph":
            cmd_str = " ".join(config["cmd"])
            shell_cmd = (
                f'unset CLAUDECODE; cd "{repo}" && {cmd_str} < "{prompt_file}"'
            )
            popen = subprocess.Popen(
                ["su", "-", "ralph", "-c", shell_cmd],
                stdout=stdout_fh, stderr=subprocess.STDOUT, text=True,
            )
        else:
            cmd_str = " ".join(config["cmd"])
            shell_cmd = f'cd "{repo}" && {cmd_str} < "{prompt_file}"'
            popen = subprocess.Popen(
                ["bash", "-c", shell_cmd],
                stdout=stdout_fh, stderr=subprocess.STDOUT, text=True,
            )

        return {"popen": popen, "stdout_path": stdout_path, "prompt_file": prompt_file}
    except Exception as e:
        log.error(f"execute_agent_async failed to spawn: {e}")
        # Clean up on failure
        try:
            stdout_fh.close()
        except Exception:
            pass
        for p in [prompt_file, stdout_path]:
            try:
                os.unlink(p)
            except OSError:
                pass
        return None


# --- Harvest completed processes ---

def harvest() -> int:
    """Poll process registry for finished agents and run completion logic.

    Returns the number of harvested (finished or timed-out) processes.
    """
    harvested = 0
    now = time.time()

    # Iterate over a snapshot since we mutate the registry
    for step_id, entry in list(PROCESS_REGISTRY.items()):
        proc = entry["popen"]
        returncode = proc.poll()
        elapsed = now - entry["start_time"]

        # Check for timeout
        if returncode is None:
            if elapsed > AGENT_TIMEOUT_SECONDS:
                log.info(
                    f"TIMEOUT step={step_id} agent={entry['agent_id']} "
                    f"elapsed={elapsed:.0f}s — killing"
                )
                try:
                    proc.kill()
                    proc.wait(timeout=10)
                except Exception as e:
                    log.error(f"Failed to kill timed-out process for step={step_id}: {e}")

                # Read any partial stdout
                stdout_text = ""
                try:
                    with open(entry["stdout_path"], "r") as f:
                        stdout_text = f.read()
                except Exception:
                    pass

                error_msg = f"Agent timed out after {AGENT_TIMEOUT_SECONDS}s"
                fail_result = antfarm_fail(step_id, error_msg)
                log.info(
                    f"HARVESTED step={step_id} agent={entry['agent_id']} "
                    f"duration={elapsed:.0f}s status=timeout"
                )

                if fail_result.get("runFailed"):
                    run = entry["run"]
                    task = run.get("task", "unknown")
                    notify(f"Antfarm run failed: {task}\n{error_msg}")
                    log.info(f"RUN FAILED: {entry['run_id'][:8]} — {task}")
                    context = entry.get("context") or {}
                    cleanup_worktree(context)
                    run_evaluator(entry["run_id"])

                # Clean up temp files
                for path in [entry.get("prompt_file"), entry.get("stdout_path")]:
                    if path:
                        try:
                            os.unlink(path)
                        except OSError:
                            pass

                del PROCESS_REGISTRY[step_id]
                harvested += 1
            continue  # Still running and not timed out

        # Process finished — read stdout from temp file
        duration = elapsed
        stdout_text = ""
        try:
            with open(entry["stdout_path"], "r") as f:
                stdout_text = f.read()
        except Exception as e:
            log.error(f"Failed to read stdout for step={step_id}: {e}")

        parsed = parse_claude_json(stdout_text)

        # Record token usage (best-effort)
        record_token_usage(
            parsed.get("usage", {}),
            source="antfarm",
            run_id=entry["run_id"],
            step_id=step_id,
            agent=entry["agent_name"],
            workflow_id=entry["workflow_id"],
            duration_seconds=duration,
        )

        run = entry["run"]
        run_id = entry["run_id"]
        agent_id = entry["agent_id"]
        workflow_id = entry["workflow_id"]
        context = entry.get("context") or {}

        if returncode == 0:
            # --- Success path ---
            # Look up step_id and type from DB
            step_rows = sb_select("antfarm_steps", {
                "id": f"eq.{step_id}",
                "select": "step_id,type",
            })
            wf_step_id = step_rows[0]["step_id"] if step_rows else ""
            step_type = step_rows[0].get("type", "single") if step_rows else "single"
            step_cfg = get_step_config(workflow_id, wf_step_id)

            # Skip dispatcher retry logic for loop and verifyEach steps
            is_loop_step = step_type == "loop"
            is_verify_each_target = False
            if not is_loop_step:
                loop_steps = sb_select("antfarm_steps", {
                    "run_id": f"eq.{run_id}",
                    "type": "eq.loop",
                    "select": "loop_config",
                })
                for ls in loop_steps:
                    lc = ls.get("loop_config") or {}
                    if isinstance(lc, str):
                        lc = json.loads(lc)
                    if lc.get("verifyEach") and lc.get("verifyStep") == wf_step_id:
                        is_verify_each_target = True
                        break

            if not is_loop_step and not is_verify_each_target:
                if handle_retry_step(run, step_id, step_cfg, parsed["text"]):
                    log.info(
                        f"HARVESTED step={step_id} agent={agent_id} "
                        f"duration={duration:.0f}s status=retry"
                    )
                    # Clean up temp files
                    for path in [entry.get("prompt_file"), entry.get("stdout_path")]:
                        if path:
                            try:
                                os.unlink(path)
                            except OSError:
                                pass
                    del PROCESS_REGISTRY[step_id]
                    harvested += 1
                    continue

            completion = antfarm_complete(step_id, parsed["text"])
            log.info(
                f"HARVESTED step={step_id} agent={agent_id} "
                f"duration={duration:.0f}s status=success"
            )

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
            # --- Failure path ---
            err = (stdout_text or "unknown error")[:2000]
            fail_result = antfarm_fail(step_id, err)
            log.info(
                f"HARVESTED step={step_id} agent={agent_id} "
                f"duration={duration:.0f}s status=failed"
            )

            if fail_result.get("runFailed"):
                task = run.get("task", "unknown")
                notify(f"Antfarm run failed: {task}\n{err[:200]}")
                log.info(f"RUN FAILED: {run_id[:8]} — {task}")
                cleanup_worktree(context)
                run_evaluator(run_id)

        # Clean up temp files
        for path in [entry.get("prompt_file"), entry.get("stdout_path")]:
            if path:
                try:
                    os.unlink(path)
                except OSError:
                    pass

        del PROCESS_REGISTRY[step_id]
        harvested += 1

    return harvested


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
        # Preserve the last output so the UI shows what actually failed
        last_output = context.get(f"{current_step_name}_output", "")
        error_msg = f"Retries exhausted ({retry_count}/{max_retries})"
        step_output = f"{error_msg}\n\nLast output:\n{last_output[:3000]}" if last_output else error_msg

        # Directly mark step + run as failed (bypass CLI failStep which
        # has its own retry counter that conflicts with ours).
        sb_update("antfarm_steps", {"id": current_step_id}, {
            "status": "failed",
            "output": step_output,
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


def prune_stale_worktrees():
    """Remove worktree dirs whose runs are no longer running.

    Scans all .antfarm/run-<uuid>* dirs, extracts the run UUID,
    checks DB status, and removes if not 'running'.
    """
    import glob as _glob

    antfarm_dirs = _glob.glob("/opt/assistant-platform/.antfarm/run-*")
    if not antfarm_dirs:
        return

    # Extract unique run UUIDs from dir names (run-<uuid> or run-<uuid>-suffix)
    uuid_re = re.compile(r"run-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})")
    dirs_by_run: dict[str, list[str]] = {}
    for d in antfarm_dirs:
        m = uuid_re.search(d)
        if m:
            dirs_by_run.setdefault(m.group(1), []).append(d)

    if not dirs_by_run:
        return

    # Batch-check which runs are still active
    run_ids = list(dirs_by_run.keys())
    try:
        active_runs = sb_select("antfarm_runs", {
            "id": f"in.({','.join(run_ids)})",
            "status": "eq.running",
            "select": "id",
        })
        active_ids = {r["id"] for r in active_runs}
    except Exception as e:
        log.error(f"Stale worktree check failed: {e}")
        return

    repo = "/opt/assistant-platform"
    for run_id, dirs in dirs_by_run.items():
        if run_id in active_ids:
            continue
        for d in dirs:
            try:
                subprocess.run(
                    ["git", "-C", repo, "worktree", "remove", "--force", d],
                    capture_output=True, text=True, timeout=30,
                )
                log.info(f"Pruned stale worktree: {d}")
            except Exception as e:
                log.error(f"Stale worktree prune failed for {d}: {e}")

    # Also prune git's internal worktree bookkeeping
    try:
        subprocess.run(
            ["git", "-C", repo, "worktree", "prune"],
            capture_output=True, text=True, timeout=10,
        )
    except Exception:
        pass


# --- Concurrency control ---

PER_RUN_CAP = 1  # Max concurrent agents per run (fair sharing)


def get_max_concurrent() -> int:
    """Query Supabase policies table for global concurrency cap.

    Returns the value of 'max_concurrent_antfarm_agents' policy, defaulting to 3.
    """
    try:
        rows = sb_select("policies", {
            "key": "eq.max_concurrent_antfarm_agents",
            "select": "value",
        })
        if rows:
            return int(rows[0]["value"])
    except Exception as e:
        log.error(f"Failed to fetch max_concurrent policy: {e}")
    return 3


def spawn_pass(run_id_filter: str | None = None) -> int:
    """Scan for claimable work and spawn agents respecting concurrency limits.

    Returns count of newly spawned agents.
    """
    prune_stale_worktrees()

    params = {"status": "eq.running"}
    if run_id_filter:
        params["id"] = f"eq.{run_id_filter}"

    runs = sb_select("antfarm_runs", params)
    if not runs:
        log.info("No running runs found in spawn_pass")
        return 0

    global_cap = get_max_concurrent()
    spawned = 0

    for run in runs:
        # Global cap check
        if len(PROCESS_REGISTRY) >= global_cap:
            log.info("CAPACITY: global cap reached")
            break

        run_id = run["id"]

        # Per-run cap check
        run_active = sum(1 for e in PROCESS_REGISTRY.values() if e["run_id"] == run_id)
        if run_active >= PER_RUN_CAP:
            log.info(f"CAPACITY: run {run_id[:8]} already has active agent")
            continue

        workflow_id = run["workflow_id"]
        context = run.get("context") or {}
        if isinstance(context, str):
            context = json.loads(context)
        repo = context.get("worktree_path") or context.get("repo", "")

        # Safety check: worktree must not equal original repo
        original_repo = context.get("original_repo", "")
        if original_repo and repo and os.path.realpath(repo) == os.path.realpath(original_repo):
            log.error(
                f"WORKTREE SAFETY: run={run_id[:8]} worktree_path equals original_repo "
                f"({repo}) — refusing to dispatch."
            )
            sb_update("antfarm_runs", {"id": run_id}, {
                "status": "failed",
                "error": "Worktree not isolated: worktree_path equals original_repo",
            })
            continue

        try:
            wf = load_workflow(workflow_id)
        except FileNotFoundError:
            log.error(f"Workflow not found: {workflow_id}")
            continue

        for agent_def in wf.get("agents", []):
            # Re-check global cap inside inner loop
            if len(PROCESS_REGISTRY) >= global_cap:
                log.info("CAPACITY: global cap reached")
                break

            # Re-check per-run cap
            run_active = sum(1 for e in PROCESS_REGISTRY.values() if e["run_id"] == run_id)
            if run_active >= PER_RUN_CAP:
                break

            agent_id = f"{workflow_id}_{agent_def['id']}"
            agent_name = agent_def["id"]
            role = agent_def.get("role", "analysis")
            model = agent_def.get("model")

            if not antfarm_peek(agent_id):
                continue

            claim = antfarm_claim(agent_id, run_id)
            if not claim:
                continue

            step_id = claim["stepId"]
            task_input = claim["input"]
            claimed_run_id = claim.get("runId", run_id)
            if claimed_run_id != run_id:
                log.warning(
                    f"CLAIM MISMATCH: expected run={run_id[:8]} got run={claimed_run_id[:8]} "
                    f"step={step_id} agent={agent_id} — skipping"
                )
                continue

            log.info(f"CLAIMED step={step_id} agent={agent_id} run={run_id[:8]}")
            prompt = build_prompt(agent_name, task_input)
            result = execute_agent_async(agent_name, role, prompt, repo, model=model)

            if result is None:
                log.error(f"Failed to spawn agent for step={step_id}")
                antfarm_fail(step_id, "Failed to spawn agent process")
                continue

            PROCESS_REGISTRY[step_id] = {
                "popen": result["popen"],
                "run_id": run_id,
                "agent_id": agent_id,
                "start_time": time.time(),
                "stdout_path": result["stdout_path"],
                "prompt_file": result["prompt_file"],
                "workflow_id": workflow_id,
                "agent_name": agent_name,
                "role": role,
                "run": run,
                "context": context,
            }
            log.info(
                f"SPAWNED step={step_id} agent={agent_id} run={run_id[:8]} "
                f"pid={result['popen'].pid}"
            )
            spawned += 1

    close_stale_runs()
    return spawned


# --- Main dispatch ---

def close_stale_runs():
    """Close runs where all steps are done but the run is still 'running',
    or runs stuck in 'running' for more than 4 hours.
    """
    try:
        running = sb_select("antfarm_runs", {
            "status": "eq.running",
            "select": "id,task,created_at,updated_at,context",
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
            # Use updated_at (reset on resume) so resumed runs don't get instantly killed
            last_activity = run.get("updated_at") or run.get("created_at", "")
            if last_activity:
                try:
                    activity_dt = datetime.fromisoformat(last_activity.replace("Z", "+00:00"))
                    age_hours = (now - activity_dt).total_seconds() / 3600
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
    prune_stale_worktrees()
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

        # Safety check: worktree must not equal original repo (cross-run contamination)
        original_repo = context.get("original_repo", "")
        if original_repo and repo and os.path.realpath(repo) == os.path.realpath(original_repo):
            log.error(
                f"WORKTREE SAFETY: run={run_id[:8]} worktree_path equals original_repo "
                f"({repo}) — refusing to dispatch. Setup likely failed to create worktree."
            )
            sb_update("antfarm_runs", {"id": run_id}, {
                "status": "failed",
                "error": "Worktree not isolated: worktree_path equals original_repo",
            })
            continue

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

            claim = antfarm_claim(agent_id, run_id)
            if not claim:
                continue

            step_id = claim["stepId"]
            task_input = claim["input"]
            claimed_run_id = claim.get("runId", run_id)
            if claimed_run_id != run_id:
                log.warning(
                    f"CLAIM MISMATCH: expected run={run_id[:8]} got run={claimed_run_id[:8]} "
                    f"step={step_id} agent={agent_id} — skipping"
                )
                continue
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
                    "select": "step_id,type",
                })
                wf_step_id = step_rows[0]["step_id"] if step_rows else ""
                step_type = step_rows[0].get("type", "single") if step_rows else "single"
                step_cfg = get_step_config(workflow_id, wf_step_id)

                # Skip dispatcher retry logic for loop steps and their
                # paired verify steps. Loop steps have their own completion
                # semantics (per-story iteration, verifyEach) managed by
                # antfarm's completeStep. The dispatcher's expects check
                # doesn't understand that a loop step won't emit STATUS: done
                # until all stories are finished.
                is_loop_step = step_type == "loop"
                is_verify_each_target = False
                if not is_loop_step:
                    # Check if this step is the verify target of a loop step
                    loop_steps = sb_select("antfarm_steps", {
                        "run_id": f"eq.{run_id}",
                        "type": "eq.loop",
                        "select": "loop_config",
                    })
                    for ls in loop_steps:
                        lc = ls.get("loop_config") or {}
                        if isinstance(lc, str):
                            lc = json.loads(lc)
                        if lc.get("verifyEach") and lc.get("verifyStep") == wf_step_id:
                            is_verify_each_target = True
                            break

                if not is_loop_step and not is_verify_each_target:
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


# --- Daemon mode ---

def daemon_loop(run_id_filter: str | None = None):
    """Long-running poll loop: harvest finished agents, spawn new ones, sleep adaptively."""
    global SHUTDOWN_REQUESTED
    log.info("Starting daemon mode")

    while not SHUTDOWN_REQUESTED:
        harvested = harvest()
        spawned = spawn_pass(run_id_filter)
        active = len(PROCESS_REGISTRY)
        log.info(
            f"POLL CYCLE: active={active} harvested={harvested} spawned={spawned}"
        )

        interval = 10 if PROCESS_REGISTRY else 60
        # Sleep in small increments so we can check SHUTDOWN_REQUESTED
        elapsed = 0
        while elapsed < interval and not SHUTDOWN_REQUESTED:
            time.sleep(min(1, interval - elapsed))
            elapsed += 1

    log.info("Daemon exiting")


# --- Entry point ---

def main():
    args = sys.argv[1:]
    run_id = None
    once = False
    daemon = False

    i = 0
    while i < len(args):
        if args[i] == "--once":
            once = True
        elif args[i] == "--daemon":
            daemon = True
        elif args[i] == "--run-id" and i + 1 < len(args):
            run_id = args[i + 1]
            i += 1
        i += 1

    if daemon:
        # Always add StreamHandler in daemon mode for journald visibility
        _sh_daemon = logging.StreamHandler()
        _sh_daemon.setFormatter(_fmt)
        log.addHandler(_sh_daemon)
        daemon_loop(run_id)
    elif once:
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
