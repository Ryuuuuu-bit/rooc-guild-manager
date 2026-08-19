CREATE TYPE "public"."party_section" AS ENUM('MAIN', 'SUB');--> statement-breakpoint
CREATE TABLE "party_busy_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"class_name" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "party_busy_entries_member_id_unique" UNIQUE("member_id")
);
--> statement-breakpoint
CREATE TABLE "party_leaders" (
	"id" text PRIMARY KEY NOT NULL,
	"leader_group" integer NOT NULL,
	"name" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "party_leaders_leader_group_unique" UNIQUE("leader_group")
);
--> statement-breakpoint
CREATE TABLE "party_slots" (
	"id" text PRIMARY KEY NOT NULL,
	"section" "party_section" NOT NULL,
	"party_number" integer NOT NULL,
	"slot_index" integer NOT NULL,
	"member_id" text,
	"class_name" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "party_busy_entries" ADD CONSTRAINT "party_busy_entries_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_slots" ADD CONSTRAINT "party_slots_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "party_slots_position_idx" ON "party_slots" USING btree ("section","party_number","slot_index");--> statement-breakpoint
CREATE INDEX "party_slots_member_id_idx" ON "party_slots" USING btree ("member_id");