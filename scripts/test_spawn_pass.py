#!/usr/bin/env python3
"""Tests for get_max_concurrent, spawn_pass, and PER_RUN_CAP in antfarm-dispatch.py."""

import importlib.util
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

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

get_max_concurrent = _mod.get_max_concurrent
spawn_pass = _mod.spawn_pass
PROCESS_REGISTRY = _mod.PROCESS_REGISTRY
PER_RUN_CAP = _mod.PER_RUN_CAP


class TestGetMaxConcurrent(unittest.TestCase):
    """Test get_max_concurrent function."""

    @patch.object(_mod, "sb_select")
    def test_returns_value_from_policies(self, mock_sb):
        mock_sb.return_value = [{"value": "5"}]
        result = get_max_concurrent()
        self.assertEqual(result, 5)
        mock_sb.assert_called_once_with("policies", {
            "key": "eq.max_concurrent_antfarm_agents",
            "select": "value",
        })

    @patch.object(_mod, "sb_select")
    def test_returns_default_3_when_no_rows(self, mock_sb):
        mock_sb.return_value = []
        self.assertEqual(get_max_concurrent(), 3)

    @patch.object(_mod, "sb_select")
    def test_returns_default_3_on_exception(self, mock_sb):
        mock_sb.side_effect = Exception("network error")
        self.assertEqual(get_max_concurrent(), 3)

    @patch.object(_mod, "sb_select")
    def test_returns_default_3_on_invalid_value(self, mock_sb):
        mock_sb.return_value = [{"value": "not-a-number"}]
        self.assertEqual(get_max_concurrent(), 3)


class TestPerRunCap(unittest.TestCase):
    def test_per_run_cap_is_one(self):
        self.assertEqual(PER_RUN_CAP, 1)


