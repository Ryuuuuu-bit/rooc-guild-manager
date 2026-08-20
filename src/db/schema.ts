import {
  pgTable,
  pgEnum,
  text,
  integer,
  timestamp,
  index,
  uniqueIndex,
  boolean,
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
    level: integer("level"),
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

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("membership_events_member_id_idx").on(table.memberId),
    index("membership_events_created_at_idx").on(table.createdAt),
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

export const membersRelations = relations(members, ({ many }) => ({
  events: many(membershipEvents),
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
export type DiscordRole = typeof discordRoles.$inferSelect;
export type NewDiscordRole = typeof discordRoles.$inferInsert;
export type PartyBoardRow = typeof partyBoards.$inferSelect;
export type PartyGroup = typeof partyGroups.$inferSelect;
export type PartyGroupParty = typeof partyGroupParties.$inferSelect;
export type PartySlot = typeof partySlots.$inferSelect;
export type NewPartySlot = typeof partySlots.$inferInsert;
export type PartyBusyEntry = typeof partyBusyEntries.$inferSelect;
