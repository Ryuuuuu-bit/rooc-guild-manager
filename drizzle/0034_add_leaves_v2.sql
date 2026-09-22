CREATE TYPE "public"."leave_source" AS ENUM('MEMBER', 'ADMIN');--> statement-breakpoint
CREATE TYPE "public"."leave_status" AS ENUM('ACTIVE', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "leaves" (
	"id" text PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"board_id" text,
	"occurrence_date" text NOT NULL,
	"status" "leave_status" DEFAULT 'ACTIVE' NOT NULL,
	"source" "leave_source" NOT NULL,
	"note" text,
	"actor" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "leaves" ADD CONSTRAINT "leaves_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaves" ADD CONSTRAINT "leaves_board_id_party_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."party_boards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "leaves_member_board_date_idx" ON "leaves" USING btree ("member_id","board_id","occurrence_date");--> statement-breakpoint
CREATE INDEX "leaves_board_date_status_idx" ON "leaves" USING btree ("board_id","occurrence_date","status");--> statement-breakpoint
CREATE INDEX "leaves_member_id_idx" ON "leaves" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "leaves_occurrence_date_idx" ON "leaves" USING btree ("occurrence_date");