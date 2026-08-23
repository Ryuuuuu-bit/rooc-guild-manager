-- Follow-up to 0016. That migration matched the target board by exact name
-- ("GL"), which ran without a SQL error but silently backfilled 0 rows —
-- reported by an admin as "GL still shows nothing" after the deploy. Most
-- likely cause: the board's stored name isn't byte-for-byte "GL" (case,
-- surrounding whitespace, etc. all defeat an exact match), even though it
-- renders as "GL" on screen.
--
-- This version doesn't depend on the name matching at all: it tries the
-- same exact-name match first (cheap, still correct if that WAS the name),
-- and falls back to whichever board was created first — which, per the
-- guild admin, was unambiguously the only board that existed when these
-- leaves were logged, regardless of what it happens to be named today.
UPDATE "membership_events"
SET "board_id" = COALESCE(
  (SELECT "id" FROM "party_boards" WHERE "name" = 'GL' LIMIT 1),
  (SELECT "id" FROM "party_boards" ORDER BY "created_at" ASC LIMIT 1)
)
WHERE "board_id" IS NULL
  AND "type" = 'ATTENDANCE_LEAVE'
  AND "confirmed_at" IS NOT NULL;
