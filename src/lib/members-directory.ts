// Server-only data for the /members directory — one load of every member
// (all statuses) plus the per-member signals the page filters on, so the
// client can search/filter instantly without a round-trip per keystroke.
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { leaves, members, partyBoards, pvpStatEntries } from "@/db/schema";
import { getCheckinEvent, getCheckinReport, listCheckinWindows, windowFor } from "@/lib/checkin-data";
import { CHECKIN_EVENTS } from "@/lib/checkin-events";
import { MONTHLY_LEAVE_LIMIT } from "@/lib/leave-quota";
import { listActiveLeavesBetween, thaiMonthRange } from "@/lib/leaves";
import { pvpEntryLastUpdated } from "@/lib/pvp-stat-fields";
import { memberDisplayName } from "@/lib/ui";

/** One cell of a member's recent-rounds strip. */
export type RoundMark =
  | "in" // was in the event's voice channel
  | "leave" // on leave for it (excused)
  | "out" // expected, not there, no leave
  | "na" // not expected: benched, left, or hadn't joined the guild yet
  | "void"; // round didn't count for anyone (a voided / break-period round)

export interface DirectoryRound {
  key: string;
  date: string;
  eventKey: string;
  shortLabel: string;
  void: boolean;
}

export interface DirectoryMember {
  id: string;
  discordId: string;
  name: string;
  username: string;
  avatar: string | null;
  inGameName: string | null;
  className: string | null;
  altClasses: string[];
  roleIds: string[];
  status: "ACTIVE" | "LEFT" | "KICKED";
  benched: boolean;
  joinedAt: string | null; // ISO
  pvp: { cp: number | null; updatedAt: string } | null;
  /** Admin-only: ACTIVE leaves this Thai month per board label ("GL", "WOE", or the board's name). */
  leaves?: Record<string, number>;
  /** Admin-only: aligned with MembersDirectory.rounds (oldest → newest). */
  attendance?: RoundMark[];
}

export interface MembersDirectory {
  members: DirectoryMember[];
  /** Admin-only (empty otherwise): the last few ended GL/WOE rounds the strip covers. */
  rounds: DirectoryRound[];
  monthlyLimit: number;
}

const ROUNDS_SHOWN = 8;

export interface LoadedRound {
  round: DirectoryRound;
  report: Awaited<ReturnType<typeof getCheckinReport>>;
}

/**
 * The last `limit` ENDED rounds across every event, oldest first, each with
 * its check-in report and whether it was a break. Shared by /members (the
 * per-member strip) and the overview (the stacked trend chart).
 */
export async function loadRecentRounds(limit: number): Promise<LoadedRound[]> {
  const now = new Date();
  const perEvent = await Promise.all(
    CHECKIN_EVENTS.map(async (event) => (await listCheckinWindows(event.key)).filter((w) => w.end <= now).map((w) => ({ ...w, eventKey: event.key })))
  );
  const windows = perEvent
    .flat()
    .sort((a, b) => b.start.getTime() - a.start.getTime())
    .slice(0, limit)
    .reverse();
  if (windows.length === 0) return [];

  // A round with any leave voided AFTER it ended was declared a break (the
  // only thing that can cancel a finished round's leave is the admin
  // "void leaves for a period" tool) — it counts for nobody.
  const dates = [...new Set(windows.map((w) => w.date))];
  const cancelled = await db
    .select({ date: leaves.occurrenceDate, cancelledAt: leaves.cancelledAt, eventKey: partyBoards.checkinEventKey })
    .from(leaves)
    .innerJoin(partyBoards, eq(leaves.boardId, partyBoards.id))
    .where(and(eq(leaves.status, "CANCELLED"), inArray(leaves.occurrenceDate, dates)));
  const voidKeys = new Set<string>();
  for (const c of cancelled) {
    const event = c.eventKey ? getCheckinEvent(c.eventKey) : undefined;
    if (event && c.cancelledAt && c.cancelledAt >= windowFor(event, c.date).end) voidKeys.add(`${c.date}:${event.key}`);
  }

  const reports = await Promise.all(windows.map((w) => getCheckinReport(w.eventKey, w.date)));
  return windows.map((w, i) => ({
    round: { key: `${w.date}:${w.eventKey}`, date: w.date, eventKey: w.eventKey, shortLabel: w.eventKey.toUpperCase(), void: voidKeys.has(`${w.date}:${w.eventKey}`) },
    report: reports[i],
  }));
}

