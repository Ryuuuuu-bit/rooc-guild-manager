import { and, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import { members, scheduledLeaves } from "@/db/schema";
import { CHECKIN_EVENTS, type CheckinEventConfig, getLeaveMemberIds, thaiDateString, weekdayOf, windowFor } from "@/lib/checkin-data";
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
   * "confirmed" (today only) — real leave, read from the matching party
   * board's leave log (see getLeaveMemberIds), the same source /checkin's
   * "On Leave" count uses. Deliberately NOT based on check-in voice
   * attendance — being outside the tracked voice channel doesn't mean
   * someone is on leave or absent (they might be on Discord elsewhere with
   * friends, or just not using voice at all).
   *
   * "requested" (future dates) — an advance leave request on file
   * (scheduledLeaves), not yet applied since the date hasn't arrived. A
   * request still sitting in scheduledLeaves FOR TODAY (the bot hasn't
   * applied it yet — normally happens within a minute of midnight, but an
   * unusually long outage could leave it pending longer) is folded into
   * today's "confirmed" onLeave list instead of its own bucket, so that
   * member doesn't silently vanish from today's cell while still counting
   * as "requested, not due" — see getCalendarMonth's dueTodayNotYetApplied.
   *

   * "unavailable" (past dates) — deliberately not computed. The calendar's
   * job is "who's on leave for what's coming up", not a historical audit
   * (that's /attendance and /checkin) — the per-round board reconstruction
   * for old dates that predate this feature (or the guild's own current
   * roster/usage) produced misleading numbers, so past days just show the
   * event happened, nothing more.
   */
  status: "confirmed" | "requested" | "unavailable";
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
 * leave for it — real/confirmed for today (see getLeaveMemberIds),
 * requested-but-not-yet-applied for dates still ahead (scheduledLeaves).
 * Past dates are returned with no leave data at all — see the "unavailable"
 * status on CalendarDayEvent for why.
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
  // ever has future dates in it, but the > today bound is kept explicit
  // rather than assumed (today's own rows, if any, are already gone by the
  // time today starts — see applyTodaysScheduledLeaves's `date <= today`
  // catch-up sweep in the nightly reset).
  const scheduledRows =
    monthEnd > today
      ? await db
          .select({ memberId: scheduledLeaves.memberId, date: scheduledLeaves.date, eventKey: scheduledLeaves.eventKey })
          .from(scheduledLeaves)
          .where(and(gte(scheduledLeaves.date, monthStart), lte(scheduledLeaves.date, monthEnd)))
      : [];
  const scheduledByKey = new Map<string, Set<string>>(); // `${date}:${eventKey}` -> memberIds, future dates only
  // Rows still on file for TODAY specifically — the bot's own catch-up
  // sweep (applyTodaysScheduledLeaves) usually clears these within a minute
  // of midnight, but a long enough outage could leave one sitting here past
  // that. Tracked separately (by eventKey only, no date — there's only ever
  // one "today") so today's cell can still show them; see the merge below.
  const dueTodayNotYetApplied = new Map<string, Set<string>>(); // eventKey -> memberIds
  for (const r of scheduledRows) {
    if (r.date === today) {
      const set = dueTodayNotYetApplied.get(r.eventKey) ?? new Set<string>();
      set.add(r.memberId);
      dueTodayNotYetApplied.set(r.eventKey, set);
      continue;
    }
    if (r.date < today) continue; // shouldn't happen — see applyTodaysScheduledLeaves' <= catch-up sweep
    const key = `${r.date}:${r.eventKey}`;
    const set = scheduledByKey.get(key) ?? new Set<string>();
    set.add(r.memberId);
    scheduledByKey.set(key, set);
  }

  const neededMemberIds = new Set<string>(scheduledRows.map((r) => r.memberId));
  const confirmedIdsByOccurrence = new Map<string, Set<string>>(); // `${date}:${eventKey}` -> memberIds

  // Confirmed leave for TODAY's occurrence(s) only — see the "unavailable"
  // status doc above for why past dates are skipped entirely. Evaluated at
  // each occurrence's own window end (or now, for a round still in
  // progress), same as getCheckinReport does for /checkin.
  const todaysOccurrence = occurrences.find((o) => o.date === today);
  if (todaysOccurrence) {
    for (const event of todaysOccurrence.events) {
      const { end } = windowFor(event, today);
      const asOf = end.getTime() < now.getTime() ? end : now;
      const ids = await getLeaveMemberIds(event, asOf);
      confirmedIdsByOccurrence.set(`${today}:${event.key}`, ids);
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
    return { id, name: m ? memberDisplayName(m) : "Unknown", discordAvatar: m?.discordAvatar ?? null };
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
      if (date < today) {
        return { eventKey: event.key, label: event.label, status: "unavailable" as const, onLeave: [] };
      }
      if (date === today) {
        const confirmedIds = confirmedIdsByOccurrence.get(`${date}:${event.key}`) ?? new Set<string>();
        const notYetAppliedIds = dueTodayNotYetApplied.get(event.key) ?? new Set<string>();
        const ids = new Set([...confirmedIds, ...notYetAppliedIds]);
        return { eventKey: event.key, label: event.label, status: "confirmed" as const, onLeave: sortedNames(ids) };
      }
      const ids = scheduledByKey.get(`${date}:${event.key}`) ?? new Set<string>();
      return { eventKey: event.key, label: event.label, status: "requested" as const, onLeave: sortedNames(ids) };
    }),
  }));

  return { year, month, today, firstWeekday: weekdayOf(monthStart), days };
}
