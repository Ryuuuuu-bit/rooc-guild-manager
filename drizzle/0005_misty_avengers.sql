CREATE TABLE "party_boards" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "party_group_parties" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "party_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"board_id" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "party_leaders" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "party_leaders" CASCADE;--> statement-breakpoint
-- Restructuring to the flexible multi-board model below — old fixed
-- Main/Sub Stage assignments don't map onto the new free-form group/party
-- shape, so this is a one-time wipe of prior assignments (not member data).
TRUNCATE TABLE "party_slots";--> statement-breakpoint
TRUNCATE TABLE "party_busy_entries";--> statement-breakpoint
ALTER TABLE "party_busy_entries" DROP CONSTRAINT "party_busy_entries_member_id_unique";--> statement-breakpoint
DROP INDEX "party_slots_position_idx";--> statement-breakpoint
ALTER TABLE "party_busy_entries" ADD COLUMN "board_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "party_slots" ADD COLUMN "party_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "party_group_parties" ADD CONSTRAINT "party_group_parties_group_id_party_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."party_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_groups" ADD CONSTRAINT "party_groups_board_id_party_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."party_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "party_group_parties_group_id_idx" ON "party_group_parties" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "party_groups_board_id_idx" ON "party_groups" USING btree ("board_id");--> statement-breakpoint
ALTER TABLE "party_busy_entries" ADD CONSTRAINT "party_busy_entries_board_id_party_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."party_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_slots" ADD CONSTRAINT "party_slots_party_id_party_group_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."party_group_parties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "party_busy_board_member_idx" ON "party_busy_entries" USING btree ("board_id","member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "party_slots_position_idx" ON "party_slots" USING btree ("party_id","slot_index");--> statement-breakpoint
ALTER TABLE "party_slots" DROP COLUMN "section";--> statement-breakpoint
ALTER TABLE "party_slots" DROP COLUMN "party_number";--> statement-breakpoint
DROP TYPE "public"."party_section";--> statement-breakpoint
-- Seed two starter boards so the /party page isn't an empty shell on first
-- load: "ปกติ" mirrors the admin's original Main/Sub Stage layout, "GVG"
-- mirrors the flexible PartyA/B/C example they provided. Both are fully
-- editable afterwards (rename/add/remove groups and parties in the UI).
DO $$
DECLARE
  v_board_normal text := gen_random_uuid()::text;
  v_board_gvg text := gen_random_uuid()::text;
  v_group_main text := gen_random_uuid()::text;
  v_group_sub1 text := gen_random_uuid()::text;
  v_group_sub2 text := gen_random_uuid()::text;
  v_group_a text := gen_random_uuid()::text;
  v_group_b text := gen_random_uuid()::text;
  v_group_c text := gen_random_uuid()::text;
  i int;
BEGIN
  INSERT INTO party_boards (id, name, sort_order) VALUES (v_board_normal, 'ปกติ', 0);
  INSERT INTO party_boards (id, name, sort_order) VALUES (v_board_gvg, 'GVG', 1);

  INSERT INTO party_groups (id, board_id, name, sort_order) VALUES (v_group_main, v_board_normal, 'Main Stage', 0);
  INSERT INTO party_groups (id, board_id, name, sort_order) VALUES (v_group_sub1, v_board_normal, 'Sub Stage 1', 1);
  INSERT INTO party_groups (id, board_id, name, sort_order) VALUES (v_group_sub2, v_board_normal, 'Sub Stage 2', 2);

  INSERT INTO party_groups (id, board_id, name, sort_order) VALUES (v_group_a, v_board_gvg, 'Party A', 0);
  INSERT INTO party_groups (id, board_id, name, sort_order) VALUES (v_group_b, v_board_gvg, 'Party B', 1);
  INSERT INTO party_groups (id, board_id, name, sort_order) VALUES (v_group_c, v_board_gvg, 'Party C', 2);

  FOR i IN 1..8 LOOP
    INSERT INTO party_group_parties (id, group_id, label, sort_order) VALUES (gen_random_uuid()::text, v_group_main, 'Party ' || i, i);
  END LOOP;
  FOR i IN 1..4 LOOP
    INSERT INTO party_group_parties (id, group_id, label, sort_order) VALUES (gen_random_uuid()::text, v_group_sub1, 'Party ' || i, i);
  END LOOP;
  FOR i IN 1..4 LOOP
    INSERT INTO party_group_parties (id, group_id, label, sort_order) VALUES (gen_random_uuid()::text, v_group_sub2, 'Party ' || i, i);
  END LOOP;
  FOR i IN 1..6 LOOP
    INSERT INTO party_group_parties (id, group_id, label, sort_order) VALUES (gen_random_uuid()::text, v_group_a, 'Party ' || i, i);
  END LOOP;
  FOR i IN 1..6 LOOP
    INSERT INTO party_group_parties (id, group_id, label, sort_order) VALUES (gen_random_uuid()::text, v_group_b, 'Party ' || i, i);
  END LOOP;
  FOR i IN 1..4 LOOP
    INSERT INTO party_group_parties (id, group_id, label, sort_order) VALUES (gen_random_uuid()::text, v_group_c, 'Party ' || i, i);
  END LOOP;
END $$;