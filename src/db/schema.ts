import {
  pgTable,
  pgEnum,
  text,
  integer,
  timestamp,
  index,
  uniqueIndex,
  boolean,
  jsonb,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";

export const memberStatusEnum = pgEnum("member_status", [
  "ACTIVE",
  "LEFT",
  "KICKED",
]);

export const eventTypeEnum = pgEnum("event_type", [
  "JOIN",
  "LEAVE",
  "KICK",
  "ROLE_UPDATE",
  "RANK_UPDATE",
  "PROFILE_UPDATE",
  "NOTE",
  // Added for the activity log's ลา / เปลี่ยนอาชีพ / เปลี่ยนชื่อ tracking —
  // split out from the generic PROFILE_UPDATE bucket so they're each their
  // own scannable, filterable category in the feed.
  "ATTENDANCE_LEAVE",
  "ATTENDANCE_RETURN",
  "CLASS_CHANGE",
  "NAME_CHANGE",
]);

export const members = pgTable(
  "members",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),

    // --- Discord profile (synced automatically by the bot) ---
    discordId: text("discord_id").notNull().unique(),
    discordUsername: text("discord_username").notNull(),
    discordGlobalName: text("discord_global_name"),
    // Server-specific nickname ("nick" in Discord's API) — distinct from the
    // account's global display name. Preferred for display when present.
    discordNickname: text("discord_nickname"),
    discordAvatar: text("discord_avatar"),
    discordRoles: text("discord_roles")
      .array()
      .notNull()
      .default([]),
    joinedDiscordAt: timestamp("joined_discord_at", { withTimezone: true }),
    leftDiscordAt: timestamp("left_discord_at", { withTimezone: true }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    // --- In-game / guild data (managed by admins) ---
    inGameName: text("in_game_name"),
    characterClass: text("character_class"),
    // Vestigial: used by the Google Sheet class-sync tool, which was removed
    // in favor of the Discord emoji class-select system. Left as a nullable
    // column rather than a migration to drop it — no code reads/writes it.
    sheetClassRaw: text("sheet_class_raw"),
    status: memberStatusEnum("status").notNull().default("ACTIVE"),
    // Still an active Discord/Rooc-role member, but flagged by an admin as
    // not currently playing — excluded from party boards and other active
    // "management" screens without touching their Discord role/status.
    // Independent of `status`: NOT auto-managed by the bot's role sync.
    benched: boolean("benched").notNull().default(false),
    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("members_status_idx").on(table.status)]
);

// Cache of the guild's Discord roles (id -> name/color/position), synced by
// the bot. Discord's member payload only carries role IDs, so this table is
// what lets the UI show and filter by human-readable role names.
export const discordRoles = pgTable("discord_roles", {
  id: text("id").primaryKey(), // Discord role ID (snowflake)
  name: text("name").notNull(),
  color: integer("color").notNull().default(0),
  position: integer("position").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const membershipEvents = pgTable(
  "membership_events",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),

    type: eventTypeEnum("type").notNull(),
    detail: text("detail"),
    actor: text("actor"), // "bot:sync" or the admin's Discord username who made a manual change

    // Only set for ATTENDANCE_LEAVE events tied to a specific party board —
    // lets the 30-minute confirm sweep (bot/attendance-confirm.ts) check
    // whether the member is still marked busy on that board before the
    // leave counts toward /attendance stats.
    boardId: text("board_id").references(() => partyBoards.id, { onDelete: "cascade" }),
    // Null = pending confirmation (reacted "ลา" less than 30 minutes ago).
    // Only confirmed ATTENDANCE_LEAVE rows count in getAttendanceStats() —
    // this is what keeps a member's curious test-click from skewing the
    // numbers, since un-reacting before confirmation discards the event
    // entirely instead of logging a return (see handleReactionRemove in
    // bot/reactions.ts). Every other event type just leaves this null.
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("membership_events_member_id_idx").on(table.memberId),
    index("membership_events_created_at_idx").on(table.createdAt),
    index("membership_events_pending_leave_idx").on(table.type, table.confirmedAt),
  ]
);

