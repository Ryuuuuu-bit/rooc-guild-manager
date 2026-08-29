CREATE TABLE "party_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_by_username" text,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
