#!/usr/bin/env python3
"""
antfarm-evaluator.py — Closed-loop post-run evaluation for antfarm workflows

Called by antfarm-dispatch.py after a run completes or fails.
Collects metrics, evaluates quality, detects failure patterns, and
auto-escalates to Telegram when things go wrong repeatedly.

Usage:
    antfarm-evaluator.py <run-id>               # evaluate a single run
    antfarm-evaluator.py --check-patterns       # scan for systemic failure patterns
    antfarm-evaluator.py --backfill             # compute metrics for all past runs
"""

import json
import logging
import os
import subprocess
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

import requests

# --- Configuration ---

SCRIPTS_DIR = Path.home() / "scripts"
TELEGRAM_SEND = SCRIPTS_DIR / "telegram-send.sh"
LOGS_DIR = Path.home() / "logs"

SUPABASE_URL = os.environ.get("PIF_SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("PIF_SUPABASE_SERVICE_ROLE_KEY", "")
if not SUPABASE_KEY:
    try:
        import subprocess as _sp
        _result = _sp.run(["pif-creds", "get", "Supabase"], capture_output=True, text=True, check=True)
        SUPABASE_KEY = _result.stdout.strip()
    except Exception:
        SUPABASE_KEY = os.environ.get("PIF_SUPABASE_ANON_KEY", "")
SUPABASE_HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation",
}

# Escalation thresholds
FAILURE_WINDOW_HOURS = 24
FAILURE_THRESHOLD = 3          # same workflow fails N times in window → escalate
RETRY_RATE_THRESHOLD = 0.5     # step retries > 50% of attempts → flag
DURATION_ANOMALY_FACTOR = 2.0  # run takes >2x median → flag

# Success criteria per workflow type
SUCCESS_CRITERIA = {
    "content-factory": {
        "required_context_keys": ["write_output"],
        "min_quality_score": 8.0,  # editor rubric average
        "max_duration_minutes": 60,
    },
    "feature-dev": {
        "required_context_keys": [],
        "min_stories_completed_pct": 0.5,  # at least half of stories done
        "max_duration_minutes": 180,
    },
    "bug-fix": {
        "required_context_keys": ["root_cause", "fix_approach"],
        "max_duration_minutes": 120,
    },
    "security-audit": {
        "required_context_keys": ["vulnerability_count"],
        "max_duration_minutes": 180,
    },
}

# --- Logging ---

LOGS_DIR.mkdir(exist_ok=True)
log = logging.getLogger("antfarm-evaluator")
log.setLevel(logging.INFO)
_fmt = logging.Formatter("%(asctime)s %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
_fh = logging.FileHandler(LOGS_DIR / "antfarm-evaluator.log")
_fh.setFormatter(_fmt)
log.addHandler(_fh)
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


def sb_insert(table: str, data: dict) -> dict:
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers=SUPABASE_HEADERS, json=data,
    )
    r.raise_for_status()
    result = r.json()
    return result[0] if isinstance(result, list) and result else result


def sb_update(table: str, match: dict, data: dict):
    params = {k: f"eq.{v}" for k, v in match.items()}
    r = requests.patch(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers=SUPABASE_HEADERS, params=params, json=data,
    )
    r.raise_for_status()


# --- Notifications ---

def notify(message: str):
    try:
        subprocess.run([str(TELEGRAM_SEND), message], timeout=30, capture_output=True)
    except Exception as e:
        log.error(f"Notify failed: {e}")


def escalate(message: str, reason: str):
    """Send an escalation alert — more prominent than a normal notification."""
    header = "⚠️ ANTFARM ESCALATION\n\n"
    notify(header + message)
    log.warning(f"ESCALATED: {reason}")


# --- Metrics collection ---

