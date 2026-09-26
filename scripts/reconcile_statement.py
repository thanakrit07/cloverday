#!/usr/bin/env python3
"""
เทียบไฟล์ statement (CSV รูปแบบเดียวกับที่ใช้ import) กับข้อมูลจริงในฐานข้อมูล
รันเองในเครื่อง ไม่ส่งข้อมูลผ่าน Claude หรือ cloud ใดๆ ทั้งสิ้น

การใช้งาน:
  export SUPABASE_DB_URL="postgresql://postgres:[PASSWORD]@db.<ref>.supabase.co:5432/postgres"
  python3 scripts/reconcile_statement.py path/to/statement.csv [--household "Our household"]

ต้องมี psql อยู่ใน PATH (มีติดตั้งอยู่แล้วถ้าเคยใช้ Supabase CLI / Postgres.app)
หา connection string ได้จาก Supabase Dashboard > Project Settings > Database > Connection string (URI)
"""
import argparse
import csv
import json
import os
import subprocess
import sys
from collections import Counter
from datetime import datetime


def psql_json(db_url: str, query: str):
    """รัน query ผ่าน psql แล้วคืนผลลัพธ์เป็น list ของ dict (ผ่าน row_to_json)"""
    wrapped = f"SELECT coalesce(json_agg(t), '[]') FROM ({query}) t"
    result = subprocess.run(
        ["psql", db_url, "-t", "-A", "-c", wrapped],
        capture_output=True, text=True, check=True,
    )
    return json.loads(result.stdout.strip() or "[]")


def to_date(d: str) -> str:
    return datetime.strptime(d.strip(), "%d/%m/%Y").strftime("%Y-%m-%d")


def norm_amount(a) -> str:
    return f"{float(a):.2f}"


def build_lookup(rows, name_field="name"):
    return {r[name_field]: r["id"] for r in rows}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("csv_path")
    ap.add_argument("--household", default="Our household")
    args = ap.parse_args()

    db_url = os.environ.get("SUPABASE_DB_URL")
    if not db_url:
        print("ตั้งค่า SUPABASE_DB_URL ก่อน (ดู connection string ใน Supabase Dashboard)")
        sys.exit(1)

    # --- โหลด reference data จาก DB ---
    households = psql_json(db_url, "select id, name from households")
    hh = next((h for h in households if h["name"] == args.household), None)
    if not hh:
        print(f"ไม่พบ household ชื่อ '{args.household}'")
        sys.exit(1)
    household_id = hh["id"]

    accounts = psql_json(db_url, f"select id, name from accounts where household_id = '{household_id}'")
    cards = psql_json(db_url, f"select id, name from cards where household_id = '{household_id}'")
    categories = psql_json(
        db_url,
        f"select id, name, kind from categories where household_id = '{household_id}' and archived = false",
    )

    accounts_by_name = build_lookup(accounts)
    cards_by_name = build_lookup(cards)
    cats_expense = {c["name"]: c["id"] for c in categories if c["kind"] == "expense"}
    cats_income = {c["name"]: c["id"] for c in categories if c["kind"] == "income"}

    def account_ref(name):
        if name in accounts_by_name:
            return accounts_by_name[name], None
        if name in cards_by_name:
            return None, cards_by_name[name]
        raise ValueError(f"ไม่รู้จักบัญชี/บัตรชื่อ '{name}' (ไม่มีใน DB)")

    # --- อ่าน CSV และแปลงเป็น key เดียวกับที่ใช้ตอน import ---
    with open(args.csv_path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    csv_keys = []
    errors = []
    for i, row in enumerate(rows, start=2):  # แถวที่ 1 คือ header
        try:
            date = to_date(row["Date"])
            kind = row["Kind"]
            amount = norm_amount(row["Amount"])
            note = row.get("Note") or ""
            details = row.get("Details") or ""

            if kind == "transfer":
                fa, fc = account_ref(row["Account or card"])
                ta, tc = account_ref(row["To account or card"])
            else:
                cats = cats_expense if kind == "expense" else cats_income
                cat_name = row["Category"]
                if cat_name not in cats:
                    raise ValueError(f"ไม่รู้จักหมวดหมู่ '{cat_name}' (kind={kind})")
                fa, fc = account_ref(row["Account or card"])
                ta, tc = None, None

            csv_keys.append((date, kind, amount, note, details, fa, fc, ta, tc))
        except Exception as e:
            errors.append(f"  แถว {i}: {e}")

    if errors:
        print(f"⚠️  พบปัญหาในการอ่าน CSV {len(errors)} แถว (ข้ามไปก่อน):")
        print("\n".join(errors[:20]))
        if len(errors) > 20:
            print(f"  ... และอีก {len(errors) - 20} แถว")

    # --- โหลด transactions จริงจาก DB (เฉพาะที่ import มา) ---
    db_rows = psql_json(
        db_url,
        f"""select date::text, kind, amount,
                   coalesce(note, '') as note,
                   coalesce(description, '') as description,
                   from_account_id, from_card_id, to_account_id, to_card_id
            from transactions
            where household_id = '{household_id}' and source = 'import'""",
    )

    db_keys = []
    for r in db_rows:
        db_keys.append((
            r["date"], r["kind"], norm_amount(r["amount"]), r["note"], r["description"],
            r.get("from_account_id"), r.get("from_card_id"),
            r.get("to_account_id"), r.get("to_card_id"),
        ))

    csv_c = Counter(csv_keys)
    db_c = Counter(db_keys)
    missing_in_db = csv_c - db_c   # อยู่ใน statement แต่ไม่อยู่ใน DB
    extra_in_db = db_c - csv_c     # อยู่ใน DB แต่ไม่อยู่ใน statement (หรือมากกว่าที่ statement มี)

    print(f"\nCSV ทั้งหมด: {len(csv_keys)} แถว | DB (source=import): {len(db_keys)} แถว")
    print(f"ตรงกันสมบูรณ์: {len(csv_keys) - sum(missing_in_db.values())} แถว")

    if not missing_in_db and not extra_in_db:
        print("✅ ตรงกันทุกรายการ ไม่มีส่วนต่าง")
        return

    if missing_in_db:
        print(f"\n❌ อยู่ใน statement แต่หาไม่เจอ/ไม่ครบใน DB ({sum(missing_in_db.values())} รายการ):")
        for key, cnt in missing_in_db.items():
            date, kind, amount, note, details, *_ = key
            print(f"  x{cnt}  {date}  {kind:8s}  {amount:>10}  {note[:50]}")

    if extra_in_db:
        print(f"\n⚠️  อยู่ใน DB แต่ไม่ตรงกับ statement ({sum(extra_in_db.values())} รายการ):")
        for key, cnt in extra_in_db.items():
            date, kind, amount, note, details, *_ = key
            print(f"  x{cnt}  {date}  {kind:8s}  {amount:>10}  {note[:50]}")


if __name__ == "__main__":
    main()
