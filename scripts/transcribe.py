#!/usr/bin/env /root/whisper-env/bin/python3
"""
Whisper transcription script for Pif.
Uses faster-whisper with the 'small' model for local speech-to-text.

Usage:
  ./transcribe.py <audio_file>              # plain text output
  ./transcribe.py <audio_file> --json       # JSON output with segments
  ./transcribe.py <audio_file> --language sk # force language (auto-detect by default)

Supports: wav, mp3, ogg, opus, m4a, webm, flac, and anything ffmpeg can decode.
Telegram voice messages (.oga/.ogg opus) are handled automatically.
"""

import sys
import os
import json
import subprocess
import tempfile
import argparse
from pathlib import Path


def convert_to_wav(input_path: str) -> str:
    """Convert any audio format to 16kHz mono WAV using ffmpeg."""
    suffix = Path(input_path).suffix.lower()
    if suffix == ".wav":
        return input_path

    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.close()

    result = subprocess.run(
        ["ffmpeg", "-i", input_path, "-ar", "16000", "-ac", "1", "-y", tmp.name],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        os.unlink(tmp.name)
        raise RuntimeError(f"ffmpeg conversion failed: {result.stderr}")

    return tmp.name


def transcribe(audio_path: str, language: str = None, beam_size: int = 5) -> dict:
    """Transcribe an audio file. Returns dict with text, language, duration, segments."""
    from faster_whisper import WhisperModel

    model = WhisperModel("small", device="cpu", compute_type="int8")

    # Convert if needed
    wav_path = convert_to_wav(audio_path)
    cleanup = wav_path != audio_path

    try:
        kwargs = {"beam_size": beam_size}
        if language:
            kwargs["language"] = language

        segments_gen, info = model.transcribe(wav_path, **kwargs)

        segments = []
        full_text_parts = []
        for seg in segments_gen:
            text = seg.text.strip()
            segments.append({
                "start": round(seg.start, 2),
                "end": round(seg.end, 2),
                "text": text,
            })
            full_text_parts.append(text)

        return {
            "text": " ".join(full_text_parts),
            "language": info.language,
            "language_probability": round(info.language_probability, 3),
            "duration": round(info.duration, 2),
            "segments": segments,
        }
    finally:
        if cleanup and os.path.exists(wav_path):
            os.unlink(wav_path)


def main():
    parser = argparse.ArgumentParser(description="Transcribe audio using Whisper (faster-whisper)")
    parser.add_argument("audio_file", help="Path to audio file")
    parser.add_argument("--json", action="store_true", help="Output JSON")
    parser.add_argument("--language", "-l", default=None, help="Force language code (e.g. en, sk, de)")
    parser.add_argument("--beam-size", type=int, default=5, help="Beam size (default: 5)")
    args = parser.parse_args()

    if not os.path.exists(args.audio_file):
        print(f"Error: file not found: {args.audio_file}", file=sys.stderr)
        sys.exit(1)

    result = transcribe(args.audio_file, language=args.language, beam_size=args.beam_size)

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(result["text"])


if __name__ == "__main__":
    main()
