ALTER TABLE "pvp_stat_entries" ADD COLUMN "review_status" text;--> statement-breakpoint
ALTER TABLE "pvp_stat_entries" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "pvp_stat_entries" ADD COLUMN "reviewed_by_username" text;--> statement-breakpoint
ALTER TABLE "pvp_stat_entries" ADD COLUMN "reviewed_at" timestamp with time zone;