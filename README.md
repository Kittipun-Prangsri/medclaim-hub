# MedClaim Hub

MVP ระบบศูนย์กลางบริหารจัดการเคลมโรงพยาบาล ครอบคลุม workflow จำลองของ OPD สิทธิบัตรทองตั้งแต่ตรวจข้อมูลจนถึงกระทบยอด

## เริ่มใช้งาน

ต้องการ Node.js 18 ขึ้นไป และไม่ต้องติดตั้ง dependency เพิ่ม

```bash
cd medclaim-hub
npm start
```

เปิด `http://localhost:4100` หรือทดสอบ API:

ก่อนเปิดระบบให้คัดลอก `.env.example` เป็น `.env` และกรอก `HOSXP_DB_PASSWORD` ในเครื่องเท่านั้น ห้าม commit หรือส่งรหัสผ่านในแชท

```bash
curl "http://localhost:4100/api/health"
curl "http://localhost:4100/api/v1/validate/ucs?from=2026-07-01&to=2026-07-11"
npm test
```

## สถาปัตยกรรม

- `src/repositories` รองรับข้อมูลจำลองและ HOSxP MySQL แบบ read-only ผ่าน `CLAIM_DATA_SOURCE`
- `src/services/RulesEngine.js` รันกฎ validation แบบ generic
- `src/rules` ruleset แยกกองทุน ประเภทเคลม เวอร์ชัน และวันที่เริ่มใช้
- `public` Dashboard สำหรับเจ้าหน้าที่เคลม

## Workflow ที่ทดลองได้

1. เมนู **ตรวจสอบก่อนส่ง** เลือกรายการสถานะพร้อมส่งและสร้างรอบเคลม
2. เมนู **รอบส่งเคลม** ส่งรอบไป FDH แบบจำลอง
3. เมนู **ผลตอบกลับ** เลือกผลอนุมัติหรือปฏิเสธ หากปฏิเสธสามารถยื่นอุทธรณ์ได้
4. เมนู **กระทบยอด** บันทึกยอดรับชำระและดูส่วนต่าง
5. เมนู **รายงาน** ดูสรุปและส่งออก CSV
6. เมนู **ตั้งค่าระบบ** เปลี่ยนชื่อ/รหัสโรงพยาบาล ดูรุ่นและสถานะ Backend และกำหนดค่า HOSxP MySQL
7. เมนู **กำกับ Claim/Rules** ตรวจ Auth Code กำกวมและดำเนิน Rules Draft → Review → Approved โดยไม่เขียนกลับ HOSxP

Provider ID UAT และ FDH จริงถูกพักไว้ตามขอบเขตปัจจุบัน ระบบยังใช้ Provider ID Mock และ FDH workflow จำลอง

## Provider ID Login Mock

เมื่อเปิดระบบจะพบหน้าเข้าสู่ระบบ Provider ID แบบจำลอง สามารถเลือกบทบาท `claim_officer`, `reviewer`, `finance`, `auditor` หรือ `admin` เพื่อทดสอบ RBAC ได้ ระบบใช้ session cookie แบบ `HttpOnly`, `SameSite=Lax` อายุ 8 ชั่วโมง และเก็บ session ในหน่วยความจำ

ก่อนเปลี่ยนเป็น Provider ID UAT ต้องได้รับ Client ID/Client Secret และ Callback URL ที่ได้รับอนุมัติ จากนั้นเพิ่ม OAuth adapter ฝั่ง backend โดยเก็บ secret ใน environment/secret manager, ตรวจ `state` และ PKCE, validate token/profile/organization และใช้ cookie `Secure` หลัง HTTPS เท่านั้น ห้ามนำ Client Secret ไปไว้ใน `public/app.js`

ข้อมูล workflow เก็บในหน่วยความจำและจะเริ่มใหม่ทุกครั้งที่ restart server เพื่อความปลอดภัยของโหมดสาธิต

ค่าหน่วยบริการและฐานข้อมูลในเวอร์ชันนี้เก็บในหน่วยความจำ รหัสผ่านไม่ถูกส่งกลับจาก API ปุ่มทดสอบฐานข้อมูลเชื่อม MySQL จริงด้วย timeout 5 วินาที รันเฉพาะ `SELECT VERSION/DATABASE/CURRENT_USER/@@read_only` และปิด connection ทันที ก่อน production ควรเก็บ credentials ใน secret manager หรือ environment variables และเข้ารหัสระหว่างรับส่ง

## ข้อจำกัดของ MVP

- HOSxP adapter ใช้ mapping ของฐานทดสอบ `patient`, `ovst`, `ovstdiag`, `opitemrece`; ต้องตรวจ schema และรหัส `pttype` ของแต่ละโรงพยาบาลก่อนใช้ผลจริง
- ฐานทดสอบปัจจุบันกำหนดสิทธิบัตรทองเป็น `HOSXP_UCS_PTTYPE_CODES=89`
- หน้าตรวจสอบใช้ server-side pagination 50 รายการต่อหน้า และ HOSxP query จำกัดสูงสุด 1,000 รายการต่อ request
- ค้นหาแบบ server-side ด้วย VN, HN, CID แบบตรงตัว หรือชื่อ/นามสกุล โดยใช้ parameterized query
- authCode mapping ใช้ `authenhos.CLAIM_CODE`, `authenhosall.CLAIM_CODE` และ `temp_authen_code`; ตาราง temp จะแปลงปี พ.ศ. เป็น ค.ศ. และรับเฉพาะ CID+วันที่ที่มี Claim Code ค่าเดียว รายการกำกวมจะคงเป็น Warning
- มี audit trail สำหรับกิจกรรมจำลอง แต่ยังไม่มีฐานข้อมูลถาวรและระบบยืนยันตัวตน
- กฎเป็นต้นแบบเชิงเทคนิค ต้องผ่านการรับรองจากผู้รับผิดชอบงานเรียกเก็บก่อนใช้จริง
- ห้ามใช้กับข้อมูลผู้ป่วยจริงจนกว่าจะเพิ่ม authentication, authorization, encryption, audit และนโยบายสำรองข้อมูล

## Roadmap

1. เชื่อม HOSxP ด้วยบัญชี SELECT-only และ mapping รายโรงพยาบาล
2. เพิ่มผู้ใช้ สิทธิ์ตามบทบาท และ audit log
3. เพิ่ม claim batch, FDH response import, correction/re-submit
4. เพิ่ม payment allocation และ reconciliation
5. เพิ่มกองทุน SSS และ CSMBS ผ่าน ruleset/adapter แยกกัน
