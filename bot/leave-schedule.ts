// Advance leave scheduling — /leave lets a member pick one or more upcoming
// event dates from a dropdown (see src/lib/checkin-events.ts for the event
// list) instead of waiting until the day to react "ลา" live on a party
// board. See scheduledLeaves in src/db/schema.ts for the storage shape and
// why a row disappears once applied. Mirrors the existing live "ลา" reaction
// flow in reactions.ts wherever the two overlap (delete-then-insert on
// partyBusyEntries, clearMemberSlotOnBoard, the ATTENDANCE_LEAVE event log)
// so both paths produce identical, indistinguishable history.
import { and, asc, desc, eq, isNull, lte } from "drizzle-orm";
import { db } from "../src/db";
import { members, membershipEvents, partyBoards, partyBusyEntries, scheduledLeaves } from "../src/db/schema";
import { CHECKIN_EVENTS } from "../src/lib/checkin-events";
import { clearMemberSlotOnBoard, countLeavesThisMonth, dmMemberLeaveStatus } from "./reactions";
import { notifyAdminsOfLeave } from "./attendance-confirm";

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

/** boardId lookup by the board's own checkinEventKey link (schema.ts) — re-queried per call since /leave only runs a handful of times a day, no need for a standing cache. */
async function resolveEventBoards(): Promise<Map<string, { id: string; name: string }>> {
  const boardByEventKey = new Map<string, { id: string; name: string }>();
  for (const event of CHECKIN_EVENTS) {
    const board = await db.query.partyBoards.findFirst({ where: eq(partyBoards.checkinEventKey, event.key) });
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

export interface MemberActiveLeave {
  boardId: string;
  boardName: string;
}

/**
 * Boards this member is CURRENTLY marked Busy/ลา on, right now — regardless
 * of how they got there (a live "ลา" reaction, or an advance /leave request
 * that already auto-applied). What /leave's picker offers under "cancel my
 * leave now", distinct from listMemberScheduledLeaves' list of not-yet-due
 * future requests just above.
 */
export async function listMemberActiveLeaves(memberId: string): Promise<MemberActiveLeave[]> {
  const rows = await db
    .select({ boardId: partyBusyEntries.boardId, boardName: partyBoards.name })
    .from(partyBusyEntries)
    .innerJoin(partyBoards, eq(partyBusyEntries.boardId, partyBoards.id))
    .where(eq(partyBusyEntries.memberId, memberId))
    .orderBy(asc(partyBoards.name));
  return rows;
}

export interface MemberScheduledLeave {
  id: string;
  boardId: string;
  date: string;
  /** Human label of the event this date belongs to (e.g. "GL"), resolved
   * from CHECKIN_EVENTS by the row's eventKey — used so the /leave cancel
   * dropdown can show it next to the date (see the doc comment on
   * listUpcomingLeaveOptions' sibling usage in bot/interactions.ts for why:
   * without it, two boards scheduled for the same calendar date would show
   * as identical, indistinguishable cancel options). Empty string if the
   * eventKey no longer matches any configured event (e.g. the event was
   * removed from CHECKIN_EVENTS after this leave was scheduled). */
  eventLabel: string;
}

/** This member's own not-yet-applied scheduled leaves, soonest first. */
export async function listMemberScheduledLeaves(memberId: string): Promise<MemberScheduledLeave[]> {
  const rows = await db
    .select()
    .from(scheduledLeaves)
    .where(eq(scheduledLeaves.memberId, memberId))
    .orderBy(asc(scheduledLeaves.date));
  return rows.map((r) => ({
    id: r.id,
    boardId: r.boardId,
    date: r.date,
    eventLabel: CHECKIN_EVENTS.find((e) => e.key === r.eventKey)?.label ?? "",
  }));
}

/**
 * Schedules one leave; a duplicate (same board+member+date, e.g. a
 * double-click) is a silent no-op thanks to the unique index — nothing gets
 * logged for that case, only for a request that's actually new. Logs a
 * LEAVE_SCHEDULED membershipEvent right away so the request is immediately
 * visible in the activity feed / member profile, not just once it's applied
 * weeks later on its actual date (see applyTodaysScheduledLeaves, which logs
 * the separate ATTENDANCE_LEAVE that day).
 */
export async function scheduleLeave(memberId: string, boardId: string, date: string, eventKey: string) {
  const inserted = await db
    .insert(scheduledLeaves)
    .values({ memberId, boardId, date, eventKey })
    .onConflictDoNothing()
    .returning({ id: scheduledLeaves.id });
  if (inserted.length === 0) return; // already scheduled — nothing new happened

  const board = await db.query.partyBoards.findFirst({ where: eq(partyBoards.id, boardId) });
  await db.insert(membershipEvents).values({
    memberId,
    type: "LEAVE_SCHEDULED",
    detail: `แจ้งลาล่วงหน้าในกระดาน "${board?.name ?? boardId}" วันที่ ${date}`,
    actor: "bot:leave-schedule",
    boardId,
  });
}

/**
 * Cancels one scheduled leave — scoped to `memberId` so a member can only
 * ever cancel their own. Returns true if a row actually existed and was
 * removed (and logs a matching LEAVE_SCHEDULE_CANCELLED event); false if
 * there was nothing to cancel (e.g. already cancelled from another click).
 */
export async function cancelScheduledLeave(memberId: string, id: string): Promise<boolean> {
  const deleted = await db
    .delete(scheduledLeaves)
    .where(and(eq(scheduledLeaves.id, id), eq(scheduledLeaves.memberId, memberId)))
    .returning({ boardId: scheduledLeaves.boardId, date: scheduledLeaves.date });
  if (deleted.length === 0) return false;

  const { boardId, date } = deleted[0];
  const board = await db.query.partyBoards.findFirst({ where: eq(partyBoards.id, boardId) });
  await db.insert(membershipEvents).values({
    memberId,
    type: "LEAVE_SCHEDULE_CANCELLED",
    detail: `ยกเลิกแจ้งลาล่วงหน้าในกระดาน "${board?.name ?? boardId}" วันที่ ${date}`,
    actor: "bot:leave-schedule",
    boardId,
  });
  return true;
}

/**
 * Turns every DUE scheduledLeaves row (dated today OR EARLIER — see below)
 * into a real leave (marked Busy on the board right away) — called from
 * resetDailyBusyLists() right after it clears the day's busy lists
 * (bot/midnight-reset.ts), so a scheduled leave shows up on the
 * freshly-reset board instead of being wiped out by that same reset. Left
 * PENDING (confirmedAt: null) just like a live "ลา" reaction — it locks in
 * (counts toward /attendance and the monthly quota) only once the matching
 * event's window actually ends, via attendance-confirm.ts's sweep, and until
 * then the member can freely undo it themselves (see cancelCurrentLeave in
 * reactions.ts, reachable through /leave's self-service cancel option) with
 * no trace left behind. This used to insert already-confirmed, reasoning
 * that an advance request is deliberate rather than a possibly-accidental
 * click — but that also meant there was no way left for a member to change
 * their mind afterward, since the scheduledLeaves-cancel flow only ever
 * touches not-yet-applied requests. Also now DMs the member + notifies
 * admins the moment it applies (see dmMemberLeaveStatus/notifyAdminsOfLeave
 * below) — this used to notify no one at all, so a member had no way to
 * learn their leave had gone into effect and was still cancellable short of
 * opening /leave themselves. Consumed rows are deleted right after
 * applying either way (even if the member is no longer eligible) — see
 * scheduledLeaves in schema.ts for why this table isn't meant to accumulate
 * history.
 *
 * Queries `date <= today`, not `date === today` — resetDailyBusyLists only
 * runs once per Thai calendar day, gated by an in-memory "have I already run
 * today" flag (bot/index.ts) that resets to "today" on every process start.
 * If the bot restarts (routine here — see Railway deploy workflow) at any
 * point on a day BEFORE that day's reset has run even once, the in-memory
 * flag comes back up already saying "today's done", so that day's reset —
 * and with it, this function — never runs at all, and would otherwise never
 * revisit those rows once the calendar date moves on (this function used to
 * look for `=== today` only, so a missed day's requests just sat in the
 * table forever, silently never applied and never cleaned up). `<=` instead
 * catches up on anything still sitting in the table from a missed day the
 * very next time this does run.
 */
export async function applyTodaysScheduledLeaves(): Promise<{ applied: number }> {
  const today = thaiDateString();
  const due = await db.select().from(scheduledLeaves).where(lte(scheduledLeaves.date, today));
  let applied = 0;

  for (const row of due) {
    const member = await db.query.members.findFirst({ where: eq(members.id, row.memberId) });

    if (member && member.status === "ACTIVE" && !member.benched) {
      const board = await db.query.partyBoards.findFirst({ where: eq(partyBoards.id, row.boardId) });
      let insertedLeaveLog = false;

      // Marking the member busy, clearing their party slot, the same-day
      // dedup check below, the new ATTENDANCE_LEAVE log, and removing this
      // row from scheduledLeaves now all commit as one transaction. Before
      // this they ran as separate statements, and the bot process CAN be
      // torn down mid-request by a routine Railway redeploy — a crash
      // partway through used to be able to leave this half-applied (e.g. the
      // busy row inserted but the row never removed from scheduledLeaves),
      // so the NEXT run would re-process it. That's fine for the busy-entry
      // delete+insert (idempotent), but the dedup check just below only
      // guards a live reaction landing on the exact due date — re-running
      // this same block a second time for an already-applied OVERDUE
      // (date < today) row would have inserted a second ATTENDANCE_LEAVE for
      // the same absence. Wrapping the whole row means it's either fully
      // applied and removed, or neither happened at all — nothing left
      // half-done for a retry to double up on.
      await db.transaction(async (tx) => {
        await tx
          .delete(partyBusyEntries)
          .where(and(eq(partyBusyEntries.boardId, row.boardId), eq(partyBusyEntries.memberId, row.memberId)));
        await tx.insert(partyBusyEntries).values({ boardId: row.boardId, memberId: row.memberId, sortOrder: 0 });
        await clearMemberSlotOnBoard(tx, row.memberId, row.boardId);

        // A live "ลา" reaction can land in the narrow window between the Thai
        // calendar date rolling over and this function actually running (the
        // midnight-check loop polls every 60s — see bot/index.ts), logging its
        // own still-unconfirmed ATTENDANCE_LEAVE for this exact member+board
        // moments before resetDailyBusyLists' busy-clear loop deletes that
        // reaction's partyBusyEntries row (and logs a spurious RETURN for it —
        // harmless, see that function's comment) just ahead of this insert.
        // Left unhandled, that would leave TWO still-pending ATTENDANCE_LEAVE
        // rows for the same member+board once attendance-confirm.ts's sweep
        // finds partyBusyEntries true again (from the insert above) and
        // confirms both. Skipping the insert when one's already sitting there
        // pending avoids that double-count — the existing row already
        // represents this exact leave, nothing else to do with it.
        //
        // Only checked for row.date === today — that race is only physically
        // possible against TODAY's occurrence (a live reaction can't pre-date
        // itself). Scoping it that way matters when the bot has been down
        // across more than one due date for the same member+board (`due` can
        // contain several rows via the `date <= today` catch-up query above):
        // without the date scope, this dedup query isn't aware which date the
        // existing pending row belongs to, so applying an older missed date
        // first would make the SECOND due row's dedup check find that first
        // insert and skip its own — silently merging two distinct missed
        // leaves into one.
        const pendingFromLiveReaction =
          row.date === today
            ? await tx.query.membershipEvents.findFirst({
                where: and(
                  eq(membershipEvents.memberId, row.memberId),
                  eq(membershipEvents.boardId, row.boardId),
                  eq(membershipEvents.type, "ATTENDANCE_LEAVE"),
                  isNull(membershipEvents.confirmedAt)
                ),
                orderBy: desc(membershipEvents.createdAt),
              })
            : undefined;

        if (!pendingFromLiveReaction) {
          await tx.insert(membershipEvents).values({
            memberId: row.memberId,
            type: "ATTENDANCE_LEAVE",
            detail: `ลาในกระดาน "${board?.name ?? row.boardId}" (แจ้งลาล่วงหน้าผ่าน /leave)`,
            actor: "bot:leave-schedule",
            boardId: row.boardId,
            confirmedAt: null,
          });
          insertedLeaveLog = true;
        }

        await tx.delete(scheduledLeaves).where(eq(scheduledLeaves.id, row.id));
      });

      applied++;

      // A live "ลา" reaction proactively DMs the member + notifies admins
      // the moment it's marked (see handleReactionAdd in reactions.ts) —
      // this auto-applied path used to do neither, so a member had no way
      // to know their scheduled leave had gone into effect (and was still
      // freely cancellable) short of opening /leave themselves to check,
      // and admins had no heads-up to rework the party board either.
      // Fire-and-forget, same as the live-reaction path — a slow/failed
      // DM shouldn't hold up applying the rest of today's due leaves, and
      // it stays outside the transaction above (a Discord API call, not a
      // DB write). Only sent when a fresh row was actually inserted above
      // (skipped for pendingFromLiveReaction, whose own react already sent
      // both).
      if (insertedLeaveLog) {
        const leaveCount = await countLeavesThisMonth(row.memberId, row.boardId);
        void dmMemberLeaveStatus(member.discordId, board?.name ?? row.boardId, leaveCount, "schedule", row.eventKey);
        void notifyAdminsOfLeave(row.memberId, row.boardId);
      }
    } else {
      // Row's job is done either way — a member who left/got benched between
      // scheduling and today just has the request silently drop instead of
      // applying to a board they're no longer part of.
      await db.delete(scheduledLeaves).where(eq(scheduledLeaves.id, row.id));
    }
  }

  return { applied };
}