// --- Party / event roster boards ---
// Fully flexible: the admin can have multiple independent boards (e.g.
// "ปกติ" and "GVG"), each with its own set of freely-named groups (no
// fixed "Main Stage"/"Sub Stage" concept — a group's name IS its label,
// so a leader's name can just be the group name), and each group holds
// however many parties the admin adds. Every party has 5 member slots
// (fixed — matches the game's actual party size). Assignment and the
// Busy/leave list are scoped per board, so the same member can hold an
// independent spot on each board (e.g. different rosters for different
// content on different days). Each board is a single always-current
// sheet, overwritten in place — no per-event history. A member's class
// (job) is NOT stored per-slot — it lives once on `members.characterClass`
// and is shared everywhere that member appears, on every board.

export const partyBoards = pgTable("party_boards", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  // The reaction emoji used for THIS board's "ลา" (attendance opt-out)
  // message — null means "use the default" (ATTENDANCE_EMOJI in
  // src/lib/class-emoji.ts). Lets an admin give each board (e.g. "GL" vs
  // "WOE") a visually distinct emoji so it's obvious at a glance in Discord
  // which event a leave reaction is for, without needing a second "reason"
  // concept layered onto the existing one-board-one-emoji model. Set (and
  // re-settable) from the "โพสต์ ลา ใน Discord" dialog — see postAttendanceMessage.
  emoji: text("emoji"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const partyGroups = pgTable(
  "party_groups",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    boardId: text("board_id")
      .notNull()
      .references(() => partyBoards.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("party_groups_board_id_idx").on(table.boardId)]
);

export const partyGroupParties = pgTable(
  "party_group_parties",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    groupId: text("group_id")
      .notNull()
      .references(() => partyGroups.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [index("party_group_parties_group_id_idx").on(table.groupId)]
);

export const partySlots = pgTable(
  "party_slots",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    partyId: text("party_id")
      .notNull()
      .references(() => partyGroupParties.id, { onDelete: "cascade" }),
    slotIndex: integer("slot_index").notNull(), // 0-4
    memberId: text("member_id").references(() => members.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("party_slots_position_idx").on(table.partyId, table.slotIndex),
    index("party_slots_member_id_idx").on(table.memberId),
  ]
);

// Members sitting out this round ("Busy" / on leave), scoped per board. A
// member can only be in one place at a time within a given board, so being
// added here removes them from any slot on the same board.
export const partyBusyEntries = pgTable(
  "party_busy_entries",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    boardId: text("board_id")
      .notNull()
      .references(() => partyBoards.id, { onDelete: "cascade" }),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("party_busy_board_member_idx").on(table.boardId, table.memberId)]
);

/** One saved board layout — group names, each group's parties, and which
 * member (by id) sat in each of a party's 5 slots. Applying a template
 * overwrites a board's current groups/parties/slots wholesale, so this is
 * captured and replayed as one JSON blob rather than its own set of
 * relational tables — nothing here is ever queried piecemeal. Not tied to
 * a specific board: the whole point is reusing the same composition across
 * different boards/events, so it outlives the board it was first saved
 * from (which may since have been renamed, reset, or deleted). */
export interface PartyTemplateData {
  groups: {
    name: string;
    parties: {
      label: string;
      /** Exactly 5 entries, index = slot index; null = empty slot. A
       * memberId that no longer resolves to an active member when the
       * template is applied (left the guild, etc.) is just skipped —
       * see applyPartyTemplate. */
      slots: (string | null)[];
    }[];
  }[];
}

export const partyTemplates = pgTable("party_templates", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  name: text("name").notNull(),
  createdByUsername: text("created_by_username"),
  data: jsonb("data").notNull().$type<PartyTemplateData>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Free-form, admin-only comment log on a member (e.g. "AFK ใน GVG 20/8") —
// distinct from `membershipEvents`, which is an audit trail of status
// changes shown more broadly. This is an append-only running log meant only
// for admins to jot down observations over time; nothing here is ever
// touched by the bot.
export const memberNotes = pgTable(
  "member_notes",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    authorUsername: text("author_username").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("member_notes_member_id_idx").on(table.memberId)]
);

// Tracks Discord messages the bot has posted that carry meaning via emoji
// reactions — the "เลือกอาชีพ" (class self-select) message (global, one at a
// time, boardId null) and each board's "ลา" (attendance/opt-out) message
// (boardId set). Reposting either kind replaces the previous row (and
// best-effort deletes the old Discord message) so there's only ever one
// live message per kind/board that the bot listens to reactions on.
export const botReactionMessages = pgTable(
  "bot_reaction_messages",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    kind: text("kind").notNull(), // "CLASS_SELECT" | "ATTENDANCE"
    boardId: text("board_id").references(() => partyBoards.id, { onDelete: "cascade" }),
    channelId: text("channel_id").notNull(),
    messageId: text("message_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("bot_reaction_messages_kind_board_idx").on(table.kind, table.boardId),
  ]
);

// Admin-managed list of in-game classes — replaces what used to be a
// hard-coded constant in src/lib/classes.ts so an admin can add/rename/
// remove/recolor classes from the web UI without a code change + deploy.
// `emoji` is reused both for the web UI's badge/icon and as the literal
// Discord reaction emoji on the "เลือกอาชีพ" message, so the two always
// stay visually in sync. `colorKey` indexes into a fixed palette of
// pre-defined Tailwind class strings (see src/lib/job-class-colors.ts) —
// NOT a free-form Tailwind class string itself, since Tailwind's build-time
// scanner only picks up classes that appear as literal text somewhere in
// source, not ones assembled at runtime from a DB value.
export const jobClasses = pgTable(
  "job_classes",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    name: text("name").notNull().unique(),
    emoji: text("emoji").notNull(),
    colorKey: text("color_key").notNull().default("stone"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("job_classes_sort_order_idx").on(table.sortOrder)]
);

export const voiceEventTypeEnum = pgEnum("voice_event_type", ["JOIN", "LEAVE"]);

// Raw join/leave log for the small set of voice channels an admin is
// watching for event check-in purposes (currently: the Tyr Cup Tue/Thu
// roll-call — see WATCHED_VOICE_CHANNEL_IDS in bot/voice-attendance.ts and
// the /checkin report page). One row per state change, not per session —
// getCheckinReport() in src/lib/checkin-data.ts reconstructs sessions by
// pairing consecutive JOIN/LEAVE rows per member. Deliberately NOT scoped
// to party boards or the ATTENDANCE_LEAVE ("ลา") system — this tracks
// actual voice presence, an unrelated signal.
export const voiceAttendanceEvents = pgTable(
  "voice_attendance_events",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    channelId: text("channel_id").notNull(),
    type: voiceEventTypeEnum("type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("voice_attendance_events_member_id_idx").on(table.memberId),
    index("voice_attendance_events_created_at_idx").on(table.createdAt),
  ]
);

// One optional admin-entered note per (event, date, member) — e.g. a member
// DMs an admin afterward explaining why they weren't online, and the admin
// jots it onto that member's row on the /checkin report so it's not lost.
// `eventKey`/`date` are plain strings (not FKs) matching CheckinEventConfig.key
// and the "YYYY-MM-DD" Thai-calendar date used throughout checkin-data.ts —
// there's no per-window DB row to key off (windows are computed on the fly
// from voice_attendance_events), so this is the join key instead.
export const checkinNotes = pgTable(
  "checkin_notes",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    eventKey: text("event_key").notNull(),
    date: text("date").notNull(),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    note: text("note").notNull(),
    actor: text("actor"), // admin's Discord username who wrote/last edited the note
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("checkin_notes_event_date_member_idx").on(table.eventKey, table.date, table.memberId)]
);

// Loot distribution queue — one independent, admin-managed ordered rotation
// per item category (e.g. "เศษการ์ด", "ขนนกขาว"). `position` (ascending =
// next up) is intentionally sparse rather than contiguous: running a round
// re-stamps just the served members to `max(position in category) + 1, +2,
// ...`, leaving everyone else untouched — cheap, and preserves relative
// order among the just-served batch for their next lap. Admin fully owns
// both membership and order (see checkin: this was a deliberate choice over
// deriving it from /members) since it needs to match a roster the guild
// already agreed on, not an alphabetical or join-date default.
export const lootCategories = pgTable(
  "loot_categories",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    // Optional: when set, this category's round-result numbering doesn't
    // start fresh at 1 — it continues from wherever the linked category's
    // MOST RECENT round left off (e.g. "ขนนกหลากสี" continuing on from
    // "ขนนกขาว", matching how the guild has always announced these two
    // together). See computeNumberingStart in loot-queue-data.ts. The
    // linked category's own numbering is unaffected — it still always
    // starts at 1 each round.
    numberingBaseCategoryId: text("numbering_base_category_id").references((): AnyPgColumn => lootCategories.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("loot_categories_name_idx").on(table.name)]
);

export const lootQueueEntries = pgTable(
  "loot_queue_entries",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    categoryId: text("category_id")
      .notNull()
      .references(() => lootCategories.id, { onDelete: "cascade" }),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
  },
  (table) => [
    uniqueIndex("loot_queue_entries_category_member_idx").on(table.categoryId, table.memberId),
    index("loot_queue_entries_category_position_idx").on(table.categoryId, table.position),
  ]
);

