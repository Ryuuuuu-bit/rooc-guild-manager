import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { members, pvpStatEntries, voiceAttendanceEvents } from "@/db/schema";
import type { Member } from "@/db/schema";

export interface InactiveMemberRow {
  member: Member;
  /** Most recent voice presence in ANY tracked check-in channel (GL/WOE), across all time — not scoped to one event/date like checkin-data.ts's per-round report. */
  lastAttendedAt: Date | null;
  /** Most recent `pvpStatEntries` submission. */
  lastPvpSubmittedAt: Date | null;
  /** Whichever of the two signals above is more recent — null if the member has neither. */
  lastActiveAt: Date | null;
  /** What `daysSinceActive` was actually measured from: `lastActiveAt`, or — for a member with neither signal yet — `joinedDiscordAt`/`createdAt` instead, so a brand-new member isn't flagged from day one just for not having done anything yet. */
  referenceAt: Date;
  daysSinceActive: number;
}

/** Shared default threshold — matches pvp-stats-table.tsx's own 14-day
 * staleness display, so the dashboard tile and the /inactive page's default
 * view agree with what "stale" already means elsewhere in the app. */
export const DEFAULT_INACTIVE_DAYS = 14;

function daysBetween(now: Date, past: Date): number {
  return Math.floor((now.getTime() - past.getTime()) / (24 * 60 * 60 * 1000));
}

/**
 * ACTIVE members who haven't shown up in either signal this app can see —
 * check-in voice attendance on a tracked GL/WOE channel, or a PVP stats
 * submission — in at least `minDays` days. Meant to help admins spot
 * members who've quietly gone dark without anyone noticing, for a
 * follow-up DM or a bench/kick decision — not an automated action itself.
 *
 * Deliberately combines both signals (rather than just PVP stats, which is
 * the only staleness check that existed before this — see
 * bot/pvp-stats-reminder.ts and pvp-stats-table.tsx's 14-day display
 * threshold) since either one alone undercounts: someone can attend every
 * round and never touch /pvp-stats, or vice versa.
 *
 * Sorted longest-quiet first. Benched members are included (not excluded)
 * — being benched explains reduced party/attendance activity, but not
 * months of silence on both fronts — the UI should just show their
 * Benched badge alongside so it's visible context, not a reason to hide
 * them from this list entirely.
 */
export async function getInactiveMembers(minDays: number): Promise<InactiveMemberRow[]> {
  const roster = await db.select().from(members).where(eq(members.status, "ACTIVE"));
  if (roster.length === 0) return [];

  const [attendanceRows, pvpRows] = await Promise.all([
    db
      .select({ memberId: voiceAttendanceEvents.memberId, lastAt: sql<string | null>`max(${voiceAttendanceEvents.createdAt})` })
      .from(voiceAttendanceEvents)
      .groupBy(voiceAttendanceEvents.memberId),
    db
      .select({ memberId: pvpStatEntries.memberId, lastAt: sql<string | null>`max(${pvpStatEntries.createdAt})` })
      .from(pvpStatEntries)
      .groupBy(pvpStatEntries.memberId),
  ]);
  const lastAttendedById = new Map(attendanceRows.filter((r) => r.lastAt).map((r) => [r.memberId, new Date(r.lastAt as string)]));
  const lastPvpById = new Map(pvpRows.filter((r) => r.lastAt).map((r) => [r.memberId, new Date(r.lastAt as string)]));

  const now = new Date();
  const rows: InactiveMemberRow[] = roster.map((member) => {
    const lastAttendedAt = lastAttendedById.get(member.id) ?? null;
    const lastPvpSubmittedAt = lastPvpById.get(member.id) ?? null;
    const lastActiveAt =
      lastAttendedAt && lastPvpSubmittedAt
        ? lastAttendedAt > lastPvpSubmittedAt
          ? lastAttendedAt
          : lastPvpSubmittedAt
        : (lastAttendedAt ?? lastPvpSubmittedAt);
    const referenceAt = lastActiveAt ?? member.joinedDiscordAt ?? member.createdAt;
    return { member, lastAttendedAt, lastPvpSubmittedAt, lastActiveAt, referenceAt, daysSinceActive: daysBetween(now, referenceAt) };
  });

  return rows.filter((r) => r.daysSinceActive >= minDays).sort((a, b) => b.daysSinceActive - a.daysSinceActive);
}
