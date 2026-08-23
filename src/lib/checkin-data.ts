import { and, gte, lte, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { members, voiceAttendanceEvents } from "@/db/schema";
import type { Member } from "@/db/schema";
import { CHECKIN_EVENTS, getCheckinEvent, type CheckinEventConfig } from "@/lib/checkin-events";

export { CHECKIN_EVENTS, getCheckinEvent };
export type { CheckinEventConfig };

/** Start/end instants of an event's window for a given "YYYY-MM-DD" (Thai calendar date) — same direct-offset parse used for startOfThaiDay/endOfThaiDay on /attendance. */
function windowFor(event: CheckinEventConfig, dateStr: string): { start: Date; end: Date } {
  return {
    start: new Date(`${dateStr}T${event.startTime}+07:00`),
    end: new Date(`${dateStr}T${event.endTime}+07:00`),
  };
}

/** "YYYY-MM-DD" for the given instant in Thailand's local time (UTC+7) — same trick as bot/midnight-reset.ts's thaiDateString, reimplemented here since bot/ and src/ don't share code across the two deploy targets. */
function thaiDateString(d: Date): string {
  const thai = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return thai.toISOString().slice(0, 10);
}

/** JS weekday (0=Sun..6=Sat) of a "YYYY-MM-DD" Thai calendar date — noon pin keeps this clear of any midnight-boundary edge case. */
function weekdayOf(dateStr: string): number {
  return new Date(`${dateStr}T12:00:00+07:00`).getUTCDay();
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00+07:00`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface CheckinWindow {
  date: string; // "YYYY-MM-DD", Thai calendar
  start: Date;
  end: Date;
}

/**
 * Every window for the given event from the first ever recorded voice
 * event on ONE OF ITS channels through today (Thai calendar), most recent
 * first. Empty until the bot has logged at least one voice event on one of
 * this event's channels — there's no way to reconstruct windows further
 * back than that (Discord's API exposes no voice history, only live state
 * changes going forward).
 */
export async function listCheckinWindows(eventKey: string): Promise<CheckinWindow[]> {
  const event = getCheckinEvent(eventKey);
  if (!event) return [];

  const [row] = await db
    .select({ min: sql<string | null>`min(${voiceAttendanceEvents.createdAt})` })
    .from(voiceAttendanceEvents)
    .where(inArray(voiceAttendanceEvents.channelId, event.channelIds));
  if (!row?.min) return [];

  const now = new Date();
  const startDate = thaiDateString(new Date(row.min));
  const today = thaiDateString(now);

  const windows: CheckinWindow[] = [];
  for (let d = startDate; d <= today; d = addDays(d, 1)) {
    if (!event.weekdays.includes(weekdayOf(d))) continue;
    const { start, end } = windowFor(event, d);
    if (start > now) continue; // this window hasn't started yet
    windows.push({ date: d, start, end });
  }
  return windows.reverse();
}

interface Interval {
  start: Date;
  end: Date;
}

/** Pairs consecutive JOIN/LEAVE rows (already sorted by time) into presence intervals. A trailing unmatched JOIN means "still connected" — closed at `now`. A stray LEAVE with no open JOIN (e.g. data from before the reconciliation-on-restart safety net existed) is ignored rather than producing a bogus negative-length interval. */
function reconstructIntervals(events: { type: "JOIN" | "LEAVE"; createdAt: Date }[], now: Date): Interval[] {
  const intervals: Interval[] = [];
  let openStart: Date | null = null;
  for (const e of events) {
    if (e.type === "JOIN") {
      if (openStart === null) openStart = e.createdAt;
    } else if (openStart !== null) {
      intervals.push({ start: openStart, end: e.createdAt });
      openStart = null;
    }
  }
  if (openStart !== null) intervals.push({ start: openStart, end: now });
  return intervals;
}

function overlapMinutes(interval: Interval, window: Interval): number {
  const overlapStart = Math.max(interval.start.getTime(), window.start.getTime());
  const overlapEnd = Math.min(interval.end.getTime(), window.end.getTime());
  return Math.max(0, overlapEnd - overlapStart) / 60_000;
}

export interface CheckinMemberResult {
  member: Member;
  attended: boolean;
  minutesPresent: number;
  firstJoinAt: Date | null;
  lastLeaveAt: Date | null; // null if they were still connected as of `now`/window end
  stillConnected: boolean;
}

export interface CheckinReport {
  window: CheckinWindow;
  attendedCount: number;
  totalCount: number;
  results: CheckinMemberResult[];
}

/**
 * Report for one event's check-in window: for every currently-active,
 * non-benched member (mirrors the roster scope used by /attendance's leave
 * stats — benched members aren't expected at events), whether they had ANY
 * voice presence — on any of this event's channels — overlapping the
 * window ("attended", no minimum-duration threshold, per admin's call)
 * plus the accumulated minutes they were actually present, as
 * supplementary context. Sorted absent-first (fastest to spot who to
 * follow up with), then by minutes present descending.
 */
export async function getCheckinReport(eventKey: string, date: string): Promise<CheckinReport | null> {
  const event = getCheckinEvent(eventKey);
  if (!event) return null;

  const { start, end } = windowFor(event, date);
  const now = new Date();

  const roster = await db
    .select()
    .from(members)
    .where(and(eq(members.status, "ACTIVE"), eq(members.benched, false)));

  // Pad well before the window so an interval that started (well) earlier
  // and is still open still gets picked up as overlapping.
  const queryFrom = new Date(start.getTime() - 24 * 60 * 60 * 1000);
  const events = await db
    .select({
      memberId: voiceAttendanceEvents.memberId,
      type: voiceAttendanceEvents.type,
      createdAt: voiceAttendanceEvents.createdAt,
    })
    .from(voiceAttendanceEvents)
    .where(
      and(
        inArray(voiceAttendanceEvents.channelId, event.channelIds),
        gte(voiceAttendanceEvents.createdAt, queryFrom),
        lte(voiceAttendanceEvents.createdAt, end)
      )
    )
    .orderBy(voiceAttendanceEvents.memberId, voiceAttendanceEvents.createdAt);

  const eventsByMember = new Map<string, { type: "JOIN" | "LEAVE"; createdAt: Date }[]>();
  for (const e of events) {
    const list = eventsByMember.get(e.memberId) ?? [];
    list.push({ type: e.type, createdAt: e.createdAt });
    eventsByMember.set(e.memberId, list);
  }

  const results: CheckinMemberResult[] = roster.map((member) => {
    const intervals = reconstructIntervals(eventsByMember.get(member.id) ?? [], now);
    const overlapping = intervals.filter((iv) => iv.end.getTime() > start.getTime() && iv.start.getTime() < end.getTime());
    const minutesPresent = overlapping.reduce((sum, iv) => sum + overlapMinutes(iv, { start, end }), 0);
    const last = overlapping[overlapping.length - 1];
    const stillConnected = last ? last.end.getTime() === now.getTime() : false;
    return {
      member,
      attended: minutesPresent > 0,
      minutesPresent: Math.round(minutesPresent),
      firstJoinAt: overlapping[0]?.start ?? null,
      lastLeaveAt: stillConnected ? null : (last?.end ?? null),
      stillConnected,
    };
  });

  results.sort((a, b) => {
    if (a.attended !== b.attended) return a.attended ? 1 : -1; // absent first
    return b.minutesPresent - a.minutesPresent;
  });

  return {
    window: { date, start, end },
    attendedCount: results.filter((r) => r.attended).length,
    totalCount: results.length,
    results,
  };
}
