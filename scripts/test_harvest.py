#!/usr/bin/env python3
"""Tests for harvest() function in antfarm-dispatch.py."""

import importlib.util
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import MagicMock, call, patch

# Load antfarm-dispatch.py as a module (filename has hyphens)
_spec = importlib.util.spec_from_file_location(
    "antfarm_dispatch",
    Path(__file__).parent / "antfarm-dispatch.py",
)
_mod = importlib.util.module_from_spec(_spec)

# Patch out requests and yaml imports that need env vars / network
sys.modules.setdefault("yaml", MagicMock())

# Suppress logging and network calls during import
with patch.dict(os.environ, {
    "PIF_SUPABASE_URL": "https://fake.supabase.co",
    "PIF_SUPABASE_SERVICE_ROLE_KEY": "fake-key",
}):
    _spec.loader.exec_module(_mod)

harvest = _mod.harvest
PROCESS_REGISTRY = _mod.PROCESS_REGISTRY
AGENT_TIMEOUT_SECONDS = _mod.AGENT_TIMEOUT_SECONDS


def _make_stdout_file(content: str) -> str:
    """Write content to a temp file and return its path."""
    f = tempfile.NamedTemporaryFile(mode="w", suffix=".log", delete=False, prefix="test-harvest-")
    f.write(content)
    f.close()
    return f.name


def _make_prompt_file() -> str:
    """Create a temp prompt file and return its path."""
    f = tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False, prefix="test-prompt-")
    f.write("test prompt")
    f.close()
    return f.name


def _make_registry_entry(step_id: str, returncode=None, elapsed=0,
                         stdout_content="", run_id="run-aaa", agent_id="wf_agent",
                         workflow_id="test-wf", agent_name="agent"):
    """Build a PROCESS_REGISTRY entry with a mocked Popen."""
    proc = MagicMock()
    proc.poll.return_value = returncode
    proc.kill = MagicMock()
    proc.wait = MagicMock()

    stdout_path = _make_stdout_file(stdout_content)
    prompt_file = _make_prompt_file()

    entry = {
        "popen": proc,
        "run_id": run_id,
        "agent_id": agent_id,
        "start_time": time.time() - elapsed,
        "stdout_path": stdout_path,
        "prompt_file": prompt_file,
        "workflow_id": workflow_id,
        "agent_name": agent_name,
        "role": "coding",
        "run": {"id": run_id, "task": "test task", "workflow_id": workflow_id, "context": {}},
        "context": {},
    }
    return entry


class TestHarvestEmpty(unittest.TestCase):
    """harvest() with empty registry."""

    def setUp(self):
        PROCESS_REGISTRY.clear()

    def test_empty_registry_returns_zero(self):
        self.assertEqual(harvest(), 0)

    def test_empty_registry_no_side_effects(self):
        harvest()
        self.assertEqual(len(PROCESS_REGISTRY), 0)


class TestHarvestStillRunning(unittest.TestCase):
    """harvest() with processes that are still running (not timed out)."""

    def setUp(self):
        PROCESS_REGISTRY.clear()

    def tearDown(self):
        # Clean up any remaining temp files
        for entry in PROCESS_REGISTRY.values():
            for p in [entry.get("stdout_path"), entry.get("prompt_file")]:
                if p:
                    try:
                        os.unlink(p)
                    except OSError:
                        pass
        PROCESS_REGISTRY.clear()

    def test_still_running_not_harvested(self):
        entry = _make_registry_entry("step-1", returncode=None, elapsed=60)
        PROCESS_REGISTRY["step-1"] = entry
        count = harvest()
        self.assertEqual(count, 0)
        self.assertIn("step-1", PROCESS_REGISTRY)


