CREATE TABLE "bot_reaction_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"board_id" text,
	"channel_id" text NOT NULL,
	"message_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bot_reaction_messages" ADD CONSTRAINT "bot_reaction_messages_board_id_party_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."party_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bot_reaction_messages_kind_board_idx" ON "bot_reaction_messages" USING btree ("kind","board_id");