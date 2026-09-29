---
name: statement-import
description: "Use when the user wants to process masked bank/card statement text files in statements/staging/masked/ into a staged transactions CSV -- e.g. \"import statement ใหม่\", \"process masked statements\", \"อัปเดต staged.csv\", or after they've run `npm run statements:mask` on new PDFs. Step 2 of 3: this skill only stages the CSV -- the user unmasks it and imports it through the app's statement review screen (ADR-0019)."
---

# Statement import (privacy-safe pipeline)

แปลง statement PDF → รายการธุรกรรมพร้อม import โดยที่ **ชื่อบุคคล/เลขบัญชีไม่หลุด
ไปให้ Claude เห็นเลย** ไฟล์ PDF ต้นฉบับและ `mask_map.json` อยู่ใน `statements/raw/`
ซึ่งถูก deny ไว้ใน `.claude/settings.json` — ห้ามพยายามอ่านหรือแตะโฟลเดอร์นั้น
ไม่ว่าด้วยเครื่องมือใด ทุกอย่างที่ Claude ทำในสกิลนี้อยู่นอกโฟลเดอร์นั้นทั้งหมด

## โครงสร้างที่เกี่ยวข้อง

```
statements/raw/                    ← ห้ามแตะ (denyไว้แล้ว)
  statements/*.pdf
  mask_map.json
  owner_name.txt                  ← ชื่อเจ้าของ ไทย/อังกฤษ บรรทัดละชื่อ (ผู้ใช้แก้เอง)
  mask_terms.txt                  ← คำอื่นที่ต้อง mask เสมอ เช่นท่อนของที่อยู่ (ผู้ใช้แก้เอง)
  final/transactions.csv        ← ผลลัพธ์สุดท้ายหลัง unmask (ผู้ใช้รันเอง)

statements/staging/               ← ใช้งานได้ปกติ ไม่มีข้อมูลจริง (มีแต่ placeholder ⟦Pn⟧)
  masked/<name>.txt              ← input: มาจาก npm run statements:mask
  staged/<name>.csv               ← per-file fragment ที่สกิลนี้สร้าง
  staged.csv                      ← merge ของทุก fragment (regenerate ทุกครั้ง)
  processed_log.json              ← {masked filename: {hash, rows, account}}
```

## ขั้นตอนที่ต้องทำเมื่อถูกเรียกใช้สกิลนี้

1. **โหลด reference data จาก DB จริง** ผ่าน Supabase MCP (`list_tables` /
   `execute_sql`): households, accounts, cards, categories (เฉพาะ
   `archived = false`) ของ household ที่เกี่ยวข้อง — ใช้ชื่อจริงจาก DB เสมอ
   ห้าม hardcode UUID เก่าจากรอบก่อน (อาจเปลี่ยนได้)

2. **สแกน `statements/staging/masked/*.txt`** สำหรับแต่ละไฟล์:
   - คำนวณ sha256 ของเนื้อหาไฟล์
   - เทียบกับ `statements/staging/processed_log.json` — ถ้า hash ตรงกับที่
     เคยประมวลผลแล้ว **ข้าม** (ไม่ต้องแจ้งอะไรมาก แค่สรุปตอนท้าย)
   - ถ้าไม่มี entry หรือ hash เปลี่ยน → ประมวลผลไฟล์นี้ใหม่
   - ถ้า hash เปลี่ยน: ผ่านข้อ 2.5 ก่อน แล้วเช็กว่า Note ทุกแถวใน fragment เดิมยังเจอ
     ในไฟล์ใหม่ด้วย `grep -qF` (ไม่พิมพ์เนื้อหา) — ถ้าเจอครบ (เช่นแก้ mask แค่
     ส่วนหัว/ที่อยู่) แค่อัปเดต hash ใน log ไม่ต้องอ่านไฟล์ใหม่ทั้งไฟล์
     ถ้าไม่ครบ ประมวลผลใหม่ตามข้อ 3

2.5 **ตรวจการหลุดก่อนเปิดอ่าน — บังคับ ห้ามข้าม:**
   ```
   python3 scripts/check_masked.py <ไฟล์ที่จะประมวลผล...>
   ```
   ผลลัพธ์เป็นแบบ redacted อยู่แล้ว (ไม่มีข้อมูลจริง) ถ้า exit ≠ 0 **ห้ามเปิดอ่าน
   ไฟล์นั้นด้วยเครื่องมือใดทั้งสิ้น** (cat/Read/grep ที่พิมพ์เนื้อหา) — หยุด แล้วบอก
   ผู้ใช้ว่าหลุดประเภทไหน ให้เพิ่มคำใน `statements/raw/mask_terms.txt` (ผู้ใช้แก้เอง)
   แล้ว `npm run statements:mask:force` ก่อน ถ้าต้องดูโครงสร้างไฟล์เพื่อหาสาเหตุ ใช้
   แค่ผลแบบ redacted (แทนตัวอักษรด้วยจำนวนตัว) ไม่พิมพ์ข้อความดิบ

   check นี้จับได้แค่รูปแบบที่รู้จัก — ระหว่างอ่านไฟล์ ถ้าเห็นชื่อคน ที่อยู่ หรือเลข
   บัญชีที่ยังไม่ถูก mask ให้หยุดทันที บอกผู้ใช้ และห้ามคัดลอกข้อความนั้นลงไฟล์ใดๆ
   (fragment, โค้ด, คอมเมนต์, ตัวอย่างใน test) — ตัวอย่างใน test/คอมเมนต์ใช้ชื่อสมมติเสมอ

