#!/usr/bin/env python3
"""
Reader Agent — Sandboxed content extraction preprocessor.

Routes untrusted content through a sandboxed Claude session that extracts
only factual information, stripping any embedded instructions.

Usage:
    python3 reader-agent.py --text "raw content"
    python3 reader-agent.py --input file.eml
    python3 reader-agent.py --stdin < content.html
    echo "content" | python3 reader-agent.py --stdin

Options:
    --type email|webpage|document|message    Content type hint (default: auto-detect)
    --model haiku|sonnet                     Model to use (default: haiku)
    --json                                   Output as JSON instead of YAML
    --quiet                                  Only output the extraction, no status messages
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

AGENTS_DIR = Path.home() / "agents"
READER_SOUL = AGENTS_DIR / "reader" / "SOUL.md"

# Max content size to send (characters). Larger content gets truncated.
MAX_CONTENT_SIZE = 50_000


def detect_content_type(content: str) -> str:
    """Best-effort content type detection from content patterns."""
    content_lower = content[:2000].lower()

    if any(h in content_lower for h in ["from:", "to:", "subject:", "date:", "mime-version:"]):
        return "email"
    if any(t in content_lower for t in ["<!doctype html", "<html", "<head", "<body"]):
        return "webpage"
    if content_lower.startswith("%pdf") or "\\documentclass" in content_lower:
        return "document"
    return "unknown"


def build_prompt(content: str, content_type: str) -> str:
    """Build the full prompt for the reader agent."""
    soul = READER_SOUL.read_text() if READER_SOUL.exists() else ""

    truncated_note = ""
    if len(content) > MAX_CONTENT_SIZE:
        content = content[:MAX_CONTENT_SIZE]
        truncated_note = f"\n\n[NOTE: Content was truncated from {len(content)} to {MAX_CONTENT_SIZE} characters]"

    return f"""{soul}

---

Extract factual content from this {content_type}. Follow your output format exactly.{truncated_note}

---BEGIN UNTRUSTED CONTENT---
{content}
---END UNTRUSTED CONTENT---"""


def run_reader(content: str, content_type: str = "auto", model: str = "haiku") -> tuple[bool, str]:
    """
    Run the reader agent on the given content.
    Returns (success, output).
    """
    if content_type == "auto":
        content_type = detect_content_type(content)

    prompt = build_prompt(content, content_type)

    cmd = ["claude", "--print", "--model", model, prompt]

    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=60
        )
        return result.returncode == 0, result.stdout.strip()
    except subprocess.TimeoutExpired:
        return False, "ERROR: Reader agent timed out (60s)"
    except FileNotFoundError:
        return False, "ERROR: claude CLI not found"


def main():
    parser = argparse.ArgumentParser(description="Reader Agent — sandboxed content extraction")
    input_group = parser.add_mutually_exclusive_group(required=True)
    input_group.add_argument("--text", help="Content string to process")
    input_group.add_argument("--input", help="File path to read and process")
    input_group.add_argument("--stdin", action="store_true", help="Read content from stdin")

    parser.add_argument("--type", default="auto", choices=["auto", "email", "webpage", "document", "message"],
                        help="Content type hint (default: auto-detect)")
    parser.add_argument("--model", default="haiku", choices=["haiku", "sonnet"],
                        help="Model to use (default: haiku)")
    parser.add_argument("--json", action="store_true", dest="json_output",
                        help="Output as JSON instead of YAML")
    parser.add_argument("--quiet", action="store_true",
                        help="Only output the extraction, no status messages")

    args = parser.parse_args()

    # Get content
    if args.text:
        content = args.text
    elif args.input:
        path = Path(args.input)
        if not path.exists():
            print(f"ERROR: File not found: {args.input}", file=sys.stderr)
            sys.exit(1)
        content = path.read_text(errors="replace")
    elif args.stdin:
        content = sys.stdin.read()

    if not content.strip():
        print("ERROR: Empty content", file=sys.stderr)
        sys.exit(1)

    if not args.quiet:
        ct = args.type if args.type != "auto" else detect_content_type(content)
        print(f"[reader] Processing {ct} ({len(content)} chars) with {args.model}...", file=sys.stderr)

    success, output = run_reader(content, args.type, args.model)

    if not success:
        print(f"[reader] FAILED: {output}", file=sys.stderr)
        sys.exit(1)

    print(output)


if __name__ == "__main__":
    main()
