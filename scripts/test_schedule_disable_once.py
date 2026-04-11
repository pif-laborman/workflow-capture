#!/usr/bin/env python3
"""Tests for US-007: Schedule disable on daemon startup and --once spawn+harvest."""

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

sys.modules.setdefault("yaml", MagicMock())

with patch.dict(os.environ, {
    "PIF_SUPABASE_URL": "https://fake.supabase.co",
    "PIF_SUPABASE_SERVICE_ROLE_KEY": "fake-key",
}):
    _spec.loader.exec_module(_mod)

PROCESS_REGISTRY = _mod.PROCESS_REGISTRY


class TestOnceSpawnHarvest(unittest.TestCase):
    """Test --once mode uses spawn+harvest pattern."""

    def setUp(self):
        PROCESS_REGISTRY.clear()
        _mod.SHUTDOWN_REQUESTED = False

    def tearDown(self):
        PROCESS_REGISTRY.clear()
        _mod.SHUTDOWN_REQUESTED = False

    @patch.object(_mod, "harvest", return_value=0)
    @patch.object(_mod, "spawn_pass", return_value=0)
    @patch.object(_mod, "should_dispatch", return_value=True)
    def test_once_calls_spawn_pass(self, mock_should, mock_spawn, mock_harvest):
        """--once mode calls spawn_pass to spawn agents."""
        with patch.object(_mod.sys, "argv", ["dispatch", "--once"]):
            _mod.main()
        mock_spawn.assert_called_once_with(None)

    @patch.object(_mod, "harvest", return_value=0)
    @patch.object(_mod, "spawn_pass", return_value=0)
    @patch.object(_mod, "should_dispatch", return_value=True)
    def test_once_with_run_id(self, mock_should, mock_spawn, mock_harvest):
        """--once with --run-id passes run_id to spawn_pass."""
        with patch.object(_mod.sys, "argv", ["dispatch", "--once", "--run-id", "abc-123"]):
            _mod.main()
        mock_spawn.assert_called_once_with("abc-123")

    @patch.object(_mod, "harvest", return_value=0)
    @patch.object(_mod, "spawn_pass", return_value=0)
    @patch.object(_mod, "should_dispatch", return_value=True)
    def test_once_skips_should_dispatch_with_run_id(self, mock_should, mock_spawn, mock_harvest):
        """--once with --run-id skips should_dispatch check."""
        with patch.object(_mod.sys, "argv", ["dispatch", "--once", "--run-id", "abc-123"]):
            _mod.main()
        mock_should.assert_not_called()

    @patch.object(_mod, "harvest", return_value=0)
    @patch.object(_mod, "spawn_pass", return_value=0)
    @patch.object(_mod, "should_dispatch", return_value=False)
    def test_once_respects_should_dispatch_false(self, mock_should, mock_spawn, mock_harvest):
        """--once without run_id exits early if should_dispatch returns False."""
        with patch.object(_mod.sys, "argv", ["dispatch", "--once"]):
            _mod.main()
        mock_spawn.assert_not_called()

    @patch.object(_mod, "time")
    @patch.object(_mod, "harvest")
    @patch.object(_mod, "spawn_pass")
    @patch.object(_mod, "should_dispatch", return_value=True)
    def test_once_waits_for_registry_to_empty(self, mock_should, mock_spawn, mock_harvest, mock_time):
        """--once waits until PROCESS_REGISTRY is empty before exiting."""
        mock_popen = MagicMock()
        harvest_count = [0]

        def spawn_side_effect(run_id_filter=None):
            PROCESS_REGISTRY["step-1"] = {"popen": mock_popen, "run_id": "r1"}
            return 1

        def harvest_side_effect():
            harvest_count[0] += 1
            if harvest_count[0] >= 2:
                PROCESS_REGISTRY.clear()
            return 0

        mock_spawn.side_effect = spawn_side_effect
        mock_harvest.side_effect = harvest_side_effect
        mock_time.sleep = MagicMock()

        with patch.object(_mod.sys, "argv", ["dispatch", "--once"]):
            _mod.main()

        # harvest should have been called multiple times until registry cleared
        self.assertGreaterEqual(harvest_count[0], 2)

    @patch.object(_mod, "time")
    @patch.object(_mod, "harvest", return_value=0)
    @patch.object(_mod, "spawn_pass")
    @patch.object(_mod, "should_dispatch", return_value=True)
    def test_once_sleeps_between_harvest_polls(self, mock_should, mock_spawn, mock_harvest, mock_time):
        """--once sleeps 5s between harvest polls when agents are active."""
        sleep_args = []

        def spawn_with_agent(run_id_filter=None):
            PROCESS_REGISTRY["step-1"] = {"popen": MagicMock(), "run_id": "r1"}
            return 1

        # Harvest clears registry on second call
        call_count = [0]
        def harvest_clears():
            call_count[0] += 1
            if call_count[0] >= 2:
                PROCESS_REGISTRY.clear()
            return 0

        mock_spawn.side_effect = spawn_with_agent
        mock_harvest.side_effect = harvest_clears
        mock_time.sleep = lambda s: sleep_args.append(s)

        with patch.object(_mod.sys, "argv", ["dispatch", "--once"]):
            _mod.main()

        self.assertIn(5, sleep_args)

    @patch.object(_mod, "harvest", return_value=0)
    @patch.object(_mod, "spawn_pass", return_value=0)
    @patch.object(_mod, "should_dispatch", return_value=True)
    def test_once_exits_immediately_when_no_agents(self, mock_should, mock_spawn, mock_harvest):
        """--once exits right away if spawn_pass doesn't spawn anything."""
        with patch.object(_mod.sys, "argv", ["dispatch", "--once"]):
            _mod.main()
        # Should have called final harvest
        mock_harvest.assert_called()


