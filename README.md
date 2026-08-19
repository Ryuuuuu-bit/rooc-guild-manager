# ROOC Guild Manager

เว็บแอปสำหรับจัดการสมาชิกกิลด์เกม ROOC โดยซิงค์ข้อมูลสมาชิกกับ Discord server ของกิลด์แบบอัตโนมัติ — เมื่อมีคนเข้า/ออก Discord server บอทจะอัปเดตสถานะในระบบให้ทันที พร้อมเก็บประวัติการเข้า-ออกทั้งหมด

## ฟีเจอร์หลัก

- **ซิงค์สมาชิกอัตโนมัติ** — บอท Discord คอยฟังอีเวนต์เข้า/ออกของสมาชิกแบบเรียลไทม์ พร้อมซิงค์เต็มรูปแบบทุก 30 นาทีเป็น safety net (เผื่อบอทออฟไลน์ตอนที่มีคนเข้า-ออก)
- **Login ด้วย Discord OAuth** — ต้องเป็นสมาชิกของ Discord server กิลด์เท่านั้นถึงจะเข้าใช้งานได้ ระบบเช็ค role ใน Discord เพื่อกำหนดว่าใครเป็นแอดมิน
- **หน้าภาพรวม (Dashboard)** — จำนวนสมาชิกทั้งหมด/active/ออกไปแล้ว/ถูกเตะ และจำนวนเข้า-ออกใน 7 วันล่าสุด
- **รายชื่อสมาชิก** — ค้นหา/กรองตามสถานะและยศ พร้อมรูปโปรไฟล์และข้อมูลจาก Discord
- **หน้ารายละเอียดสมาชิก** — แอดมินแก้ไขชื่อในเกม คลาส เลเวล ยศในกิลด์ และโน้ตภายในได้ พร้อมดูประวัติกิจกรรมทั้งหมดของสมาชิกคนนั้น
- **ประวัติกิจกรรม (Activity Log)** — บันทึกทุกครั้งที่มีคนเข้า/ออก/ถูกเตะ หรือแอดมินแก้ไขข้อมูล

## สถาปัตยกรรม

โปรเจกต์นี้มี 2 process ที่ทำงานแยกกันแต่ใช้ฐานข้อมูลเดียวกัน:

1. **Web app** (Next.js) — หน้าเว็บ + login + API สำหรับแอดมินแก้ไขข้อมูล
2. **Bot worker** (discord.js) — เชื่อมต่อกับ Discord Gateway ตลอดเวลาเพื่อฟังอีเวนต์เข้า/ออกของสมาชิก

ทั้งสองต้องรันแยกกันเพราะบอท Discord ต้องเป็น process ที่รันค้างตลอดเวลา (ไม่ใช่ serverless function) จึงแนะนำให้ deploy ทั้งคู่บน **Railway** เป็น 2 services จาก repo เดียวกัน ใช้ **PostgreSQL** (Railway plugin) เป็นฐานข้อมูลร่วม

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

Stack: Next.js 16 (App Router) · TypeScript · Tailwind CSS · Auth.js (Discord OAuth) · Drizzle ORM · PostgreSQL · discord.js v14

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
   - เลือก scope: `bot`
   - เลือก permission: `View Channels` (ก็เพียงพอ — บอทแค่ต้องอ่านรายชื่อสมาชิก ไม่ต้องส่งข้อความ)
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
- **Variables** (ดูรายการทั้งหมดในขั้นตอนที่ 3) — อย่างน้อยต้องมี `DATABASE_URL` (อ้างอิงจาก Postgres plugin ผ่าน `${{Postgres.DATABASE_URL}}`), `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_GUILD_ID`, `AUTH_SECRET`
- **Settings → Networking** → กด **Generate Domain** เพื่อได้โดเมนสาธารณะ (เช่น `rooc-guild.up.railway.app`)
- กลับไปที่ Discord Developer Portal → OAuth2 → Redirects → เพิ่ม `https://<โดเมนที่ได้>/api/auth/callback/discord`

### 2.3 สร้าง service สำหรับบอท (จาก repo เดียวกัน)

1. ในโปรเจกต์ Railway เดียวกัน กด **New → GitHub Repo** แล้วเลือก repo เดิมอีกครั้ง (จะได้ service ที่สอง)
2. ตั้งชื่อ service เช่น `bot`
3. **Settings → Deploy**:
   - Start Command: `npm run bot:start`
   - **ปิด** public networking ของ service นี้ (บอทไม่ต้องรับ HTTP request จากภายนอก)
4. **Variables**: ใส่ `DATABASE_URL`, `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID` (ไม่ต้องใส่ตัวแปรที่เกี่ยวกับ OAuth/AUTH_SECRET เพราะบอทไม่ได้ใช้)

### 2.4 รัน migration ครั้งแรก

