# ROOC Guild Manager

เว็บแอปสำหรับจัดการสมาชิกกิลด์เกม ROOC (Ragnarok Origin Classic) แบบครบวงจร — ซิงค์สมาชิกกับ Discord server อัตโนมัติ, จัดปาร์ตี้, เช็คชื่อ/ลา, เก็บสถิติ PVP, จัดคิวประมูลไอเทม และเก็บประวัติกิจกรรมทุกอย่างไว้ในที่เดียว

## ฟีเจอร์หลัก

**สมาชิกและสิทธิ์**
- ซิงค์สมาชิกอัตโนมัติกับ Discord (เข้า/ออก/เปลี่ยนยศแบบเรียลไทม์ผ่าน Gateway + full sync ทุก 30 นาทีเป็น safety net)
- Login ด้วย Discord OAuth — ต้องมี role ที่กำหนดไว้ในเซิร์ฟเวอร์ (ค่าเริ่มต้น "Rooc") ถึงจะเข้าระบบได้ สิทธิ์แอดมินคำนวณจาก Discord role/user ID ตอน login
- หน้ารายชื่อสมาชิก ค้นหา/กรองตามสถานะ, ยศ, เบนช์
- หน้ารายละเอียดสมาชิก: แก้ไขข้อมูล, โน้ตภายใน (เฉพาะแอดมินเห็น), เตะออกจาก Discord จริง, พักการเป็นสมาชิก (bench), **แบนจากคิวประมูล** ตามจำนวนวันที่กำหนด (หมดอายุอัตโนมัติ)
- Dashboard สรุปจำนวนสมาชิกทั้งหมด/active/เบนช์/ออกแล้ว/ถูกเตะ พร้อมกราฟเทรนด์การเข้าร่วมกิจกรรม
- ประวัติกิจกรรม (Activity Log) บันทึกทุกอย่าง — เข้า/ออก/เตะ, แก้ข้อมูล, ลา/กลับ, แบน/ปลดแบนประมูล ฯลฯ

**ปาร์ตี้และการเข้าร่วมกิจกรรม**
- จัดปาร์ตี้หลายบอร์ด (multi-board), ลาก-วาง หรือแตะเพื่อย้ายสมาชิก, บันทึก/โหลด template ผังปาร์ตี้
- ระบบ reaction ใน Discord ให้สมาชิกเลือกอาชีพ/แจ้งลาเองต่อบอร์ด (บอทคุมให้เลือกได้ครั้งเดียวต่อครั้ง)
- ประกาศผังปาร์ตี้เป็นรูปภาพ (server-side canvas render) ลง Discord ได้ในคลิกเดียว จำช่องล่าสุดที่เคยประกาศไว้
- Slash command `/party` — พิมพ์ในดิสคอร์ดแล้วดูผังปาร์ตี้ปัจจุบันแบบ ephemeral โดยไม่ต้องเปิดเว็บ
- `/checkin` — เช็คว่าใครเข้าห้อง voice ตรงเวลากิจกรรมจริงไหม (ตั้งค่าห้อง/วันเวลาต่ออีเวนต์ได้ที่ `src/lib/checkin-events.ts`) พร้อมโยงกับสถานะ "ลา" ของบอร์ดที่เกี่ยวข้อง ไม่ให้ขึ้นเป็น "ขาดกิจกรรม" ทั้งที่ลาไว้แล้ว
- `/attendance` — สรุปสถิติการเข้าร่วม/ลา ย้อนหลังแยกตามบอร์ด

**สถิติ PVP**
- สมาชิกกรอก/อัปเดตสถิติของตัวเองได้เอง (CP, DEF, ATK, การ์ดบอส ฯลฯ) — ทุกครั้งที่กรอกคือประวัติใหม่ ไม่ทับของเก่า
- แอดมิน review/แก้ไข/เพิ่ม/ลบ entry ของใครก็ได้ พร้อมระบบฟิลด์สถิติแบบกำหนดเองได้ (เพิ่มคอลัมน์สถิติใหม่ได้เองโดยไม่ต้องแก้โค้ด)
- ตารางหลักเรียงตาม CP ทุกคนเห็นกันหมด, ดูประวัติเต็มของแต่ละคนได้ที่หน้าโปรไฟล์

