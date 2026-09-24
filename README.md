# ROOC Guild Manager — Divine

เว็บแอป + Discord bot สำหรับบริหารกิลด์ **Divine** ในเกม Ragnarok Origin Classic (ROOC) ครบวงจรในที่เดียว: ซิงค์สมาชิกกับ Discord อัตโนมัติ, จัดปาร์ตี้ GL/WOE, ระบบลา, เช็คชื่อจากห้องเสียง, สถิติ PVP, คิวประมูลไอเทม และบันทึกกิจกรรมทุกอย่าง

> อัปเดตเอกสารล่าสุด: 24 ก.ย. 2569 (หลังรีดีไซน์ UX/UI ทั้งเว็บ)

## เอกสารทั้งหมด

| ไฟล์ | เนื้อหา |
|---|---|
| [README.md](./README.md) | ภาพรวม, ติดตั้ง, deploy, environment variables (ไฟล์นี้) |
| [docs/FEATURES.md](./docs/FEATURES.md) | คู่มือใช้งานทีละหน้า (แอดมิน + สมาชิก) และคำสั่ง Discord |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | โครงสร้างโค้ด, โมเดลข้อมูล, กฎการคำนวณ (ลา/เช็คชื่อ/โควต้า/คิว/ปาร์ตี้) |
| [docs/DESIGN-SYSTEM.md](./docs/DESIGN-SYSTEM.md) | ระบบดีไซน์: app shell, ไอคอน, UI kit, dialog/toast, responsive |
| [docs/OPERATIONS.md](./docs/OPERATIONS.md) | ขั้นตอน deploy, migration, การทดสอบ, แก้ปัญหา |
| [docs/CHANGELOG.md](./docs/CHANGELOG.md) | ประวัติการเปลี่ยนแปลงสำคัญ |
| [CLAUDE.md](./CLAUDE.md) / [AGENTS.md](./AGENTS.md) | ข้อตกลงสำหรับ AI coding agent ที่ทำงานกับ repo นี้ |

## ฟีเจอร์โดยสรุป

| หน้า | ทำอะไรได้ |
|---|---|
| **Overview** `/` | แดชบอร์ด: รอบถัดไป + ความพร้อมกระดาน, รายการที่ต้องดูแล, KPI, กราฟการเข้าร่วม 12 รอบ, สัดส่วนอาชีพ, ฟีดกิจกรรม |
| **Members** `/members` | รายชื่อทั้งหมด ค้นหา/กรอง (สถานะ, อาชีพ, ยศ, "ต้องดูแล"), แถบเข้า-ขาด 8 รอบ, ดูโปรไฟล์แบบ drawer, bench หลายคน, copy mention, CSV |
| **Party** `/party` | จัดปาร์ตี้ลาก-วาง/แตะย้าย, ป้ายพร้อมรบ, recipe อาชีพ, "หาแทน" คนลา, Auto-balance CP, Undo, ไฮไลต์อาชีพ, ประกาศภาพลง Discord |
| **Random Picker** `/random` | สุ่มสมาชิก กรองคนพัก/เฉพาะในห้องเสียง/ตามอาชีพ, ไม่ซ้ำคนเดิม, ประวัติ |
| **Loot Queue** `/loot-queue` | คิวประมูลต่อหมวด, ตัวอย่างเส้นตัด + ข้อความ Discord ก่อนรัน, Undo, เลขต่อจากหมวดอื่น, ค้นหาคิวทุกหมวด, Copy 3 แบบ |
| **Calendar** `/calendar` | ปฏิทินทุกรอบ GL/WOE, ใครลา, ผลกระทบต่ออาชีพ, รอบที่ประกาศพัก |
| **Activity Log** `/activity` | ไทม์ไลน์กิจกรรมทุกอย่างของสมาชิก แยกหมวด/ค้นหา |
| **Leave Stats** `/attendance` | สถิติการลา, จุดโควต้าเดือนนี้ต่อกระดาน, คนเกินโควต้า, ประกาศช่วงพัก |
| **Check-in [Voice]** `/checkin` | เช็คชื่อจากห้องเสียงอัตโนมัติ, % ต่อรอบ, มาสาย/ออกก่อน, แถบเวลาในห้อง, โน้ต, CSV |
| **PVP Stats** `/pvp-stats` | ตารางสถิติ PVP, มุมมองแยกอาชีพ + heatmap + ธง key stat, เปรียบเทียบ, ข้อมูลเก่ากว่า 14 วัน |
| **Manage Classes** `/classes` | จัดการอาชีพ: อีโมจิ, สี, Key PVP stat, ลำดับ (แอดมิน) |

