# Architecture

ภาพรวมโครงสร้างโค้ด โมเดลข้อมูล และกฎการคำนวณที่ระบบใช้ — อ่านไฟล์นี้ก่อนแก้โค้ดส่วนไหนก็ตาม จะได้ไม่ต้องไล่โค้ดใหม่ทั้งหมด

## ภาพรวม

```
Discord Guild ──(gateway events)──▶  bot service (discord.js, tsx bot/index.ts)
      ▲                                   │  เขียน/อ่าน
      │ REST (DM, โพสต์ข้อความ, ตั้ง role)   ▼
      └──────────────  web service  ◀──▶  Postgres (Drizzle)
                   (Next.js 16 App Router,
                    next-auth v5 Discord OAuth)
```

ทั้งสอง service รันจาก repo เดียวกันบน Railway และใช้ฐานข้อมูลเดียวกัน โค้ดที่ต้องใช้ร่วมกันอยู่ใน `src/lib/*` แบบ "plain data" (ไม่ import Next.js) เพื่อให้ bot import ได้ด้วย relative path เช่น `src/lib/leave-quota.ts`, `src/lib/checkin-events.ts`, `src/lib/party-image.ts`

## Web (`src/`)

| โฟลเดอร์ | หน้าที่ |
|---|---|
| `src/app/(app)/*` | หน้าที่ต้องล็อกอิน (overview, members, party, loot-queue, checkin, attendance, calendar, activity, random, classes, pvp-stats) — `layout.tsx` ครอบด้วย `ShellProvider` + `FeedbackProvider` |
| `src/app/actions/*` | Server Actions ทั้งหมด (ทุกตัวต้องเรียก `requireUser`/`requireAdmin` จาก `src/lib/authz.ts`) |
| `src/lib/*-data.ts` | ฟังก์ชันอ่านข้อมูลฝั่ง server สำหรับแต่ละหน้า (query + แปลงเป็น view model) |
| `src/lib/nav-config.ts` | รายการเมนูเดียวที่ sidebar / bottom bar / command palette ใช้ร่วมกัน |
| `src/components/shell/*` | App shell: sidebar, top bar, bottom bar มือถือ, `Ctrl K`, ไอคอน `AppIcon` |
| `src/components/ui/kit.tsx` | UI kit กลาง (PageHeader, Kpi, Segmented, Chip, Card, StatusTag, EmptyState) |
| `src/components/feedback.tsx` | `uiConfirm` / `uiPrompt` / `uiAlert` / `uiToast` แทน `window.confirm/alert/prompt` |
| `src/components/<feature>/*` | คอมโพเนนต์ของแต่ละฟีเจอร์ (party, checkin, leave-stats, activity) |
| `src/db/schema.ts` | Drizzle schema (มีคอมเมนต์อธิบายแต่ละคอลัมน์) |

รายละเอียดดีไซน์ → [DESIGN-SYSTEM.md](./DESIGN-SYSTEM.md)

## Bot (`bot/`)

| ไฟล์ | หน้าที่ |
|---|---|
| `index.ts` | จุดเริ่ม: login, ลงทะเบียน event, ตั้ง interval (full sync 30 นาที, stale-leave sweep 6 ชม.) |
| `sync.ts` | sync สมาชิก/role จาก Discord → ตาราง `members`, `discord_roles`, `membership_events` |
| `voice-attendance.ts` | บันทึกเข้า/ออกห้องเสียง → `voice_attendance_events` (ใช้คำนวณเช็คชื่อ) |
| `leaves.ts` | แผงลา (ปุ่ม/เมนู), บันทึกลา, DM ยืนยัน, แจ้งเตือนเกินโควต้า |
| `interactions.ts` / `commands.ts` | ปุ่ม, select menu, slash command |
| `job-classes.ts` | แผงเลือกอาชีพ → role Discord |
| `party-data.ts` / `board-helpers.ts` | โพสต์รูปจัดปาร์ตี้ (render ด้วย `@napi-rs/canvas` ผ่าน `src/lib/party-image.ts`) |
| `pvp-stats-reminder.ts` | เตือน DM เมื่อค่าสถานะ PVP เก่าเกิน 21 วัน |
| `admin-notify.ts` | ส่งแจ้งเตือนไปห้องแอดมิน (`DISCORD_ADMIN_NOTIFY_CHANNEL_ID`) |
| `welcome-message.ts` | ข้อความต้อนรับสมาชิกใหม่ |

## โมเดลข้อมูล (ตารางหลัก)

