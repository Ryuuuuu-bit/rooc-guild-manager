// Server-only data for the Guild Overview (/) — "what needs doing today":
// the next round and its board, an admin to-do list, a stacked attendance
// history, membership flow, class composition and a few shout-outs.
import { and, desc, eq, gte, lte, or } from "drizzle-orm";
import { db } from "@/db";
import { leaves, members, membershipEvents, partyBoards, pvpStatEntries } from "@/db/schema";
import { getCheckinEvent, windowFor } from "@/lib/checkin-events";
import { getNextRound } from "@/lib/calendar-data";
import { listJobClasses } from "@/lib/job-classes";
import { MONTHLY_LEAVE_LIMIT } from "@/lib/leave-quota";
import { boardsByEventKey, listActiveLeavesBetween, thaiDateString, thaiMonthRange } from "@/lib/leaves";
import { loadRecentRounds } from "@/lib/members-directory";
import { getPartyBoardDetail } from "@/lib/party-data";
import { pvpEntryLastUpdated } from "@/lib/pvp-stat-fields";
import { memberDisplayName } from "@/lib/ui";

const DAY = 24 * 60 * 60 * 1000;
const PVP_STALE_DAYS = 14;
const TREND_ROUNDS = 12;

export interface PersonRef {
  id: string;
  name: string;
  avatar: string | null;
  className: string | null;
}

export interface OverviewNextRound {
  eventKey: string;
  label: string;
  shortLabel: string;
  date: string;
  timeLabel: string;
  start: string;
  end: string;
  onLeave: PersonRef[];
  expected: number;
  board: { id: string; name: string; parties: number; slots: number; ready: number; seatedOnLeave: number; empty: number } | null;
  lastRoundRate: number | null;
}

export interface TrendRound {
  key: string;
  date: string;
  eventKey: string;
  shortLabel: string;
  void: boolean;
  attended: number;
  onLeave: number;
  absent: number;
}

export interface AttentionItem {
  key: string;
  label: string;
  hint: string;
  count: number;
  href: string;
  tone: "rose" | "amber" | "sky";
}

export interface ClassRow {
  name: string;
  colorKey: string;
  active: number;
  benched: number;
  alsoCount: number;
}

export interface Overview {
  counts: { active: number; benched: number; left: number; kicked: number; total: number };
  /** Active (non-benched) head-count at the end of each of the last 8 weeks, oldest first — derived by walking join/leave events back from today. */
  activeHistory: number[];
  activeDelta30: number;
  nextRound: OverviewNextRound | null;
  attention: AttentionItem[];
  trend: TrendRound[];
  flow: { weekStart: string; joined: number; left: number }[];
  classes: ClassRow[];
  partiesForRatio: number | null;
  pvpUpToDate: number;
  pvpRoster: number;
  leavesThisMonth: number;
  voidedThisMonth: number;
  shoutouts: { perfect: PersonRef[]; climbers: (PersonRef & { gain: number })[]; welcome: PersonRef[] };
}

