# Operations

## Deploy

1. แก้โค้ด → รัน `npx tsc --noEmit`, `npx eslint src bot`, `npm run build` ให้ผ่าน
2. รัน `push.bat` (commit + push ขึ้น `main`)
3. Railway auto-deploy ทั้งสอง service จาก commit ล่าสุด
   - **web**: pre-deploy รัน `npm run db:migrate` (ใช้ migration ใน `drizzle/`) แล้ว `npm start`
   - **bot**: `npm run bot:start`
4. ตรวจสถานะใน Railway dashboard (หรือ `environment-status`) ว่าทั้งสองเป็น SUCCESS

ถ้า auto-deploy ไม่ทำงาน: Railway → service → Settings → Source → Redeploy / reconnect repo

## Migration

- แก้ `src/db/schema.ts` → `npm run db:generate` → ได้ไฟล์ `drizzle/00XX_*.sql` + snapshot ใน `drizzle/meta/`
- commit ทั้ง SQL และ `meta/` (journal + snapshot) — ขาดอย่างใดอย่างหนึ่ง migration จะเพี้ยน
- migration รันอัตโนมัติตอน deploy web ไม่ต้องต่อ DB เอง
- **ห้ามแปะ `DATABASE_URL` ในแชทหรือ commit** — ถ้าต้องแก้ข้อมูลใน production ให้ทำผ่าน migration หรือ Railway function/pre-deploy ชั่วคราว แล้วลบทิ้งหลังใช้

Migration ล่าสุด:

| ไฟล์ | เนื้อหา |
|---|---|
| `0034_add_leaves_v2.sql` | ระบบลา v2 (รายรอบ + ลาล่วงหน้า) |
| `0035_add_member_alt_classes.sql` | อาชีพรองของสมาชิก |
| `0036_drop_party_templates.sql` | ลบ party templates เดิม |
| `0037_add_slot_playing_as.sql` | ช่องปาร์ตี้ระบุอาชีพที่เล่นจริง |
| `0038_add_job_class_key_stat.sql` | key stat ของอาชีพสำหรับคำนวณ CP |
| `0039_add_board_party_recipe.sql` | สูตรอาชีพต่อปาร์ตี้ของบอร์ด |
| `0040_add_loot_round_start_number.sql` | เลขลำดับเริ่มของรอบแจกของ |

## ทดสอบในเครื่อง

```bash
cp .env.example .env.local        # ใส่ค่าให้ครบ
npm install
npm run db:push                   # สร้าง schema ใน DB ทดสอบ (ห้ามชี้ไป production)
npm run dev                       # web ที่ http://localhost:3000
npm run bot:dev                   # bot (ใช้ bot token แยกสำหรับทดสอบถ้ามี)
```

ทดสอบ UI แบบไม่ต้องล็อกอิน: สามารถ bypass `requireUser` ชั่วคราวใน `src/lib/authz.ts` ได้ในเครื่องเท่านั้น — **ต้องคืนค่าก่อน commit ทุกครั้ง** (ตรวจด้วย `git diff src/lib/authz.ts`)

เช็คลิสต์ก่อน push:

- [ ] `tsc`, `eslint`, `next build` ผ่าน
- [ ] ดูหน้าที่แก้ที่ 390px และ 1440px
- [ ] ไม่มี `window.confirm/alert/prompt` ใหม่ (`grep -rn "window\.\(confirm\|alert\|prompt\)" src`)
- [ ] ไม่มีไฟล์ mockup / ข้อมูลสมาชิกจริงหลุดเข้า commit (`Claude outputs/` ถูก ignore แล้ว)

## ตัวจับเวลาของบอท

| งาน | ความถี่ |
|---|---|
| Full sync สมาชิก/role | ทุก 30 นาที |
| Sweep ใบลาค้าง / รอบที่ถูก void | ทุก 6 ชั่วโมง |
| เตือน PVP stats เก่า | เมื่อเกิน 21 วัน (เว็บแสดง "เก่า" ที่ 14 วัน) |

## แก้ปัญหา

| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| Deploy web fail ตอน pre-deploy | migration ผิด — ดู log ของ `db:migrate`, ตรวจว่า commit `drizzle/meta/` ครบ |
| หน้าเว็บ error #418 (hydration) | มีการ format วันที่ต่างกันระหว่าง server/client — ดู [DESIGN-SYSTEM.md](./DESIGN-SYSTEM.md) |
| บอทไม่ตอบปุ่ม | ตรวจ bot service ว่ารันอยู่, token ถูก, intent ครบ (Server Members, Voice States) |
| สมาชิกไม่ขึ้นในเว็บ | รอ full sync 30 นาที หรือ restart bot |
| เช็คชื่อไม่ขึ้น | บอร์ดต้องผูกช่องเสียงถูกต้อง และบอทต้องเห็นช่องนั้น |
| ล็อกอินไม่ได้ | ตรวจ `AUTH_URL`, redirect URI ใน Discord Developer Portal, `AUTH_SECRET` |

## งานดูแลที่ค้าง (ฝั่งแอดมิน)

- ตั้ง Key PVP stat ให้แต่ละอาชีพในหน้า Manage Classes (ใช้คำนวณ CP ปาร์ตี้)
- ตั้งสูตรปาร์ตี้ (recipe) ของแต่ละบอร์ด
- ลบ service ชั่วคราวใน Railway ที่ไม่ใช้แล้ว (`temp-pvp-mock-export`, `temp-backfill-stale-leaves`)
