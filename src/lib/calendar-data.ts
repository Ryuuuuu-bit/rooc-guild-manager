import { CHECKIN_EVENTS, type CheckinEventConfig, thaiDateString, weekdayOf, windowFor } from "@/lib/checkin-data";
import { listActiveLeavesBetween } from "@/lib/leaves";
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
 * leave for it — one query over `leaves` for the month, grouped by the
 * board's linked event (a leave on a board with no linked event has no
 * calendar cell to land in and is skipped here; /attendance still lists it).
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

  const rows = await listActiveLeavesBetween(monthStart, monthEnd);
  const byOccurrence = new Map<string, CalendarLeaveMember[]>(); // `${date}:${eventKey}`
  for (const r of rows) {
    if (!r.board?.checkinEventKey) continue;
    const key = `${r.occurrenceDate}:${r.board.checkinEventKey}`;
    const list = byOccurrence.get(key) ?? [];
    list.push({ id: r.member.id, name: memberDisplayName(r.member), discordAvatar: r.member.discordAvatar });
    byOccurrence.set(key, list);
  }

  const days: CalendarDay[] = allDates.map(({ date, weekday, events }) => ({
    date,
    weekday,
    isToday: date === today,
    isPast: date < today,
    events: events.map((event) => {
      const onLeave = (byOccurrence.get(`${date}:${event.key}`) ?? []).sort((a, b) => a.name.localeCompare(b.name));
      const roundOver = windowFor(event, date).end <= now;
      return { eventKey: event.key, label: event.label, status: roundOver ? ("confirmed" as const) : ("requested" as const), onLeave };
    }),
  }));

  return { year, month, today, firstWeekday: weekdayOf(monthStart), days };
}
