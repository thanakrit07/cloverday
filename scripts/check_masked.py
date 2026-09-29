#!/usr/bin/env python3
"""
ตรวจไฟล์ที่ mask แล้วใน statements/staging/masked/ ว่ามีชื่อ/ที่อยู่/เลขบัญชีหลุดเหลือไหม
ก่อนให้ Claude เปิดอ่าน — แสดงผลแบบ redacted เท่านั้น (ตัวอักษรกลายเป็น <t8>/<a5>
คือไทย/อังกฤษกี่ตัว, ตัวเลขกลายเป็น 9) จะได้รู้ว่าหลุดตรงไหนโดยไม่เห็นข้อมูลจริง

  python3 scripts/check_masked.py            # ทุกไฟล์
  python3 scripts/check_masked.py FILE...    # เฉพาะบางไฟล์

exit 0 = ไม่เจออะไร, exit 1 = เจอสิ่งที่น่าจะหลุด (ห้ามเปิดอ่านจนกว่าจะแก้แล้ว mask ใหม่)
"""
from __future__ import annotations

import glob
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pdf_statement_mask import HOUSE_NO_RE, STREET_RE  # noqa: E402

PH = r"⟦P\d+⟧"
CHECKS = [
    # นามสกุลหลัง placeholder ของชื่อ ("คุณ ⟦P2⟧ <นามสกุล>") — ตัวที่เคยหลุดเพราะ ์ หาย
    ("name after คุณ/ชื่อผู้ถือบัตร", re.compile(rf"(?:คุณ|ชื่อผู้?ถือบัตร)\s*{PH}\s+([ก-๙A-Za-z]{{2,}})")),
    ("transfer counterparty", re.compile(r"(?:โอนไป|จาก)\s+[A-Z]{2,6}\s+X\d{3,4}\s+(.*\S)")),
    ("English title + name", re.compile(r"(?<![A-Za-z])(?:MR|MRS|MS|MISS)\.?\s+([A-Za-z]{2,}.*)", re.I)),
    ("Thai title + name", re.compile(r"(?:นางสาว|นาย|นาง|น\.ส\.)\s*([ก-๙]{2,}.*)")),
    ("unmasked 8+ digit number", re.compile(r"\b(?!\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b)(\d(?:[\s-]?\d){7,})\b")),
]


def redact(s: str) -> str:
    s = re.sub(PH, "⟦P⟧", s)

    def one(m):
        w = m.group(0)
        if w[0].isdigit():
            return "9"
        return f"<t{len(w)}>" if "\u0e00" <= w[0] <= "\u0e7f" else f"<a{len(w)}>"

    return re.sub(r"[ก-๙]+|[A-Za-z]+|\d", one, s)


def safe_name(name: str) -> str:
    return re.sub(r"\d{12,19}", "<card no.>", name)


def findings(text: str):
    for line in text.splitlines():
        for label, rx in CHECKS:
            m = rx.search(line)
            if not m:
                continue
            body = m.group(1)
            if label == "transfer counterparty" and not re.search(r"[A-Za-zก-๙]", re.sub(PH, "", body)):
                continue  # เหลือแต่ placeholder = mask แล้ว
            yield label, body
        for m in HOUSE_NO_RE.finditer(line):
            a, b = int(m.group(1)), int(m.group(2))
            if a > 31 or b > 12 or "เลขที่" in m.group(0):
                yield "house number", m.group(0)
        for m in STREET_RE.finditer(line):
            yield "soi/road name", m.group(0)


def main():
    files = sys.argv[1:] or sorted(glob.glob("statements/staging/masked/*.txt"))
    total = 0
    for f in files:
        name = os.path.basename(f)
        issues = []
        if re.search(r"\d(?:[\s_-]?\d){11,}", name):
            issues.append(("card/account number in file name", ""))
        with open(f, encoding="utf-8") as fh:
            issues += list(findings(fh.read()))
        if issues:
            total += len(issues)
            print(f"✗ {safe_name(name)}: {len(issues)}")
            for label, body in issues[:8]:
                print(f"    {label}: {redact(body)[:70]}")
            if len(issues) > 8:
                print(f"    ... และอีก {len(issues) - 8}")
    if total:
        print(f"\nพบ {total} จุดที่น่าจะหลุด — อย่าเปิดอ่านไฟล์เหล่านี้ แก้ mask_terms.txt / script แล้ว mask ใหม่ก่อน")
        sys.exit(1)
    print(f"✓ {len(files)} ไฟล์ ไม่พบชื่อ/ที่อยู่/เลขบัญชีที่หลุด")


if __name__ == "__main__":
    main()
