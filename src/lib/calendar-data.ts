import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { leaves, members, partyBoards, type Member } from "@/db/schema";
import { CHECKIN_EVENTS, type CheckinEventConfig, addDays, thaiDateString, weekdayOf, windowFor } from "@/lib/checkin-data";
import { MONTHLY_LEAVE_LIMIT } from "@/lib/leave-quota";
import { boardsByEventKey, listActiveLeavesBetween } from "@/lib/leaves";
import { memberDisplayName } from "@/lib/ui";

export interface CalendarLeaveMember {
  id: string;
  name: string;
  discordAvatar: string | null;
  /** Main class — the calendar's "class impact" groups by this. */
  className: string | null;
  /** Filed by the member themselves (ห้องลา) or logged by an admin. */
  source: "MEMBER" | "ADMIN";
  note: string | null;
}

export interface CalendarDayEvent {
  eventKey: string;
  /** Full event name, e.g. "Tyr Cup". */
  label: string;
  /** Compact tag for grid chips, e.g. "GL". */
  shortLabel: string;
  /** "19:55–20:20" (Thai time). */
  timeLabel: string;
  /**
   * Leave v2 — one source (`leaves`, keyed by occurrence date) for every
   * date, past or future; the status only says where the round stands:
   *
   * "confirmed" — the round has ended, so every ACTIVE leave for it counts
   * (what /attendance and the monthly quota see).
   *
   * "requested" — the round hasn't ended yet; these leaves still show on
   * the party board / /checkin, and the member can cancel them for free
   * until the window closes.
   *
   * Deliberately NOT based on check-in voice attendance — being outside the
   * tracked voice channel doesn't mean someone is on leave.
   */
  status: "confirmed" | "requested";
  onLeave: CalendarLeaveMember[];
  /** Leaves cancelled AFTER the round had already ended — only a bulk void
   * (e.g. the game's scoring break, voidLeavesInRange) can do that, since
   * members and board actions can only cancel a still-open round. Shown
   * separately so a break week doesn't look like "nobody took leave". */
  voided: CalendarLeaveMember[];
  /** The party board linked to this event, for the "open board" shortcut. */
  boardId: string | null;
}

export interface CalendarDay {
  date: string; // "YYYY-MM-DD"
  weekday: number; // 0=Sun..6=Sat
  isToday: boolean;
  isPast: boolean;
  events: CalendarDayEvent[];
}

export interface CalendarMonth {
  year: number;
  month: number; // 1-12
  today: string;
  /** Weekday (0=Sun..6=Sat) of this month's 1st — how many blank leading
   * cells the UI's week grid needs before day 1. */
  firstWeekday: number;
  /** Every day of the month, in order — `events` is an empty array on a day
   * with no check-in occurrence, so the page can lay out a plain 7-column
   * grid without doing its own date math. */
  days: CalendarDay[];
  /** Active, non-benched members — the denominator for "how many are out". */
  roster: number;
  /** Roster size per main class ("" = no class). */
  classSizes: Record<string, number>;
  /** ACTIVE leaves this month per member per event key (voided ones don't
   * count) — the same number the monthly quota looks at. */
  monthlyCounts: Record<string, Record<string, number>>;
  monthlyLimit: number;
}

export interface NextRound {
  eventKey: string;
  label: string;
  shortLabel: string;
  date: string;
  timeLabel: string;
  start: string; // ISO
  end: string; // ISO
  onLeave: number;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate(); // day 0 of next month = last day of this one
}

function timeLabelOf(event: CheckinEventConfig): string {
  return `${event.startTime.slice(0, 5)}–${event.endTime.slice(0, 5)}`;
}

function toLeaveMember(member: Member, leave: { source: "MEMBER" | "ADMIN"; note: string | null }): CalendarLeaveMember {
  return {
    id: member.id,
    name: memberDisplayName(member),
    discordAvatar: member.discordAvatar,
    className: member.characterClass,
    source: leave.source,
    note: leave.note,
  };
}

/**
 * Every check-in event occurrence in the given month, each with who's on
 * leave for it (and who was voided off it) — grouped by the board's linked
 * event (a leave on a board with no linked event has no calendar cell to
 * land in and is skipped here; /attendance still lists it).
 */
