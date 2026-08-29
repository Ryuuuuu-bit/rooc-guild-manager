CREATE TABLE "pvp_stat_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"role" text,
	"cp" integer,
	"p_def" integer,
	"m_def" integer,
	"pvp_bonus" integer,
	"pvp_reduction" integer,
	"p_dmg_reduction_pct" double precision,
	"m_dmg_reduction_pct" double precision,
	"atk" integer,
	"matk" integer,
	"ignore_p_def" integer,
	"ignore_m_def" integer,
	"p_dmg_bonus_pct" double precision,
	"m_dmg_bonus_pct" double precision,
	"boss_cards" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pvp_stat_entries" ADD CONSTRAINT "pvp_stat_entries_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pvp_stat_entries_member_id_created_at_idx" ON "pvp_stat_entries" USING btree ("member_id","created_at");