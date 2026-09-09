ALTER TYPE "public"."event_type" ADD VALUE 'AUCTION_BAN';--> statement-breakpoint
ALTER TYPE "public"."event_type" ADD VALUE 'AUCTION_UNBAN';--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "auction_ban_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "auction_ban_reason" text;