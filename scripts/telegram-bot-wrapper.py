#!/usr/bin/env python3
"""Wrapper for claude-telegram-bot that adds token usage recording.

Captures token usage from Claude SDK's ResultMessage and records it to
Supabase. Best-effort -- never blocks the bot.
"""

import asyncio
import logging
import os
from typing import Any

import httpx

logger = logging.getLogger("token_usage_patch")

SUPABASE_URL = os.environ.get("PIF_SUPABASE_URL", "")
ADMIN_TENANT_ID = os.environ.get("PIF_TENANT_ID", "")

# Service role key lives in MC env, not in bot's .env
SUPABASE_KEY = ""
try:
    with open("/etc/mission-control-api.env") as f:
        for line in f:
            if line.startswith("SUPABASE_SERVICE_KEY="):
                SUPABASE_KEY = line.strip().split("=", 1)[1]
                break
except OSError:
    pass

# Module-level capture of the most recent ResultMessage's usage
_last_usage: dict[str, Any] = {}


async def _record_usage(session_id: str, duration_ms: int) -> None:
    """POST a token_usage row to Supabase. Best-effort."""
    global _last_usage
    try:
        usage = _last_usage.copy()
        _last_usage.clear()

        input_tokens = usage.get("input_tokens", 0)
        output_tokens = usage.get("output_tokens", 0)
        cache_read = usage.get("cache_read_input_tokens", 0)
        cache_write = usage.get("cache_creation_input_tokens", 0)

        if not output_tokens and not input_tokens:
            return

        row = {
            "source": "telegram-bot",
            "tenant_id": ADMIN_TENANT_ID,
            "session_id": session_id,
            "model": "",
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cache_read_tokens": cache_read,
            "cache_write_tokens": cache_write,
            "cost_usd": 0,
            "duration_seconds": duration_ms / 1000 if duration_ms else 0,
        }

        async with httpx.AsyncClient() as client:
            await client.post(
                f"{SUPABASE_URL}/rest/v1/token_usage",
                headers={
                    "apikey": SUPABASE_KEY,
                    "Authorization": f"Bearer {SUPABASE_KEY}",
                    "Content-Type": "application/json",
                    "Prefer": "return=minimal",
                },
                json=row,
                timeout=10.0,
            )
    except Exception as exc:
        logger.debug("Token usage recording failed (non-fatal): %s", exc)


def patch():
    """Capture ResultMessage.usage via __init__ wrapper and record after each response."""
    if not SUPABASE_URL or not SUPABASE_KEY or not ADMIN_TENANT_ID:
        logger.warning("Token usage patch: missing env vars, skipping")
        return

    from claude_agent_sdk import ResultMessage
    from src.claude.facade import ClaudeIntegration

    # Patch ResultMessage.__init__ to capture usage when instantiated
    original_init = ResultMessage.__init__

    def capturing_init(self, *args, **kwargs):
        global _last_usage
        original_init(self, *args, **kwargs)
        if self.usage:
            _last_usage = dict(self.usage)

    ResultMessage.__init__ = capturing_init

    # Patch run_command to record after each response
    original_run_command = ClaudeIntegration.run_command

    async def patched_run_command(self, *args, **kwargs):
        response = await original_run_command(self, *args, **kwargs)
        if response and not response.is_error:
            asyncio.create_task(
                _record_usage(response.session_id, response.duration_ms)
            )
        return response

    ClaudeIntegration.run_command = patched_run_command
    logger.info("Token usage recording patch applied")


# Apply patch, then run the original bot
patch()

from src.main import run
run()
