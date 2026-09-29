#!/usr/bin/env python3
"""
Mask/unmask ข้อมูลบุคคล (ชื่อคน, เลขบัญชี/เลขบัตร) ใน statement PDF
เพื่อให้ส่งข้อความที่เหลือไปให้ Claude ช่วย parse/เดา category ได้
โดยไม่มีชื่อ-เลขบัญชีของใครหลุดออกจากเครื่องคุณ

ขั้นตอนการใช้งาน (รองรับหลายไฟล์พร้อมกัน):

  1) mask (รันในเครื่อง — mapping file ห้ามส่งให้ใคร):
     npm run statements:mask
     (= python3 scripts/pdf_statement_mask.py mask statements/raw/statements/*.pdf)

     ชื่อเจ้าของ statement อ่านจาก statements/raw/owner_name.txt (บรรทัดละชื่อ
     เช่นชื่อไทยบรรทัดแรก ชื่ออังกฤษบรรทัดที่สอง — ชื่ออังกฤษโผล่ในรายการโอน
     ระหว่างบัญชีตัวเอง) หรือ env STATEMENT_OWNER_NAME (คั่นด้วย |)
     ถ้าไม่มีจะถามครั้งแรกแล้วจำไว้ในไฟล์นั้น

     รันซ้ำได้เรื่อยๆ — ไฟล์ที่เนื้อหาไม่เปลี่ยนจะถูกข้าม (ไม่ mask ซ้ำ)
     ถ้าอยากบังคับ mask ใหม่ทั้งหมด ใส่ --force

  2) เปิดไฟล์ .txt ใน statements/staging/masked/ ตรวจสอบเองก่อนว่าไม่มีชื่อ/
     เลขบัญชีหลุดเหลือ (ถ้าเจอหลุด ใช้ --extra-name "ชื่อที่หลุด" เพิ่มได้ แล้ว
     รันใหม่ด้วย --force เฉพาะไฟล์นั้น)

  3) เอาเนื้อหาไฟล์ .txt ไปให้ Claude ช่วยแปลงเป็นตาราง/CSV
     (วางในแชท หรือให้ Claude อ่านไฟล์ .txt ตรงๆ ก็ได้ เพราะ mask แล้ว)

  4) เอาผลลัพธ์ (CSV ที่ยังมี placeholder แบบ ⟦P3⟧ ปนอยู่) มา unmask กลับ:
     npm run statements:unmask   แล้ว import ผ่านหน้าตรวจ statement ในแอป (ADR-0019)

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
# ไม่นับสิ่งที่ขึ้นต้นเหมือนวันที่ — statement กสิกรขึ้นบรรทัดด้วย "01-04-26 10:01"
# ซึ่งวันที่+ชั่วโมงรวมกันได้ 8 หลัก เลยเคยถูก mask เป็นเลขบัญชีจนวันที่หายหมด
ACCOUNT_RE = re.compile(r"\b(?!\d{1,2}[-/]\d{1,2}[-/]\d{2,4}(?![\d/-]))\d(?:[\s-]?\d){7,}\b")

# รายการโอนของกสิกร: "โอนไป SCB X1234 <ชื่อ>" / "จาก BAY X1234 <ชื่อ>" — ทุกอย่าง
# หลังเลขบัญชีท้าย 4 ตัวคือชื่อคู่โอน (ไทยหรืออังกฤษ มีหรือไม่มีคำนำหน้าก็ได้
# และธนาคารมักตัดชื่อยาวให้สั้นแล้วต่อท้ายด้วย "++" จึงจับคู่กับชื่อเต็มไม่ได้)
# ธนาคารเดียวกัน (กสิกร→กสิกร) ไม่มีรหัสธนาคาร: "โอนไป X2123 <ชื่อ>" — รหัสธนาคารจึง optional
# นิติบุคคล (บจก./บมจ./หจก./บริษัท) ไม่ใช่ข้อมูลส่วนบุคคลและช่วยเดาหมวด จึงไม่ mask
TRANSFER_PARTY_RE = re.compile(r"((?:โอนไป|จาก)\s+(?:[A-Z]{2,6}\s+)?X\w{3,4}\s+)(?!บจก|บมจ|หจก|บริษัท)(\S.*?)\s*$", re.MULTILINE)
# ข้อความไทยที่ดึงจาก PDF มักทำวรรณยุกต์/การันต์หาย (ลาดพร้าว → ลาดพราว, ใจดี์ → ใจดี)
# และแยก ำ เป็น ํ+า — ชื่อที่จะ mask จึงต้องไม่บังคับให้มีเครื่องหมายเหล่านี้
THAI_MARKS = "\u0e47\u0e48\u0e49\u0e4a\u0e4b\u0e4c\u0e4d\u0e4e"


def flex_escape(s: str) -> str:
    out = []
    for c in s:
        if c in THAI_MARKS:
            out.append(re.escape(c) + "?")
        elif c == "\u0e33":  # ำ
            out.append("(?:\u0e33|\u0e4d\u0e32)")
        else:
            out.append(re.escape(c))
    return "".join(out)


# ที่อยู่ — ตาข่ายกันพลาดเผื่อ mask_terms.txt ไม่ครบ: บ้านเลขที่ตามด้วยชื่อไทย
# ("99/123 หมู่บ้าน...") และชื่อหลัง ซ./ซอย/ถ./ถนน ส่วนที่ไม่ใช่รูปวันที่เท่านั้น
# (ส่วนแรก > 31 หรือส่วนหลัง > 12) หรือมีคำว่า เลขที่ นำหน้า
HOUSE_NO_RE = re.compile(r"(?<![\d/⟧])(?:(?:บ้าน)?เลขที่[ \t]*)?(\d{1,5})/(\d{1,4})(?![\d/])"
                         r"(?=[ \t]+[ก-๙])((?:[ \t]+(?!ซ\.|ถ\.|ซอย|ถนน)[ก-๙][ก-๙.]*){0,2})")
STREET_RE = re.compile(r"(ซ\.|ซอย|ถ\.|ถนน)[ \t]*([ก-๙][ก-๙.]*(?:[ \t]*\d{1,3}(?![\d.,/]))?)")
PLACEHOLDER_ONLY_RE = re.compile(r"^(?:⟦P\d+⟧|[\s+.,:()/-])*$")



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
        full = r"\s+".join(flex_escape(t) for t in owner_name.split())
        text = re.sub(full, ph, text, flags=re.IGNORECASE)
        # mask แต่ละท่อนของชื่อด้วย (กันกรณีตัดคำ เช่นโชว์แค่ชื่อหรือแค่นามสกุล)
        for token in owner_name.split():
            if len(token) >= 3:
                token_ph = self._placeholder_for(token)
                text = re.sub(r"(?<![ก-๙A-Za-z])" + self._token_pattern(token) + r"(?![ก-๙A-Za-z])",
                               token_ph, text, flags=re.IGNORECASE)
        return text

    @staticmethod
    def _token_pattern(token: str) -> str:
        """ชื่อภาษาอังกฤษในรายการโอน ธนาคารมักตัดให้สั้น (เช่นนามสกุลเหลือ 5 ตัว)
        จึงให้ตรงกับทุก prefix ที่ยาว ≥ 4 ตัวอักษรด้วย (3 ตัวสั้นไป ชนคำทั่วไป
        เช่น JAI ใน JAI THAI RESTAURANT และ 3 ตัวก็แทบระบุตัวใครไม่ได้อยู่แล้ว) — ชื่อไทยไม่ทำ เพราะไทยไม่เว้นวรรค
        prefix สั้นๆ จะไปชนคำอื่นได้ง่าย"""
        if not re.fullmatch(r"[A-Za-z.\-']+", token):
            return flex_escape(token)
        pattern = ""
        for c in reversed(token[4:]):
            pattern = "(?:" + re.escape(c) + pattern + ")?"
        return re.escape(token[:4]) + pattern

    def mask_extra_names(self, text: str, names: List[str]) -> str:
        # ยาวก่อน — วลีเต็มต้องถูก mask ทั้งก้อนก่อนท่อนที่สั้นกว่า
        for name in sorted({n.strip() for n in names if n.strip()}, key=len, reverse=True):
            ph = self._placeholder_for(name)
            pattern = r"\s+".join(flex_escape(t) for t in name.split())
            text = re.sub(pattern, ph, text, flags=re.IGNORECASE)
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

    def mask_transfer_parties(self, text: str) -> str:
        def repl(m):
            party = m.group(2)
            if PLACEHOLDER_ONLY_RE.match(party):  # เป็นชื่อเราเองที่ mask ไปแล้ว
                return m.group(0)
            return m.group(1) + self._placeholder_for(party.rstrip("+ "))

        return TRANSFER_PARTY_RE.sub(repl, text)

    def mask_addresses(self, text: str) -> str:
        def house(m):
            a, b = int(m.group(1)), int(m.group(2))
            has_prefix = "เลขที่" in m.group(0)
            if not has_prefix and a <= 31 and b <= 12:  # หน้าตาเหมือนวันที่ (dd/mm)
                return m.group(0)
            return self._placeholder_for(m.group(0).strip())

        def street(m):
            return m.group(1) + " " + self._placeholder_for(m.group(2).strip())

        return STREET_RE.sub(street, HOUSE_NO_RE.sub(house, text))

    def mask_accounts(self, text: str) -> str:
        def repl(m):
            # "…7,310.20 01-04-26 10:34": a balance's cents run into a date — not an account number
            if re.search(r"(?<![\d-])\d{2}-\d{2}-\d{2}(?![\d-])", m.group(0)):
                return m.group(0)
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


def safe_stem(filename: str) -> str:
    stem = os.path.splitext(filename)[0]
    return re.sub(r"[_\-\s]*\d(?:[\s-]?\d){11,18}", "", stem).strip("_- ") or "statement"


def file_hash(path: str) -> str:
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def _try_open(pdf_path: str, password):
    try:
        pdf_ctx = pdfplumber.open(pdf_path, password=password)
        pdf_ctx.pages  # เข้าถึงจริงเพื่อบังคับให้ decrypt error โผล่ตอนนี้ ถ้าจะเกิด
        return pdf_ctx
    except Exception:
        # ไม่พึ่งข้อความ error (บาง backend คืนข้อความว่างเปล่า) — ถือว่าเปิดไม่ได้
        return None


def open_pdf(pdf_path: str, known_passwords: List[str]):
    """ลองไม่มีรหัส แล้วลองรหัสที่ใช้ได้มาแล้วในรอบนี้ (ธนาคารเดียวกันมักใช้รหัสเดียวกัน)
    ถ้ายังไม่ได้ค่อยถาม — ผิดก็ถามใหม่เรื่อยๆ กด Enter ว่างๆ เพื่อข้ามไฟล์นี้
    รหัสเก็บแค่ในหน่วยความจำระหว่างรันเท่านั้น ไม่เขียนลงไฟล์"""
    for password in [None, *known_passwords]:
        pdf_ctx = _try_open(pdf_path, password)
        if pdf_ctx is not None:
            return pdf_ctx
    name = os.path.basename(pdf_path)
    prompt = f"{name} มีรหัสผ่าน — ใส่รหัส (ไม่แสดงบนจอ, Enter ว่าง = ข้ามไฟล์นี้): "
    while True:
        password = getpass.getpass(prompt)
        if not password:
            return None
        pdf_ctx = _try_open(pdf_path, password)
        if pdf_ctx is not None:
            known_passwords.append(password)
            return pdf_ctx
        prompt = f"รหัสไม่ถูก — ลองใหม่สำหรับ {name} (Enter ว่าง = ข้าม): "


def resolve_owner_names(raw_dir: str) -> List[str]:
    """ชื่อเจ้าของ statement (ไทย และ/หรือ อังกฤษ): env STATEMENT_OWNER_NAME (คั่นด้วย |)
    → <raw_dir>/owner_name.txt (บรรทัดละชื่อ) → ถามครั้งแรกแล้วจำไว้ในไฟล์นั้น
    (อยู่ใน statements/raw ซึ่ง gitignore ไว้แล้ว) จะได้ไม่ต้องพิมพ์ชื่อลง
    package.json หรือ shell history"""
    env = os.environ.get("STATEMENT_OWNER_NAME", "")
    if env.strip():
        return [n.strip() for n in env.split("|") if n.strip()]
    path = os.path.join(raw_dir or ".", "owner_name.txt")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return [line.strip() for line in f if line.strip()]
    if not sys.stdin.isatty():
        return []
    print("ถามครั้งเดียว จะจำไว้ใน " + path + " (แก้/เพิ่มชื่อทีหลังได้ บรรทัดละชื่อ)")
    names = [
        input("ชื่อ-นามสกุลภาษาไทย: ").strip(),
        input("ชื่อ-นามสกุลภาษาอังกฤษ (ไม่มีกด Enter ข้าม): ").strip(),
    ]
    names = [n for n in names if n]
    if names:
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(names) + "\n")
    return names


def cmd_mask(args):
    if pdfplumber is None:
        print("ต้องติดตั้งก่อน: pip install pdfplumber")
        sys.exit(1)

    os.makedirs(args.outdir, exist_ok=True)

    masker = Masker()
    masker.load(args.map)

    owner_names = args.owner_name or resolve_owner_names(os.path.dirname(args.map))
    # คำอื่นที่ต้อง mask เสมอ (เช่นท่อนของที่อยู่) — บรรทัดละคำ/วลี, # คือคอมเมนต์
    terms_path = os.path.join(os.path.dirname(args.map) or ".", "mask_terms.txt")
    extra_names = list(args.extra_name)
    if os.path.exists(terms_path):
        with open(terms_path, encoding="utf-8") as f:
            extra_names += [line.strip() for line in f if line.strip() and not line.startswith("#")]
    # ชื่อยาวก่อน — ชื่อเต็มต้องถูก mask ทั้งก้อนก่อนที่ท่อนสั้นกว่าจะไปแทนที่บางส่วน
    owner_names = sorted(owner_names, key=len, reverse=True)

    total_new = 0
    known_passwords: List[str] = [args.password] if args.password else []
    for pdf_path in args.pdf_path:
        h = file_hash(pdf_path)
        prev = masker.processed_files.get(pdf_path)
        # ชื่อไฟล์ของบางธนาคารมีเลขบัตรเต็ม (KTC_202601_<16 หลัก>.pdf) — ไม่ให้ติดไปกับไฟล์ที่ mask แล้ว
        out_name = safe_stem(os.path.basename(pdf_path)) + ".txt"
        out_path = os.path.join(args.outdir, out_name)

        if prev == h and os.path.exists(out_path) and not args.force:
            print(f"⏭  {pdf_path} — ไม่เปลี่ยนแปลง ข้าม (ใช้ --force ถ้าอยากทำใหม่)")
            continue

        pdf_ctx = open_pdf(pdf_path, known_passwords)
        if pdf_ctx is None:
            print(f"⏭  {pdf_path} — ข้าม (ไม่ได้ใส่รหัส)")
            continue
        lines = []
        with pdf_ctx as pdf:
            for page in pdf.pages:
                text = page.extract_text() or ""
                lines.extend(text.splitlines())
        text = "\n".join(lines)

        for owner_name in owner_names:
            text = masker.mask_owner_name(text, owner_name)
        if extra_names:
            text = masker.mask_extra_names(text, extra_names)
        text = masker.mask_transfer_parties(text)
        text = masker.mask_honorific_names(text)
        text = masker.mask_addresses(text)
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

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    if args.in_path.lower().endswith(".csv"):
        # ทีละช่อง ไม่ใช่ทั้งไฟล์ — ค่าจริงอาจมี , หรือ " ซึ่งถ้าแทนที่ดิบๆ จะทำให้คอลัมน์เลื่อน
        import csv, io
        rows = [[PLACEHOLDER_RE.sub(repl, cell) for cell in row] for row in csv.reader(io.StringIO(content))]
        with open(args.out, "w", encoding="utf-8", newline="") as f:
            csv.writer(f).writerows(rows)
    else:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(PLACEHOLDER_RE.sub(repl, content))

    print(f"unmask เสร็จ เขียนไปที่ {args.out}")
    if missing:
        print(f"⚠️  พบ placeholder {len(missing)} ตัวที่ไม่มีใน map file (แปลว่า mapping "
              f"ไม่ตรงชุด หรือ Claude พิมพ์ placeholder ผิด): {sorted(missing)}")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)

    m = sub.add_parser("mask", help="แปลง PDF (ไฟล์เดียวหรือหลายไฟล์) เป็นข้อความที่ mask แล้ว")
    m.add_argument("pdf_path", nargs="+", help="ไฟล์ PDF หนึ่งไฟล์ขึ้นไป (ใส่ wildcard เช่น *.pdf ได้)")
    m.add_argument("--owner-name", action="append", default=[],
                    help="ชื่อ-นามสกุลเจ้าของ statement (ใส่ซ้ำได้ เช่นชื่อไทยกับชื่ออังกฤษ)")
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
