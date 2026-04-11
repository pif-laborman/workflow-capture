#!/usr/bin/env python3
"""Tests for SIGTERM handler and graceful shutdown in antfarm-dispatch.py."""

import importlib.util
import os
import signal
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


class TestHandleSigterm(unittest.TestCase):
    """Test handle_sigterm function."""

    def setUp(self):
        _mod.SHUTDOWN_REQUESTED = False

    def tearDown(self):
        _mod.SHUTDOWN_REQUESTED = False

    def test_sets_shutdown_requested(self):
        """handle_sigterm sets SHUTDOWN_REQUESTED to True."""
        _mod.handle_sigterm(signal.SIGTERM, None)
        self.assertTrue(_mod.SHUTDOWN_REQUESTED)

    def test_logs_sigterm_message(self):
        """handle_sigterm logs the SIGTERM event."""
        with patch.object(_mod, "log") as mock_log:
            _mod.handle_sigterm(signal.SIGTERM, None)
            mock_log.info.assert_called_once()
            self.assertIn("SIGTERM", mock_log.info.call_args[0][0])

    def test_accepts_any_signum(self):
        """handle_sigterm works regardless of signum value."""
        _mod.handle_sigterm(15, None)
        self.assertTrue(_mod.SHUTDOWN_REQUESTED)


class TestDaemonLoopSigtermRegistration(unittest.TestCase):
    """Test that daemon_loop registers the SIGTERM handler."""

    def setUp(self):
        _mod.SHUTDOWN_REQUESTED = False
        _mod.PROCESS_REGISTRY.clear()

    def tearDown(self):
        _mod.SHUTDOWN_REQUESTED = False
        _mod.PROCESS_REGISTRY.clear()

    @patch.object(_mod, "recover_orphaned_steps", return_value=0)
    @patch.object(_mod, "set_schedule_enabled")
    @patch.object(_mod, "time")
    @patch.object(_mod, "spawn_pass", return_value=0)
    @patch.object(_mod, "harvest", return_value=0)
    @patch.object(_mod.signal, "signal")
    def test_registers_sigterm_handler(self, mock_signal_fn, mock_harvest, mock_spawn, mock_time, mock_sched, mock_recover):
        """daemon_loop registers handle_sigterm for SIGTERM."""
        mock_spawn.side_effect = lambda run_id_filter=None: (
            setattr(_mod, "SHUTDOWN_REQUESTED", True), 0
        )[1]
        mock_time.sleep = MagicMock()
        mock_time.time = MagicMock(return_value=9999999)

        _mod.daemon_loop()

        mock_signal_fn.assert_any_call(signal.SIGTERM, _mod.handle_sigterm)


