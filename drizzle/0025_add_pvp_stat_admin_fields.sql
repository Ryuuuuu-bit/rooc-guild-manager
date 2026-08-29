CREATE TABLE "pvp_stat_field_defs" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"group_title" text DEFAULT 'อื่นๆ' NOT NULL,
	"is_percent" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pvp_stat_field_defs_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "pvp_stat_entries" ADD COLUMN "custom_values" jsonb;--> statement-breakpoint
ALTER TABLE "pvp_stat_entries" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pvp_stat_entries" ADD COLUMN "edited_by_username" text;--> statement-breakpoint
CREATE INDEX "pvp_stat_field_defs_sort_order_idx" ON "pvp_stat_field_defs" USING btree ("sort_order");