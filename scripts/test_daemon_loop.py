#!/usr/bin/env python3
"""Tests for daemon_loop, SHUTDOWN_REQUESTED, and --daemon flag in antfarm-dispatch.py."""

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

# Patch out requests and yaml imports that need env vars / network
sys.modules.setdefault("yaml", MagicMock())

# Suppress logging and network calls during import
with patch.dict(os.environ, {
    "PIF_SUPABASE_URL": "https://fake.supabase.co",
    "PIF_SUPABASE_SERVICE_ROLE_KEY": "fake-key",
}):
    _spec.loader.exec_module(_mod)

daemon_loop = _mod.daemon_loop
PROCESS_REGISTRY = _mod.PROCESS_REGISTRY


class TestShutdownRequestedFlag(unittest.TestCase):
    """Test that SHUTDOWN_REQUESTED exists at module level."""

    def test_flag_exists_and_is_false(self):
        self.assertFalse(_mod.SHUTDOWN_REQUESTED)

    def test_flag_is_bool(self):
        self.assertIsInstance(_mod.SHUTDOWN_REQUESTED, bool)


class TestDaemonLoop(unittest.TestCase):
    """Test daemon_loop function."""

    def setUp(self):
        PROCESS_REGISTRY.clear()
        _mod.SHUTDOWN_REQUESTED = False

    def tearDown(self):
        PROCESS_REGISTRY.clear()
        _mod.SHUTDOWN_REQUESTED = False

    @patch.object(_mod, "time")
    @patch.object(_mod, "spawn_pass", return_value=0)
    @patch.object(_mod, "harvest", return_value=0)
    def test_calls_harvest_then_spawn(self, mock_harvest, mock_spawn, mock_time):
        """Verify harvest is called before spawn_pass each cycle."""
        call_order = []
        mock_harvest.side_effect = lambda: (call_order.append("harvest"), 0)[1]
        mock_spawn.side_effect = lambda run_id_filter=None: (
            call_order.append("spawn"),
            setattr(_mod, "SHUTDOWN_REQUESTED", True),
            0,
        )[2]
        mock_time.sleep = MagicMock()

        daemon_loop()

        self.assertEqual(call_order, ["harvest", "spawn"])

    @patch.object(_mod, "time")
    @patch.object(_mod, "spawn_pass", return_value=0)
    @patch.object(_mod, "harvest", return_value=0)
    def test_passes_run_id_filter_to_spawn(self, mock_harvest, mock_spawn, mock_time):
        """spawn_pass receives the run_id_filter argument."""
        mock_spawn.side_effect = lambda run_id_filter=None: (
            setattr(_mod, "SHUTDOWN_REQUESTED", True),
            0,
        )[1]
        mock_time.sleep = MagicMock()

        daemon_loop(run_id_filter="test-run-123")

        mock_spawn.assert_called_once_with("test-run-123")

    @patch.object(_mod, "time")
    @patch.object(_mod, "spawn_pass", return_value=0)
    @patch.object(_mod, "harvest", return_value=0)
    def test_adaptive_interval_idle(self, mock_harvest, mock_spawn, mock_time):
        """When PROCESS_REGISTRY is empty, sleep intervals should total ~60s."""
        sleep_calls = []

        def track_sleep(s):
            sleep_calls.append(s)
            # After accumulating all sleep, signal shutdown
            if sum(sleep_calls) >= 60:
                _mod.SHUTDOWN_REQUESTED = True

        mock_time.sleep = track_sleep

        daemon_loop()

        total_sleep = sum(sleep_calls)
        self.assertEqual(total_sleep, 60)

    @patch.object(_mod, "time")
    @patch.object(_mod, "spawn_pass", return_value=1)
    @patch.object(_mod, "harvest", return_value=0)
    def test_adaptive_interval_active(self, mock_harvest, mock_spawn, mock_time):
        """When PROCESS_REGISTRY is non-empty, sleep intervals should total ~10s."""
        def spawn_with_registry(*_args, **_kwargs):
            PROCESS_REGISTRY["step-1"] = {"popen": MagicMock(), "run_id": "r1"}
            return 1

        mock_spawn.side_effect = spawn_with_registry
        sleep_calls = []

        def track_sleep(s):
            sleep_calls.append(s)
            if sum(sleep_calls) >= 10:
                _mod.SHUTDOWN_REQUESTED = True

        mock_time.sleep = track_sleep

        daemon_loop()

        total_sleep = sum(sleep_calls)
        self.assertEqual(total_sleep, 10)

    @patch.object(_mod, "time")
    @patch.object(_mod, "spawn_pass", return_value=0)
    @patch.object(_mod, "harvest", return_value=0)
    def test_stops_on_shutdown_requested(self, mock_harvest, mock_spawn, mock_time):
        """Loop exits when SHUTDOWN_REQUESTED is set."""
        call_count = [0]

        def count_and_stop(*_args, **_kwargs):
            call_count[0] += 1
            if call_count[0] >= 2:
                _mod.SHUTDOWN_REQUESTED = True
            return 0

        mock_harvest.side_effect = count_and_stop
        mock_time.sleep = MagicMock()

        daemon_loop()

        # harvest should have been called exactly twice
        self.assertEqual(call_count[0], 2)

    @patch.object(_mod, "time")
    @patch.object(_mod, "spawn_pass", return_value=0)
    @patch.object(_mod, "harvest", return_value=0)
    def test_logs_poll_cycle(self, mock_harvest, mock_spawn, mock_time):
        """Verify poll cycle logs active/harvested/spawned counts."""
        mock_spawn.side_effect = lambda run_id_filter=None: (
            setattr(_mod, "SHUTDOWN_REQUESTED", True),
            0,
        )[1]
        mock_time.sleep = MagicMock()

        with patch.object(_mod, "log") as mock_log:
            daemon_loop()

            # Find the POLL CYCLE log call
            poll_calls = [
                c for c in mock_log.info.call_args_list
                if "POLL CYCLE" in str(c)
            ]
            self.assertEqual(len(poll_calls), 1)
            msg = poll_calls[0][0][0]
            self.assertIn("active=0", msg)
            self.assertIn("harvested=0", msg)
            self.assertIn("spawned=0", msg)