export async function getOverview({ isAdmin }: { isAdmin: boolean }): Promise<Overview> {
  const now = new Date();
  const all = await db.select().from(members);
  const ref = (m: (typeof all)[number]): PersonRef => ({ id: m.id, name: memberDisplayName(m), avatar: m.discordAvatar, className: m.characterClass });
  const byId = new Map(all.map((m) => [m.id, m]));
  const current = all.filter((m) => m.status === "ACTIVE");
  const active = current.filter((m) => !m.benched);

  const counts = {
    active: active.length,
    benched: current.length - active.length,
    left: all.filter((m) => m.status === "LEFT").length,
    kicked: all.filter((m) => m.status === "KICKED").length,
    total: all.length,
  };

  // --- membership flow (8 weeks) + active head-count history --------------
  const eightWeeksAgo = new Date(now.getTime() - 56 * DAY);
  const flowEvents = await db
    .select({ type: membershipEvents.type, createdAt: membershipEvents.createdAt })
    .from(membershipEvents)
    .where(and(or(eq(membershipEvents.type, "JOIN"), eq(membershipEvents.type, "LEAVE"), eq(membershipEvents.type, "KICK")), gte(membershipEvents.createdAt, eightWeeksAgo)));
  const flow = Array.from({ length: 8 }, (_, i) => {
    const start = new Date(now.getTime() - (8 - i) * 7 * DAY);
    const end = new Date(start.getTime() + 7 * DAY);
    const inWeek = flowEvents.filter((e) => e.createdAt >= start && e.createdAt < end);
    return { weekStart: thaiDateString(start), joined: inWeek.filter((e) => e.type === "JOIN").length, left: inWeek.filter((e) => e.type !== "JOIN").length };
  });
  // Walk back from today: head-count at the end of week i = now − joins after that point + departures after it.
  const activeHistory = Array.from({ length: 8 }, (_, i) => {
    const at = new Date(now.getTime() - (7 - i) * 7 * DAY);
    const after = flowEvents.filter((e) => e.createdAt > at);
    return active.length - after.filter((e) => e.type === "JOIN").length + after.filter((e) => e.type !== "JOIN").length;
  });
  const thirtyAgo = new Date(now.getTime() - 30 * DAY);
  const last30 = flowEvents.filter((e) => e.createdAt >= thirtyAgo);
  const activeDelta30 = last30.filter((e) => e.type === "JOIN").length - last30.filter((e) => e.type !== "JOIN").length;

  // --- attendance trend (last 12 ended rounds) ----------------------------
  const loaded = await loadRecentRounds(TREND_ROUNDS);
  const trend: TrendRound[] = loaded.map(({ round, report }) => {
    const results = report?.results ?? [];
    const attended = results.filter((r) => r.attended).length;
    const onLeave = results.filter((r) => !r.attended && r.onLeave).length;
    return { ...round, attended, onLeave, absent: results.length - attended - onLeave };
  });

  // --- next round + its board ---------------------------------------------
  const nr = await getNextRound(now);
  let nextRound: OverviewNextRound | null = null;
  if (nr) {
    const leaveRows = (await listActiveLeavesBetween(nr.date, nr.date)).filter((l) => l.board?.checkinEventKey === nr.eventKey);
    const onLeave = leaveRows.map((l) => ref(l.member));
    const boardRef = (await boardsByEventKey()).get(nr.eventKey);
    let board: OverviewNextRound["board"] = null;
    if (boardRef) {
      const detail = await getPartyBoardDetail(boardRef.id);
      if (detail) {
        const slots = detail.groups.flatMap((g) => g.parties.flatMap((p) => p.slots));
        const parties = detail.groups.reduce((n, g) => n + g.parties.length, 0);
        const seatedOnLeave = slots.filter((s) => s.member && s.onLeave).length;
        const filled = slots.filter((s) => s.member).length;
        board = { id: detail.id, name: detail.name, parties, slots: slots.length, ready: filled - seatedOnLeave, seatedOnLeave, empty: slots.length - filled };
      }
    }
    const lastSame = [...trend].reverse().find((t) => t.eventKey === nr.eventKey && !t.void);
    const lastTotal = lastSame ? lastSame.attended + lastSame.onLeave + lastSame.absent : 0;
    nextRound = {
      ...nr,
      onLeave,
      expected: Math.max(0, active.length - onLeave.filter((p) => byId.get(p.id)?.status === "ACTIVE" && !byId.get(p.id)?.benched).length),
      board,
      lastRoundRate: lastSame && lastTotal ? Math.round((lastSame.attended / lastTotal) * 100) : null,
    };
  }

  // --- PVP freshness + climbers -------------------------------------------
  const pvpRows = await db
    .select({ memberId: pvpStatEntries.memberId, cp: pvpStatEntries.cp, createdAt: pvpStatEntries.createdAt, updatedAt: pvpStatEntries.updatedAt })
    .from(pvpStatEntries)
    .orderBy(desc(pvpStatEntries.createdAt));
  const latest = new Map<string, (typeof pvpRows)[number]>();
  for (const p of pvpRows) if (!latest.has(p.memberId)) latest.set(p.memberId, p);
  const staleCut = now.getTime() - PVP_STALE_DAYS * DAY;
  const pvpUpToDate = active.filter((m) => {
    const p = latest.get(m.id);
    return p && pvpEntryLastUpdated(p).getTime() >= staleCut;
  }).length;

  const { from: monthFrom, to: monthTo } = thaiMonthRange(now);
  const monthStart = new Date(`${monthFrom}T00:00:00+07:00`);
  // CP gain this month = latest CP now − the last CP filed before the month
  // (or, for someone who only started this month, their first entry in it).
  const climbers = active
    .map((m) => {
      const rows = pvpRows.filter((p) => p.memberId === m.id && p.cp != null); // newest first
      const nowCp = rows[0]?.cp;
      if (nowCp == null) return null;
      const before = rows.find((p) => p.createdAt < monthStart);
      const baseline = before?.cp ?? rows[rows.length - 1]?.cp;
      if (baseline == null || rows[0].createdAt < monthStart) return null; // nothing new this month
      return { ...ref(m), gain: nowCp - baseline };
    })
    .filter((x): x is PersonRef & { gain: number } => x !== null && x.gain > 0)
    .sort((a, b) => b.gain - a.gain)
    .slice(0, 4);

  // --- leaves this month --------------------------------------------------
  const monthLeaves = await listActiveLeavesBetween(monthFrom, monthTo);
  // Voided = cancelled only after its round had ended (the bulk "void a period" tool).
  const cancelledThisMonth = await db
    .select({ date: leaves.occurrenceDate, cancelledAt: leaves.cancelledAt, eventKey: partyBoards.checkinEventKey })
    .from(leaves)
    .innerJoin(partyBoards, eq(leaves.boardId, partyBoards.id))
    .where(and(eq(leaves.status, "CANCELLED"), gte(leaves.occurrenceDate, monthFrom), lte(leaves.occurrenceDate, monthTo)));
  const voidedThisMonth = cancelledThisMonth.filter((c) => {
    const event = c.eventKey ? getCheckinEvent(c.eventKey) : undefined;
    return event && c.cancelledAt && c.cancelledAt >= windowFor(event, c.date).end;
  }).length;

  // --- perfect attendance this month (every counted round attended) -------
  const monthRounds = loaded.filter((l) => !l.round.void && l.round.date >= monthFrom && l.round.date <= monthTo);
  const perfect =
    monthRounds.length >= 2
      ? active
          .filter((m) => monthRounds.every((l) => l.report?.results.find((r) => r.member.id === m.id)?.attended === true))
          .map(ref)
      : [];

  // --- classes ------------------------------------------------------------
  const colorByName = new Map((await listJobClasses()).map((c) => [c.name, c.colorKey]));
  const classMap = new Map<string, ClassRow>();
  const row = (name: string) => classMap.get(name) ?? { name, colorKey: colorByName.get(name) ?? "stone", active: 0, benched: 0, alsoCount: 0 };
  for (const m of current) {
    if (m.characterClass) {
      const r = row(m.characterClass);
      if (m.benched) r.benched++;
      else r.active++;
      classMap.set(m.characterClass, r);
    }
    if (!m.benched) {
      for (const a of m.altClasses) {
        if (a === m.characterClass) continue;
        const r = row(a);
        r.alsoCount++;
        classMap.set(a, r);
      }
    }
  }
  const classes = [...classMap.values()].sort((a, b) => b.active - a.active || b.benched - a.benched);

  // --- admin to-do --------------------------------------------------------
  const attention: AttentionItem[] = [];
  if (isAdmin) {
    const stale = active.filter((m) => {
      const p = latest.get(m.id);
      return !p || pvpEntryLastUpdated(p).getTime() < staleCut;
    }).length;
    const noClass = current.filter((m) => !m.characterClass).length;
    // Absent (no leave) in each of their last 3 counted rounds.
    const counted = loaded.filter((l) => !l.round.void);
    const streak = active.filter((m) => {
      const marks = counted
        .map((l) => l.report?.results.find((r) => r.member.id === m.id))
        .filter((r): r is NonNullable<typeof r> => Boolean(r))
        .slice(-3);
      return marks.length === 3 && marks.every((r) => !r.attended && !r.onLeave);
    }).length;
    const perBoard = new Map<string, number>();
    for (const l of monthLeaves) {
      if (!l.board) continue;
      const k = `${l.memberId}:${l.board.id}`;
      perBoard.set(k, (perBoard.get(k) ?? 0) + 1);
    }
    const overQuota = new Set([...perBoard.entries()].filter(([, n]) => n > MONTHLY_LEAVE_LIMIT).map(([k]) => k.split(":")[0])).size;
    // Same 30-day window as /members' "Joined < 30 days" filter this links to.
    const monthAgo = now.getTime() - 30 * DAY;
    const newcomers = current.filter((m) => m.joinedDiscordAt && m.joinedDiscordAt.getTime() >= monthAgo).length;

    attention.push(
      { key: "pvp", label: "PVP stats stale / missing", hint: `not updated in ${PVP_STALE_DAYS}+ days`, count: stale, href: "/members?attn=pvp", tone: "rose" },
      { key: "noclass", label: "Members without a class", hint: "can't be placed by class", count: noClass, href: "/members?attn=noclass", tone: "amber" },
      { key: "absent3", label: "Absent 3 rounds in a row", hint: "no leave filed", count: streak, href: "/members?attn=absent3", tone: "rose" },
      { key: "quota", label: "Over leave quota", hint: `more than ${MONTHLY_LEAVE_LIMIT} on one board this month`, count: overQuota, href: "/members?attn=quota", tone: "amber" },
      { key: "new", label: "Joined in the last 30 days", hint: "check class & in-game name", count: newcomers, href: "/members?attn=new", tone: "sky" }
    );
  }

  // --- welcome ------------------------------------------------------------
  const twoWeeksAgo = now.getTime() - 14 * DAY;
  const welcome = current
    .filter((m) => m.joinedDiscordAt && m.joinedDiscordAt.getTime() >= twoWeeksAgo)
    .sort((a, b) => (b.joinedDiscordAt?.getTime() ?? 0) - (a.joinedDiscordAt?.getTime() ?? 0))
    .slice(0, 8)
    .map(ref);

  const nextBoardParties = nextRound?.board?.parties ?? null;

  return {
    counts,
    activeHistory,
    activeDelta30,
    nextRound,
    attention,
    trend,
    flow,
    classes,
    partiesForRatio: nextBoardParties && nextBoardParties > 0 ? nextBoardParties : null,
    pvpUpToDate,
    pvpRoster: active.length,
    leavesThisMonth: monthLeaves.length,
    voidedThisMonth,
    shoutouts: { perfect, climbers, welcome },
  };
}
