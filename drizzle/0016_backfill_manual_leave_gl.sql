-- One-time data backfill, not a schema change. Before per-board attendance
-- tracking existed there was only ever one board ("GL"), so every
-- confirmed ATTENDANCE_LEAVE logged back then (via reaction, before
-- board_id was wired up, or via the manual "บันทึกการลาย้อนหลัง" admin
-- form, which never asked for a board) has board_id = NULL. That made
-- them silently disappear from the new per-board /attendance breakdown
-- (bucketed as "ไม่ระบุกระดาน" instead of counting toward "GL"), which is
-- what a guild admin flagged after the per-board split shipped.
--
-- Attributing those to GL is safe precisely because GL was the only board
-- in existence at the time they were logged — this does not touch any
-- leave logged after the WOE board (or any other board) started existing,
-- since a real board_id was always set from that point on. It only
-- touches rows still NULL right now; it does not affect any future
-- intentionally-unattributed manual leave (an admin can still pick "ไม่ระบุ"
-- going forward).
UPDATE "membership_events"
SET "board_id" = (SELECT "id" FROM "party_boards" WHERE "name" = 'GL' LIMIT 1)
WHERE "board_id" IS NULL
  AND "type" = 'ATTENDANCE_LEAVE'
  AND "confirmed_at" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "party_boards" WHERE "name" = 'GL');