class TestHarvestSuccess(unittest.TestCase):
    """harvest() for successfully completed processes."""

    def setUp(self):
        PROCESS_REGISTRY.clear()

    def tearDown(self):
        PROCESS_REGISTRY.clear()

    @patch.object(_mod, "run_evaluator")
    @patch.object(_mod, "cleanup_worktree")
    @patch.object(_mod, "check_milestone")
    @patch.object(_mod, "antfarm_complete")
    @patch.object(_mod, "handle_retry_step", return_value=False)
    @patch.object(_mod, "get_step_config", return_value={"expects": "", "on_fail": {}, "max_retries": 2})
    @patch.object(_mod, "sb_select")
    @patch.object(_mod, "record_token_usage")
    @patch.object(_mod, "parse_claude_json")
    def test_success_path_calls_completion_logic(
        self, mock_parse, mock_record, mock_sb_select,
        mock_get_cfg, mock_retry, mock_complete, mock_milestone,
        mock_cleanup, mock_evaluator
    ):
        mock_parse.return_value = {
            "text": "agent output",
            "usage": {"output_tokens": 100, "model": "opus"},
        }
        # First call: step lookup; second call: loop_steps lookup
        mock_sb_select.side_effect = [
            [{"step_id": "implement", "type": "single"}],  # step lookup
            [],  # loop_steps lookup (no loop steps)
        ]
        mock_complete.return_value = {"runCompleted": False}

        stdout_json = json.dumps({"result": "agent output", "usage": {}})
        entry = _make_registry_entry("step-1", returncode=0, elapsed=120,
                                     stdout_content=stdout_json)
        PROCESS_REGISTRY["step-1"] = entry

        count = harvest()

        self.assertEqual(count, 1)
        self.assertNotIn("step-1", PROCESS_REGISTRY)

        # Verify the completion chain was called
        mock_parse.assert_called_once()
        mock_record.assert_called_once()
        mock_retry.assert_called_once()
        mock_complete.assert_called_once_with("step-1", "agent output")
        mock_milestone.assert_called_once()

    @patch.object(_mod, "run_evaluator")
    @patch.object(_mod, "cleanup_worktree")
    @patch.object(_mod, "notify")
    @patch.object(_mod, "check_milestone")
    @patch.object(_mod, "antfarm_complete")
    @patch.object(_mod, "handle_retry_step", return_value=False)
    @patch.object(_mod, "get_step_config", return_value={"expects": "", "on_fail": {}, "max_retries": 2})
    @patch.object(_mod, "sb_select")
    @patch.object(_mod, "record_token_usage")
    @patch.object(_mod, "parse_claude_json")
    def test_run_completed_triggers_notify_and_cleanup(
        self, mock_parse, mock_record, mock_sb_select,
        mock_get_cfg, mock_retry, mock_complete, mock_milestone,
        mock_notify, mock_cleanup, mock_evaluator
    ):
        mock_parse.return_value = {"text": "done", "usage": {"output_tokens": 50}}
        mock_sb_select.side_effect = [
            [{"step_id": "final", "type": "single"}],
            [],
        ]
        mock_complete.return_value = {"runCompleted": True}

        entry = _make_registry_entry("step-2", returncode=0, elapsed=300,
                                     stdout_content="done", workflow_id="my-wf")
        PROCESS_REGISTRY["step-2"] = entry

        harvest()

        mock_notify.assert_called_once()
        self.assertIn("completed", mock_notify.call_args[0][0])
        mock_cleanup.assert_called_once()
        mock_evaluator.assert_called_once()

    @patch.object(_mod, "run_evaluator")
    @patch.object(_mod, "cleanup_worktree")
    @patch.object(_mod, "notify")
    @patch.object(_mod, "deliver_content_factory")
    @patch.object(_mod, "check_milestone")
    @patch.object(_mod, "antfarm_complete")
    @patch.object(_mod, "handle_retry_step", return_value=False)
    @patch.object(_mod, "get_step_config", return_value={"expects": "", "on_fail": {}, "max_retries": 2})
    @patch.object(_mod, "sb_select")
    @patch.object(_mod, "record_token_usage")
    @patch.object(_mod, "parse_claude_json")
    def test_content_factory_delivery(
        self, mock_parse, mock_record, mock_sb_select,
        mock_get_cfg, mock_retry, mock_complete, mock_milestone,
        mock_deliver, mock_notify, mock_cleanup, mock_evaluator
    ):
        mock_parse.return_value = {"text": "draft", "usage": {"output_tokens": 50}}
        mock_sb_select.side_effect = [
            [{"step_id": "write", "type": "single"}],
            [],
        ]
        mock_complete.return_value = {"runCompleted": True}

        entry = _make_registry_entry("step-cf", returncode=0, elapsed=200,
                                     workflow_id="content-factory")
        PROCESS_REGISTRY["step-cf"] = entry

        harvest()

        mock_deliver.assert_called_once()
        # notify should NOT be called for content-factory (deliver_content_factory handles it)
        mock_notify.assert_not_called()


