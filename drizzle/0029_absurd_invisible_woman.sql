CREATE TABLE "scheduled_leaves" (
	"id" text PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"board_id" text NOT NULL,
	"date" text NOT NULL,
	"event_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scheduled_leaves" ADD CONSTRAINT "scheduled_leaves_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_leaves" ADD CONSTRAINT "scheduled_leaves_board_id_party_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."party_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_leaves_board_member_date_idx" ON "scheduled_leaves" USING btree ("board_id","member_id","date");--> statement-breakpoint
CREATE INDEX "scheduled_leaves_date_idx" ON "scheduled_leaves" USING btree ("date");--> statement-breakpoint
CREATE INDEX "scheduled_leaves_member_id_idx" ON "scheduled_leaves" USING btree ("member_id");