import {
  pgTable,
  pgEnum,
  text,
  integer,
  doublePrecision,
  timestamp,
  index,
  uniqueIndex,
  boolean,
  jsonb,
  check,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
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
  // A guild-wide (all loot categories at once) temporary suspension from
  // the loot auction queue — see members.auctionBanUntil below.
  "AUCTION_BAN",
  "AUCTION_UNBAN",
  // Logged the moment a member REQUESTS an advance leave via /leave or the
  // "ห้องลา" panel (see scheduleLeave/cancelScheduledLeave in
  // bot/leave-schedule.ts) — distinct from ATTENDANCE_LEAVE, which only
  // fires once that request actually takes effect on its date. Without
  // these, a request for a leave weeks out was invisible anywhere in the
  // activity feed until the day itself.
  "LEAVE_SCHEDULED",
  "LEAVE_SCHEDULE_CANCELLED",
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

    // Stamped by bot/pvp-stats-reminder.ts the moment a "haven't updated PVP
    // stats in 3+ weeks" DM goes out — lets it remind at most once per stale
    // streak instead of every sweep: only re-fires once this member's
    // reference date (their latest submission, or joinedDiscordAt if they've
    // never submitted) has moved past this timestamp, i.e. they actually
    // submitted something new since the last nudge.
    lastPvpStatsReminderAt: timestamp("last_pvp_stats_reminder_at", { withTimezone: true }),

    // Guild-wide (every loot category at once — not per-category) temporary
    // suspension from the loot auction queue, e.g. for misbehavior during a
    // round. Null = not banned; a future timestamp = banned until then,
    // auto-expiring on its own (no cron needed — runLootRound and the queue
    // display both just compare against now()). A past timestamp is treated
    // as "no longer banned" but is left in place rather than nulled out, so
    // the member's most recent ban date/reason stays visible after it lapses
    // instead of disappearing the moment it expires.
    auctionBanUntil: timestamp("auction_ban_until", { withTimezone: true }),
    auctionBanReason: text("auction_ban_reason"),

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
    // lets the confirm sweep (bot/attendance-confirm.ts) check whether the
    // member is still marked busy on that board before the leave counts
    // toward /attendance stats.
    // "set null" (not "cascade") — this table is the app's permanent audit
    // trail (attendance/leave history feeds /attendance's monthly stats), so
    // deleting a party board must NOT delete the events ever logged against
    // it. The board's name is already baked into each row's `detail` text at
    // write time, so a row stays meaningful even after its boardId goes null.
    // Was cascade — deleting a board (e.g. an old unused one) used to
    // silently wipe every ATTENDANCE_LEAVE/RETURN etc. ever logged for it,
    // permanently changing past /attendance numbers with no warning.
    boardId: text("board_id").references(() => partyBoards.id, { onDelete: "set null" }),
    // Null = pending confirmation — the leave is in effect (shows on the
    // party board, excludes them from /checkin's no-show list — see
    // getLeaveMemberIds in src/lib/checkin-data.ts, which doesn't gate on
    // this) but hasn't locked in for stats purposes yet. Locks in once the
    // matching event's own window (see checkin-events.ts) actually ends —
    // whether this leave came from a live "ลา" reaction or an advance
    // /leave request that already auto-applied, both go through the same
    // wait. Only confirmed ATTENDANCE_LEAVE rows count in
    // getAttendanceStats() — this is what keeps a member free to change
    // their mind any time before the event happens: cancelling before then
    // (see cancelCurrentLeave in bot/reactions.ts) discards the event
    // entirely instead of logging a return. Every other event type just
    // leaves this null.
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

export const partyBoards = pgTable(
  "party_boards",
  {
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
    // Which CHECKIN_EVENTS entry (checkin-events.ts) this board's "ลา"
    // tracks approved leave for — e.g. the board admins use for "GL" links
    // to the "gl" event. A config key, not a DB row reference (same pattern
    // as scheduledLeaves.eventKey) — null means "not linked to any check-in
    // event": the board still works as an ordinary party/busy board, it just
    // won't be found by the event-end leave-timing gate (confirmDueLeaves in
    // bot/attendance-confirm.ts, which falls back to a flat short delay for
    // an unlinked board) or show up in /checkin's no-show exclusion or
    // /calendar.
    //
    // Deliberately an explicit link rather than matching on partyBoards.name
    // against CHECKIN_EVENTS' old attendanceBoardName field (removed) — name
    // matching broke silently the moment an admin created a differently-named
    // board for the same event, renamed the linked board, or (nothing ever
    // stopped this) created a second board that happened to share the exact
    // same name. The unique index below makes "two boards fighting over one
    // event" impossible to represent at all, rather than just unlikely.
    // Set/cleared from the "โพสต์ ลา ใน Discord" dialog — see
    // getBoardCheckinEventKey/setBoardCheckinEventKey in
    // src/app/actions/bot-messages.ts.
    checkinEventKey: text("checkin_event_key"),
    // Discord channel id the "ประกาศภาพผังปาร์ตี้" button last posted this
    // board to — remembered per-board so the picker defaults to it next time
    // instead of making an admin re-pick the same channel every single
    // announcement. Just a remembered default: the dropdown still lets them
    // pick a different channel any time.
    lastImageAnnounceChannelId: text("last_image_announce_channel_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Postgres unique indexes treat every NULL as distinct from every other
  // NULL, so any number of not-yet-linked boards can coexist — this only
  // ever blocks a SECOND board from linking to an event key already taken.
  (table) => [uniqueIndex("party_boards_checkin_event_key_idx").on(table.checkinEventKey)]
);

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
    // Defense-in-depth for the "0-4" comment above — the app layer (party
    // rendering, canvas image export in party-image.ts, which hardcodes
    // SLOTS_PER_PARTY = 5) is currently the only thing enforcing this range.
    // A future bug or a manual DB fix writing outside it would otherwise be
    // silently accepted by Postgres and only surface later as a rendering
    // bug or an out-of-bounds crash somewhere that assumes exactly 5 slots.
    check("party_slots_slot_index_range", sql`${table.slotIndex} >= 0 AND ${table.slotIndex} <= 4`),
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

// Tracks Discord messages the bot has posted that carry meaning via a member
// interacting with them — the "เลือกอาชีพ" (class self-select) message
// (global, one at a time, boardId null), each board's "ลา" (attendance/
// opt-out) message (boardId set), both reaction-based, and the guild-wide
// "ห้องลา" LEAVE_PANEL button message (global, boardId null — same tracking
// shape as CLASS_SELECT, just a click instead of a reaction). Reposting any
// kind replaces the previous row (and best-effort deletes the old Discord
// message) so there's only ever one live message per kind/board that the
// bot listens to.
export const botReactionMessages = pgTable(
  "bot_reaction_messages",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    kind: text("kind").notNull(), // "CLASS_SELECT" | "ATTENDANCE" | "LEAVE_PANEL"
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

// PVP role classification (distinct from `members.characterClass` — a job
// class like "Bio" can be built as MainDMG one week and SecondSup another).
// Kept as free text rather than a pgEnum: the guild's own labeling has
// already drifted once (this list was copied from their live Google Sheet),
// and a text column lets that keep drifting without a migration each time —
// PVP_ROLES in src/lib/pvp-stats.ts is the single place the fixed option
// list lives for the form's <select>.
// Admin-managed extra stat columns — added from the web UI (no code change/
// deploy needed) for whatever the guild starts tracking next. Values for
// these live in pvpStatEntries.customValues (a JSONB map keyed by `key`
// below), NOT as their own typed columns like the fixed stats above — that's
// what lets an admin add one without a migration. `active: false` is a soft
// delete: a field an admin removes from the live form still resolves its
// label/format for OLD entries that recorded it, instead of orphaning that
// history as an unlabeled key.
export const pvpStatFieldDefs = pgTable(
  "pvp_stat_field_defs",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    key: text("key").notNull().unique(),
    label: text("label").notNull(),
    groupTitle: text("group_title").notNull().default("อื่นๆ"),
    isPercent: boolean("is_percent").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("pvp_stat_field_defs_sort_order_idx").on(table.sortOrder)]
);

export const pvpStatEntries = pgTable(
  "pvp_stat_entries",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    role: text("role"),
    cp: integer("cp"),
    pDef: integer("p_def"),
    mDef: integer("m_def"),
    // Flat PVP attack/defense stats — NOT percentages (unlike the *Pct
    // columns below), despite the deceptively similar name to pvpReduction.
    pvpBonus: integer("pvp_bonus"),
    pvpReduction: integer("pvp_reduction"),
    pDmgReductionPct: doublePrecision("p_dmg_reduction_pct"),
    mDmgReductionPct: doublePrecision("m_dmg_reduction_pct"),
    atk: integer("atk"),
    matk: integer("matk"),
    ignorePDef: integer("ignore_p_def"),
    ignoreMDef: integer("ignore_m_def"),
    pDmgBonusPct: doublePrecision("p_dmg_bonus_pct"),
    mDmgBonusPct: doublePrecision("m_dmg_bonus_pct"),
    // Free text, e.g. "Moon/Orclord" — boss cards vary too much in
    // combination to normalize into their own table for what's essentially
    // a self-reported note.
    bossCards: text("boss_cards"),
    // Values for admin-added fields (pvpStatFieldDefs above), keyed by
    // `key`. A field removed from `values` here simply renders as "—" —
    // nothing keys off its presence besides display, so it's safe to leave
    // gaps for entries submitted before a field existed.
    customValues: jsonb("custom_values").$type<Record<string, number>>(),
    // Admin review of THIS specific submission — "ผ่าน"/"ไม่ผ่าน" plus a note
    // on what to adjust (mirrors the "Status" column on the guild's original
    // Sheet). Unlike the member-filled fields above, only requireAdmin() can
    // write these (see reviewPvpStat in app/actions/pvp-stats.ts). Free text
    // rather than a pgEnum for the same reason as `role` above — REVIEW_STATUSES
    // in src/lib/pvp-stat-review.ts is the single place the fixed option list lives.
    reviewStatus: text("review_status"),
    reviewNote: text("review_note"),
    reviewedByUsername: text("reviewed_by_username"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    // Set only when an admin corrects a submission's values after the fact
    // (adminEditPvpStatEntry) — distinct from reviewedAt/reviewedByUsername,
    // which track the pass/fail judgment, not a data edit.
    updatedAt: timestamp("updated_at", { withTimezone: true }),
    editedByUsername: text("edited_by_username"),
    // Append-only BY DEFAULT: every member self-submission is a new row
    // (never updated in place), so this doubles as the history log the
    // guild's admin wanted kept — "latest per member" is just the most
    // recent row by this column. An admin correcting a typo (updatedAt set)
    // or deleting a bad row (deletePvpStatEntry) is the sanctioned exception
    // to "never touch an existing row."
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("pvp_stat_entries_member_id_created_at_idx").on(table.memberId, table.createdAt),
  ]
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
  (table) => [
    index("loot_rounds_category_idx").on(table.categoryId),
    // Defense-in-depth for the "same index order as memberIds" comment above
    // — undoLootRound relies on the two arrays lining up 1:1 by index to
    // know which position to restore each served member to. Nothing
    // previously stopped the two from drifting out of length-sync (a future
    // bug, or a manual DB fix); this at least turns that into a loud insert-
    // time failure instead of a silent wrong-member-restored bug much later.
    check(
      "loot_rounds_member_ids_positions_length_match",
      sql`array_length(${table.memberIds}, 1) IS NOT DISTINCT FROM array_length(${table.previousPositions}, 1)`
    ),
  ]
);

// Advance leave requests — a member picks one or more upcoming event dates
// from a dropdown (see src/lib/checkin-events.ts for the event list) via the
// /leave Discord command, instead of waiting until the day to react "ลา"
// live on a party board. `applyTodaysScheduledLeaves()` (bot/leave-schedule.ts,
// called from bot/midnight-reset.ts's nightly reset) turns a row into a real,
// immediately-confirmed partyBusyEntries + ATTENDANCE_LEAVE pair once its
// `date` arrives, then DELETES this row — its job is done, and the audit
// trail lives on in membershipEvents like every other leave, not here. So
// unlike most tables in this app, this one is deliberately NOT an append-only
// history — it only ever holds still-pending, not-yet-arrived requests.
export const scheduledLeaves = pgTable(
  "scheduled_leaves",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    boardId: text("board_id")
      .notNull()
      .references(() => partyBoards.id, { onDelete: "cascade" }),
    // "YYYY-MM-DD", Thai calendar — matches an upcoming occurrence computed
    // from CHECKIN_EVENTS, same date format as checkinNotes.date.
    date: text("date").notNull(),
    // CheckinEventConfig.key (e.g. "gl"/"woe") this was scheduled against —
    // display-only (e.g. listing a member's own upcoming leaves), not a FK
    // since it's a config key from checkin-events.ts, not a DB row.
    eventKey: text("event_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("scheduled_leaves_board_member_date_idx").on(table.boardId, table.memberId, table.date),
    index("scheduled_leaves_date_idx").on(table.date),
    index("scheduled_leaves_member_id_idx").on(table.memberId),
  ]
);

export const membersRelations = relations(members, ({ many }) => ({
  events: many(membershipEvents),
  notes: many(memberNotes),
  pvpStatEntries: many(pvpStatEntries),
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
export type PvpStatEntry = typeof pvpStatEntries.$inferSelect;
export type NewPvpStatEntry = typeof pvpStatEntries.$inferInsert;
export type PvpStatFieldDefRow = typeof pvpStatFieldDefs.$inferSelect;
export type NewPvpStatFieldDefRow = typeof pvpStatFieldDefs.$inferInsert;
export type NewLootRound = typeof lootRounds.$inferInsert;
export type ScheduledLeave = typeof scheduledLeaves.$inferSelect;
export type NewScheduledLeave = typeof scheduledLeaves.$inferInsert;