**คิวประมูลไอเทม (Loot Queue)**
- แต่ละหมวดไอเทม (การ์ด, ขนนก, กล่องไอเทม ฯลฯ) มีคิวหมุนเวียนของตัวเอง — แอดมินจัดลำดับคิวเอง กด "Run Round" แล้วระบบดึงคนหน้าคิวไปต่อท้ายให้อัตโนมัติ
- ระบบแบนคิว: แบนได้ทั้งระบบ (ทุกหมวดพร้อมกัน) ตามจำนวนวันที่กำหนด ตำแหน่งในคิวไม่หาย แค่ถูกข้ามจนกว่าจะหมดโทษ

**อื่น ๆ**
- จัดการอาชีพในเกม (`/classes`) — เพิ่ม/แก้/ลบ/จัดลำดับเอง ไม่ต้องแก้โค้ด
- Random Member (`/random`) — สุ่มชื่อจากรายชื่อ active member สำหรับจับฉลาก/เลือกหัวทีม เปิดให้สมาชิกทุกคนเล่นได้ ไม่ใช่แค่แอดมิน

## สถาปัตยกรรม

โปรเจกต์นี้มี 2 process ที่ทำงานแยกกันแต่ใช้ฐานข้อมูลเดียวกัน:

1. **Web app** (Next.js) — หน้าเว็บ + login + server actions สำหรับแอดมิน/สมาชิกแก้ไขข้อมูล
2. **Bot worker** (discord.js) — เชื่อมต่อ Discord Gateway ตลอดเวลา ฟังอีเวนต์เข้า/ออก, reaction, voice state, slash command

ทั้งสองต้องรันแยกกันเพราะบอทต้องเป็น process ที่รันค้างตลอดเวลา (ไม่ใช่ serverless function) จึงแนะนำให้ deploy ทั้งคู่บน **Railway** เป็น 2 services จาก repo เดียวกัน ใช้ **PostgreSQL** (Railway plugin) เป็นฐานข้อมูลร่วม

```
┌─────────────────┐        ┌──────────────────┐
│   Web (Next.js)  │◄──────►│                  │
│   Railway service│        │   PostgreSQL     │
└─────────────────┘        │  (Railway plugin) │
┌─────────────────┐        │                  │
│   Bot (discord.js)│◄─────►│                  │
│   Railway service│        └──────────────────┘
└─────────────────┘                 ▲
        │                            │
        └──────── Discord API ───────┘
```

Stack: Next.js 16 (App Router, Turbopack) · TypeScript · Tailwind CSS v4 · Auth.js v5 (Discord OAuth) · Drizzle ORM · PostgreSQL (postgres.js) · discord.js v14 · @dnd-kit/core (จัดปาร์ตี้แบบลาก-วาง) · @napi-rs/canvas (เรนเดอร์ภาพผังปาร์ตี้ฝั่งเซิร์ฟเวอร์)

## ก่อนเริ่ม

