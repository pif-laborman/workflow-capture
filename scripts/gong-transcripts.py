#!/usr/bin/env python3
"""Gong transcript puller — fetches call transcripts and saves as searchable markdown.

Usage:
    python3 ~/scripts/gong-transcripts.py                  # Last 24 hours
    python3 ~/scripts/gong-transcripts.py --days 7          # Last 7 days
    python3 ~/scripts/gong-transcripts.py --call-id ABC123  # Specific call
    python3 ~/scripts/gong-transcripts.py --list            # List recent calls (no transcripts)

Credentials: auto-fetched from pif-creds ("Gong"), or set GONG_ACCESS_KEY/GONG_SECRET_KEY env vars.
"""

import argparse
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:
    import requests
except ImportError:
    print("Error: requests not installed. Run: pip install requests")
    sys.exit(1)

BASE_URL = "https://us-11211.api.gong.io/v2"
TRANSCRIPT_DIR = Path.home() / "memory" / "research" / "gong-transcripts"


def get_credentials():
    access_key = os.environ.get("GONG_ACCESS_KEY")
    secret_key = os.environ.get("GONG_SECRET_KEY")
    if access_key and secret_key:
        return access_key, secret_key
    # Fall back to pif-creds
    import subprocess
    try:
        result = subprocess.run(
            ["pif-creds", "get", "Gong", "--json"],
            capture_output=True, text=True, check=True,
        )
        import json as _json
        rec = _json.loads(result.stdout)
        access_key = rec.get("username", "")
        # Secret key is in notes field
        notes = rec.get("notes", "")
        for line in notes.splitlines():
            if line.startswith("Secret Key:"):
                secret_key = line.split(":", 1)[1].strip()
                break
        if access_key and secret_key:
            return access_key, secret_key
    except (subprocess.CalledProcessError, Exception):
        pass
    print("Error: Set GONG_ACCESS_KEY/GONG_SECRET_KEY, or ensure pif-creds is configured")
    sys.exit(1)


def gong_get(endpoint, params=None):
    access_key, secret_key = get_credentials()
    url = f"{BASE_URL}{endpoint}"
    resp = requests.get(url, auth=(access_key, secret_key), params=params, timeout=30)
    if resp.status_code == 429:
        retry_after = resp.headers.get("Retry-After", "60")
        print(f"Rate limited. Retry after {retry_after}s")
        sys.exit(1)
    resp.raise_for_status()
    return resp.json()


def gong_post(endpoint, payload):
    access_key, secret_key = get_credentials()
    url = f"{BASE_URL}{endpoint}"
    resp = requests.post(
        url,
        auth=(access_key, secret_key),
        headers={"Content-Type": "application/json"},
        json=payload,
        timeout=30,
    )
    if resp.status_code == 429:
        retry_after = resp.headers.get("Retry-After", "60")
        print(f"Rate limited. Retry after {retry_after}s")
        sys.exit(1)
    resp.raise_for_status()
    return resp.json()


def list_calls(from_dt, to_dt):
    """List calls in a date range. Returns list of call objects."""
    all_calls = []
    cursor = None
    while True:
        params = {"fromDateTime": from_dt, "toDateTime": to_dt}
        if cursor:
            params["cursor"] = cursor
        data = gong_get("/calls", params)
        calls = data.get("calls", [])
        all_calls.extend(calls)
        cursor = data.get("records", {}).get("cursor")
        if not cursor:
            break
    return all_calls


def get_transcripts(call_ids):
    """Fetch transcripts for a list of call IDs. Batches in groups of 20."""
    all_transcripts = []
    for i in range(0, len(call_ids), 20):
        batch = call_ids[i : i + 20]
        data = gong_post("/calls/transcript", {"filter": {"callIds": batch}})
        all_transcripts.extend(data.get("callTranscripts", []))
    return all_transcripts


