#!/usr/bin/env python3
"""
session-index.py — Build a searchable index of Claude Code sessions.

Reads JSONL session files, extracts user prompts and files mentioned,
produces a grep-friendly text index at ~/.claude/session-index.txt.

Usage:
    python3 ~/scripts/session-index.py [--rebuild]

Run weekly via Supabase schedule.
"""

import json
import os
import sys
from datetime import datetime
from pathlib import Path

JSONL_DIR = Path.home() / ".claude" / "projects" / "-root"
INDEX_FILE = Path.home() / ".claude" / "session-index.txt"
STATE_FILE = Path.home() / ".claude" / ".index-state.json"


def load_state():
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())
    return {"indexed_sessions": {}}


def save_state(state):
    STATE_FILE.write_text(json.dumps(state, indent=2))


def extract_session_info(jsonl_path):
    """Extract key info from a session JSONL file."""
    user_prompts = []
    files_mentioned = set()
    timestamp = None

    with open(jsonl_path) as f:
        for line in f:
            try:
                obj = json.loads(line)
                msg = obj.get("message", {})
                role = msg.get("role", obj.get("type", ""))
                content = msg.get("content", "")

                if not timestamp and obj.get("timestamp"):
                    ts = obj["timestamp"]
                    if isinstance(ts, str):
                        timestamp = ts[:10]
                    elif isinstance(ts, (int, float)):
                        if ts > 1e12:
                            ts = ts / 1000
                        timestamp = datetime.fromtimestamp(ts).strftime("%Y-%m-%d")

                if isinstance(content, list):
                    content = " ".join(
                        c.get("text", "") if isinstance(c, dict) else str(c)
                        for c in content
                    )

                if role == "user" and isinstance(content, str) and 3 < len(content) < 500:
                    user_prompts.append(content.strip().replace("\n", " ")[:150])

                if isinstance(content, str):
                    for word in content.split():
                        if "/" in word and (
                            "." in word.split("/")[-1] or word.startswith("~/")
                        ):
                            clean = word.strip(".,;:()\"'`{}[]")
                            if 3 < len(clean) < 100:
                                files_mentioned.add(clean)
            except (json.JSONDecodeError, KeyError):
                continue

    return {
        "date": timestamp or "unknown",
        "user_prompts": user_prompts[:10],
        "files_mentioned": sorted(files_mentioned)[:20],
    }


def build_index(rebuild=False):
    state = load_state() if not rebuild else {"indexed_sessions": {}}
    entries = []

    jsonl_files = sorted(JSONL_DIR.glob("*.jsonl"))
    for jsonl_file in jsonl_files:
        if jsonl_file.name == "history.jsonl":
            continue

        sid = jsonl_file.stem
        mtime = jsonl_file.stat().st_mtime

        # Skip if already indexed and not modified
        if not rebuild and sid in state["indexed_sessions"]:
            if state["indexed_sessions"][sid].get("mtime") == mtime:
                entries.append(state["indexed_sessions"][sid]["entry"])
                continue

        info = extract_session_info(jsonl_file)

        prompts_str = " | ".join(f'"{p}"' for p in info["user_prompts"][:5])
        files_str = ", ".join(info["files_mentioned"][:10]) or "none"

        entry = f'=== Session {sid[:8]} ({info["date"]}) ===\n'
        entry += f"USER_PROMPTS: {prompts_str}\n"
        entry += f"FILES: {files_str}\n"
        entry += "---"

        entries.append(entry)
        state["indexed_sessions"][sid] = {"mtime": mtime, "entry": entry}

    INDEX_FILE.write_text("\n".join(entries) + "\n")
    save_state(state)
    print(f"Indexed {len(entries)} sessions -> {INDEX_FILE}")


if __name__ == "__main__":
    rebuild = "--rebuild" in sys.argv
    build_index(rebuild=rebuild)