export async function getCalendarMonth(year: number, month: number): Promise<CalendarMonth> {
  const now = new Date();
  const today = thaiDateString(now);
  const total = daysInMonth(year, month);
  const monthStart = `${year}-${pad2(month)}-01`;
  const monthEnd = `${year}-${pad2(month)}-${pad2(total)}`;

  const [activeRows, cancelledRows, roster, boards] = await Promise.all([
    listActiveLeavesBetween(monthStart, monthEnd),
    db
      .select({ leave: leaves, member: members, board: partyBoards })
      .from(leaves)
      .innerJoin(members, eq(leaves.memberId, members.id))
      .innerJoin(partyBoards, eq(leaves.boardId, partyBoards.id))
      .where(and(eq(leaves.status, "CANCELLED"), gte(leaves.occurrenceDate, monthStart), lte(leaves.occurrenceDate, monthEnd))),
    db
      .select({ characterClass: members.characterClass })
      .from(members)
      .where(and(eq(members.status, "ACTIVE"), eq(members.benched, false))),
    boardsByEventKey(),
  ]);

  const onLeaveByOccurrence = new Map<string, CalendarLeaveMember[]>(); // `${date}:${eventKey}`
  const monthlyCounts: Record<string, Record<string, number>> = {};
  for (const r of activeRows) {
    const eventKey = r.board?.checkinEventKey;
    if (!eventKey) continue;
    const key = `${r.occurrenceDate}:${eventKey}`;
    onLeaveByOccurrence.set(key, [...(onLeaveByOccurrence.get(key) ?? []), toLeaveMember(r.member, r)]);
    const perMember = (monthlyCounts[r.member.id] ??= {});
    perMember[eventKey] = (perMember[eventKey] ?? 0) + 1;
  }

  const voidedByOccurrence = new Map<string, CalendarLeaveMember[]>();
  for (const r of cancelledRows) {
    const eventKey = r.board.checkinEventKey;
    const event = eventKey ? CHECKIN_EVENTS.find((e) => e.key === eventKey) : undefined;
    if (!event || !r.leave.cancelledAt) continue;
    // Cancelled before the round ended = an ordinary "never mind" — not shown.
    if (r.leave.cancelledAt < windowFor(event, r.leave.occurrenceDate).end) continue;
    const key = `${r.leave.occurrenceDate}:${event.key}`;
    voidedByOccurrence.set(key, [...(voidedByOccurrence.get(key) ?? []), toLeaveMember(r.member, r.leave)]);
  }

  const classSizes: Record<string, number> = {};
  for (const m of roster) classSizes[m.characterClass ?? ""] = (classSizes[m.characterClass ?? ""] ?? 0) + 1;

  const byName = (a: CalendarLeaveMember, b: CalendarLeaveMember) => a.name.localeCompare(b.name, "th");
  const days: CalendarDay[] = [];
  for (let day = 1; day <= total; day++) {
    const date = `${year}-${pad2(month)}-${pad2(day)}`;
    const weekday = weekdayOf(date);
    const events = CHECKIN_EVENTS.filter((e) => e.weekdays.includes(weekday)).map((event): CalendarDayEvent => {
      const key = `${date}:${event.key}`;
      return {
        eventKey: event.key,
        label: event.label,
        shortLabel: event.key.toUpperCase(),
        timeLabel: timeLabelOf(event),
        status: windowFor(event, date).end <= now ? "confirmed" : "requested",
        onLeave: (onLeaveByOccurrence.get(key) ?? []).sort(byName),
        voided: (voidedByOccurrence.get(key) ?? []).sort(byName),
        boardId: boards.get(event.key)?.id ?? null,
      };
    });
    days.push({ date, weekday, isToday: date === today, isPast: date < today, events });
  }

  return {
    year,
    month,
    today,
    firstWeekday: weekdayOf(monthStart),
    days,
    roster: roster.length,
    classSizes,
    monthlyCounts,
    monthlyLimit: MONTHLY_LEAVE_LIMIT,
  };
}

/** The soonest round (any event) that hasn't ended yet, with its leave
 * count — independent of which month the calendar is showing. */
export async function getNextRound(now: Date = new Date()): Promise<NextRound | null> {
  const today = thaiDateString(now);
  for (let i = 0; i < 8; i++) {
    const date = addDays(today, i);
    const weekday = weekdayOf(date);
    const candidates = CHECKIN_EVENTS.filter((e) => e.weekdays.includes(weekday))
      .map((event) => ({ event, window: windowFor(event, date) }))
      .filter((c) => c.window.end > now)
      .sort((a, b) => a.window.start.getTime() - b.window.start.getTime());
    const first = candidates[0];
    if (!first) continue;
    const rows = await listActiveLeavesBetween(date, date);
    return {
      eventKey: first.event.key,
      label: first.event.label,
      shortLabel: first.event.key.toUpperCase(),
      date,
      timeLabel: timeLabelOf(first.event),
      start: first.window.start.toISOString(),
      end: first.window.end.toISOString(),
      onLeave: rows.filter((r) => r.board?.checkinEventKey === first.event.key).length,
    };
  }
  return null;
}
