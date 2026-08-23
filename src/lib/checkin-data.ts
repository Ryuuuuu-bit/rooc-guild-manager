import { and, gte, lte, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { members, voiceAttendanceEvents } from "@/db/schema";
import type { Member } from "@/db/schema";

// --- Event window config -------------------------------------------------
// Tue/Thu 19:55–20:20 Thailand time — the guild's Tyr Cup game-event
// voice check-in window. Adjust here (and redeploy the web service) if the
// schedule ever changes; nothing else needs touching. JS getUTCDay():
// 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat.
const CHECKIN_WEEKDAYS = [2, 4];
const WINDOW_START_TIME = "19:55:00";
const WINDOW_END_TIME = "20:20:00";

/** Start/end instants of the check-in window for a given "YYYY-MM-DD" (Thai calendar date) — same direct-offset parse used for startOfThaiDay/endOfThaiDay on /attendance. */
function windowFor(dateStr: string): { start: Date; end: Date } {
  return {
    start: new Date(`${dateStr}T${WINDOW_START_TIME}+07:00`),
    end: new Date(`${dateStr}T${WINDOW_END_TIME}+07:00`),
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
 * Every Tue/Thu check-in window from the first ever recorded voice event
 * through today (Thai calendar), most recent first. Empty until the bot
 * has logged at least one voice event — there's no way to reconstruct
 * windows further back than that (Discord's API exposes no voice
 * history, only live state changes going forward).
 */
export async function listCheckinWindows(): Promise<CheckinWindow[]> {
  const [row] = await db
    .select({ min: sql<string | null>`min(${voiceAttendanceEvents.createdAt})` })
    .from(voiceAttendanceEvents);
  if (!row?.min) return [];

  const now = new Date();
  const startDate = thaiDateString(new Date(row.min));
  const today = thaiDateString(now);

  const windows: CheckinWindow[] = [];
  for (let d = startDate; d <= today; d = addDays(d, 1)) {
    if (!CHECKIN_WEEKDAYS.includes(weekdayOf(d))) continue;
    const { start, end } = windowFor(d);
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
 * Report for one check-in window: for every currently-active, non-benched
 * member (mirrors the roster scope used by /attendance's leave stats —
 * benched members aren't expected at events), whether they had ANY voice
 * presence overlapping the window ("attended" — per admin's call, just
 * showing up counts, no minimum-duration threshold) plus the accumulated
 * minutes they were actually present, as supplementary context. Sorted
 * absent-first (fastest to spot who to follow up with), then by minutes
 * present descending.
 */
export async function getCheckinReport(date: string): Promise<CheckinReport> {
  const { start, end } = windowFor(date);
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
    .where(and(gte(voiceAttendanceEvents.createdAt, queryFrom), lte(voiceAttendanceEvents.createdAt, end)))
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
