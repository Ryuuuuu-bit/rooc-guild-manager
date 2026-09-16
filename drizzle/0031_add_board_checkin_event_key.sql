ALTER TABLE "party_boards" ADD COLUMN "checkin_event_key" text;--> statement-breakpoint
-- Backfill: the app used to find the "GL"/"WOE" boards purely by matching
-- partyBoards.name against CHECKIN_EVENTS' now-removed attendanceBoardName
-- field. Link whatever board is currently named exactly "GL"/"WOE" to the
-- matching event key up front, so leave-timing gating, /checkin and
-- /calendar keep working immediately after this deploy without an admin
-- having to manually re-link them in the "โพสต์ ลา ใน Discord" dialog. A
-- future rename/new board still needs linking there — this only covers the
-- boards already playing that role today.
UPDATE "party_boards" SET "checkin_event_key" = 'gl' WHERE "name" = 'GL' AND "checkin_event_key" IS NULL;--> statement-breakpoint
UPDATE "party_boards" SET "checkin_event_key" = 'woe' WHERE "name" = 'WOE' AND "checkin_event_key" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "party_boards_checkin_event_key_idx" ON "party_boards" USING btree ("checkin_event_key");