| ตาราง | เก็บอะไร |
|---|---|
| `members` | สมาชิก (discordId, ชื่อ, อาชีพหลัก, alt classes, สถานะ active/benched/kicked, ban ประมูล) |
| `discord_roles`, `membership_events` | role ที่ sync มา และประวัติเข้า/ออก/เปลี่ยนสถานะ |
| `party_boards` | บอร์ดกิจกรรม (ชื่อ, ช่องเสียง, วัน/เวลา, `party_recipe` jsonb) |
| `party_groups`, `party_group_parties`, `party_slots` | กลุ่ม → ปาร์ตี้ → ช่อง (สมาชิก + `playing_as`) |
| `party_busy_entries` | สมาชิกที่ติดธุระในรอบนั้น |
| `leaves`, `scheduled_leaves` | ใบลา v2 (รายรอบ / ลาล่วงหน้าเป็นช่วง) |
| `voice_attendance_events` | เหตุการณ์เข้า/ออกห้องเสียง |
| `checkin_notes` | โน้ตแอดมินต่อสมาชิกต่อรอบ |
| `loot_categories`, `loot_queue_entries`, `loot_rounds` | หมวดของ, ลำดับคิว, ประวัติการแจก (`start_number`) |
| `job_classes` | อาชีพ (สี, emoji, role, `key_stat` สำหรับ PVP) |
| `pvp_stat_field_defs`, `pvp_stat_entries` | ช่องค่าสถานะ PVP และค่าที่สมาชิกกรอก |
| `member_notes`, `bot_reaction_messages` | โน้ตแอดมิน, ข้อความที่บอทติดตาม |

## กฎการคำนวณ

**ลา (Leave v2)** — ลาผูกกับ "รอบ" ของบอร์ด (วันที่ + บอร์ด) โควต้า `MONTHLY_LEAVE_LIMIT = 2` ครั้ง/บอร์ด/เดือน (`src/lib/leave-quota.ts`) — ไม่บล็อก แค่แสดงเตือนใน DM, แจ้งแอดมิน และหน้า Attendance ถ้าแอดมิน "ยกเลิกรอบ" (void) ใบลาของรอบนั้นจะถูกตั้งเป็น `CANCELLED` หลังรอบจบ ไม่นับโควต้า

**เช็คชื่อ** (`src/lib/checkin-view.ts`) — ใช้ event ห้องเสียงเทียบกับเวลาเริ่ม/จบรอบ สถานะ: `in` (ตรงเวลา), `late` (เข้าช้ากว่า `LATE_MINUTES = 5` นาที), `early` (ออกก่อนจบ), `live` (รอบกำลังเล่นและอยู่ในห้อง), `leave` (มีใบลา), `absent` (ไม่มา) — รอบที่ถูก void จะแสดงแยก

**คิวของ (Loot Queue)** — แต่ละหมวดมีลำดับคิวของตัวเอง การ "แจก" หนึ่งรอบ = ตัด N คนแรกไปท้ายคิว และบันทึก `loot_rounds` (รายชื่อ, `start_number`) "รอบคิว (lap)" = ทุกคนได้ครบหนึ่งรอบ สมาชิกที่ benched/ban ประมูลจะถูกข้าม

**ปาร์ตี้** (`src/components/party/party-board-logic.ts`) — CP ของปาร์ตี้มาจาก key stat ของอาชีพ (ค่า PVP), ปาร์ตี้ที่ขาดข้อมูลใช้ค่ามัธยฐานของกลุ่มแทน Auto-balance สลับสมาชิกระหว่างปาร์ตี้เต็มเพื่อลดความแปรปรวนของ CP โดยคงสูตรอาชีพ (recipe) ของบอร์ด ทุกการเปลี่ยนแปลงคำนวณเป็น diff แล้วบันทึกทีเดียวผ่าน `applySlotLayout` (มี undo)

**PVP stats** — ค่าที่ไม่อัปเดตเกิน 14 วัน = "เก่า" บนเว็บ, บอทเตือน DM ที่ 21 วัน

**Nav badges** (`src/app/actions/nav.ts` → `getNavStatus`) — ดึงทุกครั้งที่เปลี่ยนหน้า + ทุก 60 วินาที: รอบที่กำลัง live/ถัดไป, คนในห้องเสียง, คนลา และตัวเลขงานค้างของแอดมิน

## การยืนยันตัวตนและสิทธิ์

- ล็อกอินด้วย Discord OAuth (next-auth v5) ต้องเป็นสมาชิกกิลด์
- แอดมิน = มี role ใน `DISCORD_ADMIN_ROLE_IDS` หรือ user id อยู่ใน `DISCORD_ADMIN_USER_IDS` — ตรวจทุก server action ด้วย `requireAdmin()`
- เมนูที่เห็นกรองด้วย `navItemsFor(isAdmin)` แต่การป้องกันจริงอยู่ที่ server action เสมอ