class TestHarvestFailure(unittest.TestCase):
    """harvest() for failed processes."""

    def setUp(self):
        PROCESS_REGISTRY.clear()

    def tearDown(self):
        PROCESS_REGISTRY.clear()

    @patch.object(_mod, "run_evaluator")
    @patch.object(_mod, "cleanup_worktree")
    @patch.object(_mod, "notify")
    @patch.object(_mod, "record_token_usage")
    @patch.object(_mod, "parse_claude_json")
    @patch.object(_mod, "antfarm_fail")
    def test_failure_path_calls_antfarm_fail(
        self, mock_fail, mock_parse, mock_record, mock_notify,
        mock_cleanup, mock_evaluator
    ):
        mock_parse.return_value = {"text": "error output", "usage": {}}
        mock_fail.return_value = {"runFailed": False, "retrying": True}

        entry = _make_registry_entry("step-f1", returncode=1, elapsed=60,
                                     stdout_content="some error")
        PROCESS_REGISTRY["step-f1"] = entry

        count = harvest()

        self.assertEqual(count, 1)
        self.assertNotIn("step-f1", PROCESS_REGISTRY)
        mock_fail.assert_called_once()
        # First arg is step_id
        self.assertEqual(mock_fail.call_args[0][0], "step-f1")

    @patch.object(_mod, "run_evaluator")
    @patch.object(_mod, "cleanup_worktree")
    @patch.object(_mod, "notify")
    @patch.object(_mod, "record_token_usage")
    @patch.object(_mod, "parse_claude_json")
    @patch.object(_mod, "antfarm_fail")
    def test_run_failed_triggers_notify_and_cleanup(
        self, mock_fail, mock_parse, mock_record, mock_notify,
        mock_cleanup, mock_evaluator
    ):
        mock_parse.return_value = {"text": "", "usage": {}}
        mock_fail.return_value = {"runFailed": True}

        entry = _make_registry_entry("step-f2", returncode=1, elapsed=60,
                                     stdout_content="crash")
        PROCESS_REGISTRY["step-f2"] = entry

        harvest()

        mock_notify.assert_called_once()
        mock_cleanup.assert_called_once()
        mock_evaluator.assert_called_once()


class TestHarvestTimeout(unittest.TestCase):
    """harvest() for processes that exceed AGENT_TIMEOUT_SECONDS."""

    def setUp(self):
        PROCESS_REGISTRY.clear()

    def tearDown(self):
        PROCESS_REGISTRY.clear()

    @patch.object(_mod, "run_evaluator")
    @patch.object(_mod, "cleanup_worktree")
    @patch.object(_mod, "notify")
    @patch.object(_mod, "antfarm_fail")
    def test_timeout_kills_process(self, mock_fail, mock_notify,
                                   mock_cleanup, mock_evaluator):
        mock_fail.return_value = {"runFailed": False}

        entry = _make_registry_entry("step-t1", returncode=None,
                                     elapsed=AGENT_TIMEOUT_SECONDS + 60)
        PROCESS_REGISTRY["step-t1"] = entry

        count = harvest()

        self.assertEqual(count, 1)
        self.assertNotIn("step-t1", PROCESS_REGISTRY)
        entry["popen"].kill.assert_called_once()
        mock_fail.assert_called_once()
        self.assertIn("timed out", mock_fail.call_args[0][1])

    @patch.object(_mod, "run_evaluator")
    @patch.object(_mod, "cleanup_worktree")
    @patch.object(_mod, "notify")
    @patch.object(_mod, "antfarm_fail")
    def test_timeout_with_run_failed(self, mock_fail, mock_notify,
                                     mock_cleanup, mock_evaluator):
        mock_fail.return_value = {"runFailed": True}

        entry = _make_registry_entry("step-t2", returncode=None,
                                     elapsed=AGENT_TIMEOUT_SECONDS + 10)
        PROCESS_REGISTRY["step-t2"] = entry

        harvest()

        mock_notify.assert_called_once()
        mock_cleanup.assert_called_once()
        mock_evaluator.assert_called_once()


