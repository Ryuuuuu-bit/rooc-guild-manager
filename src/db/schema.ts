import {
  pgTable,
  pgEnum,
  text,
  integer,
  timestamp,
  index,
  uniqueIndex,
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

// --- Party / event roster board ---
// A single always-current board (per the requested "one roster, overwritten
// in place" model) of who is placed in which party for the guild's
// activities, mirroring the admin's previous Excel sheet: a "Main Stage"
// of 8 parties, and a "Sub Stage" of 8 parties split into two groups of 4
// under two named leaders — 5 member slots per party — plus a free-form
// "Busy" list for members sitting out this round.

export const partySectionEnum = pgEnum("party_section", ["MAIN", "SUB"]);

export const partySlots = pgTable(
  "party_slots",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    section: partySectionEnum("section").notNull(),
    partyNumber: integer("party_number").notNull(), // 1-8
    slotIndex: integer("slot_index").notNull(), // 0-4
    memberId: text("member_id").references(() => members.id, { onDelete: "set null" }),
    className: text("class_name"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("party_slots_position_idx").on(
      table.section,
      table.partyNumber,
      table.slotIndex
    ),
    index("party_slots_member_id_idx").on(table.memberId),
  ]
);

// Two named leaders for the Sub Stage's two 4-party groups.
export const partyLeaders = pgTable("party_leaders", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  leaderGroup: integer("leader_group").notNull().unique(), // 1 (parties 1-4) or 2 (parties 5-8)
  name: text("name"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Members sitting out this round ("Busy" / on leave). A member can only be
// in one place at a time, so being added here removes them from any slot.
export const partyBusyEntries = pgTable("party_busy_entries", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  memberId: text("member_id")
    .notNull()
    .unique()
    .references(() => members.id, { onDelete: "cascade" }),
  className: text("class_name"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

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
export type PartySlot = typeof partySlots.$inferSelect;
export type NewPartySlot = typeof partySlots.$inferInsert;
export type PartyLeader = typeof partyLeaders.$inferSelect;
export type PartyBusyEntry = typeof partyBusyEntries.$inferSelect;