// Append-only history of "who got served this round" per category — an
// audit trail (mirrors membershipEvents' philosophy elsewhere in this app),
// and what a Discord announcement is generated from. `memberIds` is a plain
// snapshot array (not a join table / FK) deliberately: it's a historical
// record of who was served AT THE TIME, so it should read the same later
// even if that member is later removed from the guild — a display join
// just falls back to showing nothing extra for an id that no longer exists.
export const lootRounds = pgTable(
  "loot_rounds",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    categoryId: text("category_id")
      .notNull()
      .references(() => lootCategories.id, { onDelete: "cascade" }),
    label: text("label"), // admin-entered context, e.g. "GL 25/8" — shown in history and used as the Discord post's headline
    memberIds: text("member_ids").array().notNull().default([]),
    // Each served member's queue `position` immediately before this round
    // ran, same index order as memberIds — lets "undo" (only ever offered
    // for the single most-recent round of a category, see undoLootRound)
    // put them back exactly where they were instead of guessing.
    previousPositions: integer("previous_positions").array().notNull().default([]),
    actor: text("actor"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("loot_rounds_category_idx").on(table.categoryId)]
);

export const membersRelations = relations(members, ({ many }) => ({
  events: many(membershipEvents),
  notes: many(memberNotes),
}));

export const membershipEventsRelations = relations(
  membershipEvents,
  ({ one }) => ({
    member: one(members, {
      fields: [membershipEvents.memberId],
      references: [members.id],
    }),
  })
);

