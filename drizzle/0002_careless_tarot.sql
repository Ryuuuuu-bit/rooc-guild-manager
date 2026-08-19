ALTER TABLE "members" ADD COLUMN "discord_nickname" text;

-- One-time data reset: the roster is being rescoped to only track members
-- holding a specific Discord role (default "Rooc"). Wipe all previously
-- synced members/events; the bot will fully repopulate the roster with only
-- tracked-role holders on its next sync pass after this deploy.
TRUNCATE TABLE "membership_events", "members" RESTART IDENTITY CASCADE;