class TestMainDaemonFlag(unittest.TestCase):
    """Test that --daemon flag is parsed in main()."""

    def setUp(self):
        _mod.SHUTDOWN_REQUESTED = False

    def tearDown(self):
        _mod.SHUTDOWN_REQUESTED = False

    @patch.object(_mod, "daemon_loop")
    def test_daemon_flag_calls_daemon_loop(self, mock_daemon):
        with patch.object(_mod.sys, "argv", ["dispatch", "--daemon"]):
            _mod.main()
        mock_daemon.assert_called_once_with(None)

    @patch.object(_mod, "daemon_loop")
    def test_daemon_with_run_id(self, mock_daemon):
        with patch.object(_mod.sys, "argv", ["dispatch", "--daemon", "--run-id", "abc"]):
            _mod.main()
        mock_daemon.assert_called_once_with("abc")

    @patch.object(_mod, "dispatch_once")
    @patch.object(_mod, "should_dispatch", return_value=True)
    def test_once_flag_still_works(self, mock_should, mock_dispatch):
        with patch.object(_mod.sys, "argv", ["dispatch", "--once"]):
            _mod.main()
        mock_dispatch.assert_called_once_with(None)

    @patch.object(_mod, "daemon_loop")
    def test_daemon_adds_stream_handler(self, mock_daemon):
        """--daemon mode should add a StreamHandler to the logger."""
        initial_handlers = len(_mod.log.handlers)
        with patch.object(_mod.sys, "argv", ["dispatch", "--daemon"]):
            _mod.main()
        self.assertGreater(len(_mod.log.handlers), initial_handlers)
        # Clean up: remove the added handler
        _mod.log.handlers.pop()


if __name__ == "__main__":
    unittest.main()