class TestHarvestTempFileCleanup(unittest.TestCase):
    """harvest() cleans up temp files after processing."""

    def setUp(self):
        PROCESS_REGISTRY.clear()

    def tearDown(self):
        PROCESS_REGISTRY.clear()

    @patch.object(_mod, "run_evaluator")
    @patch.object(_mod, "cleanup_worktree")
    @patch.object(_mod, "notify")
    @patch.object(_mod, "record_token_usage")
    @patch.object(_mod, "parse_claude_json", return_value={"text": "", "usage": {}})
    @patch.object(_mod, "antfarm_fail", return_value={})
    def test_temp_files_deleted_on_failure(
        self, mock_fail, mock_parse, mock_record, mock_notify,
        mock_cleanup, mock_evaluator
    ):
        entry = _make_registry_entry("step-c1", returncode=1, elapsed=30)
        stdout_path = entry["stdout_path"]
        prompt_file = entry["prompt_file"]

        # Verify files exist before harvest
        self.assertTrue(os.path.exists(stdout_path))
        self.assertTrue(os.path.exists(prompt_file))

        PROCESS_REGISTRY["step-c1"] = entry
        harvest()

        # Verify files are cleaned up
        self.assertFalse(os.path.exists(stdout_path))
        self.assertFalse(os.path.exists(prompt_file))

    @patch.object(_mod, "run_evaluator")
    @patch.object(_mod, "cleanup_worktree")
    @patch.object(_mod, "check_milestone")
    @patch.object(_mod, "antfarm_complete", return_value={"runCompleted": False})
    @patch.object(_mod, "handle_retry_step", return_value=False)
    @patch.object(_mod, "get_step_config", return_value={"expects": "", "on_fail": {}, "max_retries": 2})
    @patch.object(_mod, "sb_select")
    @patch.object(_mod, "record_token_usage")
    @patch.object(_mod, "parse_claude_json", return_value={"text": "ok", "usage": {}})
    def test_temp_files_deleted_on_success(
        self, mock_parse, mock_record, mock_sb_select,
        mock_get_cfg, mock_retry, mock_complete, mock_milestone,
        mock_cleanup, mock_evaluator
    ):
        mock_sb_select.side_effect = [
            [{"step_id": "s1", "type": "single"}],
            [],
        ]

        entry = _make_registry_entry("step-c2", returncode=0, elapsed=30)
        stdout_path = entry["stdout_path"]
        prompt_file = entry["prompt_file"]
        PROCESS_REGISTRY["step-c2"] = entry

        harvest()

        self.assertFalse(os.path.exists(stdout_path))
        self.assertFalse(os.path.exists(prompt_file))

    @patch.object(_mod, "run_evaluator")
    @patch.object(_mod, "cleanup_worktree")
    @patch.object(_mod, "notify")
    @patch.object(_mod, "antfarm_fail", return_value={})
    def test_temp_files_deleted_on_timeout(
        self, mock_fail, mock_notify, mock_cleanup, mock_evaluator
    ):
        entry = _make_registry_entry("step-c3", returncode=None,
                                     elapsed=AGENT_TIMEOUT_SECONDS + 5)
        stdout_path = entry["stdout_path"]
        prompt_file = entry["prompt_file"]
        PROCESS_REGISTRY["step-c3"] = entry

        harvest()

        self.assertFalse(os.path.exists(stdout_path))
        self.assertFalse(os.path.exists(prompt_file))


