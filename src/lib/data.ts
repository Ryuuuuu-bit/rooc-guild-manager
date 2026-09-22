import { db } from "@/db";
import { discordRoles, leaves, members, membershipEvents, memberNotes, partyBoards, type MembershipEvent } from "@/db/schema";
import { and, arrayContains, asc, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import { env } from "@/lib/env";
import { listJobClasses } from "@/lib/job-classes";
import { MONTHLY_LEAVE_LIMIT } from "@/lib/leave-quota";
import { isConfirmed, roundEnd, thaiDateString, thaiMonthRange } from "@/lib/leaves";

export interface MemberFilters {
  search?: string;
  status?: "ACTIVE" | "LEFT" | "KICKED" | "ALL";
  /** Discord role ID — only members carrying this role in `discordRoles`. */
  discordRoleId?: string;
  /** "benched" = only benched members, "active" = only non-benched, undefined = no filter. */
  benched?: "benched" | "active";
  /** Class name — matches the main class OR a secondary one ("who can play Priest?"). */
  className?: string;
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

  if (filters.className) {
    conditions.push(or(eq(members.characterClass, filters.className), arrayContains(members.altClasses, [filters.className]))!);
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

/**
 * Every leave that COUNTS in the range: ACTIVE and its round has ended
 * (src/lib/leaves.ts isConfirmed) — a leave cancelled before the round ended
 * is CANCELLED and never appears here; one for a round still ahead isn't
 * counted yet. Range bounds are Thai calendar dates (occurrenceDate), so
 * "last 30 days" means rounds dated in the last 30 days.
 */
async function confirmedLeavesInRange(filter: AttendanceRangeFilter) {
  const now = new Date();
  const from = filter.from ?? (filter.days ? new Date(now.getTime() - filter.days * 24 * 60 * 60 * 1000) : undefined);
  const conditions = [eq(leaves.status, "ACTIVE")];
  if (from) conditions.push(gte(leaves.occurrenceDate, thaiDateString(from)));
  if (filter.to) conditions.push(lte(leaves.occurrenceDate, thaiDateString(filter.to)));
  if (filter.boardId) conditions.push(eq(leaves.boardId, filter.boardId));
  const rows = await db
    .select({ leave: leaves, board: partyBoards })
    .from(leaves)
    .leftJoin(partyBoards, eq(leaves.boardId, partyBoards.id))
    .where(and(...conditions))
    .orderBy(asc(leaves.occurrenceDate));
  return rows
    .filter((r) => isConfirmed(r.leave, r.board ?? { checkinEventKey: null }, now))
    .map((r) => ({ ...r.leave, roundEnd: roundEnd(r.board ?? { checkinEventKey: null }, r.leave.occurrenceDate) }));
}

/**
 * Per-member ลา counts within a period, sorted most-ลา-first — answers "who
 * takes leave the most" at a glance. Deliberately just a raw count rather
 * than a percentage: a "rate" would need an "expected attendance" concept
 * (how many events did they have the chance to attend) that this app's
 * board model doesn't track, so a rate would be more misleading than
 * informative. Only lists members who are currently ACTIVE and not benched.
 *
 * Also surfaces each member's most recent counted ลา within the range
 * (lastLeaveAt = that round's end).
 */
export async function getAttendanceStats(filter: AttendanceRangeFilter = {}) {
  const confirmed = await confirmedLeavesInRange(filter);
  const statsByMember = new Map<string, { leaveCount: number; lastLeaveAt: Date }>();
  for (const l of confirmed) {
    const s = statsByMember.get(l.memberId) ?? { leaveCount: 0, lastLeaveAt: l.roundEnd };
    s.leaveCount++;
    if (l.roundEnd > s.lastLeaveAt) s.lastLeaveAt = l.roundEnd;
    statsByMember.set(l.memberId, s);
  }

  const activeMembers = await db
    .select()
    .from(members)
    .where(and(eq(members.status, "ACTIVE"), eq(members.benched, false)));

  const stats = activeMembers
    .map((m) => {
      const s = statsByMember.get(m.id);
      return { member: m, leaveCount: s?.leaveCount ?? 0, lastLeaveAt: s?.lastLeaveAt ?? null };
    })
    .sort((a, b) => b.leaveCount - a.leaveCount || a.member.discordUsername.localeCompare(b.member.discordUsername));

  return { stats, totalLeaveEvents: confirmed.length };
}

export interface OverQuotaEntry {
  member: typeof members.$inferSelect;
  /** Per-board counts this month, only boards where the count is over the limit. */
  boards: { boardId: string | null; boardName: string; leaveCount: number }[];
}

/**
 * Active, non-benched members who are OVER the monthly leave rule
 * (MONTHLY_LEAVE_LIMIT, per board) in the current Thai calendar month —
 * the "⚠️ เกินโควต้าเดือนนี้" panel on /attendance. Counts every ACTIVE
 * leave dated this month, upcoming rounds included — deliberately matching
 * what ห้องลา tells the member ("ครั้งที่ N/2") and the admin notification,
 * so a member on their 3rd leave is flagged the moment it's filed, not only
 * after the round ends. Independent of the page's range/board filter.
 */
export async function getOverQuotaThisMonth(): Promise<OverQuotaEntry[]> {
  const { from, to } = thaiMonthRange();
  const rows = await db
    .select({
      memberId: leaves.memberId,
      boardId: leaves.boardId,
      leaveCount: sql<number>`count(*)::int`,
    })
    .from(leaves)
    .where(and(eq(leaves.status, "ACTIVE"), gte(leaves.occurrenceDate, from), lte(leaves.occurrenceDate, to)))
    .groupBy(leaves.memberId, leaves.boardId)
    .having(sql`count(*) > ${MONTHLY_LEAVE_LIMIT}`);
  if (rows.length === 0) return [];

  const [activeMembers, boards] = await Promise.all([
    db.select().from(members).where(and(eq(members.status, "ACTIVE"), eq(members.benched, false))),
    db.select({ id: partyBoards.id, name: partyBoards.name }).from(partyBoards),
  ]);
  const memberById = new Map(activeMembers.map((m) => [m.id, m]));
  const boardNameById = new Map(boards.map((b) => [b.id, b.name]));

  const byMember = new Map<string, OverQuotaEntry>();
  for (const r of rows) {
    const member = memberById.get(r.memberId);
    if (!member) continue;
    const entry = byMember.get(r.memberId) ?? { member, boards: [] };
    entry.boards.push({
      boardId: r.boardId,
      boardName: r.boardId ? boardNameById.get(r.boardId) ?? "Deleted board" : "Unspecified board",
      leaveCount: r.leaveCount,
    });
    byMember.set(r.memberId, entry);
  }
  return [...byMember.values()].sort(
    (a, b) =>
      Math.max(...b.boards.map((x) => x.leaveCount)) - Math.max(...a.boards.map((x) => x.leaveCount)) ||
      a.member.discordUsername.localeCompare(b.member.discordUsername)
  );
}

/**
 * Counted-leave totals grouped by board (e.g. "GL": 12, "WOE": 8) — feeds
 * the small per-board summary on the /attendance page. Leaves with no board
 * (or whose board has since been deleted) are bucketed under a null id so
 * the numbers still add up to getAttendanceStats's totalLeaveEvents.
 */
export async function getAttendanceBoardBreakdown(filter: Omit<AttendanceRangeFilter, "boardId"> = {}) {
  const confirmed = await confirmedLeavesInRange(filter);
  const countByBoard = new Map<string | null, number>();
  for (const l of confirmed) countByBoard.set(l.boardId, (countByBoard.get(l.boardId) ?? 0) + 1);

  const boards = await db.select({ id: partyBoards.id, name: partyBoards.name }).from(partyBoards);
  const nameById = new Map(boards.map((b) => [b.id, b.name]));

  return [...countByBoard.entries()]
    .map(([boardId, leaveCount]) => ({
      boardId,
      boardName: boardId ? nameById.get(boardId) ?? "Deleted board" : "Unspecified board",
      leaveCount,
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

  // Members who list each class as a SECONDARY one — "could also field N
  // more of these in a pinch", shown faintly next to the main-class bar.
  const altRows = await db
    .select({ className: sql<string>`alt`, count: sql<number>`count(*)::int` })
    .from(sql`${members}, unnest(${members.altClasses}) as alt`)
    .where(and(eq(members.status, "ACTIVE"), eq(members.benched, false)))
    .groupBy(sql`alt`);
  const altByName = new Map(altRows.map((r) => [r.className, r.count]));

  const classesList = await listJobClasses();
  const byName = new Map(classesList.map((c) => [c.name, c]));

  const known = rows
    .filter((r): r is { className: string; count: number } => Boolean(r.className))
    .map((r) => ({
      name: r.className,
      count: r.count,
      alsoCount: altByName.get(r.className) ?? 0,
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