หลังจากตั้งค่า `DATABASE_URL` ของ Postgres plugin แล้ว ต้องสร้างตารางในฐานข้อมูลก่อนใช้งานจริง วิธีที่ง่ายที่สุดคือรันจากเครื่องตัวเอง โดยตั้ง `DATABASE_URL` ชั่วคราวให้ชี้ไปที่ Postgres บน Railway (คัดลอกจากแท็บ Connect ของ Postgres plugin แล้วใช้ "Public Network" connection string):

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
| `DISCORD_BOT_TOKEN` | bot | จาก Discord App → Bot |
| `DISCORD_GUILD_ID` | web + bot | Server ID ของกิลด์ |
| `DISCORD_ADMIN_ROLE_IDS` | web | Role ID (คั่นด้วย comma) ที่ให้สิทธิ์แอดมิน |
| `DISCORD_ADMIN_USER_IDS` | web | User ID (คั่นด้วย comma) ที่ให้สิทธิ์แอดมินเสมอ (ไม่บังคับ) |
| `DISCORD_TRACKED_ROLE_NAME` | web + bot | ชื่อ Discord role ที่ใช้กรองว่าใครคือ "สมาชิกกิลด์" ใน roster (ไม่บังคับ, ค่า default คือ `Rooc`) |
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
| `npm run db:generate` | สร้างไฟล์ migration ใหม่หลังจากแก้ `src/db/schema.ts` |
| `npm run db:migrate` | รัน migration ที่ยังไม่ได้ apply กับฐานข้อมูล |
| `npm run db:studio` | เปิด Drizzle Studio (GUI ดู/แก้ข้อมูลในฐานข้อมูล) |
| `npm run lint` | ตรวจสอบโค้ดด้วย ESLint |

---

## โครงสร้างโปรเจกต์

```
src/
  app/
    (app)/            หน้าที่ต้อง login: dashboard, members, activity
    login/             หน้า login ด้วย Discord
    api/auth/          Auth.js route handler
    actions/           Server actions สำหรับแอดมินแก้ไขข้อมูล
  components/          UI components ที่ใช้ร่วมกัน
  db/                   Drizzle schema + db client
  lib/                  Discord API helper, auth/authorization helper, data queries
  auth.ts               ตั้งค่า Auth.js (Discord OAuth + สิทธิ์แอดมิน)
bot/
  index.ts              Entry point ของบอท
  sync.ts                ตรรกะซิงค์สมาชิก (full sync + อีเวนต์เรียลไทม์)
  discord-client.ts      สร้าง Discord client พร้อม intents ที่ต้องใช้
drizzle/                 ไฟล์ SQL migration ที่ generate จาก schema
scripts/migrate.ts        สคริปต์รัน migration
```

## การทำงานของระบบซิงค์สมาชิก

- **ตอนบอทเริ่มทำงาน** และ **ทุก 30 นาที**: บอทจะดึงรายชื่อสมาชิกปัจจุบันทั้งหมดจาก Discord มาเทียบกับฐานข้อมูล — ใครที่อยู่ในกิลด์แต่ไม่มีในระบบจะถูกเพิ่มเป็นสมาชิกใหม่ ใครที่เคย active อยู่ในระบบแต่ไม่อยู่ใน Discord แล้วจะถูกเปลี่ยนสถานะเป็น "ออกจากกิลด์" อัตโนมัติ (ครอบคลุมกรณีบอทออฟไลน์ตอนมีคนเข้า-ออก)
- **แบบเรียลไทม์**: บอทฟังอีเวนต์ `guildMemberAdd` / `guildMemberRemove` / `guildMemberUpdate` โดยตรงจาก Discord Gateway เพื่ออัปเดตทันทีที่มีการเปลี่ยนแปลง
- **การเตะสมาชิก (kick)**: Discord ไม่ได้แยกอีเวนต์ "ถูกเตะ" กับ "ออกเอง" ให้ชัดเจนโดยไม่ใช้สิทธิ์ audit-log เพิ่มเติม ระบบนี้จึงบันทึกทั้งสองกรณีเป็น "ออกจากกิลด์" อัตโนมัติ ส่วนแอดมินสามารถกดทำเครื่องหมาย "ถูกเตะออก" เองในหน้ารายละเอียดสมาชิกได้ เพื่อแยกสถานะให้ชัดเจนในระบบ

## Troubleshooting

- **Login แล้วเด้งกลับพร้อม error "NotAGuildMember"** — บัญชี Discord ที่ใช้ login ต้องเป็นสมาชิกของ server ที่ตรงกับ `DISCORD_GUILD_ID`
- **Login แล้ว redirect ผิด / callback error** — เช็คว่า Redirect URI ใน Discord Developer Portal ตรงกับโดเมนจริงเป๊ะ (รวม `https://` และ path `/api/auth/callback/discord`)
- **บอทไม่เห็นสมาชิกเลย / sync ได้ 0 คน** — เช็คว่าเปิด **Server Members Intent** ใน Discord Developer Portal แล้ว และบอทถูกเชิญเข้า server จริง
- **role ใหม่ยังไม่ขึ้นเป็นแอดมินทันที** — สิทธิ์แอดมินคำนวณตอน login ใหม่ทุกครั้ง ให้ลอง logout แล้ว login ใหม่
