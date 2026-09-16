ALTER TABLE "membership_events" DROP CONSTRAINT "membership_events_board_id_party_boards_id_fk";
--> statement-breakpoint
ALTER TABLE "membership_events" ADD CONSTRAINT "membership_events_board_id_party_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."party_boards"("id") ON DELETE set null ON UPDATE no action;