def collect_run_metrics(run_id: str) -> dict:
    """Gather all metrics for a completed/failed run."""

    # Fetch run data
    runs = sb_select("antfarm_runs", {
        "id": f"eq.{run_id}",
        "select": "id,workflow_id,task,status,context,created_at,updated_at",
    })
    if not runs:
        raise ValueError(f"Run {run_id} not found")
    run = runs[0]

    # Fetch all steps for this run
    steps = sb_select("antfarm_steps", {
        "run_id": f"eq.{run_id}",
        "select": "id,step_id,agent_id,step_index,status,retry_count,max_retries,"
                  "abandoned_count,updated_at,type",
        "order": "step_index.asc",
    })

    # Fetch stories if any
    stories = sb_select("antfarm_stories", {
        "run_id": f"eq.{run_id}",
        "select": "id,story_id,title,status,retry_count",
    })

    # Fetch events for timing data
    events = sb_select("antfarm_events", {
        "run_id": f"eq.{run_id}",
        "select": "ts,event,step_id,detail",
        "order": "ts.asc",
    })

    # Calculate duration
    created = datetime.fromisoformat(run["created_at"])
    updated = datetime.fromisoformat(run["updated_at"])
    duration_seconds = int((updated - created).total_seconds())

    # Calculate step durations from events
    step_durations = _calculate_step_durations(events, steps)

    # Count retries across all steps
    total_retries = sum(s.get("retry_count", 0) for s in steps)
    total_abandoned = sum(s.get("abandoned_count", 0) for s in steps)

    # Story metrics
    story_count = len(stories)
    stories_completed = len([s for s in stories if s["status"] == "done"])
    stories_failed = len([s for s in stories if s["status"] == "failed"])

    # Quality score (workflow-specific)
    quality_score, quality_details = _evaluate_quality(run, steps, stories)

    # Failure reason for failed runs
    failure_reason = None
    if run["status"] == "failed":
        fail_events = [e for e in events if e["event"] in ("run.failed", "step.failed")]
        if fail_events:
            failure_reason = fail_events[-1].get("detail", "Unknown failure")

    return {
        "run_id": run_id,
        "workflow_id": run["workflow_id"],
        "status": run["status"],
        "duration_seconds": duration_seconds,
        "step_count": len(steps),
        "retry_count": total_retries + total_abandoned,
        "story_count": story_count,
        "stories_completed": stories_completed,
        "stories_failed": stories_failed,
        "quality_score": quality_score,
        "quality_details": quality_details,
        "failure_reason": failure_reason,
        "step_durations": step_durations,
    }


def _calculate_step_durations(events: list, steps: list) -> dict:
    """Calculate per-step durations from events timeline."""
    step_times = {}  # step_id -> {start, end}

    for event in events:
        step_id = event.get("step_id")
        if not step_id:
            continue
        ts = event["ts"]
        etype = event["event"]

        if step_id not in step_times:
            step_times[step_id] = {"start": None, "end": None}

        if etype in ("step.running", "step.pending"):
            if step_times[step_id]["start"] is None:
                step_times[step_id]["start"] = ts
        elif etype in ("step.done", "step.failed"):
            step_times[step_id]["end"] = ts

    durations = {}
    for step_id, times in step_times.items():
        if times["start"] and times["end"]:
            start = datetime.fromisoformat(times["start"])
            end = datetime.fromisoformat(times["end"])
            durations[step_id] = int((end - start).total_seconds())
        elif times["start"]:
            durations[step_id] = None  # still running or no end event

    return durations


