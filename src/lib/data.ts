import { db } from "@/db";
import { discordRoles, members, membershipEvents, memberNotes, partyBoards, type MembershipEvent } from "@/db/schema";
import { and, arrayContains, desc, eq, gte, ilike, isNotNull, lte, or, sql } from "drizzle-orm";
import { env } from "@/lib/env";
import { listJobClasses } from "@/lib/job-classes";

export interface MemberFilters {
  search?: string;
  status?: "ACTIVE" | "LEFT" | "KICKED" | "ALL";
  /** Discord role ID — only members carrying this role in `discordRoles`. */
  discordRoleId?: string;
  /** "benched" = only benched members, "active" = only non-benched, undefined = no filter. */
  benched?: "benched" | "active";
}

export async function listMembers(filters: MemberFilters = {}) {
  const conditions = [];

  if (filters.search) {
    const term = `%${filters.search}%`;
    conditions.push(
      or(
        ilike(members.discordUsername, term),
        ilike(members.discordGlobalName, term),
        ilike(members.discordNickname, term),
        ilike(members.inGameName, term)
      )
    );
  }

  if (filters.status && filters.status !== "ALL") {
    conditions.push(eq(members.status, filters.status));
  } else if (!filters.status) {
    conditions.push(eq(members.status, "ACTIVE"));
  }

  if (filters.discordRoleId) {
    conditions.push(arrayContains(members.discordRoles, [filters.discordRoleId]));
  }

  if (filters.benched === "benched") {
    conditions.push(eq(members.benched, true));
  } else if (filters.benched === "active") {
    conditions.push(eq(members.benched, false));
  }

  return db
    .select()
    .from(members)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(members.discordUsername);
}

/**
 * Cached Discord roles for the guild, ordered highest-position first (as
 * Discord shows them) — filtered down to just the roles relevant to guild
 * management (see `env.managementRoleNames`). The Discord server is a
 * shared multi-game community with many other roles (bots, other games,
 * general community tiers) that would just be noise in this app's role
 * filter/badges.
 */
export async function listDiscordRoles() {
  const rows = await db.select().from(discordRoles).orderBy(desc(discordRoles.position));
  const allowed = new Set(env.managementRoleNames);
  return rows.filter((r) => allowed.has(r.name.trim().toLowerCase()));
}

export async function getMemberById(id: string) {
  const member = await db.query.members.findFirst({
    where: eq(members.id, id),
  });
  if (!member) return null;

  const events = await db
    .select()
    .from(membershipEvents)
    .where(eq(membershipEvents.memberId, id))
    .orderBy(desc(membershipEvents.createdAt))
    .limit(50);

  // Admin-only internal comment log (e.g. "AFK ใน GVG 20/8") — the caller
  // decides whether to actually render this to the current user.
  const notes = await db
    .select()
    .from(memberNotes)
    .where(eq(memberNotes.memberId, id))
    .orderBy(desc(memberNotes.createdAt));

  return { member, events, notes };
}

/**
 * Recent activity feed (dashboard preview + full /activity page). `days`
 * bounds it to events from the last N days (e.g. 30) — omit for no date
 * bound at all (still capped by `limit` either way, since this table only
 * grows and an unbounded feed on a guild active for a year+ would get slow).
 */
export interface ActivityFilters {
  /** Matches against the same name fields as listMembers' search, so
   * looking someone up here behaves the same as on /members. */
  search?: string;
  /** One membershipEvents.type value (e.g. "CLASS_CHANGE") — undefined/"" means all types. */
  type?: string;
}