3. **สำหรับแต่ละไฟล์ที่ต้องประมวลผล (ที่ผ่านข้อ 2.5 แล้วเท่านั้น):**
   - อ่านเนื้อหา — อ่านเฉพาะส่วนรายการธุรกรรมถ้าทำได้ (ส่วนหัว statement มักมีชื่อ/
     ที่อยู่ ไม่จำเป็นต่อการแยกรายการ)
   - หาว่า statement นี้เป็นของบัญชี/บัตรไหน โดยจับคำสำคัญในเนื้อหา (เช่น
     "CardX", "SpeedyCash", "KTC", "กสิกร", "UOB") เทียบกับชื่อจริงใน DB
     (accounts/cards ที่โหลดมาขั้นตอน 1) ถ้าจับคู่ไม่ได้ชัดเจน **ให้ถามผู้ใช้**
     แทนการเดา
   - แยกรายการธุรกรรมทีละแถว: วันที่, คำอธิบาย (มี placeholder ปนได้ ไม่ต้อง
     พยายาม resolve เอง — unmask จะทำให้ทีหลัง), จำนวนเงิน, kind
     (expense/income/transfer) ตามบริบท (เช่น "PAYMENT RECEIVED" หรือ
     transfer ระหว่างบัญชีตัวเอง = income/transfer, รายการซื้อของปกติ =
     expense)
   - เดา Category จากคำอธิบาย โดยจับคู่กับ **ชื่อ category จริงที่โหลดจาก DB**
     เท่านั้น (ไม่ต้องสร้าง category ใหม่) ถ้าเดาไม่ออกใช้ "Other"
   - เขียนผลลัพธ์เป็น CSV fragment ที่ `statements/staging/staged/<name>.csv`
     คอลัมน์ตรงกับ schema เดิม:
     `Date,Kind,Amount,Category,Account or card,To account or card,Note,Details,Owner`
     (Date รูปแบบ `DD/MM/YYYY`, ค.ศ.) — Note ใส่คำอธิบายที่ยังมี placeholder
     ได้ตามปกติ อย่าพยายามแทนที่ placeholder เอง
   - อัปเดต `statements/staging/processed_log.json`:
     `{ "<filename>.txt": { "hash": "...", "rows": N, "account": "..." } }`

4. **Merge ทุก fragment** ใน `statements/staging/staged/*.csv` เป็น
   `statements/staging/staged.csv` ไฟล์เดียว (header เดียว ต่อท้ายด้วยข้อมูลทุก
   fragment) — regenerate ใหม่ทุกครั้งที่รันสกิลนี้ (ไม่ต้อง append สะสม)
   เพื่อให้ไฟล์นี้ตรงกับ fragment ล่าสุดเสมอ แม้จะลบ/แก้ fragment ไปแล้ว

5. **สรุปผลให้ผู้ใช้อ่าน**: กี่ไฟล์ที่ข้าม, กี่ไฟล์ที่ประมวลผลใหม่, รวมกี่
   รายการใน `staged.csv`, มีรายการไหนที่เดา category ไม่ได้/เดา account ไม่ได้
   ต้องให้ผู้ใช้ตรวจสอบเป็นพิเศษ

6. **บอกขั้นตอนถัดไป** ให้ผู้ใช้รันเอง (Claude ห้ามรัน `npm run statements:*`
   เอง เพราะทุกตัวแตะ `statements/raw/`):
   ```
   npm run statements:unmask   # → statements/raw/final/transactions.csv
   ```
   แล้วเปิดหน้าตรวจ statement ในแอป เลือกไฟล์นั้น (อ่านใน browser, เขียน DB
   ตอนกด Apply เท่านั้น — ADR-0019) import ซ้ำไฟล์เดิมได้ ไม่เกิดรายการซ้ำ
   ถ้าแนะนำให้ผู้ใช้เปิดดู `statements/raw/final/transactions.csv` ก่อน import
   ก็ได้ แต่ Claude ห้ามเปิดเอง

   ขั้นก่อนหน้าสกิลนี้ (ผู้ใช้รันเอง): วาง PDF ใน `statements/raw/statements/`
   แล้ว `npm run statements:mask`

## การทำใหม่ (re-process)

ถ้าผู้ใช้อยากให้ไฟล์ไหนประมวลผลใหม่: ลบ entry ของไฟล์นั้นออกจาก
`statements/staging/processed_log.json` (หรือลบทั้งไฟล์ log เพื่อรีเซ็ตทั้งหมด)
แล้วเรียกสกิลนี้ใหม่ — ไฟล์ที่ log ไม่มี entry (หรือ hash ไม่ตรง) จะถูกประมวลผล
ใหม่โดยอัตโนมัติตามขั้นตอนข้างบน
