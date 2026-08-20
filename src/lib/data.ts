import { db } from "@/db";
import { discordRoles, members, membershipEvents, memberNotes } from "@/db/schema";
import { and, arrayContains, desc, eq, gte, ilike, or, sql } from "drizzle-orm";
import { env } from "@/lib/env";

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

export async function getRecentActivity(limit = 30) {
  return db
    .select({
      event: membershipEvents,
      member: members,
    })
    .from(membershipEvents)
    .innerJoin(members, eq(membershipEvents.memberId, members.id))
    .orderBy(desc(membershipEvents.createdAt))
    .limit(limit);
}

export async function getDashboardStats() {
  const [totals] = await db
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where ${members.status} = 'ACTIVE')::int`,
      left: sql<number>`count(*) filter (where ${members.status} = 'LEFT')::int`,
      kicked: sql<number>`count(*) filter (where ${members.status} = 'KICKED')::int`,
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
    joinsLast7Days: recentJoins?.count ?? 0,
    leavesLast7Days: recentLeaves?.count ?? 0,
  };
}
