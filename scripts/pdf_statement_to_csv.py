#!/usr/bin/env python3
"""
แปลง statement PDF (บัตรเครดิต/บัญชีธนาคาร) เป็น CSV รูปแบบเดียวกับ
wealth-prof-transactions.csv โดยรันทั้งหมดในเครื่อง ไม่ส่งไฟล์หรือข้อมูล
ในไฟล์ไปที่ Claude หรือ cloud ใดๆ ทั้งสิ้น

ติดตั้ง (ครั้งเดียว):
  pip install pdfplumber

การใช้งาน:
  python3 scripts/pdf_statement_to_csv.py statement.pdf --account "KTC" --out ktc_extracted.csv

  # ดูตัวอย่างผลลัพธ์ก่อน โดยไม่เขียนไฟล์ (พิมพ์แค่ในเครื่อง ไม่ส่งไปไหน)
  python3 scripts/pdf_statement_to_csv.py statement.pdf --account "KTC" --preview 10

  # ถ้า parse ไม่ตรง ให้ dump ข้อความดิบไปดูเองในเครื่องก่อน (ไม่ผ่าน Claude)
  python3 scripts/pdf_statement_to_csv.py statement.pdf --dump-raw raw_text.txt

หลังจากได้ไฟล์ CSV แล้ว:
  1. เปิดตรวจสอบ/แก้ไข Category, Kind ที่ auto-guess ผิด ด้วยตัวเอง (Excel/Numbers/text editor)
  2. ใช้ scripts/reconcile_statement.py เทียบกับ DB ต่อได้เลย (ไฟล์ CSV นี้ไม่มีข้อมูล
     บุคคลที่ 3 มากกว่าที่ statement ต้นฉบับมีอยู่แล้ว — เป็นแค่การแปลงรูปแบบ)

หมายเหตุ: สคริปต์นี้เดารูปแบบทั่วไปของ statement ไทย (วันที่ + รายละเอียด + จำนวนเงิน
ต่อบรรทัด) ถ้า parse ผิดเยอะ ให้ใช้ --dump-raw ดูข้อความดิบเอง แล้วบอกผมแค่ "รูปแบบ"
ที่ผิด (เช่น "วันที่เป็น DD-MM-YY ไม่ใช่ DD/MM/YYYY", "จำนวนเงินอยู่คนละคอลัมน์กับ
รายละเอียด") โดยไม่ต้องบอกตัวเลข/ชื่อจริงในนั้น ผมจะแก้ regex ให้แบบไม่เห็นข้อมูลจริง
"""
from __future__ import annotations

import argparse
import csv
import re
import sys
from typing import List, Optional

try:
    import pdfplumber
except ImportError:
    print("ต้องติดตั้งก่อน: pip install pdfplumber")
    sys.exit(1)


DATE_RE = re.compile(r"\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b")
AMOUNT_RE = re.compile(r"(-?[\d,]+\.\d{2})\s*$")

# คำที่มักบ่งว่าเป็นเงินเข้า/refund มากกว่ารายจ่ายปกติ (ปรับเพิ่มได้ตามที่เจอ)
INCOME_HINTS = ("payment received", "refund", "เงินเข้า", "รับเงิน", "cashback", "transfer to flexi")


def normalize_date(raw: str) -> str | None:
    raw = raw.replace("-", "/")
    parts = raw.split("/")
    if len(parts) != 3:
        return None
    d, m, y = parts
    if len(y) == 2:
        y = "25" + y if int(y) < 50 else "19" + y  # เดา พ.ศ./ค.ศ. คร่าวๆ ปรับได้
    try:
        return f"{d.zfill(2)}/{m.zfill(2)}/{y}"
    except Exception:
        return None


def extract_lines(pdf_path: str) -> list[str]:
    lines: list[str] = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            lines.extend(text.splitlines())
    return lines


def parse_line(line: str):
    """คืน (date, description, amount) ถ้าบรรทัดนี้ดูเหมือนรายการธุรกรรม ไม่งั้นคืน None"""
    date_match = DATE_RE.search(line)
    amount_match = AMOUNT_RE.search(line)
    if not date_match or not amount_match:
        return None
    date = normalize_date(date_match.group(1))
    if not date:
        return None
    amount_raw = amount_match.group(1).replace(",", "")
    try:
        amount = float(amount_raw)
    except ValueError:
        return None
    if amount == 0:
        return None
    # description = ข้อความระหว่างวันที่กับจำนวนเงิน
    start = date_match.end()
    end = amount_match.start()
    desc = line[start:end].strip(" .-|:")
    if not desc:
        return None
    return date, desc, amount


def guess_kind(desc: str, amount: float) -> str:
    lowered = desc.lower()
    if amount < 0 or any(h in lowered for h in INCOME_HINTS):
        return "income"
    return "expense"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf_path")
    ap.add_argument("--account", default="", help='ชื่อบัญชี/บัตร (ต้องตรงกับใน DB เช่น "KTC")')
    ap.add_argument("--out", default=None, help="ไฟล์ CSV ผลลัพธ์")
    ap.add_argument("--preview", type=int, default=0, help="แสดงตัวอย่าง N แถวแรกในเทอร์มินัล ไม่เขียนไฟล์")
    ap.add_argument("--dump-raw", default=None, help="เขียนข้อความดิบทั้งหมดจาก PDF ลงไฟล์นี้ (ดูเองในเครื่อง)")
    args = ap.parse_args()

    lines = extract_lines(args.pdf_path)

    if args.dump_raw:
        with open(args.dump_raw, "w", encoding="utf-8") as f:
            f.write("\n".join(lines))
        print(f"เขียนข้อความดิบ {len(lines)} บรรทัด ไปที่ {args.dump_raw} แล้ว (เปิดดูเองในเครื่อง)")
        return

    parsed = []
    skipped = 0
    for line in lines:
        result = parse_line(line)
        if result:
            date, desc, amount = result
            kind = guess_kind(desc, amount)
            parsed.append((date, kind, abs(amount), desc))
        else:
            skipped += 1

    print(f"parse ได้ {len(parsed)} แถว, ข้าม {skipped} บรรทัดที่ไม่เข้ารูปแบบ")

    if args.preview:
        print(f"\nตัวอย่าง {min(args.preview, len(parsed))} แถวแรก:")
        for date, kind, amount, desc in parsed[: args.preview]:
            print(f"  {date}  {kind:8s}  {amount:>10,.2f}  {desc[:60]}")
        if not args.out:
            return

    if not args.out:
        print("ไม่ได้ระบุ --out และไม่ได้ใช้ --preview จึงไม่เขียนไฟล์ (ใส่ --out ไฟล์.csv เพื่อบันทึก)")
        return

    with open(args.out, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(
            ["Date", "Kind", "Amount", "Category", "Account or card",
             "To account or card", "Note", "Details", "Owner"]
        )
        for date, kind, amount, desc in parsed:
            writer.writerow([date, kind, amount, "", args.account, "", desc, "", ""])

    print(f"เขียน {len(parsed)} แถว ไปที่ {args.out} แล้ว")
    print("ขั้นตอนถัดไป: เปิดไฟล์นี้ ใส่ Category ให้แต่ละแถว (Kind/Account ก็ตรวจสอบซ้ำอีกที)")


if __name__ == "__main__":
    main()
