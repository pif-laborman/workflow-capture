#!/usr/bin/env python3
"""Tests for recover_orphaned_steps in antfarm-dispatch.py."""

import importlib.util
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch, call

# Load antfarm-dispatch.py as a module (filename has hyphens)
_spec = importlib.util.spec_from_file_location(
    "antfarm_dispatch",
    Path(__file__).parent / "antfarm-dispatch.py",
)
_mod = importlib.util.module_from_spec(_spec)

sys.modules.setdefault("yaml", MagicMock())

with patch.dict(os.environ, {
    "PIF_SUPABASE_URL": "https://fake.supabase.co",
    "PIF_SUPABASE_SERVICE_ROLE_KEY": "fake-key",
}):
    _spec.loader.exec_module(_mod)


class TestRecoverOrphanedSteps(unittest.TestCase):
    """Test recover_orphaned_steps function."""

    @patch.object(_mod, "sb_update")
    @patch.object(_mod, "sb_select")
    def test_no_orphaned_steps(self, mock_select, mock_update):
        """Returns 0 and does not call sb_update when no orphaned steps."""
        mock_select.return_value = []
        result = _mod.recover_orphaned_steps()
        self.assertEqual(result, 0)
        mock_select.assert_called_once_with(
            "antfarm_steps",
            {"status": "eq.running", "select": "id,run_id,type,current_story_id"},
        )
        mock_update.assert_not_called()

    @patch.object(_mod, "sb_update")
    @patch.object(_mod, "sb_select")
    def test_resets_regular_step_to_pending(self, mock_select, mock_update):
        """Resets a regular (non-loop) orphaned step to pending."""
        mock_select.return_value = [
            {"id": "step-1", "run_id": "run-1", "type": "coding", "current_story_id": None},
        ]
        result = _mod.recover_orphaned_steps()
        self.assertEqual(result, 1)
        mock_update.assert_called_once_with(
            "antfarm_steps",
            {"id": "step-1"},
            {"status": "pending"},
        )

    @patch.object(_mod, "sb_update")
    @patch.object(_mod, "sb_select")
    def test_loop_step_preserves_current_story_id(self, mock_select, mock_update):
        """Loop steps preserve current_story_id when reset to pending."""
        mock_select.return_value = [
            {"id": "step-2", "run_id": "run-2", "type": "loop", "current_story_id": "story-42"},
        ]
        result = _mod.recover_orphaned_steps()
        self.assertEqual(result, 1)
        mock_update.assert_called_once_with(
            "antfarm_steps",
            {"id": "step-2"},
            {"status": "pending", "current_story_id": "story-42"},
        )

    @patch.object(_mod, "sb_update")
    @patch.object(_mod, "sb_select")
    def test_loop_step_without_current_story_id(self, mock_select, mock_update):
        """Loop steps with no current_story_id don't include it in update."""
        mock_select.return_value = [
            {"id": "step-3", "run_id": "run-3", "type": "loop", "current_story_id": None},
        ]
        result = _mod.recover_orphaned_steps()
        self.assertEqual(result, 1)
        mock_update.assert_called_once_with(
            "antfarm_steps",
            {"id": "step-3"},
            {"status": "pending"},
        )

    @patch.object(_mod, "sb_update")
    @patch.object(_mod, "sb_select")
    def test_multiple_orphaned_steps(self, mock_select, mock_update):
        """Handles multiple orphaned steps including mix of types."""
        mock_select.return_value = [
            {"id": "step-1", "run_id": "run-1", "type": "coding", "current_story_id": None},
            {"id": "step-2", "run_id": "run-2", "type": "loop", "current_story_id": "story-7"},
            {"id": "step-3", "run_id": "run-1", "type": "verification", "current_story_id": None},
        ]
        result = _mod.recover_orphaned_steps()
        self.assertEqual(result, 3)
        self.assertEqual(mock_update.call_count, 3)
        mock_update.assert_any_call(
            "antfarm_steps", {"id": "step-1"}, {"status": "pending"},
        )
        mock_update.assert_any_call(
            "antfarm_steps", {"id": "step-2"}, {"status": "pending", "current_story_id": "story-7"},
        )
        mock_update.assert_any_call(
            "antfarm_steps", {"id": "step-3"}, {"status": "pending"},
        )

    @patch.object(_mod, "sb_update")
    @patch.object(_mod, "sb_select")
    def test_logs_each_recovery(self, mock_select, mock_update):
        """Each orphaned step recovery is logged with step_id and run_id."""
        mock_select.return_value = [
            {"id": "step-1", "run_id": "run-1", "type": "coding", "current_story_id": None},
        ]
        with patch.object(_mod, "log") as mock_log:
            _mod.recover_orphaned_steps()
            # Check that the per-step log message was called
            mock_log.info.assert_any_call(
                "RECOVERY: resetting orphaned step=step-1 run=run-1 to pending"
            )

    @patch.object(_mod, "recover_orphaned_steps")
    @patch.object(_mod, "spawn_pass", return_value=0)
    @patch.object(_mod, "harvest", return_value=0)
    @patch.object(_mod, "time")
    @patch("signal.signal")
    def test_daemon_loop_calls_recover_on_startup(self, mock_signal, mock_time, mock_harvest, mock_spawn, mock_recover):
        """daemon_loop calls recover_orphaned_steps before entering the poll loop."""
        mock_recover.return_value = 0
        # Make daemon_loop exit after first iteration
        _mod.SHUTDOWN_REQUESTED = False
        mock_time.sleep.side_effect = lambda _: setattr(_mod, "SHUTDOWN_REQUESTED", True)
        mock_time.time.return_value = 0
        _mod.daemon_loop()
        mock_recover.assert_called_once()
        _mod.SHUTDOWN_REQUESTED = False


if __name__ == "__main__":
    unittest.main()
