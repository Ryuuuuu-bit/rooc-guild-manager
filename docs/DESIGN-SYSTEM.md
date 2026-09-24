# Design System

ทุกหน้าใช้ภาษาดีไซน์เดียวกัน (โทนมืด, เส้นบาง, มินิมอล) — ถ้าจะเพิ่มหน้าใหม่ ให้ประกอบจากชิ้นส่วนในไฟล์นี้ก่อน อย่าสร้างสไตล์ใหม่เอง

## App shell (`src/components/shell/shell-client.tsx`)

| ส่วน | พฤติกรรม |
|---|---|
| Sidebar (desktop) | เมนูจัดกลุ่ม main / events / logs / system, badge งานค้าง, ย่อเป็น rail ได้, กล่อง "รอบถัดไป" ด้านล่าง |
| Top bar | ชื่อหน้า, ปุ่มค้นหา (`Ctrl K`), สถานะ live |
| Bottom bar (มือถือ) | 4 แท็บหลัก (Home, Members, Party, Loot) + ปุ่ม More เปิด sheet เมนูที่เหลือ |
| Command palette | `Ctrl K` / `⌘ K` — ค้นหาหน้าและชื่อสมาชิก (`getPaletteMembers`) |

เมนูทั้งหมดมาจาก `src/lib/nav-config.ts` ที่เดียว — เพิ่มหน้าใหม่ให้เพิ่ม item ที่นี่ (href, label, icon, group, badge?, tab?, adminOnly?) แล้ว sidebar, bottom bar และ palette จะอัปเดตเอง Badge เพิ่มได้ที่ `getNavStatus` ใน `src/app/actions/nav.ts`

## ไอคอน (`src/components/shell/app-icon.tsx`)

ใช้ `<AppIcon name="..." />` — SVG เส้นบาง 1.6px, `currentColor`, ขนาดตามตัวอักษร ห้ามใช้ emoji เป็นไอคอน UI (emoji ใช้ได้เฉพาะข้อความที่ส่งเข้า Discord)
ถ้าต้องการไอคอนใหม่ ให้เพิ่ม path ใน `app-icon.tsx` ในสไตล์เดียวกัน (viewBox 24, stroke เท่านั้น, ไม่มี fill)

## UI kit (`src/components/ui/kit.tsx`)

| คอมโพเนนต์ | ใช้ทำอะไร |
|---|---|
| `PageHeader` | หัวหน้า: title, คำอธิบาย, ปุ่มด้านขวา |
| `KpiGrid` + `Kpi` | กล่องตัวเลขสรุปขนาดเท่ากัน (tone, hint, progress bar, alert) — grid ตอบสนองอัตโนมัติ 2→4 คอลัมน์ |
| `Segmented` | ตัวเลือกช่วงเวลา/มุมมอง — ใส่ `href` เพื่อเป็นลิงก์ (state ใน URL) หรือใช้ `onSelect` |
| `Chip` | ตัวกรองแบบเปิด/ปิด พร้อมตัวนับ |
| `Card` / `CardHeader` | กล่องเนื้อหามาตรฐาน |
| `StatusTag` | ป้ายสถานะ (in, late, early, live, leave, absent ฯลฯ) สีตรงกันทุกหน้า |
| `EmptyState` | ข้อความตอนไม่มีข้อมูล |

## Dialog และ Toast (`src/components/feedback.tsx`)

**ห้ามใช้ `window.confirm` / `alert` / `prompt`** — ใช้แทนด้วย:

```ts
if (!(await uiConfirm({ title: "ลบรายการนี้?", message: "กู้คืนไม่ได้", danger: true }))) return;
const name = await uiPrompt({ title: "ตั้งชื่อรอบ", defaultValue: "Round 1" });
uiToast("คัดลอกแล้ว", { tone: "success", actionLabel: "Undo", onAction: () => restore() });
uiAlert("บันทึกไม่สำเร็จ");
```

ทุกตัวมี fallback เป็น native dialog ถ้า `FeedbackProvider` ยังไม่ mount ส่วนฟอร์มที่ submit ผ่าน `<form action>` ให้ยืนยันก่อนแล้วเรียก `form.requestSubmit()` (ดูตัวอย่างใน `member-status-actions.tsx`)

## Responsive

- โครงหน้า: `main` กว้างสุด `1600px`; หน้าที่ต้องใช้พื้นที่เต็ม (Party) ตั้ง `data-wide-page`
- Grid ใช้ `minmax(0, 1fr)` เสมอ เพื่อไม่ให้เนื้อหาดันจนล้นจอมือถือ
- กล่องในแถวเดียวกันต้องสูง/กว้างเท่ากัน (KPI, การ์ดหมวด)
- ทดสอบที่ 390px (มือถือ), 768px (แท็บเล็ต), 1440px (desktop)

## สีและโทน

- พื้นหลังโทน zinc เข้ม, การ์ดยกขึ้นเล็กน้อยด้วยขอบบาง
- สีสถานะ: เขียว = ปกติ/ตรงเวลา, เหลืองอำพัน = เตือน/สาย, แดง = ขาด/อันตราย, ฟ้า = live/ข้อมูล, ม่วง = ลา
- สีอาชีพมาจาก `src/lib/job-class-colors.ts` / ตาราง `job_classes`

## ข้อควรระวัง (เคยเจอแล้ว)

- **Hydration mismatch**: อย่าใช้ `toLocaleString` กับวันที่ใน client component (server/browser ให้ผลต่างกัน เช่น "Sept" กับ "Sep") — สร้าง string เอง
- **ห้ามเรียก `Date.now()` ระหว่าง render** (lint `purity`) — ส่ง `now` มาจาก server
- **ห้าม setState ใน effect** แบบ sync (lint `set-state-in-effect`) และอย่า reassign ตัวแปรภายใน `.map()` ตอน render
- `useDraggable` จาก dnd-kit ให้ destructure ค่าออกมาก่อนใช้ (lint `refs`)