class TestSpawnPass(unittest.TestCase):
    """Test spawn_pass function."""

    def setUp(self):
        PROCESS_REGISTRY.clear()

    def tearDown(self):
        PROCESS_REGISTRY.clear()

    @patch.object(_mod, "close_stale_runs")
    @patch.object(_mod, "sb_select")
    @patch.object(_mod, "prune_stale_worktrees")
    def test_returns_0_when_no_runs(self, mock_prune, mock_sb, mock_close):
        mock_sb.return_value = []
        result = spawn_pass()
        self.assertEqual(result, 0)
        mock_prune.assert_called_once()

    @patch.object(_mod, "close_stale_runs")
    @patch.object(_mod, "get_max_concurrent", return_value=3)
    @patch.object(_mod, "execute_agent_async")
    @patch.object(_mod, "build_prompt", return_value="test prompt")
    @patch.object(_mod, "antfarm_claim")
    @patch.object(_mod, "antfarm_peek", return_value=True)
    @patch.object(_mod, "load_workflow")
    @patch.object(_mod, "sb_select")
    @patch.object(_mod, "prune_stale_worktrees")
    def test_spawns_agent_for_eligible_work(
        self, mock_prune, mock_sb, mock_wf, mock_peek, mock_claim,
        mock_prompt, mock_exec, mock_cap, mock_close
    ):
        run = {
            "id": "run-1234-5678-9abc-def0",
            "workflow_id": "test-workflow",
            "context": {"repo": "/tmp/test-repo"},
            "task": "test task",
        }
        mock_sb.return_value = [run]
        mock_wf.return_value = {
            "agents": [{"id": "developer", "role": "coding"}],
        }
        mock_claim.return_value = {
            "stepId": "step-001",
            "input": "do the thing",
            "runId": "run-1234-5678-9abc-def0",
        }
        mock_proc = MagicMock()
        mock_proc.pid = 999
        mock_exec.return_value = {
            "popen": mock_proc,
            "stdout_path": "/tmp/out.log",
            "prompt_file": "/tmp/prompt.md",
        }

        result = spawn_pass()

        self.assertEqual(result, 1)
        mock_peek.assert_called_once_with("test-workflow_developer")
        mock_claim.assert_called_once_with("test-workflow_developer", "run-1234-5678-9abc-def0")
        mock_exec.assert_called_once()
        self.assertIn("step-001", PROCESS_REGISTRY)
        entry = PROCESS_REGISTRY["step-001"]
        self.assertEqual(entry["run_id"], "run-1234-5678-9abc-def0")
        self.assertEqual(entry["agent_id"], "test-workflow_developer")
        self.assertEqual(entry["popen"], mock_proc)
        mock_close.assert_called_once()

    @patch.object(_mod, "close_stale_runs")
    @patch.object(_mod, "get_max_concurrent", return_value=1)
    @patch.object(_mod, "sb_select")
    @patch.object(_mod, "prune_stale_worktrees")
    def test_global_cap_prevents_spawn(self, mock_prune, mock_sb, mock_cap, mock_close):
        # Pre-populate registry to meet cap
        PROCESS_REGISTRY["existing-step"] = {
            "popen": MagicMock(),
            "run_id": "other-run",
            "agent_id": "agent-1",
            "start_time": 0,
            "stdout_path": "/tmp/out.log",
            "prompt_file": "/tmp/p.md",
        }
        run = {
            "id": "run-aaaa-bbbb-cccc-dddd",
            "workflow_id": "wf",
            "context": {"repo": "/tmp/repo"},
            "task": "task",
        }
        mock_sb.return_value = [run]

        result = spawn_pass()
        self.assertEqual(result, 0)

    @patch.object(_mod, "close_stale_runs")
    @patch.object(_mod, "get_max_concurrent", return_value=3)
    @patch.object(_mod, "sb_select")
    @patch.object(_mod, "prune_stale_worktrees")
    def test_per_run_cap_prevents_second_agent(self, mock_prune, mock_sb, mock_cap, mock_close):
        run_id = "run-1111-2222-3333-4444"
        # Pre-populate: run already has 1 active agent
        PROCESS_REGISTRY["existing-step"] = {
            "popen": MagicMock(),
            "run_id": run_id,
            "agent_id": "agent-1",
            "start_time": 0,
            "stdout_path": "/tmp/out.log",
            "prompt_file": "/tmp/p.md",
        }
        run = {
            "id": run_id,
            "workflow_id": "wf",
            "context": {"repo": "/tmp/repo"},
            "task": "task",
        }
        mock_sb.return_value = [run]

        result = spawn_pass()
        self.assertEqual(result, 0)

    @patch.object(_mod, "close_stale_runs")
    @patch.object(_mod, "get_max_concurrent", return_value=3)
    @patch.object(_mod, "antfarm_fail")
    @patch.object(_mod, "execute_agent_async", return_value=None)
    @patch.object(_mod, "build_prompt", return_value="prompt")
    @patch.object(_mod, "antfarm_claim")
    @patch.object(_mod, "antfarm_peek", return_value=True)
    @patch.object(_mod, "load_workflow")
    @patch.object(_mod, "sb_select")
    @patch.object(_mod, "prune_stale_worktrees")
    def test_handles_spawn_failure(
        self, mock_prune, mock_sb, mock_wf, mock_peek, mock_claim,
        mock_prompt, mock_exec, mock_fail, mock_cap, mock_close
    ):
        run = {
            "id": "run-aaaa-bbbb-cccc-dddd",
            "workflow_id": "wf",
            "context": {"repo": "/tmp/repo"},
            "task": "task",
        }
        mock_sb.return_value = [run]
        mock_wf.return_value = {"agents": [{"id": "dev", "role": "coding"}]}
        mock_claim.return_value = {
            "stepId": "step-fail",
            "input": "task",
            "runId": "run-aaaa-bbbb-cccc-dddd",
        }

        result = spawn_pass()
        self.assertEqual(result, 0)
        mock_fail.assert_called_once_with("step-fail", "Failed to spawn agent process")
        self.assertNotIn("step-fail", PROCESS_REGISTRY)

    @patch.object(_mod, "close_stale_runs")
    @patch.object(_mod, "get_max_concurrent", return_value=3)
    @patch.object(_mod, "execute_agent_async")
    @patch.object(_mod, "build_prompt", return_value="prompt")
    @patch.object(_mod, "antfarm_claim")
    @patch.object(_mod, "antfarm_peek", return_value=True)
    @patch.object(_mod, "load_workflow")
    @patch.object(_mod, "sb_select")
    @patch.object(_mod, "prune_stale_worktrees")
    def test_skips_claim_mismatch(
        self, mock_prune, mock_sb, mock_wf, mock_peek, mock_claim,
        mock_prompt, mock_exec, mock_cap, mock_close
    ):
        run = {
            "id": "run-aaaa-bbbb-cccc-dddd",
            "workflow_id": "wf",
            "context": {"repo": "/tmp/repo"},
            "task": "task",
        }
        mock_sb.return_value = [run]
        mock_wf.return_value = {"agents": [{"id": "dev", "role": "coding"}]}
        mock_claim.return_value = {
            "stepId": "step-wrong",
            "input": "task",
            "runId": "different-run-id-xxxx",
        }

        result = spawn_pass()
        self.assertEqual(result, 0)
        mock_exec.assert_not_called()

    @patch.object(_mod, "close_stale_runs")
    @patch.object(_mod, "get_max_concurrent", return_value=3)
    @patch.object(_mod, "sb_select")
    @patch.object(_mod, "prune_stale_worktrees")
    def test_run_id_filter(self, mock_prune, mock_sb, mock_cap, mock_close):
        mock_sb.return_value = []

        spawn_pass(run_id_filter="specific-run-id")

        mock_sb.assert_called_with("antfarm_runs", {
            "status": "eq.running",
            "id": "eq.specific-run-id",
        })

    @patch.object(_mod, "close_stale_runs")
    @patch.object(_mod, "get_max_concurrent", return_value=2)
    @patch.object(_mod, "execute_agent_async")
    @patch.object(_mod, "build_prompt", return_value="prompt")
    @patch.object(_mod, "antfarm_claim")
    @patch.object(_mod, "antfarm_peek", return_value=True)
    @patch.object(_mod, "load_workflow")
    @patch.object(_mod, "sb_select")
    @patch.object(_mod, "prune_stale_worktrees")
    def test_spawns_across_multiple_runs(
        self, mock_prune, mock_sb, mock_wf, mock_peek, mock_claim,
        mock_prompt, mock_exec, mock_cap, mock_close
    ):
        """With cap=2 and 2 runs, should spawn 1 agent per run."""
        runs = [
            {"id": "run-aaaa", "workflow_id": "wf", "context": {"repo": "/tmp/r1"}, "task": "t1"},
            {"id": "run-bbbb", "workflow_id": "wf", "context": {"repo": "/tmp/r2"}, "task": "t2"},
        ]
        mock_sb.return_value = runs
        mock_wf.return_value = {"agents": [{"id": "dev", "role": "coding"}]}

        claim_calls = iter([
            {"stepId": "step-a", "input": "do a", "runId": "run-aaaa"},
            {"stepId": "step-b", "input": "do b", "runId": "run-bbbb"},
        ])
        mock_claim.side_effect = lambda *a, **kw: next(claim_calls)

        mock_proc = MagicMock()
        mock_proc.pid = 100
        mock_exec.return_value = {
            "popen": mock_proc,
            "stdout_path": "/tmp/out.log",
            "prompt_file": "/tmp/p.md",
        }

        result = spawn_pass()
        self.assertEqual(result, 2)
        self.assertIn("step-a", PROCESS_REGISTRY)
        self.assertIn("step-b", PROCESS_REGISTRY)


if __name__ == "__main__":
    unittest.main()