export type Member = typeof members.$inferSelect;
export type NewMember = typeof members.$inferInsert;
export type MembershipEvent = typeof membershipEvents.$inferSelect;
export type NewMembershipEvent = typeof membershipEvents.$inferInsert;
export type MemberNote = typeof memberNotes.$inferSelect;
export type NewMemberNote = typeof memberNotes.$inferInsert;
export type DiscordRole = typeof discordRoles.$inferSelect;
export type NewDiscordRole = typeof discordRoles.$inferInsert;
export type PartyBoardRow = typeof partyBoards.$inferSelect;
export type PartyGroup = typeof partyGroups.$inferSelect;
export type PartyGroupParty = typeof partyGroupParties.$inferSelect;
export type PartySlot = typeof partySlots.$inferSelect;
export type NewPartySlot = typeof partySlots.$inferInsert;
export type PartyBusyEntry = typeof partyBusyEntries.$inferSelect;
export type PartyTemplateRow = typeof partyTemplates.$inferSelect;
export type BotReactionMessage = typeof botReactionMessages.$inferSelect;
export type NewBotReactionMessage = typeof botReactionMessages.$inferInsert;
export type JobClassRow = typeof jobClasses.$inferSelect;
export type NewJobClassRow = typeof jobClasses.$inferInsert;
export type VoiceAttendanceEvent = typeof voiceAttendanceEvents.$inferSelect;
export type NewVoiceAttendanceEvent = typeof voiceAttendanceEvents.$inferInsert;
export type CheckinNote = typeof checkinNotes.$inferSelect;
export type NewCheckinNote = typeof checkinNotes.$inferInsert;
export type LootCategory = typeof lootCategories.$inferSelect;
export type NewLootCategory = typeof lootCategories.$inferInsert;
export type LootQueueEntry = typeof lootQueueEntries.$inferSelect;
export type NewLootQueueEntry = typeof lootQueueEntries.$inferInsert;
export type LootRound = typeof lootRounds.$inferSelect;
export type NewLootRound = typeof lootRounds.$inferInsert;
