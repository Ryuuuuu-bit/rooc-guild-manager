CREATE TABLE "loot_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loot_queue_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"category_id" text NOT NULL,
	"member_id" text NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loot_rounds" (
	"id" text PRIMARY KEY NOT NULL,
	"category_id" text NOT NULL,
	"label" text,
	"member_ids" text[] DEFAULT '{}' NOT NULL,
	"previous_positions" integer[] DEFAULT '{}' NOT NULL,
	"actor" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "loot_queue_entries" ADD CONSTRAINT "loot_queue_entries_category_id_loot_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."loot_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loot_queue_entries" ADD CONSTRAINT "loot_queue_entries_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loot_rounds" ADD CONSTRAINT "loot_rounds_category_id_loot_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."loot_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "loot_categories_name_idx" ON "loot_categories" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "loot_queue_entries_category_member_idx" ON "loot_queue_entries" USING btree ("category_id","member_id");--> statement-breakpoint
CREATE INDEX "loot_queue_entries_category_position_idx" ON "loot_queue_entries" USING btree ("category_id","position");--> statement-breakpoint
CREATE INDEX "loot_rounds_category_idx" ON "loot_rounds" USING btree ("category_id");