#!/usr/bin/env python3
"""
Mask/unmask ข้อมูลบุคคล (ชื่อคน, เลขบัญชี/เลขบัตร) ใน statement PDF
เพื่อให้ส่งข้อความที่เหลือไปให้ Claude ช่วย parse/เดา category ได้
โดยไม่มีชื่อ-เลขบัญชีของใครหลุดออกจากเครื่องคุณ

ขั้นตอนการใช้งาน (รองรับหลายไฟล์พร้อมกัน):

  1) mask (รันในเครื่อง — mapping file ห้ามส่งให้ใคร):
     npm run statements:mask
     (= python3 scripts/pdf_statement_mask.py mask statements/raw/statements/*.pdf)

     ชื่อเจ้าของ statement อ่านจาก env STATEMENT_OWNER_NAME หรือ
     statements/raw/owner_name.txt — ถ้าไม่มีจะถามครั้งแรกแล้วจำไว้ในไฟล์นั้น

     รันซ้ำได้เรื่อยๆ — ไฟล์ที่เนื้อหาไม่เปลี่ยนจะถูกข้าม (ไม่ mask ซ้ำ)
     ถ้าอยากบังคับ mask ใหม่ทั้งหมด ใส่ --force

  2) เปิดไฟล์ .txt ใน statements/staging/masked/ ตรวจสอบเองก่อนว่าไม่มีชื่อ/
     เลขบัญชีหลุดเหลือ (ถ้าเจอหลุด ใช้ --extra-name "ชื่อที่หลุด" เพิ่มได้ แล้ว
     รันใหม่ด้วย --force เฉพาะไฟล์นั้น)

  3) เอาเนื้อหาไฟล์ .txt ไปให้ Claude ช่วยแปลงเป็นตาราง/CSV
     (วางในแชท หรือให้ Claude อ่านไฟล์ .txt ตรงๆ ก็ได้ เพราะ mask แล้ว)

  4) เอาผลลัพธ์ (CSV ที่ยังมี placeholder แบบ ⟦P3⟧ ปนอยู่) มา unmask กลับ:
     npm run statements:unmask   (หรือ npm run statements:import เพื่อ unmask + import เลย)

  mask_map.json คือกุญแจแปลงกลับ — เก็บไว้ในเครื่อง อย่า commit เข้า git,
  อย่าส่งให้ Claude หรือที่ใดๆ ใช้ไฟล์เดียวกันได้ทุก statement (ชื่อคนเดิม
  จะได้ placeholder เลขเดิมทุกไฟล์)
"""
from __future__ import annotations

import argparse
import getpass
import hashlib
import json
import os
import re
import sys
from typing import Dict, List

try:
    import pdfplumber
except ImportError:
    pdfplumber = None

PLACEHOLDER_RE = re.compile(r"⟦P(\d+)⟧")

# คำนำหน้าชื่อที่ใช้จับชื่อบุคคลที่ 3 ในบรรทัด statement
HONORIFICS = [
    "นาย", "นาง", "นางสาว", "น.ส.", "ด.ช.", "ด.ญ.", "ว่าที่ ร.ต.", "ว่าที่ ร.ต. หญิง",
    "Mr.", "Mrs.", "Ms.", "Miss", "MR.", "MRS.", "MS.",
]

# ชื่อหลังคำนำหน้า: ตัวอักษรไทย/อังกฤษ, จุด, เว้นวรรคได้ไม่กี่คำ ก่อนเจอตัวเลข/วงเล็บ/สิ้นบรรทัด
NAME_TAIL = r"[ก-๙A-Za-z\.]+(?:\s+[ก-๙A-Za-z\.]+){0,3}"

# เลขบัญชี/บัตร: ตัวเลขติดกัน 8 หลักขึ้นไป (เว้นวรรค/ขีดคั่นได้)
ACCOUNT_RE = re.compile(r"\b(?:\d[\s-]?){8,}\b")