class TestDefaultContinuousMode(unittest.TestCase):
    """Test default mode (no flags) uses spawn+harvest pattern."""

    def setUp(self):
        PROCESS_REGISTRY.clear()
        _mod.SHUTDOWN_REQUESTED = False

    def tearDown(self):
        PROCESS_REGISTRY.clear()
        _mod.SHUTDOWN_REQUESTED = False

    @patch.object(_mod, "set_schedule_enabled")
    @patch.object(_mod, "clear_active_flag")
    @patch.object(_mod, "time")
    @patch.object(_mod, "sb_select", return_value=[])
    @patch.object(_mod, "harvest", return_value=0)
    @patch.object(_mod, "spawn_pass", return_value=0)
    def test_default_mode_uses_spawn_harvest(self, mock_spawn, mock_harvest, mock_sb, mock_time, mock_clear, mock_sched):
        """Default mode calls harvest() and spawn_pass()."""
        mock_time.sleep = MagicMock()

        with patch.object(_mod.sys, "argv", ["dispatch"]):
            _mod.main()

        mock_harvest.assert_called()
        mock_spawn.assert_called()

    @patch.object(_mod, "set_schedule_enabled")
    @patch.object(_mod, "clear_active_flag")
    @patch.object(_mod, "time")
    @patch.object(_mod, "sb_select", return_value=[])
    @patch.object(_mod, "harvest", return_value=0)
    @patch.object(_mod, "spawn_pass", return_value=0)
    def test_default_mode_exits_when_no_runs(self, mock_spawn, mock_harvest, mock_sb, mock_time, mock_clear, mock_sched):
        """Default mode exits and disables schedule when no running runs."""
        mock_time.sleep = MagicMock()

        with patch.object(_mod.sys, "argv", ["dispatch"]):
            _mod.main()

        mock_clear.assert_called_once()
        mock_sched.assert_called_once_with(False)

    @patch.object(_mod, "set_schedule_enabled")
    @patch.object(_mod, "clear_active_flag")
    @patch.object(_mod, "time")
    @patch.object(_mod, "sb_select")
    @patch.object(_mod, "harvest", return_value=0)
    @patch.object(_mod, "spawn_pass", return_value=0)
    def test_default_mode_loops_when_runs_active(self, mock_spawn, mock_harvest, mock_sb, mock_time, mock_clear, mock_sched):
        """Default mode continues looping while runs are active."""
        call_count = [0]

        def sb_side_effect(table, params=None):
            call_count[0] += 1
            if call_count[0] <= 1:
                return [{"id": "run-1", "status": "running"}]
            return []

        mock_sb.side_effect = sb_side_effect
        mock_time.sleep = MagicMock()

        with patch.object(_mod.sys, "argv", ["dispatch"]):
            _mod.main()

        # spawn_pass called at least twice (once when runs active, once before check)
        self.assertGreaterEqual(mock_spawn.call_count, 2)

    @patch.object(_mod, "set_schedule_enabled")
    @patch.object(_mod, "clear_active_flag")
    @patch.object(_mod, "time")
    @patch.object(_mod, "sb_select", return_value=[])
    @patch.object(_mod, "harvest", return_value=0)
    @patch.object(_mod, "spawn_pass", return_value=0)
    def test_default_mode_sleeps_15s(self, mock_spawn, mock_harvest, mock_sb, mock_time, mock_clear, mock_sched):
        """Default mode sleeps 15s between cycles."""
        sleep_args = []
        mock_time.sleep = lambda s: sleep_args.append(s)

        # Need runs active for at least one cycle to trigger sleep
        sb_calls = [0]
        def sb_side_effect(table, params=None):
            sb_calls[0] += 1
            if sb_calls[0] <= 1:
                return [{"id": "run-1"}]
            return []

        mock_sb.side_effect = sb_side_effect

        with patch.object(_mod.sys, "argv", ["dispatch"]):
            _mod.main()

        self.assertIn(15, sleep_args)


