import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { members, pvpStatEntries, type Member, type PvpStatEntry } from "@/db/schema";
import { memberDisplayName } from "@/lib/ui";

// Re-exported for convenience — see pvp-roles.ts for why the role list
// itself lives in a separate, client-safe module.
export { PVP_ROLES, type PvpRole } from "@/lib/pvp-roles";

export interface PvpStatRow {
  entry: PvpStatEntry;
  member: Pick<Member, "id" | "discordNickname" | "discordGlobalName" | "discordUsername" | "discordAvatar" | "characterClass" | "inGameName">;
}

/**
 * One row per ACTIVE, non-benched member: their most recent submission, or
 * `entry: null` if they've never filled the form. Ordered by CP descending
 * (nulls — never submitted — sort last) since this powers the public
 * leaderboard table and CP is the single number people compare guild-wide.
 */
export async function getLatestPvpStats(): Promise<Array<{ member: PvpStatRow["member"]; entry: PvpStatEntry | null }>> {
  const activeMembers = await db
    .select({
      id: members.id,
      discordNickname: members.discordNickname,
      discordGlobalName: members.discordGlobalName,
      discordUsername: members.discordUsername,
      discordAvatar: members.discordAvatar,
      characterClass: members.characterClass,
      inGameName: members.inGameName,
    })
    .from(members)
    .where(and(eq(members.status, "ACTIVE"), eq(members.benched, false)));

  const memberIds = activeMembers.map((m) => m.id);
  const allEntries = memberIds.length
    ? await db
        .select()
        .from(pvpStatEntries)
        .where(inArray(pvpStatEntries.memberId, memberIds))
        .orderBy(desc(pvpStatEntries.createdAt))
    : [];

  // First entry seen per member wins — allEntries is already newest-first.
  const latestByMember = new Map<string, PvpStatEntry>();
  for (const e of allEntries) {
    if (!latestByMember.has(e.memberId)) latestByMember.set(e.memberId, e);
  }

  return activeMembers
    .map((member) => ({ member, entry: latestByMember.get(member.id) ?? null }))
    .sort((a, b) => {
      const cpA = a.entry?.cp;
      const cpB = b.entry?.cp;
      if (cpA == null && cpB == null) return memberDisplayName(a.member).localeCompare(memberDisplayName(b.member), "th");
      if (cpA == null) return 1;
      if (cpB == null) return -1;
      return cpB - cpA;
    });
}

/** Every submission a member has made, newest first — the append-only history the guild wanted kept. */
export async function getPvpStatHistory(memberId: string): Promise<PvpStatEntry[]> {
  return db
    .select()
    .from(pvpStatEntries)
    .where(eq(pvpStatEntries.memberId, memberId))
    .orderBy(desc(pvpStatEntries.createdAt));
}

/** A member's own most recent submission — used to prefill the form so a weekly update means editing what changed, not retyping everything. */
export async function getMyLatestPvpStat(memberId: string): Promise<PvpStatEntry | null> {
  const [row] = await db
    .select()
    .from(pvpStatEntries)
    .where(eq(pvpStatEntries.memberId, memberId))
    .orderBy(desc(pvpStatEntries.createdAt))
    .limit(1);
  return row ?? null;
}
