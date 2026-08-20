ALTER TABLE "membership_events" ADD COLUMN "board_id" text;--> statement-breakpoint
ALTER TABLE "membership_events" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "membership_events" ADD CONSTRAINT "membership_events_board_id_party_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."party_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "membership_events_pending_leave_idx" ON "membership_events" USING btree ("type","confirmed_at");