class TestDaemonScheduleDisable(unittest.TestCase):
    """Test daemon_loop disables schedule on startup."""

    def setUp(self):
        PROCESS_REGISTRY.clear()
        _mod.SHUTDOWN_REQUESTED = False

    def tearDown(self):
        PROCESS_REGISTRY.clear()
        _mod.SHUTDOWN_REQUESTED = False

    @patch.object(_mod, "recover_orphaned_steps", return_value=0)
    @patch.object(_mod, "set_schedule_enabled")
    @patch.object(_mod, "time")
    @patch.object(_mod, "spawn_pass", return_value=0)
    @patch.object(_mod, "harvest", return_value=0)
    def test_daemon_disables_schedule(self, mock_harvest, mock_spawn, mock_time, mock_sched, mock_recover):
        """daemon_loop calls set_schedule_enabled(False) on startup."""
        mock_spawn.side_effect = lambda run_id_filter=None: (
            setattr(_mod, "SHUTDOWN_REQUESTED", True), 0
        )[1]
        mock_time.sleep = MagicMock()

        _mod.daemon_loop()

        mock_sched.assert_called_once_with(False)

    @patch.object(_mod, "recover_orphaned_steps", return_value=0)
    @patch.object(_mod, "set_schedule_enabled")
    @patch.object(_mod, "time")
    @patch.object(_mod, "spawn_pass", return_value=0)
    @patch.object(_mod, "harvest", return_value=0)
    def test_daemon_logs_schedule_disabled(self, mock_harvest, mock_spawn, mock_time, mock_sched, mock_recover):
        """daemon_loop logs that schedule was disabled."""
        mock_spawn.side_effect = lambda run_id_filter=None: (
            setattr(_mod, "SHUTDOWN_REQUESTED", True), 0
        )[1]
        mock_time.sleep = MagicMock()

        with patch.object(_mod, "log") as mock_log:
            _mod.daemon_loop()
            info_msgs = [c[0][0] for c in mock_log.info.call_args_list]
            self.assertTrue(any("Disabled antfarm-dispatch schedule" in m for m in info_msgs))

    @patch.object(_mod, "recover_orphaned_steps", return_value=0)
    @patch.object(_mod, "set_schedule_enabled")
    @patch.object(_mod, "time")
    @patch.object(_mod, "spawn_pass", return_value=0)
    @patch.object(_mod, "harvest", return_value=0)
    def test_schedule_disabled_after_recovery(self, mock_harvest, mock_spawn, mock_time, mock_sched, mock_recover):
        """set_schedule_enabled is called after recover_orphaned_steps."""
        call_order = []
        mock_recover.side_effect = lambda: (call_order.append("recover"), 0)[1]
        mock_sched.side_effect = lambda enabled: call_order.append("schedule")
        mock_spawn.side_effect = lambda run_id_filter=None: (
            call_order.append("spawn"),
            setattr(_mod, "SHUTDOWN_REQUESTED", True),
            0,
        )[2]
        mock_time.sleep = MagicMock()

        _mod.daemon_loop()

        self.assertEqual(call_order.index("recover"), 0)
        self.assertEqual(call_order.index("schedule"), 1)


if __name__ == "__main__":
    unittest.main()