ทั้งเว็บใช้ **app shell เดียวกัน**: เมนูซ้ายพร้อม badge งานค้าง, กล่องรอบถัดไป, ค้นหา `Ctrl K`, แถบล่างบนมือถือ, หน้าต่างยืนยัน/แจ้งเตือนแบบเดียวกันทุกหน้า — ดู [docs/DESIGN-SYSTEM.md](./docs/DESIGN-SYSTEM.md)

**Discord bot**: ซิงค์สมาชิกเรียลไทม์ + full sync ทุก 30 นาที, `/party`, `/leave`, แผงเลือกอาชีพ, แผง "ห้องลา", เก็บเวลาเข้า-ออกห้องเสียง, DM เตือนอัปเดต PVP stats (ทุก 21 วัน), ข้อความต้อนรับ, แจ้งเตือนแอดมินในช่องที่กำหนด

## สถาปัตยกรรม

2 process แยกกัน ใช้ PostgreSQL ตัวเดียวกัน (deploy บน Railway 2 services จาก repo เดียว):

```
┌──────────────────┐        ┌──────────────────┐
│  web (Next.js)   │◄──────►│                  │
│  Railway service │        │   PostgreSQL     │
└──────────────────┘        │  (Railway)       │
┌──────────────────┐        │                  │
│  bot (discord.js)│◄──────►│                  │
│  Railway service │        └──────────────────┘
└──────────────────┘
        │  Discord Gateway + REST
        ▼
     Discord
```

**Stack:** Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Tailwind CSS v4 · Auth.js v5 (Discord OAuth) · Drizzle ORM + postgres.js · discord.js v14 · @dnd-kit/core · @napi-rs/canvas · date-fns

รายละเอียดโครงสร้างโค้ดและกฎการคำนวณ → [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)

---

## ติดตั้งครั้งแรก

### 1. สร้าง Discord Application

