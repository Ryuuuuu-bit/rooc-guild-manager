// Plain data only — deliberately no DB/discord.js/Next.js imports, so both
// the bot (via a relative import, see bot/voice-attendance.ts) and the web
// app (via the @/ alias, see src/lib/checkin-data.ts and /checkin) can pull
// from this ONE list instead of keeping two copies of the channel IDs in
// sync by hand.
//
// To add another event: append an entry here, redeploy BOTH services (bot
// needs the new channelIds to actually log anything for it; web needs the
// new schedule to know when its window is). Grab a channel ID from its
// Discord URL: .../channels/<guildId>/<channelId>.
export interface CheckinEventConfig {
  key: string;
  label: string;
  /** JS getUTCDay(): 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat. */
  weekdays: number[];
  startTime: string; // "HH:MM:SS", Thailand local time
  endTime: string;
  /** Being in ANY of these channels counts as present for this event — e.g. two separate team rooms for the same event. */
  channelIds: string[];
  /** Party-board names (case-insensitive) that link to this event — see eventKeyForBoardName. */
  boardNames: string[];
}

// Which party board's "ลา" tracks approved leave for each event is stored on
// partyBoards.checkinEventKey (see schema.ts) and derived FROM THE BOARD'S
// NAME: a board named "GL" links to the gl event, "WOE" to woe (see
// boardNames + eventKeyForBoardName below; syncBoardEventLink in
// src/lib/board-link.ts writes it on create/rename). The admin's call: the
// two boards are named for their events and never change, so a separate
// dropdown was just clutter. The unique index on checkinEventKey still makes
// "two boards fighting over one event" impossible — a second board with the
// same name simply stays unlinked (the board page says so).
export const CHECKIN_EVENTS: CheckinEventConfig[] = [
  {
    key: "gl",
    label: "Tyr Cup",
    weekdays: [2, 4], // Tue, Thu
    startTime: "19:55:00",
    endTime: "20:20:00",
    channelIds: ["1488971259113902090", "1488971308225269943", "1486678906214809721", "1545045768107196488"],
    boardNames: ["GL", "Tyr Cup"],
  },
  {
    key: "woe",
    label: "WOE (Emperium Overrun)",
    weekdays: [0], // Sun
    startTime: "19:55:00",
    endTime: "20:40:00",
    channelIds: ["1490330449275260988"],
    boardNames: ["WOE"],
  },
];

export function getCheckinEvent(key: string): CheckinEventConfig | undefined {
  return CHECKIN_EVENTS.find((e) => e.key === key);
}

/** The event a party board named `name` belongs to (case/whitespace-insensitive), or null. */
export function eventKeyForBoardName(name: string): string | null {
  const wanted = name.trim().toLowerCase();
  return CHECKIN_EVENTS.find((e) => e.key === wanted || e.boardNames.some((n) => n.toLowerCase() === wanted))?.key ?? null;
}

/** Start/end instants of an event's window for a given "YYYY-MM-DD" (Thai
 * calendar date). Plain data + date math only (no DB/discord.js/Next.js
 * imports) so both bot/attendance-confirm.ts and the web app's
 * src/lib/checkin-data.ts (which re-exports this rather than keeping its own
 * copy) can share one implementation. */
export function windowFor(event: CheckinEventConfig, dateStr: string): { start: Date; end: Date } {
  return {
    start: new Date(`${dateStr}T${event.startTime}+07:00`),
    end: new Date(`${dateStr}T${event.endTime}+07:00`),
  };
}

// Local date-math helpers for nextOccurrenceEnd below only — every other
// consumer of this "plain data" module (bot/*.ts, src/lib/checkin-data.ts)
// keeps its own copy of this same trick rather than importing one from here,
// so this file keeps one too instead of becoming a second source for it.
function weekdayOf(dateStr: string): number {
  return new Date(`${dateStr}T12:00:00+07:00`).getUTCDay();
}
function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00+07:00`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function thaiDateString(d: Date): string {
  const thai = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return thai.toISOString().slice(0, 10);
}

/**
 * The end time of this event's NEXT occurrence (today or later, relative to
 * `now`) whose window hasn't already finished — the actual moment a "ลา"
 * marked against this event should lock in, regardless of which day within
 * the event's weekly cycle it was marked on.
 *
 * This matters because a live "ลา" reaction has no explicit target date the
 * way an advance /leave request does (see scheduleLeave in
 * bot/leave-schedule.ts) — it's just a click on a standing, never-reposted
 * board message (see postAttendanceMessage in src/app/actions/bot-messages.ts)
 * that a member can click on ANY day, not only the event's own. An earlier
 * version of this gating (in bot/attendance-confirm.ts) assumed a live
 * reaction always happens same-day as the event it's for, and fell back to a
 * flat short delay whenever that assumption didn't hold (reacting on a day
 * the event doesn't run, or reacting after that day's window had already
 * closed) — which locked the leave in almost immediately, reintroducing the
 * exact "confirmed before the event, no real way to undo it" problem this
 * whole event-end-gating design was built to fix. Searching forward for the
 * next not-yet-ended occurrence closes that gap: reacting early for an
 * upcoming date behaves the same as scheduling it in advance through /leave.
 *
 * Searches up to 14 days ahead — every event configured here recurs at least
 * weekly, so that's always enough to find one.
 */
export function nextOccurrenceEnd(event: CheckinEventConfig, now: Date): Date {
  const today = thaiDateString(now);
  for (let i = 0; i <= 14; i++) {
    const date = addDays(today, i);
    if (!event.weekdays.includes(weekdayOf(date))) continue;
    const { end } = windowFor(event, date);
    if (end > now) return end;
  }
  // Unreachable given the 14-day search above and every real event's weekly
  // recurrence — kept as a safety net (confirm right away) rather than
  // throwing, in case a future event config ever ships with an empty
  // `weekdays` array.
  return now;
}

/**
 * "YYYY-MM-DD" (Thai calendar date) of the occurrence nextOccurrenceEnd
 * above would land on — the same search, returning the date instead of the
 * end instant, for callers that key things by date (scheduledLeaves rows,
 * digest headers). Falls back to today if nothing is found within the
 * 14-day search, mirroring nextOccurrenceEnd's own safety net.
 */
export function nextOccurrenceDate(event: CheckinEventConfig, now: Date): string {
  const today = thaiDateString(now);
  for (let i = 0; i <= 14; i++) {
    const date = addDays(today, i);
    if (!event.weekdays.includes(weekdayOf(date))) continue;
    if (windowFor(event, date).end > now) return date;
  }
  return today;
}

/**
 * The end instant of this event's MOST RECENT occurrence that has already
 * finished (at or before `now`) — the mirror image of nextOccurrenceEnd.
 * Used by the nightly reset (bot/midnight-reset.ts) to tell a "ลา" that was
 * for the occurrence that just ended (clear it) apart from one marked early
 * for the NEXT occurrence (keep it). Searches back 14 days for the same
 * reason nextOccurrenceEnd searches forward 14; null if nothing has ended
 * in that span (a brand-new event config).
 */
export function lastOccurrenceEnd(event: CheckinEventConfig, now: Date): Date | null {
  const today = thaiDateString(now);
  for (let i = 0; i <= 14; i++) {
    const date = addDays(today, -i);
    if (!event.weekdays.includes(weekdayOf(date))) continue;
    const { end } = windowFor(event, date);
    if (end <= now) return end;
  }
  return null;
}

/** Every channel ID watched by any check-in event — what the bot subscribes to. */
export function allWatchedChannelIds(): string[] {
  return CHECKIN_EVENTS.flatMap((e) => e.channelIds);
}
