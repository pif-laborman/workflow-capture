#!/usr/bin/env python3
"""Tests for execute_agent_async and PROCESS_REGISTRY in antfarm-dispatch.py."""

import importlib.util
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, mock_open, patch

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

execute_agent_async = _mod.execute_agent_async
execute_agent = _mod.execute_agent
PROCESS_REGISTRY = _mod.PROCESS_REGISTRY
ROLE_CONFIG = _mod.ROLE_CONFIG


class TestProcessRegistry(unittest.TestCase):
    """Test PROCESS_REGISTRY exists and is properly initialized."""

    def test_registry_exists_and_is_dict(self):
        self.assertIsInstance(PROCESS_REGISTRY, dict)

    def test_registry_initially_empty(self):
        self.assertEqual(len(PROCESS_REGISTRY), 0)


class TestExecuteAgentAsync(unittest.TestCase):
    """Test execute_agent_async function."""

    def test_returns_none_for_missing_repo(self):
        result = execute_agent_async(
            agent_name="test-agent",
            role="coding",
            prompt="do something",
            repo="/nonexistent/path/that/does/not/exist",
        )
        self.assertIsNone(result)

    @patch("subprocess.Popen")
    def test_returns_dict_with_expected_keys(self, mock_popen_cls):
        mock_proc = MagicMock()
        mock_proc.pid = 12345
        mock_popen_cls.return_value = mock_proc

        with tempfile.TemporaryDirectory() as tmpdir:
            result = execute_agent_async(
                agent_name="test-agent",
                role="coding",
                prompt="test prompt content",
                repo=tmpdir,
            )

        self.assertIsNotNone(result)
        self.assertIn("popen", result)
        self.assertIn("stdout_path", result)
        self.assertIn("prompt_file", result)

        # popen should be the mock process
        self.assertEqual(result["popen"], mock_proc)

        # stdout_path should be a real file path (created by the function)
        self.assertTrue(result["stdout_path"].endswith(".log"))

        # prompt_file should exist on disk
        self.assertTrue(os.path.exists(result["prompt_file"]))

        # Clean up temp files
        for p in [result["stdout_path"], result["prompt_file"]]:
            try:
                os.unlink(p)
            except OSError:
                pass

    @patch("subprocess.Popen")
    def test_stdout_written_to_file_not_pipe(self, mock_popen_cls):
        """Verify stdout is captured to a file, not piped."""
        mock_proc = MagicMock()
        mock_proc.pid = 12345
        mock_popen_cls.return_value = mock_proc

        with tempfile.TemporaryDirectory() as tmpdir:
            result = execute_agent_async(
                agent_name="test-agent",
                role="analysis",
                prompt="analyze this",
                repo=tmpdir,
            )

        self.assertIsNotNone(result)

        # Check Popen was called with a file handle for stdout, not PIPE
        call_kwargs = mock_popen_cls.call_args
        stdout_arg = call_kwargs.kwargs.get("stdout") or call_kwargs[1].get("stdout")
        # stdout should be a file object, not subprocess.PIPE
        import subprocess
        self.assertNotEqual(stdout_arg, subprocess.PIPE)

        # Clean up
        for p in [result["stdout_path"], result["prompt_file"]]:
            try:
                os.unlink(p)
            except OSError:
                pass

    @patch("subprocess.Popen")
    def test_prompt_file_not_deleted(self, mock_popen_cls):
        """execute_agent_async should NOT delete the prompt file (caller does that)."""
        mock_proc = MagicMock()
        mock_proc.pid = 12345
        mock_popen_cls.return_value = mock_proc

        with tempfile.TemporaryDirectory() as tmpdir:
            result = execute_agent_async(
                agent_name="test-agent",
                role="coding",
                prompt="keep this prompt",
                repo=tmpdir,
            )

        self.assertIsNotNone(result)
        # Prompt file should still exist after the call
        self.assertTrue(os.path.exists(result["prompt_file"]))

        # And it should contain the prompt text
        with open(result["prompt_file"]) as f:
            self.assertEqual(f.read(), "keep this prompt")

        # Clean up
        for p in [result["stdout_path"], result["prompt_file"]]:
            try:
                os.unlink(p)
            except OSError:
                pass

    @patch("subprocess.Popen")
    def test_model_override(self, mock_popen_cls):
        """Model override should appear in the Popen command."""
        mock_proc = MagicMock()
        mock_proc.pid = 12345
        mock_popen_cls.return_value = mock_proc

        with tempfile.TemporaryDirectory() as tmpdir:
            result = execute_agent_async(
                agent_name="test-agent",
                role="coding",
                prompt="test",
                repo=tmpdir,
                model="sonnet",
            )

        self.assertIsNotNone(result)
        # The command passed to Popen should contain 'sonnet'
        call_args = mock_popen_cls.call_args[0][0]
        cmd_str = " ".join(call_args)
        self.assertIn("sonnet", cmd_str)

        # Clean up
        for p in [result["stdout_path"], result["prompt_file"]]:
            try:
                os.unlink(p)
            except OSError:
                pass

    @patch("subprocess.Popen", side_effect=OSError("spawn failed"))
    def test_returns_none_on_spawn_failure(self, mock_popen_cls):
        """If Popen raises, function should return None and clean up."""
        with tempfile.TemporaryDirectory() as tmpdir:
            result = execute_agent_async(
                agent_name="test-agent",
                role="coding",
                prompt="will fail",
                repo=tmpdir,
            )

        self.assertIsNone(result)

    @patch("subprocess.Popen")
    def test_uses_su_ralph_for_ralph_user(self, mock_popen_cls):
        """Should use 'su - ralph -c' pattern for ralph user roles."""
        mock_proc = MagicMock()
        mock_proc.pid = 12345
        mock_popen_cls.return_value = mock_proc

        with tempfile.TemporaryDirectory() as tmpdir:
            result = execute_agent_async(
                agent_name="test-agent",
                role="coding",  # coding role uses ralph user
                prompt="test",
                repo=tmpdir,
            )

        self.assertIsNotNone(result)
        call_args = mock_popen_cls.call_args[0][0]
        self.assertEqual(call_args[0], "su")
        self.assertEqual(call_args[1], "-")
        self.assertEqual(call_args[2], "ralph")
        self.assertEqual(call_args[3], "-c")

        # Clean up
        for p in [result["stdout_path"], result["prompt_file"]]:
            try:
                os.unlink(p)
            except OSError:
                pass

    def test_existing_execute_agent_still_works(self):
        """Verify the original execute_agent function is still present and callable."""
        self.assertTrue(callable(execute_agent))
        # Call with a non-existent repo to get the early-return path
        result = execute_agent(
            agent_name="test",
            role="coding",
            prompt="test",
            repo="/nonexistent/path/xyz",
        )
        self.assertFalse(result["success"])
        self.assertIn("does not exist", result["error"])


if __name__ == "__main__":
    unittest.main()
