import { and, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import { members, scheduledLeaves } from "@/db/schema";
import { CHECKIN_EVENTS, type CheckinEventConfig, getCheckinReport, thaiDateString, weekdayOf } from "@/lib/checkin-data";
import { memberDisplayName } from "@/lib/ui";

export interface CalendarLeaveMember {
  id: string;
  name: string;
  discordAvatar: string | null;
}

export interface CalendarDayEvent {
  eventKey: string;
  label: string;
  /**
   * true once this occurrence has actually happened (up to `now`) — the
   * counts/list below then come from the real check-in voice report (see
   * getCheckinReport, the same function /checkin uses), not just leave
   * reactions. False while it's still a future date, where there's no
   * attendance to report yet — the list is instead whoever has an advance
   * leave request on file for it (scheduledLeaves), which can still change
   * before the date arrives.
   */
  confirmed: boolean;
  attendedCount: number | null; // null when `confirmed` is false (hasn't happened yet)
  totalCount: number | null; // null when `confirmed` is false
  /**
   * Confirmed: everyone who did NOT attend — on-leave and unexplained
   * absences collapsed into one list, since this is a monthly overview, not
   * a detailed report (see /checkin for the attended/on-leave/absent
   * breakdown). Not confirmed: everyone who's requested leave for this date
   * so far.
   */
  notAttended: CalendarLeaveMember[];
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

function toLeaveMember(m: { id: string; discordUsername: string; discordGlobalName: string | null; discordNickname: string | null; discordAvatar: string | null }): CalendarLeaveMember {
  return { id: m.id, name: memberDisplayName(m), discordAvatar: m.discordAvatar };
}

/**
 * Every check-in event occurrence in the given month, each with real
 * attendance for it — who actually didn't show up (getCheckinReport, same
 * real voice check-in data /checkin uses) for dates that have already
 * happened, or who's requested leave in advance (scheduledLeaves) for
 * dates still ahead, since there's nothing to report attendance-wise yet.
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
  const scheduledMemberRows = scheduledRows.length
    ? await db
        .select({
          id: members.id,
          discordUsername: members.discordUsername,
          discordGlobalName: members.discordGlobalName,
          discordNickname: members.discordNickname,
          discordAvatar: members.discordAvatar,
        })
        .from(members)
        .where(inArray(members.id, [...new Set(scheduledRows.map((r) => r.memberId))]))
    : [];
  const scheduledMemberById = new Map(scheduledMemberRows.map((m) => [m.id, m]));

  // Real check-in report (real voice attendance + leave, same as /checkin)
  // per past/today occurrence — one call per (event, date), reusing the
  // exact roster/attendance/leave rules already trusted there instead of
  // re-deriving them.
  const reportByOccurrence = new Map<string, Awaited<ReturnType<typeof getCheckinReport>>>();
  for (const { date, events } of occurrences) {
    if (date > today) continue; // handled from scheduledByKey below instead
    for (const event of events) {
      reportByOccurrence.set(`${date}:${event.key}`, await getCheckinReport(event.key, date));
    }
  }

  const days: CalendarDay[] = allDates.map(({ date, weekday, events }) => ({
    date,
    weekday,
    isToday: date === today,
    isPast: date < today,
    events: events.map((event) => {
      const key = `${date}:${event.key}`;
      const isPast = date <= today;
      if (isPast) {
        const report = reportByOccurrence.get(key);
        const notAttended = (report?.results ?? []).filter((r) => !r.attended).map((r) => toLeaveMember(r.member));
        notAttended.sort((a, b) => a.name.localeCompare(b.name));
        return {
          eventKey: event.key,
          label: event.label,
          confirmed: true,
          attendedCount: report?.attendedCount ?? null,
          totalCount: report?.totalCount ?? null,
          notAttended,
        };
      }
      const ids = scheduledByKey.get(key) ?? new Set<string>();
      const notAttended = [...ids]
        .map((id) => scheduledMemberById.get(id))
        .filter((m): m is NonNullable<typeof m> => Boolean(m))
        .map(toLeaveMember)
        .sort((a, b) => a.name.localeCompare(b.name));
      return { eventKey: event.key, label: event.label, confirmed: false, attendedCount: null, totalCount: null, notAttended };
    }),
  }));

  return { year, month, today, firstWeekday: weekdayOf(monthStart), days };
}
