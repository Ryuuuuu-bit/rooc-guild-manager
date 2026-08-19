CREATE TYPE "public"."event_type" AS ENUM('JOIN', 'LEAVE', 'KICK', 'ROLE_UPDATE', 'RANK_UPDATE', 'PROFILE_UPDATE', 'NOTE');--> statement-breakpoint
CREATE TYPE "public"."guild_rank" AS ENUM('LEADER', 'OFFICER', 'VETERAN', 'MEMBER', 'RECRUIT');--> statement-breakpoint
CREATE TYPE "public"."member_status" AS ENUM('ACTIVE', 'LEFT', 'KICKED');--> statement-breakpoint
CREATE TABLE "members" (
	"id" text PRIMARY KEY NOT NULL,
	"discord_id" text NOT NULL,
	"discord_username" text NOT NULL,
	"discord_global_name" text,
	"discord_avatar" text,
	"discord_roles" text[] DEFAULT '{}' NOT NULL,
	"joined_discord_at" timestamp with time zone,
	"left_discord_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"in_game_name" text,
	"character_class" text,
	"level" integer,
	"guild_rank" "guild_rank" DEFAULT 'RECRUIT' NOT NULL,
	"status" "member_status" DEFAULT 'ACTIVE' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "members_discord_id_unique" UNIQUE("discord_id")
);
--> statement-breakpoint
CREATE TABLE "membership_events" (
	"id" text PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"type" "event_type" NOT NULL,
	"detail" text,
	"actor" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "membership_events" ADD CONSTRAINT "membership_events_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "members_status_idx" ON "members" USING btree ("status");--> statement-breakpoint
CREATE INDEX "members_guild_rank_idx" ON "members" USING btree ("guild_rank");--> statement-breakpoint
CREATE INDEX "membership_events_member_id_idx" ON "membership_events" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "membership_events_created_at_idx" ON "membership_events" USING btree ("created_at");