def _evaluate_quality(run: dict, steps: list, stories: list) -> tuple:
    """Evaluate output quality based on workflow-specific criteria.

    Returns (quality_score, quality_details_dict).
    """
    workflow_id = run["workflow_id"]
    criteria = SUCCESS_CRITERIA.get(workflow_id, {})
    context = run.get("context") or {}
    if isinstance(context, str):
        context = json.loads(context)

    details = {"checks": []}
    scores = []

    # Check 1: Required context keys present
    required_keys = criteria.get("required_context_keys", [])
    if required_keys:
        present = [k for k in required_keys if context.get(k)]
        missing = [k for k in required_keys if not context.get(k)]
        score = len(present) / len(required_keys) * 10 if required_keys else 10
        scores.append(score)
        details["checks"].append({
            "name": "required_outputs",
            "score": score,
            "present": present,
            "missing": missing,
        })

    # Check 2: Duration within budget
    max_minutes = criteria.get("max_duration_minutes")
    created = datetime.fromisoformat(run["created_at"])
    updated = datetime.fromisoformat(run["updated_at"])
    actual_minutes = (updated - created).total_seconds() / 60
    if max_minutes:
        if actual_minutes <= max_minutes:
            score = 10.0
        elif actual_minutes <= max_minutes * 1.5:
            score = 7.0
        else:
            score = 4.0
        scores.append(score)
        details["checks"].append({
            "name": "duration",
            "score": score,
            "actual_minutes": round(actual_minutes, 1),
            "budget_minutes": max_minutes,
        })

    # Check 3: Story completion rate (if applicable)
    min_stories_pct = criteria.get("min_stories_completed_pct")
    if min_stories_pct is not None and stories:
        total = len(stories)
        completed = len([s for s in stories if s["status"] == "done"])
        pct = completed / total if total > 0 else 0
        score = min(10.0, (pct / min_stories_pct) * 10) if min_stories_pct > 0 else 10
        scores.append(score)
        details["checks"].append({
            "name": "story_completion",
            "score": round(score, 1),
            "completed": completed,
            "total": total,
            "pct": round(pct * 100, 1),
        })

    # Check 4: Content-factory editor score (extracted from context)
    if workflow_id == "content-factory":
        # The editor step stores scores in context
        editor_score = None
        for key in ("edit_output", "editor_output"):
            output = context.get(key, "")
            if output:
                # Parse "Average: X.X" or "AVERAGE: X.X" from editor output
                import re
                m = re.search(r'(?:average|avg|overall)[:\s]+(\d+\.?\d*)', output, re.I)
                if m:
                    editor_score = float(m.group(1))
                    break

        if editor_score is not None:
            scores.append(editor_score)
            details["checks"].append({
                "name": "editor_rubric",
                "score": editor_score,
            })

    # Check 5: Retry efficiency (fewer retries = better)
    total_retries = sum(s.get("retry_count", 0) for s in steps)
    total_steps = len(steps)
    if total_steps > 0:
        retry_rate = total_retries / total_steps
        score = max(0, 10 - retry_rate * 5)  # each retry per step costs 5 points
        scores.append(round(score, 1))
        details["checks"].append({
            "name": "retry_efficiency",
            "score": round(score, 1),
            "total_retries": total_retries,
            "total_steps": total_steps,
        })

    # Calculate overall quality score
    quality_score = round(sum(scores) / len(scores), 2) if scores else None

    return quality_score, details


# --- Pattern detection ---

