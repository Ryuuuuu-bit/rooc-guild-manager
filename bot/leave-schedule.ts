// Advance leave scheduling — /leave lets a member pick one or more upcoming
// event dates from a dropdown (see src/lib/checkin-events.ts for the event
// list) instead of waiting until the day to react "ลา" live on a party
// board. See scheduledLeaves in src/db/schema.ts for the storage shape and
// why a row disappears once applied. Mirrors the existing live "ลา" reaction
// flow in reactions.ts wherever the two overlap (delete-then-insert on
// partyBusyEntries, clearMemberSlotOnBoard, the ATTENDANCE_LEAVE event log)
// so both paths produce identical, indistinguishable history.
import { and, asc, eq } from "drizzle-orm";
import { db } from "../src/db";
import { members, membershipEvents, partyBoards, partyBusyEntries, scheduledLeaves } from "../src/db/schema";
import { CHECKIN_EVENTS } from "../src/lib/checkin-events";
import { clearMemberSlotOnBoard } from "./reactions";

/** "YYYY-MM-DD" for now in Thailand's local time — a local copy rather than
 * an import from midnight-reset.ts, since that module calls into this one
 * (applyTodaysScheduledLeaves) and importing back would create a cycle. Same
 * trick as every other copy of this helper in the codebase. */
function thaiDateString(d: Date = new Date()): string {
  const thai = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return thai.toISOString().slice(0, 10);
}

/** JS weekday (0=Sun..6=Sat) of a "YYYY-MM-DD" Thai calendar date. */
function weekdayOf(dateStr: string): number {
  return new Date(`${dateStr}T12:00:00+07:00`).getUTCDay();
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00+07:00`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Thai-locale "อ. 16 ก.ย." style short label for a "YYYY-MM-DD" date — used on the /leave select menus, which cap each option's label at 100 chars but read best short. */
export function formatThaiDateLabel(dateStr: string): string {
  return new Date(`${dateStr}T12:00:00+07:00`).toLocaleDateString("th-TH", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Asia/Bangkok",
  });
}

// How many days out to offer in the /leave dropdown. Wide enough to cover
// several weeks of GL (Tue/Thu) + WOE (Sun) occurrences (~12 dates) without
// coming close to Discord's 25-option select menu limit.
const LOOKAHEAD_DAYS = 28;

export interface LeaveOption {
  boardId: string;
  boardName: string;
  date: string;
  eventKey: string;
  eventLabel: string;
}

/** boardId lookup by event.attendanceBoardName — re-queried per call since /leave only runs a handful of times a day, no need for a standing cache. */
async function resolveEventBoards(): Promise<Map<string, { id: string; name: string }>> {
  const boardByEventKey = new Map<string, { id: string; name: string }>();
  for (const event of CHECKIN_EVENTS) {
    if (!event.attendanceBoardName) continue;
    const board = await db.query.partyBoards.findFirst({ where: eq(partyBoards.name, event.attendanceBoardName) });
    if (board) boardByEventKey.set(event.key, { id: board.id, name: board.name });
  }
  return boardByEventKey;
}

/**
 * Every upcoming (today or later) occurrence of every check-in event that
 * has a matching party board, within LOOKAHEAD_DAYS — what the /leave
 * add-select dropdown is built from. Skips events with no matching board
 * (nothing to mark ลา on), same as getLeaveMemberIds in checkin-data.ts.
 */
export async function listUpcomingLeaveOptions(): Promise<LeaveOption[]> {
  const boardByEventKey = await resolveEventBoards();
  const today = thaiDateString();
  const options: LeaveOption[] = [];

  for (const event of CHECKIN_EVENTS) {
    const board = boardByEventKey.get(event.key);
    if (!board) continue;
    for (let i = 0; i <= LOOKAHEAD_DAYS; i++) {
      const date = addDays(today, i);
      if (!event.weekdays.includes(weekdayOf(date))) continue;
      options.push({ boardId: board.id, boardName: board.name, date, eventKey: event.key, eventLabel: event.label });
    }
  }

  return options.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** This member's own not-yet-applied scheduled leaves, soonest first. */
export async function listMemberScheduledLeaves(memberId: string) {
  return db.select().from(scheduledLeaves).where(eq(scheduledLeaves.memberId, memberId)).orderBy(asc(scheduledLeaves.date));
}

/** Schedules one leave; a duplicate (same board+member+date, e.g. a double-click) is a silent no-op thanks to the unique index. */
export async function scheduleLeave(memberId: string, boardId: string, date: string, eventKey: string) {
  await db.insert(scheduledLeaves).values({ memberId, boardId, date, eventKey }).onConflictDoNothing();
}

/** Cancels one scheduled leave — scoped to `memberId` so a member can only ever cancel their own. Returns true if a row actually existed and was removed. */
export async function cancelScheduledLeave(memberId: string, id: string): Promise<boolean> {
  const deleted = await db
    .delete(scheduledLeaves)
    .where(and(eq(scheduledLeaves.id, id), eq(scheduledLeaves.memberId, memberId)))
    .returning({ id: scheduledLeaves.id });
  return deleted.length > 0;
}

/**
 * Turns every scheduledLeaves row dated today into a real, immediately-
 * confirmed leave — called from resetDailyBusyLists() right after it clears
 * the day's busy lists (bot/midnight-reset.ts), so a scheduled leave shows up
 * on the freshly-reset board instead of being wiped out by that same reset.
 * Bypasses the 30-minute pending-confirm window live reactions go through
 * (see attendance-confirm.ts) since this is a deliberate advance request, not
 * a possibly-accidental click — there's nothing to protect against by
 * holding it pending. Consumed rows are deleted right after applying either
 * way (even if the member is no longer eligible) — see scheduledLeaves in
 * schema.ts for why this table isn't meant to accumulate history.
 */
export async function applyTodaysScheduledLeaves(): Promise<{ applied: number }> {
  const today = thaiDateString();
  const due = await db.select().from(scheduledLeaves).where(eq(scheduledLeaves.date, today));
  let applied = 0;

  for (const row of due) {
    const member = await db.query.members.findFirst({ where: eq(members.id, row.memberId) });
    if (member && member.status === "ACTIVE" && !member.benched) {
      const board = await db.query.partyBoards.findFirst({ where: eq(partyBoards.id, row.boardId) });
      await db
        .delete(partyBusyEntries)
        .where(and(eq(partyBusyEntries.boardId, row.boardId), eq(partyBusyEntries.memberId, row.memberId)));
      await db.insert(partyBusyEntries).values({ boardId: row.boardId, memberId: row.memberId, sortOrder: 0 });
      await clearMemberSlotOnBoard(row.memberId, row.boardId);
      await db.insert(membershipEvents).values({
        memberId: row.memberId,
        type: "ATTENDANCE_LEAVE",
        detail: `ลาในกระดาน "${board?.name ?? row.boardId}" (แจ้งลาล่วงหน้าผ่าน /leave)`,
        actor: "bot:leave-schedule",
        boardId: row.boardId,
        confirmedAt: new Date(),
      });
      applied++;
    }
    // Row's job is done either way — a member who left/got benched between
    // scheduling and today just has the request silently drop instead of
    // applying to a board they're no longer part of.
    await db.delete(scheduledLeaves).where(eq(scheduledLeaves.id, row.id));
  }

  return { applied };
}
