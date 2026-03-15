#!/usr/bin/env python3
"""
elevenlabs-tts.py — Text-to-speech via ElevenLabs API

Usage:
    python3 ~/scripts/elevenlabs-tts.py "Text to speak"
    python3 ~/scripts/elevenlabs-tts.py "Text to speak" --voice george
    python3 ~/scripts/elevenlabs-tts.py "Text to speak" --voice george --telegram
    python3 ~/scripts/elevenlabs-tts.py --list-voices
    python3 ~/scripts/elevenlabs-tts.py --test-voices "Sample text"

Requires ELEVENLABS_API_KEY in ~/.pif-env
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

API_BASE = "https://api.elevenlabs.io/v1"
DEFAULT_MODEL = "eleven_flash_v2_5"
DEFAULT_FORMAT = "mp3_22050_32"

# Pre-made voice shortcuts (name → voice_id)
# These are well-known default voices; actual IDs confirmed via API
VOICE_SHORTCUTS = {
    "adam": "pNInz6obpgDQGcFmaJgB",
    "antoni": "ErXwobaYiN019PkySvjV",
    "arnold": "VR6AewLTigWG4xSOukaG",
    "bella": "EXAVITQu4vr4xnSDxMaL",
    "charlie": "IKne3meq5aSn9XLyUdCD",
    "daniel": "onwK4e9ZLuTAKqWW03F9",
    "george": "JBFqnCBsd6RMkjVDRZzb",
}


def get_api_key():
    key = os.environ.get("ELEVENLABS_API_KEY")
    if not key:
        # Fall back to pif-creds (logins table)
        try:
            import subprocess as _sp
            _result = _sp.run(["pif-creds", "get", "ElevenLabs"], capture_output=True, text=True, check=True)
            key = _result.stdout.strip()
        except Exception:
            pass
    if not key:
        print("Error: ELEVENLABS_API_KEY not set. Store in logins table or set env var.", file=sys.stderr)
        sys.exit(1)
    return key


def list_voices(api_key):
    """List available voices via API."""
    import urllib.request

    req = urllib.request.Request(
        f"{API_BASE}/voices?show_legacy=false",
        headers={"xi-api-key": api_key},
    )
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read())

    print(f"{'Name':<20} {'ID':<28} {'Category':<12} {'Labels'}")
    print("-" * 80)
    for voice in data.get("voices", []):
        labels = voice.get("labels", {})
        label_str = ", ".join(f"{k}={v}" for k, v in labels.items()) if labels else ""
        print(f"{voice['name']:<20} {voice['voice_id']:<28} {voice.get('category', 'N/A'):<12} {label_str}")


def text_to_speech(text, voice_id, api_key, model=DEFAULT_MODEL, output_format=DEFAULT_FORMAT):
    """Convert text to speech, return audio bytes."""
    import urllib.request

    body = json.dumps({
        "text": text,
        "model_id": model,
        "voice_settings": {
            "stability": 0.5,
            "similarity_boost": 0.75,
            "style": 0.3,
            "speed": 1.0,
        },
    }).encode()

    req = urllib.request.Request(
        f"{API_BASE}/text-to-speech/{voice_id}?output_format={output_format}",
        data=body,
        headers={
            "xi-api-key": api_key,
            "Content-Type": "application/json",
        },
    )

    with urllib.request.urlopen(req) as resp:
        return resp.read()


def send_telegram_voice(audio_path):
    """Send audio file as Telegram voice message."""
    token = os.environ.get("PIF_TELEGRAM_TOKEN")
    chat_id = os.environ.get("PIF_TELEGRAM_USER_ID")
    if not token or not chat_id:
        try:
            import json as _json
            _result = subprocess.run(["pif-creds", "get", "Telegram Bot", "--json"], capture_output=True, text=True, check=True)
            _rec = _json.loads(_result.stdout)
            token = token or _rec.get("password", "")
            import re
            chat_id = chat_id or re.search(r'\d{5,}', _rec.get("notes", "")).group()
        except Exception:
            print("Error: Cannot get Telegram credentials from env or pif-creds", file=sys.stderr)
            sys.exit(1)

    result = subprocess.run(
        [
            "curl", "-s", "-X", "POST",
            f"https://api.telegram.org/bot{token}/sendVoice",
            "-F", f"chat_id={chat_id}",
            "-F", f"voice=@{audio_path}",
        ],
        capture_output=True, text=True,
    )

    resp = json.loads(result.stdout)
    if resp.get("ok"):
        print("Voice message sent to Telegram")
    else:
        print(f"Telegram send failed: {resp}", file=sys.stderr)
        sys.exit(1)


def resolve_voice(voice_arg):
    """Resolve voice name/shortcut to voice_id."""
    lower = voice_arg.lower()
    if lower in VOICE_SHORTCUTS:
        return VOICE_SHORTCUTS[lower]
    # Assume it's a direct voice_id
    return voice_arg


def test_voices(text, api_key):
    """Generate samples for all shortcut voices and save to /tmp."""
    output_dir = Path(tempfile.gettempdir()) / "pif-voice-samples"
    output_dir.mkdir(exist_ok=True)

    print(f"Generating voice samples in {output_dir}/")
    print(f"Text: \"{text}\"")
    print()

    for name, vid in VOICE_SHORTCUTS.items():
        outfile = output_dir / f"{name}.mp3"
        try:
            audio = text_to_speech(text, vid, api_key)
            outfile.write_bytes(audio)
            size_kb = len(audio) / 1024
            print(f"  {name:<15} → {outfile} ({size_kb:.1f} KB)")
        except Exception as e:
            print(f"  {name:<15} → FAILED: {e}")

    print(f"\nDone. Listen to samples in {output_dir}/")


def main():
    parser = argparse.ArgumentParser(description="ElevenLabs TTS for Pif")
    parser.add_argument("text", nargs="?", help="Text to convert to speech")
    parser.add_argument("--voice", default="daniel", help="Voice name or ID (default: daniel)")
    parser.add_argument("--model", default=DEFAULT_MODEL, help=f"Model ID (default: {DEFAULT_MODEL})")
    parser.add_argument("--output", "-o", help="Output file path (default: /tmp/pif-voice.mp3)")
    parser.add_argument("--telegram", action="store_true", help="Send as Telegram voice message")
    parser.add_argument("--list-voices", action="store_true", help="List available voices")
    parser.add_argument("--test-voices", metavar="TEXT", help="Generate samples for all preset voices")
    args = parser.parse_args()

    api_key = get_api_key()

    if args.list_voices:
        list_voices(api_key)
        return

    if args.test_voices:
        test_voices(args.test_voices, api_key)
        return

    if not args.text:
        parser.error("Text argument required (or use --list-voices / --test-voices)")

    voice_id = resolve_voice(args.voice)
    output_path = args.output or "/tmp/pif-voice.mp3"

    print(f"Voice: {args.voice} ({voice_id})")
    print(f"Model: {args.model}")
    print(f"Text: \"{args.text[:80]}{'...' if len(args.text) > 80 else ''}\"")

    audio = text_to_speech(args.text, voice_id, api_key, args.model)
    Path(output_path).write_bytes(audio)
    size_kb = len(audio) / 1024
    print(f"Saved: {output_path} ({size_kb:.1f} KB)")

    if args.telegram:
        send_telegram_voice(output_path)


if __name__ == "__main__":
    main()