def check_failure_patterns(workflow_id: str = None) -> list:
    """Detect systemic failure patterns across recent runs.

    Returns list of escalation-worthy findings.
    """
    findings = []
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=FAILURE_WINDOW_HOURS)).isoformat()

    # Get recent metrics
    params = {
        "select": "run_id,workflow_id,status,created_at,duration_seconds,retry_count,"
                  "failure_reason,quality_score,stories_failed,step_count",
        "created_at": f"gte.{cutoff}",
        "order": "created_at.desc",
    }
    if workflow_id:
        params["workflow_id"] = f"eq.{workflow_id}"

    metrics = sb_select("antfarm_run_metrics", params)

    if not metrics:
        return findings

    # Group by workflow
    by_workflow = {}
    for m in metrics:
        wf = m["workflow_id"]
        by_workflow.setdefault(wf, []).append(m)

    for wf, runs in by_workflow.items():
        failed = [r for r in runs if r["status"] == "failed"]
        total = len(runs)

        # Pattern 1: Repeated failures
        if len(failed) >= FAILURE_THRESHOLD:
            # Check if the failure reasons are the same
            reasons = [r.get("failure_reason", "unknown") for r in failed]
            unique_reasons = set(reasons)
            findings.append({
                "type": "repeated_failure",
                "workflow": wf,
                "failures": len(failed),
                "total_runs": total,
                "window_hours": FAILURE_WINDOW_HOURS,
                "reasons": list(unique_reasons),
                "message": (
                    f"Workflow `{wf}` failed {len(failed)}/{total} times "
                    f"in the last {FAILURE_WINDOW_HOURS}h.\n"
                    f"Reasons: {', '.join(unique_reasons)}"
                ),
            })

        # Pattern 2: High retry rate
        total_retries = sum(r.get("retry_count", 0) for r in runs)
        total_steps = sum(r.get("step_count", 0) for r in runs)
        if total_steps > 0:
            retry_rate = total_retries / total_steps
            if retry_rate > RETRY_RATE_THRESHOLD:
                findings.append({
                    "type": "high_retry_rate",
                    "workflow": wf,
                    "retry_rate": round(retry_rate, 2),
                    "total_retries": total_retries,
                    "total_steps": total_steps,
                    "message": (
                        f"Workflow `{wf}` has {round(retry_rate*100)}% retry rate "
                        f"({total_retries} retries across {total_steps} steps "
                        f"in {total} runs)."
                    ),
                })

        # Pattern 3: Quality degradation
        scored = [r for r in runs if r.get("quality_score") is not None]
        if len(scored) >= 2:
            recent_scores = [float(r["quality_score"]) for r in scored[:3]]
            avg_recent = sum(recent_scores) / len(recent_scores)
            if avg_recent < 6.0:
                findings.append({
                    "type": "low_quality",
                    "workflow": wf,
                    "avg_score": round(avg_recent, 1),
                    "message": (
                        f"Workflow `{wf}` quality trending low: "
                        f"avg {round(avg_recent, 1)}/10 across last "
                        f"{len(recent_scores)} runs."
                    ),
                })

        # Pattern 4: Duration anomaly
        durations = [r["duration_seconds"] for r in runs if r.get("duration_seconds")]
        if len(durations) >= 3:
            sorted_d = sorted(durations)
            median = sorted_d[len(sorted_d) // 2]
            latest = durations[0]  # most recent
            if latest > median * DURATION_ANOMALY_FACTOR and median > 0:
                findings.append({
                    "type": "duration_anomaly",
                    "workflow": wf,
                    "latest_seconds": latest,
                    "median_seconds": median,
                    "message": (
                        f"Workflow `{wf}` latest run took "
                        f"{latest//60}min vs median {median//60}min "
                        f"({round(latest/median, 1)}x slower)."
                    ),
                })

    return findings


# --- Main evaluation flow ---

def evaluate_run(run_id: str):
    """Full post-run evaluation: collect metrics, check patterns, escalate."""

    # Check if already evaluated
    existing = sb_select("antfarm_run_metrics", {
        "run_id": f"eq.{run_id}",
        "select": "id",
    })
    if existing:
        log.info(f"Run {run_id[:8]} already evaluated, skipping")
        return

    # Collect metrics
    log.info(f"Evaluating run {run_id[:8]}")
    metrics = collect_run_metrics(run_id)

    # Store metrics
    sb_insert("antfarm_run_metrics", metrics)
    log.info(
        f"Metrics stored: workflow={metrics['workflow_id']} "
        f"status={metrics['status']} "
        f"duration={metrics['duration_seconds']}s "
        f"quality={metrics['quality_score']} "
        f"retries={metrics['retry_count']}"
    )

    # Check for failure patterns
    findings = check_failure_patterns(metrics["workflow_id"])

    if findings:
        for f in findings:
            escalate(f["message"], f["type"])

            # Mark the metric as escalated
            sb_update("antfarm_run_metrics", {"run_id": run_id}, {
                "escalated": True,
                "escalation_reason": f["type"],
            })
    else:
        log.info("No escalation-worthy patterns detected")


def backfill_metrics():
    """Compute metrics for all past runs that don't have metrics yet."""
    runs = sb_select("antfarm_runs", {
        "status": "in.(completed,failed)",
        "select": "id,workflow_id,status",
        "order": "created_at.asc",
    })

    existing = sb_select("antfarm_run_metrics", {"select": "run_id"})
    existing_ids = {m["run_id"] for m in existing}

    to_eval = [r for r in runs if r["id"] not in existing_ids]
    log.info(f"Backfilling {len(to_eval)} runs")

    for run in to_eval:
        try:
            evaluate_run(run["id"])
        except Exception as e:
            log.error(f"Failed to evaluate {run['id'][:8]}: {e}")


# --- Entry point ---

def main():
    args = sys.argv[1:]

    if not args:
        print(__doc__)
        sys.exit(1)

    if args[0] == "--check-patterns":
        findings = check_failure_patterns()
        if findings:
            for f in findings:
                print(f"[{f['type']}] {f['message']}")
                escalate(f["message"], f["type"])
        else:
            print("No escalation-worthy patterns found")

    elif args[0] == "--backfill":
        backfill_metrics()

    else:
        # Assume it's a run ID
        run_id = args[0]
        evaluate_run(run_id)


if __name__ == "__main__":
    main()
