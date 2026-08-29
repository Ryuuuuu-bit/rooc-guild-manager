import { and, asc, gte, lte, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { checkinNotes, members, membershipEvents, partyBoards, voiceAttendanceEvents } from "@/db/schema";
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

/**
 * Member IDs currently connected to any of the tracked voice channels (the
 * GL/WOE event channels in checkin-events.ts) right now — i.e. whichever
 * member's MOST RECENT logged voice event overall is a JOIN with no LEAVE
 * after it. This is the closest thing to "who's online" the bot can see:
 * it only has the Voice States intent, not the (privileged) Presence
 * intent, so general Discord online/idle/offline status isn't available —
 * this reflects live voice presence in the events channels specifically,
 * which is what matters while running a loot-queue round live.
 */
export async function listOnlineMemberIds(): Promise<Set<string>> {
  const rows = await db
    .select({ memberId: voiceAttendanceEvents.memberId, type: voiceAttendanceEvents.type })
    .from(voiceAttendanceEvents)
    .orderBy(asc(voiceAttendanceEvents.memberId), asc(voiceAttendanceEvents.createdAt));

  const lastTypeByMember = new Map<string, "JOIN" | "LEAVE">();
  for (const r of rows) lastTypeByMember.set(r.memberId, r.type); // ascending order — last write wins = most recent event

  const online = new Set<string>();
  for (const [memberId, type] of lastTypeByMember) {
    if (type === "JOIN") online.add(memberId);
  }
  return online;
}

export interface CheckinMemberResult {
  member: Member;
  attended: boolean;
  minutesPresent: number;
  firstJoinAt: Date | null;
  lastLeaveAt: Date | null; // null if they were still connected as of `now`/window end
  stillConnected: boolean;
  /** Admin-entered reason (e.g. relayed after the fact via DM) for this
   * member's row on this specific window — see checkinNotes in schema.ts.
   * Most useful on an absent row, but not restricted to one. */
  note: string | null;
  /** Had a confirmed "ลา" reaction in effect on this event's matching party
   * board as of this window (see getLeaveMemberIds) — an absent row with
   * this set is an excused no-show, not an unexplained one. */
  onLeave: boolean;
}

export interface CheckinReport {
  window: CheckinWindow;
  attendedCount: number;
  totalCount: number;
  onLeaveCount: number;
  results: CheckinMemberResult[];
}

/**
 * Member IDs with a CONFIRMED "ลา" reaction in effect, on the party board
 * matching this check-in event (see attendanceBoardName in
 * checkin-events.ts), as of `asOf` — i.e. their most recent ATTENDANCE_LEAVE
 * (confirmed) / ATTENDANCE_RETURN event on that board, at or before `asOf`,
 * was a LEAVE rather than a RETURN. Mirrors listOnlineMemberIds's
 * last-write-wins reduction over an ascending-time event log, and only
 * counts confirmed leaves for the same reason getAttendanceStats does — a
 * quick test-click that gets un-reacted inside 30 minutes never became a
 * real leave (see confirmDueLeaves/handleReactionRemove in bot/). RETURN
 * events carry no confirmedAt gating of their own (every board is a single
 * always-current sheet, so a return only ever follows an already-confirmed
 * leave — see handleReactionRemove).
 *
 * Returns an empty set if this event has no matching board configured, or
 * the board itself doesn't exist (e.g. renamed/deleted) — leave just won't
 * be shown rather than erroring the whole report.
 */
async function getLeaveMemberIds(event: CheckinEventConfig, asOf: Date): Promise<Set<string>> {
  if (!event.attendanceBoardName) return new Set();

  const board = await db.query.partyBoards.findFirst({
    where: eq(partyBoards.name, event.attendanceBoardName),
  });
  if (!board) return new Set();

  const rows = await db
    .select({
      memberId: membershipEvents.memberId,
      type: membershipEvents.type,
    })
    .from(membershipEvents)
    .where(
      and(
        eq(membershipEvents.boardId, board.id),
        lte(membershipEvents.createdAt, asOf),
        or(
          and(eq(membershipEvents.type, "ATTENDANCE_LEAVE"), isNotNull(membershipEvents.confirmedAt)),
          eq(membershipEvents.type, "ATTENDANCE_RETURN")
        )
      )
    )
    .orderBy(asc(membershipEvents.memberId), asc(membershipEvents.createdAt));

  const lastTypeByMember = new Map<string, string>();
  for (const r of rows) lastTypeByMember.set(r.memberId, r.type); // ascending order — last write wins = most recent event

  const onLeave = new Set<string>();
  for (const [memberId, type] of lastTypeByMember) {
    if (type === "ATTENDANCE_LEAVE") onLeave.add(memberId);
  }
  return onLeave;
}

/**
 * Report for one event's check-in window: for every currently-active,
 * non-benched member who had already joined the guild by the time this
 * window's event happened (mirrors the roster scope used by /attendance's
 * leave stats — benched members aren't expected at events — plus this
 * join-date cutoff so someone who joined the guild after an old event
 * doesn't retroactively show up as "ไม่เข้าร่วม" for it), whether they had
 * ANY voice presence — on any of this event's channels — overlapping the
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
    .where(
      and(
        eq(members.status, "ACTIVE"),
        eq(members.benched, false),
        // Someone who joined the guild AFTER this window's event happened
        // wasn't around to check in — don't hold that against them (a
        // missing joinedDiscordAt is legacy data from before this column
        // existed, treated as "always eligible" rather than excluded).
        or(isNull(members.joinedDiscordAt), lte(members.joinedDiscordAt, end))
      )
    );

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

  const notes = await db
    .select({ memberId: checkinNotes.memberId, note: checkinNotes.note })
    .from(checkinNotes)
    .where(and(eq(checkinNotes.eventKey, eventKey), eq(checkinNotes.date, date)));
  const noteByMember = new Map(notes.map((n) => [n.memberId, n.note]));

  // Evaluated at the window's own end (capped at `now` for a window that
  // hasn't finished yet) so a past window's report doesn't get "helped" by
  // someone who only clicked ลา on that board afterwards — kept fully
  // separate per event/board (see attendanceBoardName in checkin-events.ts:
  // "gl" only ever reads the "GL" board, "woe" only ever reads "WOE").
  const asOf = end.getTime() < now.getTime() ? end : now;
  const leaveMemberIds = await getLeaveMemberIds(event, asOf);

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
      note: noteByMember.get(member.id) ?? null,
      onLeave: leaveMemberIds.has(member.id),
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
    onLeaveCount: results.filter((r) => r.onLeave).length,
    results,
  };
}

export interface AttendanceTrendPoint {
  date: string;
  attendedCount: number;
  totalCount: number;
  /** 0–1, or null when totalCount is 0 (no eligible roster that day — not
   * the same as 0% attendance, so the chart can render it as "no data"
   * instead of an empty bar). */
  rate: number | null;
}

/**
 * The last `limit` check-in windows for one event, oldest first (left-to-
 * right on a trend chart), each reduced to just its attendance rate — reuses
 * getCheckinReport per window rather than re-deriving the roster/attendance
 * rules a second time, since this is an admin-facing dashboard glance, not
 * a hot path (at most a handful of windows).
 */
export async function getAttendanceTrend(eventKey: string, limit = 8): Promise<AttendanceTrendPoint[]> {
  const windows = await listCheckinWindows(eventKey); // most recent first
  const recent = windows.slice(0, limit).reverse(); // oldest first, for left-to-right reading

  const reports = await Promise.all(recent.map((w) => getCheckinReport(eventKey, w.date)));
  return reports.map((report, i) => ({
    date: recent[i].date,
    attendedCount: report?.attendedCount ?? 0,
    totalCount: report?.totalCount ?? 0,
    rate: report && report.totalCount > 0 ? report.attendedCount / report.totalCount : null,
  }));
}
