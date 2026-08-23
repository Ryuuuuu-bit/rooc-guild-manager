CREATE TABLE "checkin_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"event_key" text NOT NULL,
	"date" text NOT NULL,
	"member_id" text NOT NULL,
	"note" text NOT NULL,
	"actor" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "checkin_notes" ADD CONSTRAINT "checkin_notes_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "checkin_notes_event_date_member_idx" ON "checkin_notes" USING btree ("event_key","date","member_id");