class Masker:
    def __init__(self):
        self.map: Dict[str, str] = {}   # placeholder -> original
        self.reverse: Dict[str, str] = {}  # original -> placeholder
        self.counter = 0
        self.processed_files: Dict[str, str] = {}  # pdf_path -> sha256

    def _placeholder_for(self, original: str) -> str:
        original = original.strip()
        if original in self.reverse:
            return self.reverse[original]
        self.counter += 1
        ph = f"⟦P{self.counter}⟧"
        self.map[ph] = original
        self.reverse[original] = ph
        return ph

    def mask_owner_name(self, text: str, owner_name: str) -> str:
        owner_name = owner_name.strip()
        if not owner_name:
            return text
        ph = self._placeholder_for(owner_name)
        text = re.sub(re.escape(owner_name), ph, text, flags=re.IGNORECASE)
        # mask แต่ละท่อนของชื่อด้วย (กันกรณีตัดคำ เช่นโชว์แค่ชื่อหรือแค่นามสกุล)
        for token in owner_name.split():
            if len(token) >= 3:
                token_ph = self._placeholder_for(token)
                text = re.sub(r"(?<![ก-๙A-Za-z])" + re.escape(token) + r"(?![ก-๙A-Za-z])",
                               token_ph, text)
        return text

    def mask_extra_names(self, text: str, names: List[str]) -> str:
        for name in names:
            name = name.strip()
            if not name:
                continue
            ph = self._placeholder_for(name)
            text = re.sub(re.escape(name), ph, text, flags=re.IGNORECASE)
        return text

    def mask_honorific_names(self, text: str) -> str:
        for h in sorted(HONORIFICS, key=len, reverse=True):
            pattern = re.compile(re.escape(h) + r"\s*(" + NAME_TAIL + r")")

            def repl(m):
                full = m.group(0)
                ph = self._placeholder_for(full)
                return ph

            text = pattern.sub(repl, text)
        return text

    def mask_accounts(self, text: str) -> str:
        def repl(m):
            digits = re.sub(r"[\s-]", "", m.group(0))
            ph = self._placeholder_for(digits)
            return ph

        return ACCOUNT_RE.sub(repl, text)

    def save(self, path: str):
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"map": self.map, "processed_files": self.processed_files},
                       f, ensure_ascii=False, indent=2)

    def load(self, path: str):
        if not os.path.exists(path):
            return
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        # รองรับไฟล์ map แบบเก่า (ก่อนมี processed_files) ด้วย
        self.map = data.get("map", data if "processed_files" not in data else {})
        self.processed_files = data.get("processed_files", {})
        self.reverse = {v: k for k, v in self.map.items()}
        nums = [int(k[2:-1]) for k in self.map if k.startswith("⟦P") and k.endswith("⟧")]
        self.counter = max(nums) if nums else 0


def file_hash(path: str) -> str:
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def open_pdf(pdf_path: str, password):
    try:
        pdf_ctx = pdfplumber.open(pdf_path, password=password)
        pdf_ctx.pages  # เข้าถึงจริงเพื่อบังคับให้ decrypt error โผล่ตอนนี้ ถ้าจะเกิด
        return pdf_ctx
    except Exception:
        # ไม่พึ่งข้อความ error (บาง backend คืนข้อความว่างเปล่า) — ลองถามรหัสแล้วเปิดใหม่แทน
        password = getpass.getpass(
            f"เปิด {os.path.basename(pdf_path)} ไม่ได้ (อาจมีรหัสผ่าน) "
            "กรุณาใส่รหัส (พิมพ์แล้วไม่แสดงบนจอ): "
        )
        pdf_ctx = pdfplumber.open(pdf_path, password=password)
        pdf_ctx.pages
        return pdf_ctx


def resolve_owner_name(raw_dir: str) -> str:
    """ชื่อเจ้าของ statement: env STATEMENT_OWNER_NAME → <raw_dir>/owner_name.txt →
    ถามครั้งแรกแล้วจำไว้ในไฟล์นั้น (อยู่ใน statements/raw ซึ่ง gitignore ไว้แล้ว)
    จะได้ไม่ต้องพิมพ์ชื่อลง package.json หรือ shell history"""
    name = os.environ.get("STATEMENT_OWNER_NAME", "").strip()
    if name:
        return name
    path = os.path.join(raw_dir or ".", "owner_name.txt")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return f.read().strip()
    if not sys.stdin.isatty():
        return ""
    name = input("ชื่อ-นามสกุลเจ้าของ statement (ถามครั้งเดียว จะจำไว้ใน " + path + "): ").strip()
    if name:
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(name + "\n")
    return name


