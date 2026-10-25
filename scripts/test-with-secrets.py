"""Exercise credential precedence and failure paths without real credentials."""
from pathlib import Path
import subprocess
import tempfile
import unittest

WRAPPER = Path(__file__).resolve().with_name("with-secrets.sh")


class WithSecretsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.calls = self.root / "calls"
        fake = self.root / "gcloud"
        fake.write_text('''#!/bin/bash
printf '%s\\n' "$*" >> "$CALLS"
case "$1 $2" in
  'config get-value') printf '%s' "${MOCK_PROJECT:-}" ;;
  'auth list') printf '%s' "${MOCK_ACCOUNT:-}" ;;
  'secrets versions')
    [[ ${MOCK_DENIED:-0} == 0 ]] || exit 1
    printf '%s' "${MOCK_KEY:-}"
    ;;
  *) exit 99 ;;
esac
''')
        fake.chmod(0o700)
        self.env = {"PATH": f"{self.root}:/usr/bin:/bin", "CALLS": str(self.calls),
                    "MOCK_PROJECT": "configured-project", "MOCK_ACCOUNT": "dev@example.test",
                    "MOCK_KEY": "synthetic-shared-fixture"}

    def run_wrapper(self, command=None, **env):
        return subprocess.run(["/bin/bash", str(WRAPPER), *(command or ["/bin/true"])],
                              env={**self.env, **env}, capture_output=True, text=True)

    def assert_key(self, expected, **env):
        # Compare inside the child so even the test output contains no payload.
        result = self.run_wrapper(["/bin/bash", "-c", '[[ $GEMINI_API_KEY == "$1" ]]',
                                   "check", expected], **env)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "")

    def test_personal_key_wins_without_cloud_calls(self):
        self.assert_key("synthetic-personal-fixture", GEMINI_API_KEY="synthetic-personal-fixture",
                        GOOGLE_API_KEY="synthetic-alias-fixture")
        self.assertFalse(self.calls.exists())

    def test_google_alias_without_cloud_calls(self):
        self.assert_key("synthetic-alias-fixture", GOOGLE_API_KEY="synthetic-alias-fixture")
        self.assertFalse(self.calls.exists())

    def test_shared_key_and_configured_project(self):
        self.assert_key("synthetic-shared-fixture", GEMINI_API_KEY="")
        self.assertIn("--project=configured-project", self.calls.read_text())
        self.assertIn("--secret=GEMINI_API_KEY", self.calls.read_text())

    def test_explicit_project_takes_precedence(self):
        self.assert_key("synthetic-shared-fixture", FINEPRINT_PROJECT="explicit-project")
        calls = self.calls.read_text()
        self.assertIn("--project=explicit-project", calls)
        self.assertNotIn("config get-value", calls)

    def test_missing_project(self):
        result = self.run_wrapper(MOCK_PROJECT="")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("set FINEPRINT_PROJECT", result.stderr)

    def test_unset_project(self):
        self.assertNotEqual(self.run_wrapper(MOCK_PROJECT="(unset)").returncode, 0)

    def test_no_login(self):
        result = self.run_wrapper(MOCK_ACCOUNT="")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("gcloud auth login", result.stderr)
        self.assertNotIn("secrets versions", self.calls.read_text())

    def test_access_denied_does_not_execute_command(self):
        marker = self.root / "executed"
        result = self.run_wrapper(["/usr/bin/touch", str(marker)], MOCK_DENIED="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("roles/secretmanager.secretAccessor", result.stderr)
        self.assertFalse(marker.exists())
        self.assertEqual(result.stdout, "")

    def test_empty_secret(self):
        result = self.run_wrapper(MOCK_KEY="")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("is empty", result.stderr)

    def test_missing_cli(self):
        result = self.run_wrapper(PATH=str(self.root / "missing"))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("install the Google Cloud CLI", result.stderr)

    def test_usage(self):
        result = subprocess.run(["/bin/bash", str(WRAPPER)], env=self.env,
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)

    def test_arguments_and_exit_status(self):
        result = self.run_wrapper(["/bin/bash", "-c", '[[ $1 == "two words" && $2 == \'$literal\' ]] || exit 99; exit 23',
                                   "check", "two words", "$literal"])
        self.assertEqual(result.returncode, 23)

    def test_xtrace_does_not_expose_payload(self):
        result = subprocess.run(["/bin/bash", "-x", str(WRAPPER), "/bin/true"],
                                env=self.env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0)
        self.assertNotIn(self.env["MOCK_KEY"], result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
