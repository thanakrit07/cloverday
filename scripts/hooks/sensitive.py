#!/usr/bin/env python3
"""
กันข้อมูลส่วนตัวหลุดเข้าโค้ด — ใช้สองที่ ตัวตรวจเดียวกัน:
  python3 scripts/hooks/sensitive.py staged   ก่อน git commit (scripts/hooks/pre-commit เรียกให้)
  python3 scripts/hooks/sensitive.py claude   ก่อน Claude เขียนไฟล์ (hook ใน .claude/settings.json)

ตรวจ 2 อย่างเท่านั้น:
  1. เลขต่อเนื่องตั้งแต่ 12 หลัก (เลขบัตร/เลขบัญชี) ยกเว้นเลขที่ดูออกว่าแต่ง
     เช่น 1234567890123456 หรือเลขซ้ำตัวเดียวกัน — ใช้เลขแบบนี้ในตัวอย่าง/test ได้
  2. คำที่อยู่ใน .git/sensitive-terms (ไฟล์ในเครื่อง ไม่ถูก track; บรรทัดละคำ,
     ชื่อ/ที่อยู่/เลขบัตรจริงของตัวเอง) — repo ไม่เก็บค่าจริงเลย

ผลลัพธ์บอกแค่ "ไฟล์:บรรทัด และกฎข้อไหน" ไม่พิมพ์ค่าที่เจอ
ข้ามได้ด้วย git commit --no-verify เมื่อรู้ว่าปลอดภัย
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys

# ต่อเนื่อง 12+ หลัก หรือกลุ่ม 4 หลักคั่นด้วยเว้นวรรค/ขีด (หน้าตาเลขบัตร) — ไม่นับเลขสองก้อนที่บังเอิญอยู่ติดกัน
DIGITS = re.compile(r"(?<!\d)(?:\d{12,}|\d{4}(?:[ -]\d{4}){2,}\d*)(?!\d)")
# เลขที่ดูออกว่าแต่ง: ตัวเดียวซ้ำ หรือ 1234567890 วนซ้ำ
FAKE = re.compile(r"^(?:(\d)\1+|(?:1234567890)+\d{0,9})$")
SKIP_FILES = ("package-lock.json",)
# UUID (ข้อมูลจำลองใน seed.sql ลงท้ายด้วยเลข 12 หลัก) ไม่ใช่เลขบัตร
UUID = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")


def git_dir() -> str:
    try:
        return subprocess.run(["git", "rev-parse", "--git-dir"], capture_output=True, text=True, check=True).stdout.strip()
    except Exception:
        return ".git"


def local_terms() -> list[str]:
    path = os.path.join(git_dir(), "sensitive-terms")
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        return [t.strip().lower() for t in f if len(t.strip()) >= 3 and not t.startswith("#")]


def findings(text: str, terms: list[str] | None = None) -> list[tuple[int, str]]:
    """(บรรทัด, เหตุผล) ของสิ่งที่น่าจะเป็นข้อมูลส่วนตัว — ไม่คืนค่าที่เจอ"""
    terms = local_terms() if terms is None else terms
    out: list[tuple[int, str]] = []
    for number, line in enumerate(text.splitlines(), 1):
        for m in DIGITS.finditer(UUID.sub("", line)):
            digits = re.sub(r"\D", "", m.group(0))
            if len(digits) >= 12 and not FAKE.match(digits):
                out.append((number, f"เลขต่อเนื่อง {len(digits)} หลัก (เลขบัตร/บัญชี?) — ถ้าเป็นตัวอย่างให้ใช้เลขแต่ง เช่น 1234567890123456"))
        lowered = line.lower()
        if any(t in lowered for t in terms):
            out.append((number, "มีคำที่อยู่ใน .git/sensitive-terms"))
    return out


def staged() -> int:
    diff = subprocess.run(["git", "diff", "--cached", "-U0", "--no-color"], capture_output=True, text=True, check=True).stdout
    terms = local_terms()
    path = ""
    line_no = 0
    bad: list[str] = []
    for raw in diff.splitlines():
        if raw.startswith("+++ "):
            path = raw[6:] if raw.startswith("+++ b/") else raw[4:]
        elif raw.startswith("@@"):
            m = re.search(r"\+(\d+)", raw)
            line_no = int(m.group(1)) if m else 0
        elif raw.startswith("+") and not raw.startswith("+++"):
            if not path.endswith(SKIP_FILES):
                for _, why in findings(raw[1:], terms):
                    bad.append(f"  {path}:{line_no}  {why}")
            line_no += 1
    if bad:
        print("commit ถูกหยุด: พบสิ่งที่น่าจะเป็นข้อมูลส่วนตัวในไฟล์ที่ staged", *bad, "ถ้ารู้ว่าปลอดภัย: git commit --no-verify", sep="\n", file=sys.stderr)
        return 1
    return 0


def claude() -> int:
    try:
        event = json.load(sys.stdin)
    except Exception:
        return 0
    tool = event.get("tool_input", {}) or {}
    path = str(tool.get("file_path", ""))
    if path.endswith(SKIP_FILES):
        return 0
    parts = [str(tool.get(k, "")) for k in ("content", "new_string")]
    parts += [str(e.get("new_string", "")) for e in (tool.get("edits") or []) if isinstance(e, dict)]  # MultiEdit
    text = "\n".join(parts)
    hits = findings(text)
    if not hits:
        return 0
    print(
        f"หยุดก่อนเขียน {os.path.basename(path)}: ข้อความที่จะเขียนมีสิ่งที่น่าจะเป็นข้อมูลส่วนตัวของผู้ใช้ "
        f"({'; '.join(sorted({why for _, why in hits}))}). ห้ามเขียนค่าจริงลงไฟล์ใดๆ — ใช้ข้อมูลสมมติแทน แล้วลองใหม่",
        file=sys.stderr,
    )
    return 2


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    sys.exit({"staged": staged, "claude": claude}.get(mode, lambda: 2)())
