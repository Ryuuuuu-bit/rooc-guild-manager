# Changelog

## กันยายน 2026 — Redesign ทั้งเว็บ

### App shell (Phase 1)
- เมนูใหม่: sidebar จัดกลุ่ม + badge งานค้าง (ปาร์ตี้, สมาชิก, กิจกรรม, ลา, เช็คชื่อ), ย่อเป็น rail ได้, กล่อง "รอบถัดไป"
- Top bar + ค้นหาทั้งเว็บ `Ctrl K` (หน้า + ชื่อสมาชิก)
- มือถือ: bottom bar 4 แท็บ + More sheet
- ไอคอนเส้นบางแบบมินิมอลชุดเดียวทั้งเว็บ (`AppIcon`) แทน emoji/ไอคอนเดิม
- หน้าต่างยืนยัน / ถาม / แจ้งเตือน / toast แบบเดียวกันทุกหน้า แทน `window.confirm/alert/prompt` ทั้งหมด (55 จุด)
- ลบไฟล์เมนูเก่า (`nav.tsx`, `nav-links.tsx`, `nav-icons.tsx`) และแข่งม้าใน Random Picker (`horse-race-track.tsx`)

### หน้าต่าง ๆ (Phase 2/3)
- **UI kit กลาง** (`src/components/ui/kit.tsx`): PageHeader, KPI ขนาดเท่ากัน, Segmented, Chip, Card, StatusTag, EmptyState
- **Check-in**: แถบรอบ (รวมรอบที่ถูก void), KPI, สถานะ ตรงเวลา / สาย (>5 นาที) / ออกก่อน / live / ลา / ขาด, ตัวกรอง, โน้ตรายคน
- **Leave Stats**: KPI เดือนนี้, จุดโควต้า 2 ครั้ง/บอร์ด, นับแยกบอร์ด, ช่วงวันที่กำหนดเอง, ฟอร์มยกเลิกรอบแบบใหม่
- **Activity Log**: ช่วง 24 ชม., หมวดกิจกรรม, จัดกลุ่มตามวัน, ลบพร้อมยืนยัน
- **Random Picker**: สุ่มเฉพาะคนในห้องเสียง, กรองตามอาชีพ, ประวัติการสุ่ม, ปิดเสียงได้
- **Manage Classes**: การ์ดอาชีพ, จำนวนคนที่ใช้, แถบสี, ตั้ง key stat เร็ว, เรียงลำดับ, แก้/ลบ

### Party board
- แถบความพร้อม (ครบ/ขาด/ลา), ไฮไลต์ตามอาชีพ
- ค้นหาตัวสำรองต่อช่อง + การ์ด "ต้องหาคนแทน"
- CP ปาร์ตี้จาก key stat + ปุ่ม Auto-balance (ลดความต่าง CP ระหว่างปาร์ตี้)
- สูตรอาชีพต่อบอร์ด (recipe), แสดงรายการเปลี่ยนแปลงก่อนบันทึก, Undo
- Migration `0039_add_board_party_recipe`

### Loot Queue
- การ์ดหมวดของ, KPI รอบคิว (lap), เส้นตัดแสดงว่าใครได้รอบนี้, พรีวิวข้อความ Discord
- แผงแจกของ: คัดลอกอัตโนมัติ + Undo, ลากเรียงลำดับคิว, ค้นหาสมาชิก, เพิ่มหลายคนพร้อมกัน
- ประวัติ: เมนูคัดลอก 3 รูปแบบ, เลขลำดับเริ่มของรอบ
- Migration `0040_add_loot_round_start_number`

### เอกสาร
- เขียน README ใหม่ + เพิ่ม `docs/` (FEATURES, ARCHITECTURE, DESIGN-SYSTEM, OPERATIONS, CHANGELOG)
- เพิ่ม `Claude outputs/` ใน `.gitignore` (ไฟล์ mockup มีข้อมูลสมาชิกจริง)

## สิงหาคม 2026
- **ระบบลา v2**: ลารายรอบ + ลาล่วงหน้าเป็นช่วง, โควต้า 2 ครั้ง/บอร์ด/เดือน (เตือน ไม่บล็อก), void รอบ → ใบลาเป็น CANCELLED (migration `0034`)
- อาชีพรองของสมาชิก (`0035`), ลบ party templates (`0036`), `playing_as` ในช่องปาร์ตี้ (`0037`), key stat อาชีพ (`0038`)
- PVP stats: แสดง "เก่า" ที่ 14 วัน, บอทเตือน DM ที่ 21 วัน
- แจ้งเตือนห้องแอดมิน (`DISCORD_ADMIN_NOTIFY_CHANNEL_ID`)
