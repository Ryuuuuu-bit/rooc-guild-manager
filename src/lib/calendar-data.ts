import { and, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import { members, scheduledLeaves } from "@/db/schema";
import {
  CHECKIN_EVENTS,
  type CheckinEventConfig,
  getLeaveMemberIds,
  thaiDateString,
  weekdayOf,
  windowFor,
} from "@/lib/checkin-data";

export interface CalendarLeaveMember {
  id: string;
  name: string;
  discordAvatar: string | null;
}

export interface CalendarDayEvent {
  eventKey: string;
  label: string;
  /**
   * true once this occurrence has actually happened (up to `now`) and its
   * leave list is read from the confirmed attendance log on the matching
   * party board (see getLeaveMemberIds) — false while it's still a future
   * date and the leave list is only an advance request nobody has applied
   * yet (see scheduledLeaves in schema.ts). Lets the UI mark future leave
   * as "requested" rather than implying it's already locked in — a member
   * can still cancel an advance request any time before its date arrives.
   */
  confirmed: boolean;
  onLeave: CalendarLeaveMember[];
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
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate(); // day 0 of next month = last day of this one
}

/**
 * Every check-in event occurrence in the given month, each with who's on
 * leave for it — confirmed (from the party board's leave log) for dates
 * that have already happened, requested-but-not-yet-applied (from
 * scheduledLeaves) for dates still ahead. Reuses the exact same
 * event/window/leave-lookup logic as /checkin's per-round report
 * (checkin-data.ts), just swept across a whole month instead of one date
 * at a time — see getLeaveMemberIds and windowFor there.
 */
export async function getCalendarMonth(year: number, month: number): Promise<CalendarMonth> {
  const now = new Date();
  const today = thaiDateString(now);
  const total = daysInMonth(year, month);
  const monthStart = `${year}-${pad2(month)}-01`;
  const monthEnd = `${year}-${pad2(month)}-${pad2(total)}`;

  // Every day of the month, with which events (if any) fall on it.
  const allDates: { date: string; weekday: number; events: CheckinEventConfig[] }[] = [];
  for (let day = 1; day <= total; day++) {
    const date = `${year}-${pad2(month)}-${pad2(day)}`;
    const weekday = weekdayOf(date);
    const events = CHECKIN_EVENTS.filter((e) => e.weekdays.includes(weekday));
    allDates.push({ date, weekday, events });
  }
  const occurrences = allDates.filter((d) => d.events.length > 0);

  // Every not-yet-applied advance leave request for the month, in one query
  // — applyTodaysScheduledLeaves() converts a row into a confirmed leave
  // (and deletes it from here) once its date arrives, so this table only
  // ever has future dates in it, but the >= today bound is kept explicit
  // rather than assumed.
  const scheduledRows = await db
    .select({ memberId: scheduledLeaves.memberId, date: scheduledLeaves.date, eventKey: scheduledLeaves.eventKey })
    .from(scheduledLeaves)
    .where(and(gte(scheduledLeaves.date, monthStart), lte(scheduledLeaves.date, monthEnd), gte(scheduledLeaves.date, today)));
  const scheduledByKey = new Map<string, Set<string>>(); // `${date}:${eventKey}` -> memberIds
  for (const r of scheduledRows) {
    const key = `${r.date}:${r.eventKey}`;
    const set = scheduledByKey.get(key) ?? new Set<string>();
    set.add(r.memberId);
    scheduledByKey.set(key, set);
  }

  const neededMemberIds = new Set<string>(scheduledRows.map((r) => r.memberId));
  const confirmedIdsByOccurrence = new Map<string, Set<string>>(); // `${date}:${eventKey}` -> memberIds

  for (const { date, events } of occurrences) {
    for (const event of events) {
      if (date > today) continue; // handled from scheduledByKey below instead
      const { end } = windowFor(event, date);
      const asOf = end.getTime() < now.getTime() ? end : now;
      const ids = await getLeaveMemberIds(event, asOf);
      confirmedIdsByOccurrence.set(`${date}:${event.key}`, ids);
      for (const id of ids) neededMemberIds.add(id);
    }
  }

  const memberRows = neededMemberIds.size
    ? await db
        .select({
          id: members.id,
          discordUsername: members.discordUsername,
          discordGlobalName: members.discordGlobalName,
          discordNickname: members.discordNickname,
          discordAvatar: members.discordAvatar,
        })
        .from(members)
        .where(inArray(members.id, [...neededMemberIds]))
    : [];
  const memberById = new Map(memberRows.map((m) => [m.id, m]));
  function toLeaveMember(id: string): CalendarLeaveMember {
    const m = memberById.get(id);
    const name = m ? m.discordNickname || m.discordGlobalName || m.discordUsername : "Unknown";
    return { id, name, discordAvatar: m?.discordAvatar ?? null };
  }
  function sortedNames(ids: Iterable<string>): CalendarLeaveMember[] {
    return [...ids].map(toLeaveMember).sort((a, b) => a.name.localeCompare(b.name));
  }

  const days: CalendarDay[] = allDates.map(({ date, weekday, events }) => ({
    date,
    weekday,
    isToday: date === today,
    isPast: date < today,
    events: events.map((event) => {
      const key = `${date}:${event.key}`;
      const isPast = date <= today;
      const ids = isPast ? (confirmedIdsByOccurrence.get(key) ?? new Set<string>()) : (scheduledByKey.get(key) ?? new Set<string>());
      return { eventKey: event.key, label: event.label, confirmed: isPast, onLeave: sortedNames(ids) };
    }),
  }));

  return { year, month, today, firstWeekday: weekdayOf(monthStart), days };
}
