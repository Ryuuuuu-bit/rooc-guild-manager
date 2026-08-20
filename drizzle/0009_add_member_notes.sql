CREATE TABLE "member_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"body" text NOT NULL,
	"author_username" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member_notes" ADD CONSTRAINT "member_notes_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_notes_member_id_idx" ON "member_notes" USING btree ("member_id");