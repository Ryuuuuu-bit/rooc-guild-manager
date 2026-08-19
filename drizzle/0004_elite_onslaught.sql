DROP INDEX "members_guild_rank_idx";--> statement-breakpoint
ALTER TABLE "members" DROP COLUMN "guild_rank";--> statement-breakpoint
DROP TYPE "public"."guild_rank";