def transcript_to_markdown(call, transcript_data):
    """Convert a call + transcript into a markdown document."""
    call_id = call.get("id", "unknown")
    title = call.get("title", "Untitled Call")
    started = call.get("started", "")
    duration = call.get("duration", 0)
    participants = call.get("parties", [])

    # Build participant lookup
    speaker_names = {}
    participant_lines = []
    for p in participants:
        name = p.get("name", p.get("emailAddress", "Unknown"))
        speaker_id = p.get("speakerId")
        affiliation = p.get("affiliation", "")
        if speaker_id:
            speaker_names[speaker_id] = name
        label = f"- {name}"
        if affiliation:
            label += f" ({affiliation})"
        participant_lines.append(label)

    # Format date — always include call ID for dedup
    date_str = started[:10] if started else "unknown-date"
    filename = f"{date_str}_Call-{call_id}.md"

    lines = [
        f"# {title}",
        f"",
        f"- **Date:** {started}",
        f"- **Duration:** {duration}s ({duration // 60}m {duration % 60}s)",
        f"- **Call ID:** {call_id}",
        f"",
        f"## Participants",
        "",
    ]
    lines.extend(participant_lines)
    lines.append("")
    lines.append("## Transcript")
    lines.append("")

    # Find transcript for this call
    call_transcript = None
    for t in transcript_data:
        if t.get("callId") == call_id:
            call_transcript = t
            break

    if call_transcript:
        for segment in call_transcript.get("transcript", []):
            speaker_id = segment.get("speakerId", "")
            speaker_name = speaker_names.get(speaker_id, f"Speaker {speaker_id}")
            topic = segment.get("topic")
            if topic:
                lines.append(f"### {topic}")
                lines.append("")
            sentences = segment.get("sentences", [])
            text = " ".join(s.get("text", "") for s in sentences)
            if text.strip():
                lines.append(f"**{speaker_name}:** {text.strip()}")
                lines.append("")
    else:
        lines.append("_(No transcript available)_")
        lines.append("")

    return filename, "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Pull Gong call transcripts")
    parser.add_argument("--days", type=int, default=1, help="Look back N days (default: 1)")
    parser.add_argument("--call-id", type=str, help="Fetch transcript for a specific call ID")
    parser.add_argument("--list", action="store_true", help="List recent calls without fetching transcripts")
    parser.add_argument("--sync", action="store_true", help="Skip calls already downloaded (match by call ID in filename)")
    parser.add_argument("--output-dir", type=str, default=str(TRANSCRIPT_DIR), help="Output directory")
    args = parser.parse_args()

    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    now = datetime.now(timezone.utc)

    if args.call_id:
        # Fetch single call transcript
        print(f"Fetching transcript for call {args.call_id}...")
        transcripts = get_transcripts([args.call_id])
        if not transcripts:
            print("No transcript found for this call.")
            sys.exit(0)
        # We don't have call metadata for single fetch — create minimal
        call = {"id": args.call_id, "title": f"Call {args.call_id}", "started": now.isoformat(), "duration": 0, "parties": []}
        filename, content = transcript_to_markdown(call, transcripts)
        filepath = out_dir / filename
        filepath.write_text(content)
        print(f"Saved: {filepath}")
        return

    from_dt = (now - timedelta(days=args.days)).isoformat()
    to_dt = now.isoformat()

    print(f"Fetching calls from last {args.days} day(s)...")
    calls = list_calls(from_dt, to_dt)

    if not calls:
        print("No calls found in this period.")
        return

    print(f"Found {len(calls)} call(s).")

    if args.list:
        for c in calls:
            title = c.get("title", "Untitled")
            started = c.get("started", "?")[:16]
            duration = c.get("duration", 0)
            cid = c.get("id", "?")
            print(f"  [{started}] {title} ({duration // 60}m) — {cid}")
        return

    # Skip calls already on disk (match Call-{id} in filename)
    if args.sync:
        existing_ids = set()
        for f in out_dir.glob("*_Call-*.md"):
            # Extract call ID from filename like 2026-03-11_Call-1234567890.md
            match = re.search(r"Call-(\d+)\.md$", f.name)
            if match:
                existing_ids.add(match.group(1))
        before = len(calls)
        calls = [c for c in calls if str(c["id"]) not in existing_ids]
        skipped = before - len(calls)
        if skipped:
            print(f"Skipped {skipped} already-downloaded call(s).")

    if not calls:
        print("Nothing new to fetch.")
        return

    # Fetch transcripts
    call_ids = [c["id"] for c in calls]
    print(f"Fetching transcripts for {len(call_ids)} call(s)...")
    transcripts = get_transcripts(call_ids)

    saved = 0
    for call in calls:
        filename, content = transcript_to_markdown(call, transcripts)
        filepath = out_dir / filename
        filepath.write_text(content)
        saved += 1

    print(f"Saved {saved} transcript(s) to {out_dir}")
    print("Run 'qmd update' to index for search.")


if __name__ == "__main__":
    main()
