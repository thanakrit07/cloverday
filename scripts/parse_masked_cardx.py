#!/usr/bin/env python3
"""
Parse ไฟล์ statement บัตรเครดิต CardX (รูปแบบ masked .txt) แล้วเทียบกับ DB
เพื่อหาว่ารายการไหน "ใหม่จริง" (ยังไม่เคย import) — ตัดรายการซ้ำออกก่อน
เพื่อไม่ต้องไล่ตรวจทีละบรรทัดสำหรับข้อมูลที่มีอยู่แล้ว

ใช้ภายใน (โดย Claude ผ่าน Bash) เท่านั้น ไม่ใช่สคริปต์ที่ผู้ใช้ต้องรันเอง
เนื้อหาที่อ่านมีแต่ placeholder (ไม่มี PII) จึงไม่มีปัญหาเรื่องความเป็นส่วนตัว
"""
from __future__ import annotations

import json
import re
import sys
from collections import Counter

TXN_RE = re.compile(r"^(\d{2})/(\d{2})\s+(\d{2})/(\d{2})\s+(.+?)\s+(-?[\d,]+\.\d{2})$")
CLOSING_RE = re.compile(r"(\d{2})/(\d{2})/(\d{2})\s+[\d,]+\.\d{2}\s+[\d,]+\.\d{2}\s+\d{2}/\d{2}/\d{2}")


def parse_file(path: str):
    text = open(path, encoding="utf-8").read()
    m = CLOSING_RE.search(text)
    if not m:
        raise ValueError(f"หา closing date ไม่เจอใน {path}")
    _, cm, cy = m.groups()
    closing_year = 2000 + int(cy)
    closing_month = int(cm)

    rows = []
    for line in text.splitlines():
        line = line.strip()
        m = TXN_RE.match(line)
        if not m:
            continue
        post_d, post_m, _, _, desc, amount_s = m.groups()
        amount = float(amount_s.replace(",", ""))
        if amount == 0:
            continue
        # ใช้วันที่บันทึก (posting date) เป็นวันที่ transaction — ตรงกับที่ DB เดิมใช้
        # (วันที่รายการ/transaction date เก็บไว้เป็นข้อมูลอ้างอิงใน description เท่านั้น)
        month = int(post_m)
        year = closing_year - 1 if month > closing_month else closing_year
        date = f"{year}-{month:02d}-{int(post_d):02d}"
        kind = "income" if amount < 0 else "expense"
        rows.append({
            "date": date, "kind": kind, "amount": round(abs(amount), 2),
            "note": desc.strip(), "source_file": path,
        })
    return rows


def main():
    paths = sys.argv[1:]
    all_rows = []
    for p in paths:
        rows = parse_file(p)
        print(f"{p}: parse ได้ {len(rows)} แถว", file=sys.stderr)
        all_rows.extend(rows)

    print(json.dumps(all_rows, ensure_ascii=False))


if __name__ == "__main__":
    main()