- บัญชี [Railway](https://railway.app) (มี free trial / usage-based pricing)
- สิทธิ์ "Manage Server" ใน Discord server ของกิลด์ (เพื่อเชิญบอทและตั้งค่า)
- Node.js 20+ ถ้าต้องการรันในเครื่องตัวเองด้วย

---

## ขั้นตอนที่ 1 — สร้าง Discord Application

1. ไปที่ [Discord Developer Portal](https://discord.com/developers/applications) → **New Application** → ตั้งชื่อ (เช่น "ROOC Guild Manager")
2. ไปที่แท็บ **OAuth2 → General**:
   - คัดลอก **Client ID** และ **Client Secret** เก็บไว้
   - ที่ **Redirects** กด **Add Redirect** แล้วใส่:
     - ตอน dev: `http://localhost:3000/api/auth/callback/discord`
     - ตอน production: `https://<โดเมนแอปของคุณ>/api/auth/callback/discord` (ใส่หลังจากรู้โดเมนจาก Railway แล้วในขั้นตอนที่ 2)
3. ไปที่แท็บ **Bot**:
   - กด **Reset Token** เพื่อสร้าง bot token ใหม่ แล้วคัดลอกเก็บไว้ (จะเห็นครั้งเดียว)
   - เปิด **Privileged Gateway Intents → Server Members Intent** (**จำเป็น** ไม่งั้นบอทจะไม่เห็นรายชื่อสมาชิก)
4. ไปที่แท็บ **OAuth2 → URL Generator**:
   - เลือก scope: `bot` และ `applications.commands` (สำหรับ slash command `/party`)
   - เลือก permission:
     - `View Channels` — ขั้นต่ำสุด บอทต้องอ่านรายชื่อสมาชิก/ห้อง voice ได้
     - `Kick Members` — ให้ปุ่ม "เตะออก" ในเว็บเตะออกจาก Discord จริง (role ของบอทต้องอยู่สูงกว่า role ของคนที่จะเตะด้วย)
     - `Send Messages` + `Add Reactions` — สำหรับโพสต์ข้อความเลือกอาชีพ/ลา และประกาศผังปาร์ตี้
     - `Manage Messages` — (แนะนำ ไม่บังคับ) ให้บอทลบ reaction เก่าอัตโนมัติเวลาสมาชิกเปลี่ยนตัวเลือก ไม่มีก็ยังใช้งานได้ปกติ แค่ไม่มีการเคลียร์ reaction ซ้ำ
   - เปิดลิงก์ที่ได้เพื่อเชิญบอทเข้า Discord server ของกิลด์
5. หา **Guild ID** (Server ID): เปิด Discord → User Settings → Advanced → เปิด **Developer Mode** → คลิกขวาที่ไอคอน server → **Copy Server ID**
6. (ถ้าต้องการ) หา **Role ID** ของยศที่อยากให้เป็นแอดมินในระบบ: คลิกขวาที่ role นั้นใน Server Settings → Roles → **Copy Role ID**

---

## ขั้นตอนที่ 2 — Deploy บน Railway

### 2.1 สร้างโปรเจกต์และฐานข้อมูล

1. Push โค้ดนี้ขึ้น GitHub repository ของคุณ
2. ที่ [Railway](https://railway.app) → **New Project → Deploy from GitHub repo** → เลือก repo นี้
3. ในโปรเจกต์เดียวกัน กด **New → Database → Add PostgreSQL**

### 2.2 สร้าง service สำหรับเว็บแอป

Railway จะสร้าง service แรกจาก repo ให้อัตโนมัติ (ใช้ Nixpacks ตรวจจับว่าเป็น Next.js เอง):

- **Settings → Deploy**:
  - Start Command: `npm run start` (ค่าเริ่มต้นถูกต้องอยู่แล้วเพราะมี `build`/`start` script)
  - Pre-Deploy Command: `npm run db:migrate` — ให้ migration รันอัตโนมัติทุกครั้งที่ deploy โดยไม่ต้องรันมือ
- **Variables** (ดูรายการทั้งหมดในขั้นตอนที่ 3) — อย่างน้อยต้องมี `DATABASE_URL` (อ้างอิงจาก Postgres plugin ผ่าน `${{Postgres.DATABASE_URL}}`), `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `AUTH_SECRET`, `AUTH_URL`, `AUTH_TRUST_HOST`
- **Settings → Networking** → กด **Generate Domain** เพื่อได้โดเมนสาธารณะ (เช่น `rooc-guild.up.railway.app`)
- กลับไปที่ Discord Developer Portal → OAuth2 → Redirects → เพิ่ม `https://<โดเมนที่ได้>/api/auth/callback/discord`
- ตั้ง `AUTH_URL` เป็นโดเมนเดียวกันนี้ (ดูเหตุผลในตารางตัวแปรด้านล่าง)

### 2.3 สร้าง service สำหรับบอท (จาก repo เดียวกัน)

1. ในโปรเจกต์ Railway เดียวกัน กด **New → GitHub Repo** แล้วเลือก repo เดิมอีกครั้ง (จะได้ service ที่สอง)
2. ตั้งชื่อ service เช่น `bot`
3. **Settings → Deploy**:
   - Start Command: `npm run bot:start`
   - **ปิด** public networking ของ service นี้ (บอทไม่ต้องรับ HTTP request จากภายนอก)
4. **Variables**: ใส่ `DATABASE_URL`, `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID` (ไม่ต้องใส่ตัวแปรที่เกี่ยวกับ OAuth/AUTH_SECRET เพราะบอทไม่ได้ใช้)

> **ถ้า push แล้วไม่ deploy อัตโนมัติ**: บางครั้ง Railway's GitHub App integration หลุดการเชื่อมต่อ (พบเจอจริงในโปรเจกต์นี้) — เช็คได้ที่ service → Settings → Source ว่ายัง connect อยู่ไหม ถ้าหลุดให้ reconnect repo ใหม่ที่หน้านั้น หรือกด redeploy มือไปพลางก่อนจนกว่าจะแก้การเชื่อมต่อ

### 2.4 รัน migration ครั้งแรก

ถ้าตั้ง Pre-Deploy Command ไว้แล้วตามข้อ 2.2 ไม่ต้องทำอะไรเพิ่ม — migration จะรันเองทุก deploy หลังจากนี้ ถ้ายังไม่ได้ตั้งหรืออยากรันมือครั้งแรกก่อน deploy จริง วิธีที่ง่ายที่สุดคือรันจากเครื่องตัวเอง โดยตั้ง `DATABASE_URL` ชั่วคราวให้ชี้ไปที่ Postgres บน Railway (คัดลอกจากแท็บ Connect ของ Postgres plugin แล้วใช้ "Public Network" connection string):

```bash
DATABASE_URL="<connection string จาก Railway Postgres>" npm run db:migrate
```

หรือถ้าใช้ [Railway CLI](https://docs.railway.com/guides/cli): `railway run npm run db:migrate` จากในโฟลเดอร์โปรเจกต์ (จะดึง environment variables ของ service ที่ผูกไว้ให้อัตโนมัติ)

---

## ขั้นตอนที่ 3 — Environment Variables ทั้งหมด

ดูคำอธิบายและวิธีหาแต่ละค่าใน [`.env.example`](./.env.example) ด้วย

| ตัวแปร | ใช้ที่ | คำอธิบาย |
|---|---|---|
| `DATABASE_URL` | web + bot | Postgres connection string |
| `DISCORD_CLIENT_ID` | web | จาก Discord App → OAuth2 |
| `DISCORD_CLIENT_SECRET` | web | จาก Discord App → OAuth2 |
| `DISCORD_BOT_TOKEN` | web + bot | จาก Discord App → Bot — ทั้งเว็บและบอทต้องใช้ตัวนี้ (เว็บเรียก Discord REST API ตรงสำหรับปุ่มเตะออก/โพสต์ข้อความ) |
| `DISCORD_GUILD_ID` | web + bot | Server ID ของกิลด์ |
| `DISCORD_ADMIN_ROLE_IDS` | web | Role ID (คั่นด้วย comma) ที่ให้สิทธิ์แอดมิน ไม่บังคับ |
| `DISCORD_ADMIN_USER_IDS` | web | User ID (คั่นด้วย comma) ที่ให้สิทธิ์แอดมินเสมอไม่ว่าถือ role อะไร ไม่บังคับ |
| `DISCORD_TRACKED_ROLE_NAME` | web + bot | ชื่อ Discord role ที่ใช้กรองว่าใครคือ "สมาชิกกิลด์" ใน roster จับคู่แบบไม่สนตัวพิมพ์เล็ก-ใหญ่ ไม่บังคับ (ค่า default คือ `Rooc`) |
| `DISCORD_MANAGEMENT_ROLE_NAMES` | web | Role name (คั่นด้วย comma) ที่จะโชว์เป็นตัวกรอง/badge ในเว็บ — server ที่เป็นชุมชนรวมหลายเกมจะมี role เยอะที่ไม่เกี่ยวกับกิลด์นี้ ตัวนี้ช่วยกรองให้เห็นเฉพาะที่เกี่ยว ไม่บังคับ (ค่า default `ADMIN,MOD,Rooc,Strategist`) |
| `AUTH_SECRET` | web | สุ่มด้วย `openssl rand -base64 32` |
| `AUTH_URL` | web | **ต้องใส่เสมอใน production** — Railway proxy ทำให้ Auth.js เดา URL ของตัวเองผิด (เช่น `https://your-app.up.railway.app`) ถ้าไม่ใส่จะเจอ error `Configuration` ตอน login |
| `AUTH_TRUST_HOST` | web | **ต้องใส่เสมอใน production** — ตั้งเป็น `true` คู่กับ `AUTH_URL` ด้านบน |

---

## รันในเครื่องตัวเอง (local development)

```bash
npm install
cp .env.example .env   # แล้วกรอกค่าจริงในไฟล์ .env
npm run db:migrate     # สร้างตารางในฐานข้อมูล (ต้องมี Postgres รันอยู่ก่อน เช่นผ่าน docker)
npm run dev            # รันเว็บที่ http://localhost:3000
npm run bot:dev        # รันบอท (อีก terminal หนึ่ง)
```

ถ้ายังไม่มี Postgres ในเครื่อง รันเร็ว ๆ ด้วย Docker:

```bash
docker run --name rooc-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=rooc_guild -p 5432:5432 -d postgres:16
```

### คำสั่งอื่น ๆ ที่มีให้

| คำสั่ง | ใช้ทำอะไร |
|---|---|
| `npm run db:generate` | สร้างไฟล์ migration ใหม่หลังจากแก้ `src/db/schema.ts` (รันแบบ offline ได้ ไม่ต้องต่อฐานข้อมูลจริง) |
| `npm run db:migrate` | รัน migration ที่ยังไม่ได้ apply กับฐานข้อมูล |
| `npm run db:push` | ดัน schema ปัจจุบันเข้าฐานข้อมูลตรง ๆ โดยไม่ผ่านไฟล์ migration (ใช้เฉพาะตอน prototype เท่านั้น อย่าใช้กับฐานข้อมูล production) |
| `npm run db:studio` | เปิด Drizzle Studio (GUI ดู/แก้ข้อมูลในฐานข้อมูล) |
| `npm run lint` | ตรวจสอบโค้ดด้วย ESLint |

> ก่อน ship ทุกครั้งควรรัน `npx tsc --noEmit` **และ** `npm run build` เต็ม ๆ ด้วย ไม่ใช่แค่ `tsc`/`lint` — Client Component บางตัวมีปัญหาที่ compile ผ่าน type-check แต่ทำให้ build จริงพังได้ (ดูรายละเอียดใน `CLAUDE.md`)

---

## โครงสร้างโปรเจกต์

```
src/
  app/
    (app)/            หน้าที่ต้อง login: dashboard, members, activity, party,
                       attendance, checkin, classes, pvp-stats, loot-queue, random
    login/             หน้า login ด้วย Discord
    api/auth/          Auth.js route handler
    actions/           Server actions: members, party, checkin, attendance,
                       pvp-stats, loot-queue, job-classes, party-templates, ฯลฯ
  components/          UI components ที่ใช้ร่วมกัน (party board, pvp stats, loot queue ฯลฯ)
  db/                   Drizzle schema + db client
  lib/                  Discord API helper, auth/authorization, data queries,
                       checkin config, party image rendering (canvas)
  auth.ts               ตั้งค่า Auth.js (Discord OAuth + สิทธิ์แอดมิน)
bot/
  index.ts              Entry point ของบอท
  sync.ts                ตรรกะซิงค์สมาชิก (full sync + อีเวนต์เรียลไทม์)
  reactions.ts           ระบบ reaction เลือกอาชีพ/แจ้งลา
  voice-attendance.ts     ติดตามใครเข้าห้อง voice ตอนไหน (สำหรับ /checkin)
  midnight-reset.ts       รีเซ็ตสถานะ "ลา" ทุกเที่ยงคืน
  commands.ts / interactions.ts   Slash command /party
  discord-client.ts      สร้าง Discord client พร้อม intents ที่ต้องใช้
drizzle/                 ไฟล์ SQL migration ที่ generate จาก schema
scripts/migrate.ts        สคริปต์รัน migration
```

## การทำงานของระบบซิงค์สมาชิก

- **ตอนบอทเริ่มทำงาน** และ **ทุก 30 นาที**: บอทจะดึงรายชื่อสมาชิกปัจจุบันทั้งหมดจาก Discord มาเทียบกับฐานข้อมูล — ใครที่อยู่ในกิลด์แต่ไม่มีในระบบจะถูกเพิ่มเป็นสมาชิกใหม่ ใครที่เคย active อยู่ในระบบแต่ไม่อยู่ใน Discord แล้วจะถูกเปลี่ยนสถานะเป็น "ออกจากกิลด์" อัตโนมัติ (ครอบคลุมกรณีบอทออฟไลน์ตอนมีคนเข้า-ออก)
- **แบบเรียลไทม์**: บอทฟังอีเวนต์ `guildMemberAdd` / `guildMemberRemove` / `guildMemberUpdate` โดยตรงจาก Discord Gateway เพื่ออัปเดตทันทีที่มีการเปลี่ยนแปลง
- **การเตะสมาชิก (kick)**: Discord ไม่ได้แยกอีเวนต์ "ถูกเตะ" กับ "ออกเอง" ให้ชัดเจนโดยไม่ใช้สิทธิ์ audit-log เพิ่มเติม ระบบนี้จึงบันทึกทั้งสองกรณีเป็น "ออกจากกิลด์" อัตโนมัติ ส่วนแอดมินสามารถกดทำเครื่องหมาย "ถูกเตะออก" เองในหน้ารายละเอียดสมาชิกได้ เพื่อแยกสถานะให้ชัดเจนในระบบ — หรือกดปุ่ม "เตะออก" ตรง ๆ จากเว็บให้เตะออกจาก Discord จริงพร้อมกันไปเลย

## Troubleshooting

- **Login แล้วเด้งกลับพร้อม error "NotAGuildMember"** — บัญชี Discord ที่ใช้ login ต้องมี role ที่ตรงกับ `DISCORD_TRACKED_ROLE_NAME` (ค่า default `Rooc`) ใน server ที่ตรงกับ `DISCORD_GUILD_ID`
- **Login แล้ว redirect ผิด / callback error "Configuration"** — ส่วนใหญ่เพราะลืมตั้ง `AUTH_URL`/`AUTH_TRUST_HOST` หรือ Redirect URI ใน Discord Developer Portal ไม่ตรงกับโดเมนจริงเป๊ะ (รวม `https://` และ path `/api/auth/callback/discord`)
- **บอทไม่เห็นสมาชิกเลย / sync ได้ 0 คน** — เช็คว่าเปิด **Server Members Intent** ใน Discord Developer Portal แล้ว และบอทถูกเชิญเข้า server จริง
- **role ใหม่ยังไม่ขึ้นเป็นแอดมินทันที** — สิทธิ์แอดมินคำนวณตอน login ใหม่ทุกครั้ง ให้ลอง logout แล้ว login ใหม่
- **push ขึ้น GitHub แล้ว Railway ไม่ deploy ให้เอง** — เช็คว่า Railway's GitHub App ยังเชื่อมต่อ repo อยู่ไหม (service → Settings → Source) การเชื่อมต่อหลุดได้เองบางครั้ง แก้โดย reconnect repo เดิมที่หน้านั้นอีกครั้ง
- **migration ใหม่ไม่ apply หลัง deploy** — เช็คว่าตั้ง Pre-Deploy Command เป็น `npm run db:migrate` ไว้ที่ web service แล้ว (ดูขั้นตอนที่ 2.2) ไม่งั้นต้องรันมือทุกครั้งตามขั้นตอนที่ 2.4