/** The last `ROUNDS_SHOWN` ended rounds, with each member's mark. */
async function recentAttendance(memberIds: string[]): Promise<{ rounds: DirectoryRound[]; marks: Map<string, RoundMark[]> }> {
  const loaded = await loadRecentRounds(ROUNDS_SHOWN);
  const rounds = loaded.map((l) => l.round);
  const reports = loaded.map((l) => l.report);

  const marks = new Map<string, RoundMark[]>();
  for (const id of memberIds) marks.set(id, []);
  rounds.forEach((round, i) => {
    const byMember = new Map((reports[i]?.results ?? []).map((r) => [r.member.id, r]));
    for (const id of memberIds) {
      let mark: RoundMark;
      if (round.void) mark = "void";
      else {
        const r = byMember.get(id);
        // Not in that round's roster (benched, left, or joined after it) — not expected.
        mark = !r ? "na" : r.attended ? "in" : r.onLeave ? "leave" : "out";
      }
      marks.get(id)!.push(mark);
    }
  });
  return { rounds, marks };
}

export async function getMembersDirectory({ includeAdminData }: { includeAdminData: boolean }): Promise<MembersDirectory> {
  const rows = await db.select().from(members);
  const ids = rows.map((m) => m.id);

  const pvpRows = rows.length
    ? await db
        .select({ memberId: pvpStatEntries.memberId, cp: pvpStatEntries.cp, createdAt: pvpStatEntries.createdAt, updatedAt: pvpStatEntries.updatedAt })
        .from(pvpStatEntries)
        .orderBy(desc(pvpStatEntries.createdAt))
    : [];
  const latestPvp = new Map<string, (typeof pvpRows)[number]>();
  for (const p of pvpRows) if (!latestPvp.has(p.memberId)) latestPvp.set(p.memberId, p);

  let leavesByMember = new Map<string, Record<string, number>>();
  let attendance: { rounds: DirectoryRound[]; marks: Map<string, RoundMark[]> } = { rounds: [], marks: new Map() };
  if (includeAdminData) {
    const { from, to } = thaiMonthRange(new Date());
    const [monthLeaves, att] = await Promise.all([listActiveLeavesBetween(from, to), recentAttendance(ids)]);
    leavesByMember = new Map();
    for (const l of monthLeaves) {
      if (!l.board) continue; // board-less legacy entries have no quota bucket
      const label = l.board.checkinEventKey ? l.board.checkinEventKey.toUpperCase() : l.board.name;
      const rec = leavesByMember.get(l.memberId) ?? {};
      rec[label] = (rec[label] ?? 0) + 1;
      leavesByMember.set(l.memberId, rec);
    }
    attendance = att;
  }

  const list: DirectoryMember[] = rows.map((m) => {
    const p = latestPvp.get(m.id);
    return {
      id: m.id,
      discordId: m.discordId,
      name: memberDisplayName(m),
      username: m.discordUsername,
      avatar: m.discordAvatar,
      inGameName: m.inGameName,
      className: m.characterClass,
      altClasses: m.altClasses,
      roleIds: m.discordRoles,
      status: m.status,
      benched: m.benched,
      joinedAt: m.joinedDiscordAt ? m.joinedDiscordAt.toISOString() : null,
      pvp: p ? { cp: p.cp, updatedAt: pvpEntryLastUpdated(p).toISOString() } : null,
      ...(includeAdminData ? { leaves: leavesByMember.get(m.id) ?? {}, attendance: attendance.marks.get(m.id) ?? [] } : {}),
    };
  });
  list.sort((a, b) => a.name.localeCompare(b.name, "th"));

  return { members: list, rounds: attendance.rounds, monthlyLimit: MONTHLY_LEAVE_LIMIT };
}
