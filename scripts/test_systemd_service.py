"""Tests for the antfarm-dispatch.service systemd unit file."""

import configparser
import os
import unittest

SERVICE_FILE = os.path.join(
    os.path.dirname(__file__), "..", "systemd", "antfarm-dispatch.service"
)


class TestSystemdServiceFile(unittest.TestCase):
    """Validate the antfarm-dispatch.service unit file."""

    @classmethod
    def setUpClass(cls):
        cls.config = configparser.ConfigParser(interpolation=None)
        # configparser needs '=' assignments; systemd uses them, so this works
        cls.config.read(SERVICE_FILE)

    def test_file_exists(self):
        self.assertTrue(
            os.path.isfile(SERVICE_FILE),
            f"Service file not found at {SERVICE_FILE}",
        )

    def test_unit_section(self):
        self.assertIn("Unit", self.config)
        self.assertEqual(
            self.config["Unit"]["Description"], "Antfarm Dispatch Daemon"
        )
        self.assertEqual(
            self.config["Unit"]["After"], "network-online.target"
        )
        self.assertEqual(
            self.config["Unit"]["Wants"], "network-online.target"
        )

    def test_service_section(self):
        svc = self.config["Service"]
        self.assertEqual(svc["Type"], "simple")
        self.assertEqual(svc["User"], "root")
        self.assertEqual(svc["WorkingDirectory"], "/root")
        self.assertEqual(svc["Restart"], "on-failure")
        self.assertEqual(svc["RestartSec"], "10")
        self.assertEqual(svc["KillSignal"], "SIGTERM")
        self.assertEqual(svc["TimeoutStopSec"], "180")

    def test_execstart_sources_pif_env_and_runs_daemon(self):
        exec_start = self.config["Service"]["ExecStart"]
        self.assertIn("source /root/.pif-env", exec_start)
        self.assertIn("antfarm-dispatch.py --daemon", exec_start)
        # exec ensures SIGTERM goes to python, not bash
        self.assertIn("exec python3", exec_start)

    def test_execstart_uses_bash(self):
        exec_start = self.config["Service"]["ExecStart"]
        self.assertTrue(exec_start.startswith("/bin/bash -c"))

    def test_install_section(self):
        self.assertIn("Install", self.config)
        self.assertEqual(
            self.config["Install"]["WantedBy"], "multi-user.target"
        )

    def test_timeout_stop_allows_grace_period(self):
        """TimeoutStopSec=180 gives 120s grace + 60s buffer for final harvest."""
        timeout = int(self.config["Service"]["TimeoutStopSec"])
        self.assertGreaterEqual(timeout, 180)


if __name__ == "__main__":
    unittest.main()