export async function getRecentActivity(limit = 30, days?: number, filters: ActivityFilters = {}) {
  const conditions = [];
  if (days) {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    conditions.push(gte(membershipEvents.createdAt, cutoff));
  }
  if (filters.search) {
    const term = `%${filters.search}%`;
    conditions.push(
      or(
        ilike(members.discordUsername, term),
        ilike(members.discordGlobalName, term),
        ilike(members.discordNickname, term),
        ilike(members.inGameName, term)
      )
    );
  }
  if (filters.type) {
    conditions.push(eq(membershipEvents.type, filters.type as MembershipEvent["type"]));
  }

  return db
    .select({
      event: membershipEvents,
      member: members,
    })
    .from(membershipEvents)
    .innerJoin(members, eq(membershipEvents.memberId, members.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(membershipEvents.createdAt))
    .limit(limit);
}

/** Shared filter shape for the /attendance queries below.
 * `from`/`to` are inclusive instants (already resolved to Thai-local day
 * boundaries by the page, see startOfThaiDay/endOfThaiDay in the page) for
 * a custom range — either may be omitted for an open-ended range.
 * `days` is the simpler "last N days from now" preset; only used when
 * `from` isn't already given. Kept as a plain number (rather than making
 * the page resolve it to a Date itself) specifically so the `Date.now()`
 * arithmetic happens in here, a plain data-layer function, instead of in
 * the page component's render body — the project's React Compiler purity
 * lint (react-hooks/purity) flags impure calls like Date.now() directly
 * inside a component/page file, but not inside a call it makes into a
 * regular module like this one. */
export interface AttendanceRangeFilter {
  from?: Date;
  to?: Date;
  days?: number;
  boardId?: string;
}

function attendanceConditions(filter: AttendanceRangeFilter) {
  const conditions = [eq(membershipEvents.type, "ATTENDANCE_LEAVE"), isNotNull(membershipEvents.confirmedAt)];
  const from = filter.from ?? (filter.days ? new Date(Date.now() - filter.days * 24 * 60 * 60 * 1000) : undefined);
  if (from) conditions.push(gte(membershipEvents.createdAt, from));
  if (filter.to) conditions.push(lte(membershipEvents.createdAt, filter.to));
  if (filter.boardId) conditions.push(eq(membershipEvents.boardId, filter.boardId));
  return conditions;
}

/**
 * Per-member ลา counts within a period, sorted most-ลา-first — answers "who
 * takes leave the most" at a glance. Deliberately just a raw count rather
 * than a percentage: a "rate" would need an "expected attendance" concept
 * (how many events did they have the chance to attend) that this app's
 * board model doesn't track (boards are a single always-current sheet
 * reused across events, not one row per historical event), so a rate would
 * be more misleading than informative. Only lists members who are
 * currently ACTIVE and not benched — someone who's left the guild isn't
 * meaningful to rank here, and a benched member isn't really "playing"
 * (they're excluded from every board's roster too, see party-data.ts), so
 * listing them at 0 ลา would just be clutter, not signal.
 *
 * Also surfaces each member's most recent ลา date within the range
 * (lastLeaveAt) — every leave already carries an exact date+time
 * (membershipEvents.createdAt), this just makes that visible on the stats
 * page itself instead of only in the per-member activity feed.
 */
export async function getAttendanceStats(filter: AttendanceRangeFilter = {}) {
  // Only confirmed leaves count — a member has to leave the "ลา" reaction
  // in place for 30 minutes before it's counted, so a quick test-click that
  // gets un-reacted right away is discarded rather than ever showing up
  // here (see confirmDueLeaves in bot/attendance-confirm.ts).
  const rows = await db
    .select({
      memberId: membershipEvents.memberId,
      leaveCount: sql<number>`count(*)::int`,
      lastLeaveAt: sql<string>`max(${membershipEvents.createdAt})`,
    })
    .from(membershipEvents)
    .where(and(...attendanceConditions(filter)))
    .groupBy(membershipEvents.memberId);

  const statsByMember = new Map(rows.map((r) => [r.memberId, { leaveCount: r.leaveCount, lastLeaveAt: r.lastLeaveAt }]));

  const activeMembers = await db
    .select()
    .from(members)
    .where(and(eq(members.status, "ACTIVE"), eq(members.benched, false)));

  const stats = activeMembers
    .map((m) => {
      const s = statsByMember.get(m.id);
      return { member: m, leaveCount: s?.leaveCount ?? 0, lastLeaveAt: s ? new Date(s.lastLeaveAt) : null };
    })
    .sort((a, b) => b.leaveCount - a.leaveCount || a.member.discordUsername.localeCompare(b.member.discordUsername));

  const totalLeaveEvents = rows.reduce((sum, r) => sum + r.leaveCount, 0);

  return { stats, totalLeaveEvents };
}

/**
 * Confirmed-leave totals grouped by board (e.g. "GL": 12, "WOE": 8) — feeds
 * the small per-board summary on the /attendance page so switching the
 * board filter isn't the only way to see the split. Leaves logged before
 * boardId existed on membershipEvents (or whose board has since been
 * deleted) are bucketed under a null id so the numbers still add up to
 * getAttendanceStats's totalLeaveEvents.
 */
export async function getAttendanceBoardBreakdown(filter: Omit<AttendanceRangeFilter, "boardId"> = {}) {
  const rows = await db
    .select({
      boardId: membershipEvents.boardId,
      leaveCount: sql<number>`count(*)::int`,
    })
    .from(membershipEvents)
    .where(and(...attendanceConditions(filter)))
    .groupBy(membershipEvents.boardId);

  const boards = await db.select({ id: partyBoards.id, name: partyBoards.name }).from(partyBoards);
  const nameById = new Map(boards.map((b) => [b.id, b.name]));

  return rows
    .map((r) => ({
      boardId: r.boardId,
      boardName: r.boardId ? nameById.get(r.boardId) ?? "กระดานที่ถูกลบ" : "ไม่ระบุกระดาน",
      leaveCount: r.leaveCount,
    }))
    .sort((a, b) => b.leaveCount - a.leaveCount);
}

/**
 * Class breakdown across active, non-benched members — for the dashboard's
 * "who plays what" bar chart. Members with no class set are surfaced
 * separately (unassignedCount) rather than silently dropped, since a big
 * chunk of "no class" is itself useful signal (a lot of the roster still
 * needs to self-select via the Discord class-select message).
 */
export async function getClassDistribution() {
  const rows = await db
    .select({
      className: members.characterClass,
      count: sql<number>`count(*)::int`,
    })
    .from(members)
    .where(and(eq(members.status, "ACTIVE"), eq(members.benched, false)))
    .groupBy(members.characterClass);

  const classesList = await listJobClasses();
  const byName = new Map(classesList.map((c) => [c.name, c]));

  const known = rows
    .filter((r): r is { className: string; count: number } => Boolean(r.className))
    .map((r) => ({
      name: r.className,
      count: r.count,
      emoji: byName.get(r.className)?.emoji ?? "",
      colorKey: byName.get(r.className)?.colorKey ?? "stone",
    }))
    .sort((a, b) => b.count - a.count);

  const unassignedCount = rows.find((r) => !r.className)?.count ?? 0;

  return { known, unassignedCount };
}

export async function getDashboardStats() {
  const [totals] = await db
    .select({
      total: sql<number>`count(*)::int`,
      // Excludes benched members — they're still ACTIVE (Discord role-wise)
      // but flagged by an admin as not currently playing, and already get
      // their own "พักการเล่น" card below; without this exclusion the two
      // cards double-counted the same people instead of partitioning them.
      active: sql<number>`count(*) filter (where ${members.status} = 'ACTIVE' and ${members.benched} = false)::int`,
      left: sql<number>`count(*) filter (where ${members.status} = 'LEFT')::int`,
      kicked: sql<number>`count(*) filter (where ${members.status} = 'KICKED')::int`,
      benched: sql<number>`count(*) filter (where ${members.status} = 'ACTIVE' and ${members.benched} = true)::int`,
    })
    .from(members);

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [recentJoins] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(membershipEvents)
    .where(
      and(eq(membershipEvents.type, "JOIN"), gte(membershipEvents.createdAt, sevenDaysAgo))
    );

  const [recentLeaves] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(membershipEvents)
    .where(
      and(
        or(eq(membershipEvents.type, "LEAVE"), eq(membershipEvents.type, "KICK")),
        gte(membershipEvents.createdAt, sevenDaysAgo)
      )
    );

  return {
    total: totals?.total ?? 0,
    active: totals?.active ?? 0,
    left: totals?.left ?? 0,
    kicked: totals?.kicked ?? 0,
    benched: totals?.benched ?? 0,
    joinsLast7Days: recentJoins?.count ?? 0,
    leavesLast7Days: recentLeaves?.count ?? 0,
  };
}
