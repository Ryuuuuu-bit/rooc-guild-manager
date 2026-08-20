CREATE TABLE "job_classes" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"emoji" text NOT NULL,
	"color_key" text DEFAULT 'stone' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_classes_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "party_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"structure" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "job_classes_sort_order_idx" ON "job_classes" USING btree ("sort_order");
--> statement-breakpoint
-- Seed the 15 classes that previously lived as a hard-coded constant in
-- src/lib/classes.ts, preserving their existing emoji (used both for the
-- web badge and the Discord reaction message) and closest matching color
-- from the new fixed palette, in their existing display order.
INSERT INTO "job_classes" ("id", "name", "emoji", "color_key", "sort_order") VALUES
('jc_bio', 'Bio', '🧪', 'orange', 0),
('jc_bd', 'B/D', '🎵', 'amber', 1),
('jc_doramstr', 'DoramSTR', '🐾', 'violet', 2),
('jc_doramint', 'DoramINT', '🪄', 'purple', 3),
('jc_knight', 'Knight', '⚔️', 'rose', 4),
('jc_priest', 'Priest', '✝️', 'emerald', 5),
('jc_wizmeteo', 'WizMeteo', '🔥', 'pink', 6),
('jc_wizcc', 'WizCC', '❄️', 'sky', 7),
('jc_paladin', 'Paladin', '🛡️', 'fuchsia', 8),
('jc_rouge', 'Rouge', '⚡', 'indigo', 9),
('jc_assassin', 'Assassin', '🗡️', 'red', 10),
('jc_sage', 'Sage', '📖', 'teal', 11),
('jc_champion', 'Champion', '👊', 'yellow', 12),
('jc_sniper', 'Sniper', '🏹', 'lime', 13),
('jc_blacksmith', 'Blacksmith', '🔨', 'stone', 14);