CREATE TYPE "public"."voice_event_type" AS ENUM('JOIN', 'LEAVE');--> statement-breakpoint
CREATE TABLE "voice_attendance_events" (
	"id" text PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"type" "voice_event_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "voice_attendance_events" ADD CONSTRAINT "voice_attendance_events_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "voice_attendance_events_member_id_idx" ON "voice_attendance_events" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "voice_attendance_events_created_at_idx" ON "voice_attendance_events" USING btree ("created_at");