def cmd_mask(args):
    if pdfplumber is None:
        print("ต้องติดตั้งก่อน: pip install pdfplumber")
        sys.exit(1)

    os.makedirs(args.outdir, exist_ok=True)

    masker = Masker()
    masker.load(args.map)

    args.owner_name = args.owner_name or resolve_owner_name(os.path.dirname(args.map))

    total_new = 0
    for pdf_path in args.pdf_path:
        h = file_hash(pdf_path)
        prev = masker.processed_files.get(pdf_path)
        out_name = os.path.splitext(os.path.basename(pdf_path))[0] + ".txt"
        out_path = os.path.join(args.outdir, out_name)

        if prev == h and os.path.exists(out_path) and not args.force:
            print(f"⏭  {pdf_path} — ไม่เปลี่ยนแปลง ข้าม (ใช้ --force ถ้าอยากทำใหม่)")
            continue

        pdf_ctx = open_pdf(pdf_path, args.password)
        lines = []
        with pdf_ctx as pdf:
            for page in pdf.pages:
                text = page.extract_text() or ""
                lines.extend(text.splitlines())
        text = "\n".join(lines)

        if args.owner_name:
            text = masker.mask_owner_name(text, args.owner_name)
        if args.extra_name:
            text = masker.mask_extra_names(text, args.extra_name)
        text = masker.mask_honorific_names(text)
        text = masker.mask_accounts(text)

        with open(out_path, "w", encoding="utf-8") as f:
            f.write(text)
        masker.processed_files[pdf_path] = h
        masker.save(args.map)  # save ทุกไฟล์ กันไฟดับ/ctrl-c กลางทาง

        print(f"✅ {pdf_path} → {out_path}")
        total_new += 1

    print(f"\nเสร็จ: mask ใหม่ {total_new} ไฟล์ (map รวม {masker.counter} entries ที่ {args.map})")
    print("→ เปิดไฟล์ .txt ใน " + args.outdir + " ตรวจสอบเองก่อนว่าไม่มีชื่อ/เลขบัญชีหลุดเหลืออยู่")
    print("→ " + args.map + " ห้ามส่งให้ใคร เก็บไว้ในเครื่องเท่านั้น")


def cmd_unmask(args):
    with open(args.map, encoding="utf-8") as f:
        data = json.load(f)
    mapping = data.get("map", data)  # รองรับไฟล์ map แบบเก่าด้วย

    with open(args.in_path, encoding="utf-8") as f:
        content = f.read()

    missing = set()

    def repl(m):
        ph = m.group(0)
        if ph in mapping:
            return mapping[ph]
        missing.add(ph)
        return ph

    result = PLACEHOLDER_RE.sub(repl, content)

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        f.write(result)

    print(f"unmask เสร็จ เขียนไปที่ {args.out}")
    if missing:
        print(f"⚠️  พบ placeholder {len(missing)} ตัวที่ไม่มีใน map file (แปลว่า mapping "
              f"ไม่ตรงชุด หรือ Claude พิมพ์ placeholder ผิด): {sorted(missing)}")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)

    m = sub.add_parser("mask", help="แปลง PDF (ไฟล์เดียวหรือหลายไฟล์) เป็นข้อความที่ mask แล้ว")
    m.add_argument("pdf_path", nargs="+", help="ไฟล์ PDF หนึ่งไฟล์ขึ้นไป (ใส่ wildcard เช่น *.pdf ได้)")
    m.add_argument("--owner-name", default="", help="ชื่อ-นามสกุลเจ้าของ statement")
    m.add_argument("--extra-name", action="append", default=[],
                    help="ชื่อเพิ่มเติมที่อยากบังคับ mask (ใส่ซ้ำได้หลายครั้ง)")
    m.add_argument("--outdir", default="statements/staging/masked",
                    help="โฟลเดอร์เก็บไฟล์ .txt ที่ mask แล้ว (ชื่อไฟล์ตาม PDF ต้นฉบับ)")
    m.add_argument("--map", default="statements/raw/mask_map.json")
    m.add_argument("--force", action="store_true",
                    help="mask ใหม่แม้ไฟล์จะไม่เปลี่ยนแปลง (ปกติจะข้ามไฟล์ที่ทำไปแล้ว)")
    m.add_argument("--password", default=None,
                    help="รหัสผ่าน PDF (ถ้าไม่ใส่และไฟล์ล็อกไว้ จะถามให้พิมพ์ตอนรันแทน "
                         "แนะนำให้ปล่อยว่างไว้ จะได้ไม่ค้างใน shell history)")
    m.set_defaults(func=cmd_mask)

    u = sub.add_parser("unmask", help="แปลง placeholder กลับเป็นข้อมูลจริง")
    u.add_argument("in_path", help="ไฟล์ผลลัพธ์จาก Claude ที่ยังมี placeholder ⟦Pn⟧")
    u.add_argument("--map", default="statements/raw/mask_map.json")
    u.add_argument("--out", default="statements/raw/final/transactions.csv")
    u.set_defaults(func=cmd_unmask)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