class TestHarvestLoopStepSkip(unittest.TestCase):
    """harvest() skips retry logic for loop and verifyEach steps."""

    def setUp(self):
        PROCESS_REGISTRY.clear()

    def tearDown(self):
        PROCESS_REGISTRY.clear()

    @patch.object(_mod, "run_evaluator")
    @patch.object(_mod, "cleanup_worktree")
    @patch.object(_mod, "check_milestone")
    @patch.object(_mod, "antfarm_complete", return_value={"runCompleted": False})
    @patch.object(_mod, "handle_retry_step")
    @patch.object(_mod, "get_step_config", return_value={"expects": "STATUS: done", "on_fail": {}, "max_retries": 2})
    @patch.object(_mod, "sb_select")
    @patch.object(_mod, "record_token_usage")
    @patch.object(_mod, "parse_claude_json", return_value={"text": "partial", "usage": {}})
    def test_loop_step_skips_retry(
        self, mock_parse, mock_record, mock_sb_select,
        mock_get_cfg, mock_retry, mock_complete, mock_milestone,
        mock_cleanup, mock_evaluator
    ):
        mock_sb_select.return_value = [{"step_id": "loop-stories", "type": "loop"}]

        entry = _make_registry_entry("step-loop", returncode=0, elapsed=60)
        PROCESS_REGISTRY["step-loop"] = entry

        harvest()

        # handle_retry_step should NOT be called for loop steps
        mock_retry.assert_not_called()
        mock_complete.assert_called_once()

    @patch.object(_mod, "run_evaluator")
    @patch.object(_mod, "cleanup_worktree")
    @patch.object(_mod, "check_milestone")
    @patch.object(_mod, "antfarm_complete", return_value={"runCompleted": False})
    @patch.object(_mod, "handle_retry_step")
    @patch.object(_mod, "get_step_config", return_value={"expects": "STATUS: done", "on_fail": {}, "max_retries": 2})
    @patch.object(_mod, "sb_select")
    @patch.object(_mod, "record_token_usage")
    @patch.object(_mod, "parse_claude_json", return_value={"text": "verified", "usage": {}})
    def test_verify_each_target_skips_retry(
        self, mock_parse, mock_record, mock_sb_select,
        mock_get_cfg, mock_retry, mock_complete, mock_milestone,
        mock_cleanup, mock_evaluator
    ):
        # First call: step lookup (not a loop step)
        # Second call: loop_steps lookup (finds a loop step pointing at this step)
        mock_sb_select.side_effect = [
            [{"step_id": "verify", "type": "single"}],
            [{"loop_config": {"verifyEach": True, "verifyStep": "verify"}}],
        ]

        entry = _make_registry_entry("step-ve", returncode=0, elapsed=60)
        PROCESS_REGISTRY["step-ve"] = entry

        harvest()

        mock_retry.assert_not_called()
        mock_complete.assert_called_once()


class TestHarvestRetryStep(unittest.TestCase):
    """harvest() handles retry_step correctly."""

    def setUp(self):
        PROCESS_REGISTRY.clear()

    def tearDown(self):
        PROCESS_REGISTRY.clear()

    @patch.object(_mod, "run_evaluator")
    @patch.object(_mod, "cleanup_worktree")
    @patch.object(_mod, "check_milestone")
    @patch.object(_mod, "antfarm_complete")
    @patch.object(_mod, "handle_retry_step", return_value=True)
    @patch.object(_mod, "get_step_config", return_value={"expects": "STATUS: done", "on_fail": {"retry_step": "plan"}, "max_retries": 2})
    @patch.object(_mod, "sb_select")
    @patch.object(_mod, "record_token_usage")
    @patch.object(_mod, "parse_claude_json", return_value={"text": "no status", "usage": {}})
    def test_retry_step_skips_complete(
        self, mock_parse, mock_record, mock_sb_select,
        mock_get_cfg, mock_retry, mock_complete, mock_milestone,
        mock_cleanup, mock_evaluator
    ):
        mock_sb_select.side_effect = [
            [{"step_id": "implement", "type": "single"}],
            [],  # no loop steps
        ]

        entry = _make_registry_entry("step-r1", returncode=0, elapsed=60)
        PROCESS_REGISTRY["step-r1"] = entry

        harvest()

        mock_retry.assert_called_once()
        # antfarm_complete should NOT be called when retry handled it
        mock_complete.assert_not_called()
        self.assertNotIn("step-r1", PROCESS_REGISTRY)


