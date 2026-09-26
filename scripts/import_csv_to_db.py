#!/usr/bin/env python3
"""
Import CSV (schema เดียวกับ wealth-prof-transactions.csv) เข้า Supabase DB
ตรงๆ ผ่าน psql — รันเองในเครื่องหลังตรวจสอบ statements/raw/final/transactions.csv
ด้วยตาแล้วเท่านั้น สคริปต์นี้ไม่ส่งข้อมูลผ่าน Claude หรือ cloud อื่นใดทั้งสิ้น

การใช้งาน:
  export SUPABASE_DB_URL="postgresql://postgres:[PASSWORD]@db.<ref>.supabase.co:5432/postgres"
  python3 scripts/import_csv_to_db.py statements/raw/final/transactions.csv \\
      --household "Our household"

  # ดูตัวอย่างว่าจะ insert อะไรบ้างก่อน โดยไม่เขียนจริง
  python3 scripts/import_csv_to_db.py statements/raw/final/transactions.csv --dry-run
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import subprocess
import sys
from collections import defaultdict
from datetime import date as Date, datetime
from decimal import Decimal


def psql_json(db_url: str, query: str):
    wrapped = f"SELECT coalesce(json_agg(t), '[]') FROM ({query}) t"
    result = subprocess.run(
        ["psql", db_url, "-t", "-A", "-c", wrapped],
        capture_output=True, text=True, check=True,
    )
    return json.loads(result.stdout.strip() or "[]")


def psql_exec(db_url: str, sql: str):
    subprocess.run(["psql", db_url, "-c", sql], check=True, capture_output=True, text=True)


def load_env_file(path: str = ".env.local"):
    """อ่าน KEY=VALUE จาก .env.local (gitignore ไว้แล้ว) ถ้ายังไม่ได้ export ใน shell"""
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


MATCH_WINDOW_DAYS = 3


class ExistingTransactions:
    """รายการที่มีใน DB แล้ว ใช้กัน import ซ้ำ

    statement แต่ละแหล่งลงวันที่ต่างกันได้ (วันรูดบัตร vs วันตัดยอด ห่างกัน 1–2 วัน)
    และคืนเงินเก็บเป็น income ยอดบวก ขณะที่ statement เป็นยอดติดลบ จึงจับคู่ด้วย
    บัญชี/บัตรเดียวกัน + ยอดเท่ากัน (ไม่สนเครื่องหมาย) + วันที่ห่างไม่เกิน ±3 วัน
    โดยไม่ดู kind/category/note (แก้ในแอปได้) — แถว DB แต่ละแถวจับคู่ได้ครั้งเดียว"""

    def __init__(self, rows):
        self.by_amount = defaultdict(list)
        for t in rows:
            refs = {t[k] for k in ("from_account_id", "from_card_id", "to_account_id", "to_card_id") if t[k]}
            self.by_amount[abs(Decimal(str(t["amount"])))].append(
                {"date": Date.fromisoformat(t["date"]), "refs": refs, "used": False})

    def claim(self, date: str, amount, refs: set) -> bool:
        d = Date.fromisoformat(date)
        best = None
        for t in self.by_amount.get(abs(Decimal(str(amount))), []):
            gap = abs((t["date"] - d).days)
            if t["used"] or gap > MATCH_WINDOW_DAYS or not refs <= t["refs"]:
                continue
            if best is None or gap < best[0]:
                best = (gap, t)
        if best is None:
            return False
        best[1]["used"] = True
        return True


def to_date(d: str) -> str:
    return datetime.strptime(d.strip(), "%d/%m/%Y").strftime("%Y-%m-%d")


def sql_str(s):
    if s is None or s == "":
        return "NULL"
    return "'" + str(s).replace("'", "''") + "'"


def sql_str_notnull(s):
    s = s or ""
    return "'" + str(s).replace("'", "''") + "'"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("csv_path")
    ap.add_argument("--household", default="Our household")
    ap.add_argument("--source", default="import", help="ค่า source column (default: import)")
    ap.add_argument("--dry-run", action="store_true", help="แสดง SQL ที่จะรัน โดยไม่เขียนจริง")
    ap.add_argument("--allow-duplicates", action="store_true",
                    help="ไม่ต้องข้ามรายการที่ดูเหมือนมีใน DB แล้ว (ปกติจะข้าม)")
    args = ap.parse_args()

    load_env_file()
    db_url = os.environ.get("SUPABASE_DB_URL")
    if not db_url:
        print("ตั้งค่า SUPABASE_DB_URL ก่อน (ใส่บรรทัด SUPABASE_DB_URL=postgresql://... ใน .env.local)")
        sys.exit(1)

    households = psql_json(db_url, "select id, name from households")
    hh = next((h for h in households if h["name"] == args.household), None)
    if not hh:
        print(f"ไม่พบ household ชื่อ '{args.household}'")
        sys.exit(1)
    household_id = hh["id"]

    accounts = {a["name"]: a["id"] for a in
                psql_json(db_url, f"select id, name from accounts where household_id = '{household_id}'")}
    cards = {c["name"]: c["id"] for c in
             psql_json(db_url, f"select id, name from cards where household_id = '{household_id}'")}
    cats = psql_json(
        db_url,
        f"select id, name, kind from categories where household_id = '{household_id}' and archived = false",
    )
    cats_expense = {c["name"]: c["id"] for c in cats if c["kind"] == "expense"}
    cats_income = {c["name"]: c["id"] for c in cats if c["kind"] == "income"}

    def account_id(name):
        if name in accounts:
            return accounts[name], None
        if name in cards:
            return None, cards[name]
        raise ValueError(f"ไม่รู้จักบัญชี/บัตรชื่อ '{name}'")

    def account_id_or_none(name):
        try:
            return account_id(name)
        except ValueError:
            return None, None

    def account_ref(name):
        acc, card = account_id(name)
        return sql_str(acc), sql_str(card)

    with open(args.csv_path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    existing = ExistingTransactions([])
    dates = [to_date(r["Date"]) for r in rows if r.get("Date")]
    if dates and not args.allow_duplicates:
        existing = ExistingTransactions(psql_json(
            db_url,
            "select date::text as date, amount, from_account_id, from_card_id, "
            "to_account_id, to_card_id from transactions "
            f"where household_id = '{household_id}' "
            f"and date between date '{min(dates)}' - {MATCH_WINDOW_DAYS} "
            f"and date '{max(dates)}' + {MATCH_WINDOW_DAYS}",
        ))

    def known_refs(*names):
        return {i for n in names if n for i in account_id_or_none(n) if i}

    values = []
    errors = []
    skipped = 0
    for i, row in enumerate(rows, start=2):
        try:
            date = to_date(row["Date"])
            kind = row["Kind"]
            amount = row["Amount"]
            note = row.get("Note") or ""
            details = row.get("Details") or ""

            refs = known_refs(row["Account or card"],
                              row["To account or card"] if kind == "transfer" else None)
            if refs and existing.claim(date, amount, refs):
                skipped += 1
                continue

            if Decimal(amount) <= 0:
                raise ValueError(f"ยอด {amount} ติดลบ/ศูนย์ (คืนเงิน?) — DB รับแต่ยอดบวก "
                                 "ให้แก้เป็น kind=income ยอดบวก หรือบันทึกในแอปเอง")

            if kind == "transfer":
                cat_sql, cat_kind_sql = "NULL", "NULL"
                from_acc, from_card = account_ref(row["Account or card"])
                to_acc, to_card = account_ref(row["To account or card"])
            else:
                cats_map = cats_expense if kind == "expense" else cats_income
                cat_name = row["Category"]
                if cat_name not in cats_map:
                    raise ValueError(f"ไม่รู้จักหมวดหมู่ '{cat_name}' (kind={kind})")
                cat_sql = sql_str(cats_map[cat_name])
                cat_kind_sql = sql_str(kind)
                from_acc, from_card = account_ref(row["Account or card"])
                to_acc, to_card = "NULL", "NULL"

            values.append(
                f"({sql_str(household_id)}, {sql_str(date)}, {sql_str(kind)}, {cat_sql}, {cat_kind_sql}, "
                f"{sql_str_notnull(details)}, {amount}, {from_acc}, {from_card}, {to_acc}, {to_card}, "
                f"{sql_str(note)}, {sql_str(args.source)})"
            )
        except Exception as e:
            errors.append(f"  แถว {i}: {e}")

    if errors:
        print(f"⚠️  ข้าม {len(errors)} แถวเพราะมีปัญหา:")
        print("\n".join(errors[:30]))
        if len(errors) > 30:
            print(f"  ... และอีก {len(errors) - 30} แถว")
        print()

    if skipped:
        print(f"⏭  ข้าม {skipped} แถวที่มีใน DB อยู่แล้ว (ยอด+บัญชีตรง วันที่ห่างไม่เกิน {MATCH_WINDOW_DAYS} วัน)\n")

    if not values:
        print("ไม่มีแถวใหม่ที่ต้อง import")
        return

    cols = ("household_id, date, kind, category_id, category_kind, description, amount, "
            "from_account_id, from_card_id, to_account_id, to_card_id, note, source")
    batch_size = 150
    print(f"พร้อม import {len(values)} แถว (แบ่ง {(len(values) + batch_size - 1) // batch_size} batch)")

    if args.dry_run:
        print("\n--dry-run: ตัวอย่าง SQL ของ batch แรก:")
        print(f"INSERT INTO transactions ({cols})\nVALUES\n" + ",\n".join(values[:3]) + "\n...")
        return

    for i in range(0, len(values), batch_size):
        chunk = values[i:i + batch_size]
        sql = f"INSERT INTO transactions ({cols})\nVALUES\n" + ",\n".join(chunk) + ";"
        psql_exec(db_url, sql)
        print(f"  insert batch {i // batch_size + 1}: {len(chunk)} แถว ✅")

    print(f"\n✅ Import เสร็จ {len(values)} แถว")


if __name__ == "__main__":
    main()