1. [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**
2. **OAuth2 → General**: คัดลอก Client ID / Client Secret และเพิ่ม Redirect
   - dev: `http://localhost:3000/api/auth/callback/discord`
   - production: `https://<โดเมน>/api/auth/callback/discord`
3. **Bot**: Reset Token (คัดลอกเก็บไว้) และเปิด **Server Members Intent** (จำเป็น)
4. **OAuth2 → URL Generator**: scope `bot` + `applications.commands`, permission `View Channels`, `Send Messages`, `Add Reactions`, `Attach Files`, `Kick Members` (+ `Manage Messages` แนะนำ) แล้วเปิดลิงก์เชิญบอท
5. เปิด Developer Mode ใน Discord → คัดลอก **Server ID**, Role ID ของแอดมิน, Channel ID ของช่องแจ้งเตือนแอดมิน

### 2. Deploy บน Railway

1. **New Project → Deploy from GitHub repo** → เลือก repo นี้ และ **New → Database → PostgreSQL**
2. **service `web`** (สร้างจาก repo อัตโนมัติ)
   - Start: `npm run start` · **Pre-Deploy: `npm run db:migrate`** (migration รันเองทุก deploy)
   - Networking → Generate Domain แล้วนำโดเมนไปใส่ Redirect ใน Discord และตัวแปร `AUTH_URL`
3. **service `bot`** (New → GitHub Repo → repo เดิม)
   - Start: `npm run bot:start` · ปิด public networking
4. ใส่ Variables ตามตารางด้านล่าง (`DATABASE_URL` ให้อ้างอิง `${{Postgres.DATABASE_URL}}`)

หลังตั้งค่าเสร็จ: push ขึ้น `main` → Railway build + deploy ทั้งสอง service อัตโนมัติ (ดู [docs/OPERATIONS.md](./docs/OPERATIONS.md))

### 3. Environment variables

ดูคำอธิบายเต็มใน [`.env.example`](./.env.example)

| ตัวแปร | ใช้ที่ | คำอธิบาย |
|---|---|---|
| `DATABASE_URL` | web + bot | Postgres connection string |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | web | จาก Discord App → OAuth2 |
| `DISCORD_BOT_TOKEN` | web + bot | เว็บใช้เรียก REST (เตะ, โพสต์ข้อความ/ภาพ) บอทใช้ต่อ Gateway |
| `DISCORD_GUILD_ID` | web + bot | Server ID ของกิลด์ |
| `DISCORD_ADMIN_ROLE_IDS` | web | Role ID (คั่น comma) ที่ได้สิทธิ์แอดมิน |
| `DISCORD_ADMIN_USER_IDS` | web | User ID (คั่น comma) ที่เป็นแอดมินเสมอ |
| `DISCORD_TRACKED_ROLE_NAME` | web + bot | role ที่นับว่าเป็นสมาชิกกิลด์ (default `Rooc`) |
| `DISCORD_MANAGEMENT_ROLE_NAMES` | web | role ที่โชว์เป็นตัวกรอง/badge (default `ADMIN,MOD,Rooc,Strategist`) |
| `DISCORD_ADMIN_NOTIFY_CHANNEL_ID` | bot | ช่องที่บอทโพสต์แจ้งเตือนแอดมิน (เช่น มีคนลา, ลาเกินโควต้า) |
| `AUTH_SECRET` | web | `openssl rand -base64 32` |
| `AUTH_URL` | web | **ต้องใส่ใน production** เช่น `https://<โดเมน>` |
| `AUTH_TRUST_HOST` | web | **ต้องใส่ใน production** = `true` |
| `CLASS_SYNC_SHEET_ID` / `CLASS_SYNC_SHEET_GID` | web | เลิกใช้แล้ว (เครื่องมือ sync อาชีพจาก Google Sheet ถูกถอดออก) ไม่ต้องใส่ |

---

## รันในเครื่อง

```bash
npm install
cp .env.example .env        # กรอกค่าจริง
npm run db:migrate          # ต้องมี Postgres ก่อน
npm run dev                 # เว็บ http://localhost:3000
npm run bot:dev             # บอท (อีก terminal)
```

Postgres ด่วนด้วย Docker:

```bash
docker run --name rooc-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=rooc_guild -p 5432:5432 -d postgres:16
```

| คำสั่ง | ใช้ทำอะไร |
|---|---|
| `npm run db:generate` | สร้างไฟล์ migration หลังแก้ `src/db/schema.ts` |
| `npm run db:migrate` | apply migration ที่ค้าง |
| `npm run db:studio` | Drizzle Studio (GUI ดูข้อมูล) |
| `npm run lint` | ESLint |
| `npx tsc --noEmit` | type-check |
| `npm run build` | build เต็ม — **รันทุกครั้งก่อน push** (บางปัญหาผ่าน tsc แต่ build พัง) |

## โครงสร้างโปรเจกต์ (ย่อ)

```
src/
  app/(app)/        หน้าที่ต้อง login (overview, members, party, random, loot-queue,
                    calendar, activity, attendance, checkin, pvp-stats, classes) + layout (app shell)
  app/actions/      Server actions (ทุกตัวเช็ค requireUser/requireAdmin เอง)
  components/       UI — shell/ (เมนู, ค้นหา), ui/kit.tsx (ชิ้นส่วนกลาง), feedback.tsx (dialog/toast),
                    party/, checkin/, activity/, leave-stats/ ฯลฯ
  db/schema.ts      Drizzle schema (มีคอมเมนต์อธิบายแต่ละตาราง)
  lib/              data queries, กฎการลา/เช็คชื่อ, nav-config, checkin-events ฯลฯ
bot/                Discord bot worker (รันด้วย tsx)
drizzle/            SQL migrations
scripts/            migrate.ts, migrate-leaves-v2.ts
docs/               เอกสาร
```

## แก้ปัญหาเบื้องต้น

- **Login แล้วขึ้น NotAGuildMember** — บัญชีต้องมี role ตาม `DISCORD_TRACKED_ROLE_NAME` ใน server ที่ตรงกับ `DISCORD_GUILD_ID`
- **Callback error "Configuration"** — ลืม `AUTH_URL`/`AUTH_TRUST_HOST` หรือ Redirect URI ไม่ตรงโดเมนเป๊ะ
- **บอท sync ได้ 0 คน** — ยังไม่เปิด Server Members Intent
- **role ใหม่ยังไม่เป็นแอดมิน** — logout แล้ว login ใหม่ (สิทธิ์ถูกเช็คสดกับ Discord ทุกครั้งที่ทำ action แอดมิน)

เพิ่มเติม → [docs/OPERATIONS.md](./docs/OPERATIONS.md)
