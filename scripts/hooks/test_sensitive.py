import os
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(__file__))
import sensitive  # noqa: E402

# ตัวเลข/ชื่อทั้งหมดในไฟล์นี้แต่งขึ้น; เลข "จริงหน้าตา" ประกอบจากชิ้นส่วนเพื่อให้ตัวตรวจไม่เจอไฟล์นี้เอง
REAL_LOOKING = "".join(["7391", "8264", "0517", "2846"])


class Findings(unittest.TestCase):
    def test_flags_a_long_run_and_a_spaced_run_but_never_prints_it(self):
        self.assertEqual(len(sensitive.findings(f"card {REAL_LOOKING}", [])), 1)
        spaced = " ".join(["7391", "8264", "0517", "2846"])
        self.assertEqual(len(sensitive.findings(f"card {spaced}", [])), 1)
        for _, why in sensitive.findings(f"card {REAL_LOOKING}", []):
            self.assertNotIn(REAL_LOOKING, why)

    def test_lets_obviously_made_up_numbers_through(self):
        self.assertEqual(sensitive.findings("x 1234567890123456 y", []), [])
        self.assertEqual(sensitive.findings("x 000000000000 y", []), [])

    def test_ignores_dates_amounts_and_short_numbers(self):
        self.assertEqual(sensitive.findings("2026-09-29 12:30 1,234,567.89 ฿12345 0812345678", []), [])

    def test_flags_a_local_term_case_insensitively(self):
        self.assertEqual(len(sensitive.findings("hello Demo Person here", ["demo person"])), 1)
        self.assertEqual(sensitive.findings("hello", ["demo person"]), [])


class StagedHook(unittest.TestCase):
    def run_in_repo(self, content, terms=""):
        with tempfile.TemporaryDirectory() as d:
            sh = lambda *a: subprocess.run(a, cwd=d, capture_output=True, text=True)
            sh("git", "init", "-q")
            if terms:
                with open(os.path.join(d, ".git", "sensitive-terms"), "w", encoding="utf-8") as f:
                    f.write(terms)
            with open(os.path.join(d, "a.txt"), "w", encoding="utf-8") as f:
                f.write(content)
            sh("git", "add", "a.txt")
            return subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), "sensitive.py"), "staged"], cwd=d, capture_output=True, text=True)

    def test_blocks_a_commit_with_a_card_number_and_names_only_the_place(self):
        r = self.run_in_repo(f"ok\ncard {REAL_LOOKING}\n")
        self.assertEqual(r.returncode, 1)
        self.assertIn("a.txt:2", r.stderr)
        self.assertNotIn(REAL_LOOKING, r.stderr)

    def test_blocks_a_local_term_and_passes_clean_text(self):
        self.assertEqual(self.run_in_repo("my name is Demo Person\n", "demo person\n").returncode, 1)
        self.assertEqual(self.run_in_repo("nothing here 1234567890123456\n", "demo person\n").returncode, 0)


class ClaudeHook(unittest.TestCase):
    def run_hook(self, tool_input):
        import json
        script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sensitive.py")
        return subprocess.run([sys.executable, script, "claude"], input=json.dumps({"tool_input": tool_input}), capture_output=True, text=True)

    def test_blocks_a_write_or_edit_carrying_a_card_number_without_echoing_it(self):
        for tool_input in ({"file_path": "x.ts", "content": f"const n = '{REAL_LOOKING}'"}, {"file_path": "x.ts", "new_string": REAL_LOOKING}, {"file_path": "x.ts", "edits": [{"new_string": REAL_LOOKING}]}):
            r = self.run_hook(tool_input)
            self.assertEqual(r.returncode, 2)
            self.assertNotIn(REAL_LOOKING, r.stderr)

    def test_lets_ordinary_and_made_up_content_through(self):
        self.assertEqual(self.run_hook({"file_path": "x.ts", "content": "const n = '1234567890123456'"}).returncode, 0)
        self.assertEqual(self.run_hook({"file_path": "package-lock.json", "content": REAL_LOOKING}).returncode, 0)


if __name__ == "__main__":
    unittest.main()