class TestGracefulShutdown(unittest.TestCase):
    """Test graceful shutdown after daemon loop exits."""

    def setUp(self):
        _mod.SHUTDOWN_REQUESTED = False
        _mod.PROCESS_REGISTRY.clear()

    def tearDown(self):
        _mod.SHUTDOWN_REQUESTED = False
        _mod.PROCESS_REGISTRY.clear()

    @patch.object(_mod, "recover_orphaned_steps", return_value=0)
    @patch.object(_mod, "set_schedule_enabled")
    @patch.object(_mod.signal, "signal")
    @patch.object(_mod, "time")
    @patch.object(_mod, "spawn_pass", return_value=0)
    @patch.object(_mod, "harvest", return_value=0)
    def test_no_agents_skips_grace_period(self, mock_harvest, mock_spawn, mock_time, mock_sig, mock_sched, mock_recover):
        """When no agents are active, shutdown logs completion immediately."""
        mock_spawn.side_effect = lambda run_id_filter=None: (
            setattr(_mod, "SHUTDOWN_REQUESTED", True), 0
        )[1]
        mock_time.sleep = MagicMock()
        mock_time.time = MagicMock(return_value=9999999)

        with patch.object(_mod, "log") as mock_log:
            _mod.daemon_loop()
            # Should log shutdown complete, but NOT the "Waiting for" message
            info_msgs = [c[0][0] for c in mock_log.info.call_args_list]
            self.assertTrue(any("Shutdown complete" in m for m in info_msgs))
            self.assertFalse(any("Waiting for" in m for m in info_msgs))

    @patch.object(_mod, "recover_orphaned_steps", return_value=0)
    @patch.object(_mod, "set_schedule_enabled")
    @patch.object(_mod.signal, "signal")
    @patch.object(_mod, "time")
    @patch.object(_mod, "spawn_pass", return_value=0)
    @patch.object(_mod, "harvest")
    def test_grace_period_harvests_agents(self, mock_harvest, mock_spawn, mock_time, mock_sig, mock_sched, mock_recover):
        """During grace period, harvest() is called to reap finishing agents."""
        mock_popen = MagicMock()
        harvest_call_count = [0]

        def harvest_side_effect():
            harvest_call_count[0] += 1
            if harvest_call_count[0] >= 3:
                _mod.PROCESS_REGISTRY.clear()
            return 0

        mock_harvest.side_effect = harvest_side_effect

        def spawn_with_agent(run_id_filter=None):
            _mod.PROCESS_REGISTRY["step-1"] = {"popen": mock_popen, "run_id": "r1"}
            setattr(_mod, "SHUTDOWN_REQUESTED", True)
            return 1

        mock_spawn.side_effect = spawn_with_agent
        mock_time.sleep = MagicMock()
        mock_time.time = MagicMock(return_value=0)

        _mod.daemon_loop()

        self.assertGreaterEqual(harvest_call_count[0], 2)

    @patch.object(_mod, "recover_orphaned_steps", return_value=0)
    @patch.object(_mod, "set_schedule_enabled")
    @patch.object(_mod.signal, "signal")
    @patch.object(_mod, "time")
    @patch.object(_mod, "spawn_pass", return_value=0)
    @patch.object(_mod, "harvest", return_value=0)
    def test_grace_period_logs_agent_count(self, mock_harvest, mock_spawn, mock_time, mock_sig, mock_sched, mock_recover):
        """Grace period log message includes the number of active agents."""
        mock_popen = MagicMock()

        def spawn_with_agents(run_id_filter=None):
            _mod.PROCESS_REGISTRY["step-1"] = {"popen": mock_popen, "run_id": "r1"}
            _mod.PROCESS_REGISTRY["step-2"] = {"popen": mock_popen, "run_id": "r2"}
            setattr(_mod, "SHUTDOWN_REQUESTED", True)
            return 2

        mock_spawn.side_effect = spawn_with_agents
        mock_time.sleep = MagicMock()
        time_vals = iter([0, 0, 200])
        mock_time.time = MagicMock(side_effect=lambda: next(time_vals, 200))

        with patch.object(_mod, "log") as mock_log:
            _mod.daemon_loop()
            info_msgs = [c[0][0] for c in mock_log.info.call_args_list]
            waiting_msgs = [m for m in info_msgs if "Waiting for" in m]
            self.assertEqual(len(waiting_msgs), 1)
            self.assertIn("2", waiting_msgs[0])

    @patch.object(_mod, "recover_orphaned_steps", return_value=0)
    @patch.object(_mod, "set_schedule_enabled")
    @patch.object(_mod.signal, "signal")
    @patch.object(_mod, "time")
    @patch.object(_mod, "spawn_pass", return_value=0)
    @patch.object(_mod, "harvest", return_value=0)
    def test_kills_agents_after_grace_period(self, mock_harvest, mock_spawn, mock_time, mock_sig, mock_sched, mock_recover):
        """Agents still running after 120s grace period are killed."""
        mock_popen = MagicMock()

        def spawn_with_agent(run_id_filter=None):
            _mod.PROCESS_REGISTRY["step-1"] = {"popen": mock_popen, "run_id": "r1"}
            setattr(_mod, "SHUTDOWN_REQUESTED", True)
            return 1

        mock_spawn.side_effect = spawn_with_agent
        mock_time.sleep = MagicMock()
        time_vals = iter([0, 200, 200])
        mock_time.time = MagicMock(side_effect=lambda: next(time_vals, 200))

        _mod.daemon_loop()

        mock_popen.kill.assert_called_once()

    @patch.object(_mod, "recover_orphaned_steps", return_value=0)
    @patch.object(_mod, "set_schedule_enabled")
    @patch.object(_mod.signal, "signal")
    @patch.object(_mod, "time")
    @patch.object(_mod, "spawn_pass", return_value=0)
    @patch.object(_mod, "harvest")
    def test_final_harvest_after_kill(self, mock_harvest, mock_spawn, mock_time, mock_sig, mock_sched, mock_recover):
        """harvest() is called after killing remaining agents."""
        mock_popen = MagicMock()
        harvest_calls_after_kill = []

        def spawn_with_agent(run_id_filter=None):
            _mod.PROCESS_REGISTRY["step-1"] = {"popen": mock_popen, "run_id": "r1"}
            setattr(_mod, "SHUTDOWN_REQUESTED", True)
            return 1

        mock_spawn.side_effect = spawn_with_agent
        mock_time.sleep = MagicMock()
        time_vals = iter([0, 200, 200])
        mock_time.time = MagicMock(side_effect=lambda: next(time_vals, 200))

        kill_happened = [False]
        original_kill = mock_popen.kill

        def track_kill():
            kill_happened[0] = True
            original_kill()

        mock_popen.kill = track_kill

        harvest_call_count = [0]

        def counting_harvest():
            harvest_call_count[0] += 1
            if kill_happened[0]:
                harvest_calls_after_kill.append(harvest_call_count[0])
                _mod.PROCESS_REGISTRY.clear()
            return 0

        mock_harvest.side_effect = counting_harvest

        _mod.daemon_loop()

        self.assertGreater(len(harvest_calls_after_kill), 0)

    @patch.object(_mod, "recover_orphaned_steps", return_value=0)
    @patch.object(_mod, "set_schedule_enabled")
    @patch.object(_mod.signal, "signal")
    @patch.object(_mod, "time")
    @patch.object(_mod, "spawn_pass", return_value=0)
    @patch.object(_mod, "harvest", return_value=0)
    def test_shutdown_complete_log(self, mock_harvest, mock_spawn, mock_time, mock_sig, mock_sched, mock_recover):
        """Shutdown complete message is always logged."""
        mock_spawn.side_effect = lambda run_id_filter=None: (
            setattr(_mod, "SHUTDOWN_REQUESTED", True), 0
        )[1]
        mock_time.sleep = MagicMock()
        mock_time.time = MagicMock(return_value=9999999)

        with patch.object(_mod, "log") as mock_log:
            _mod.daemon_loop()
            info_msgs = [c[0][0] for c in mock_log.info.call_args_list]
            self.assertTrue(any("Shutdown complete" in m for m in info_msgs))

    @patch.object(_mod, "recover_orphaned_steps", return_value=0)
    @patch.object(_mod, "set_schedule_enabled")
    @patch.object(_mod.signal, "signal")
    @patch.object(_mod, "time")
    @patch.object(_mod, "spawn_pass", return_value=0)
    @patch.object(_mod, "harvest", return_value=0)
    def test_grace_period_sleep_interval(self, mock_harvest, mock_spawn, mock_time, mock_sig, mock_sched, mock_recover):
        """During grace period, sleeps are 5 seconds apart."""
        mock_popen = MagicMock()

        def spawn_with_agent(run_id_filter=None):
            _mod.PROCESS_REGISTRY["step-1"] = {"popen": mock_popen, "run_id": "r1"}
            setattr(_mod, "SHUTDOWN_REQUESTED", True)
            return 1

        mock_spawn.side_effect = spawn_with_agent
        sleep_args = []

        def track_sleep(s):
            sleep_args.append(s)

        mock_time.sleep = track_sleep
        call_count = [0]

        def advancing_time():
            call_count[0] += 1
            if call_count[0] <= 2:
                return 0
            return 200

        mock_time.time = advancing_time

        _mod.daemon_loop()

        grace_sleeps = [s for s in sleep_args if s == 5]
        self.assertGreater(len(grace_sleeps), 0)


if __name__ == "__main__":
    unittest.main()