class TestHarvestMultipleProcesses(unittest.TestCase):
    """harvest() handles multiple registry entries correctly."""

    def setUp(self):
        PROCESS_REGISTRY.clear()

    def tearDown(self):
        PROCESS_REGISTRY.clear()

    @patch.object(_mod, "run_evaluator")
    @patch.object(_mod, "cleanup_worktree")
    @patch.object(_mod, "check_milestone")
    @patch.object(_mod, "antfarm_complete", return_value={"runCompleted": False})
    @patch.object(_mod, "handle_retry_step", return_value=False)
    @patch.object(_mod, "get_step_config", return_value={"expects": "", "on_fail": {}, "max_retries": 2})
    @patch.object(_mod, "sb_select")
    @patch.object(_mod, "record_token_usage")
    @patch.object(_mod, "parse_claude_json", return_value={"text": "ok", "usage": {}})
    @patch.object(_mod, "antfarm_fail", return_value={})
    def test_mixed_finished_and_running(
        self, mock_fail, mock_parse, mock_record, mock_sb_select,
        mock_get_cfg, mock_retry, mock_complete, mock_milestone,
        mock_cleanup, mock_evaluator
    ):
        mock_sb_select.side_effect = [
            [{"step_id": "s1", "type": "single"}],
            [],
        ]

        # One finished successfully, one still running, one failed
        entry_ok = _make_registry_entry("step-ok", returncode=0, elapsed=120)
        entry_running = _make_registry_entry("step-run", returncode=None, elapsed=30)
        entry_fail = _make_registry_entry("step-fail", returncode=1, elapsed=60)

        PROCESS_REGISTRY["step-ok"] = entry_ok
        PROCESS_REGISTRY["step-run"] = entry_running
        PROCESS_REGISTRY["step-fail"] = entry_fail

        count = harvest()

        self.assertEqual(count, 2)  # ok + fail harvested
        self.assertNotIn("step-ok", PROCESS_REGISTRY)
        self.assertNotIn("step-fail", PROCESS_REGISTRY)
        self.assertIn("step-run", PROCESS_REGISTRY)  # still running

        # Clean up the still-running entry's temp files
        for p in [entry_running.get("stdout_path"), entry_running.get("prompt_file")]:
            if p:
                try:
                    os.unlink(p)
                except OSError:
                    pass


class TestHarvestReadsFromFile(unittest.TestCase):
    """harvest() reads stdout from the temp file, not pipe."""

    def setUp(self):
        PROCESS_REGISTRY.clear()

    def tearDown(self):
        PROCESS_REGISTRY.clear()

    @patch.object(_mod, "run_evaluator")
    @patch.object(_mod, "cleanup_worktree")
    @patch.object(_mod, "notify")
    @patch.object(_mod, "record_token_usage")
    @patch.object(_mod, "parse_claude_json")
    @patch.object(_mod, "antfarm_fail", return_value={})
    def test_reads_stdout_from_file(
        self, mock_fail, mock_parse, mock_record, mock_notify,
        mock_cleanup, mock_evaluator
    ):
        mock_parse.return_value = {"text": "file content here", "usage": {}}

        content = "this is the captured stdout from file"
        entry = _make_registry_entry("step-read", returncode=1, elapsed=30,
                                     stdout_content=content)
        PROCESS_REGISTRY["step-read"] = entry

        harvest()

        # parse_claude_json should have received the file content
        mock_parse.assert_called_once_with(content)


if __name__ == "__main__":
    unittest.main()
