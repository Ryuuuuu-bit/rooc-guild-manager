import { and, eq, isNull } from "drizzle-orm";
import { db } from "../src/db";
import { members, membershipEvents, partyBoards, partyBusyEntries } from "../src/db/schema";
import { sendDirectMessage } from "../src/lib/discord";
import { getCheckinEventByBoardName, windowFor } from "../src/lib/checkin-events";

/** "YYYY-MM-DD" for now in Thailand's local time — a local copy rather than
 * an import from elsewhere, same trick as every other copy of this helper in
 * the codebase (see bot/leave-schedule.ts's own copy for why). */
function thaiDateString(d: Date = new Date()): string {
  const thai = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return thai.toISOString().slice(0, 10);
}

/** JS weekday (0=Sun..6=Sat) of a "YYYY-MM-DD" Thai calendar date. */
function weekdayOf(dateStr: string): number {
  return new Date(`${dateStr}T12:00:00+07:00`).getUTCDay();
}

// Fallback for a board with no matching CHECKIN_EVENTS entry (see
// getCheckinEventByBoardName) — such a board has no known "event end time" to
// gate on, so it keeps the flat-delay behavior this whole file used to use
// for every board before the per-event gating below was added.
const FALLBACK_CONFIRM_AFTER_MS = 30 * 60 * 1000;

/** Comma-separated Discord user IDs to DM the moment a "ลา" survives
 * confirmation — lets admins rework the party board well ahead of the event
 * instead of only noticing on their next visit to /attendance. Read
 * directly off the env var (bot convention — see DISCORD_TRACKED_ROLE_NAME
 * in sync.ts) rather than importing src/lib/env, which throws on missing
 * required vars this bot doesn't need. Empty/unset = no one gets DMed. */
function leaveNotifyUserIds(): string[] {
  return (process.env.DISCORD_LEAVE_NOTIFY_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Best-effort DM to every configured admin once a leave is confirmed — a
 * quick-click-then-undo never reaches here (see confirmDueLeaves), so this
 * only ever fires for a leave that's genuinely going to hold. */
async function notifyAdminsOfConfirmedLeave(memberId: string, boardId: string) {
  const notifyIds = leaveNotifyUserIds();
  if (notifyIds.length === 0) return;

  const member = await db.query.members.findFirst({ where: eq(members.id, memberId) });
  if (!member) return;
  const board = await db.query.partyBoards.findFirst({ where: eq(partyBoards.id, boardId) });
  const displayName = member.discordNickname || member.discordGlobalName || member.discordUsername;

  const text =
    `📋 ยืนยันลาแล้ว: ${displayName} ลาในกระดาน "${board?.name ?? boardId}" (ผ่านการยืนยัน 30 นาทีแล้ว)\n` +
    "เตรียมจัดปาร์ตี้ทดแทนได้เลยครับ";

  for (const userId of notifyIds) {
    try {
      await sendDirectMessage(userId, text);
    } catch (err) {
      console.error(`[bot] failed to DM admin ${userId} about a confirmed leave`, err);
    }
  }
}

/**
 * Promotes pending ATTENDANCE_LEAVE events (a member marked ลา — via a live
 * reaction, or an advance /leave request that already auto-applied — not yet
 * confirmed) to confirmed once the MATCHING EVENT'S OWN WINDOW FOR TODAY
 * actually ends — only confirmed leaves count toward the /attendance stats
 * page (see getAttendanceStats in src/lib/data.ts) and the monthly leave
 * quota. This is what keeps a member free to change their mind any time
 * before the event happens: cancelling before then (un-reacting, or the
 * self-service option in /leave — see cancelCurrentLeave in reactions.ts)
 * discards the event entirely instead of logging it, no matter how long ago
 * it was originally marked.
 *
 * Previously this gated on a flat 30-minute timer from when the member
 * reacted, regardless of the actual event — which is what let an advance
 * /leave request (applied hours or days before the event, see
 * leave-schedule.ts's applyTodaysScheduledLeaves) lock in almost instantly,
 * leaving no way for the member to undo it themselves afterward (the
 * scheduledLeaves-cancel flow only ever touches not-yet-applied requests).
 * Gating on the event's real end time instead treats every origin the same
 * and keeps the door open for exactly as long as it should be.
 *
 * A board with no matching CHECKIN_EVENTS entry (see
 * getCheckinEventByBoardName) — or the rare case where today doesn't
 * actually match the event's configured weekday, which shouldn't happen
 * since live "ลา" reactions are meant to be used same-day (see
 * leave-schedule.ts's header comment) — falls back to the flat
 * FALLBACK_CONFIRM_AFTER_MS delay this file used for every board before
 * per-event gating existed.
 *
 * Checked against our own partyBusyEntries state (already kept in sync by
 * reactions.ts on every add/remove) rather than re-fetching the Discord
 * message, and driven by comparing timestamps rather than an in-memory
 * timer — so it survives bot restarts/redeploys cleanly. Anything overdue
 * just gets caught on the next sweep, including right at startup.
 *
 * Legacy rows from before this feature existed have no boardId recorded
 * (the column didn't exist yet) — those are auto-confirmed rather than
 * discarded, so historical /attendance stats don't silently disappear.
 */
export async function confirmDueLeaves(): Promise<{ confirmed: number; discarded: number }> {
  const now = new Date();
  const today = thaiDateString(now);

  // Always a small set (one row per currently-pending leave) — no need to
  // pre-filter by time in the query itself now that "due" depends on each
  // row's own event, not a single flat cutoff.
  const pending = await db
    .select({
      id: membershipEvents.id,
      memberId: membershipEvents.memberId,
      boardId: membershipEvents.boardId,
      createdAt: membershipEvents.createdAt,
    })
    .from(membershipEvents)
    .where(and(eq(membershipEvents.type, "ATTENDANCE_LEAVE"), isNull(membershipEvents.confirmedAt)));

  let confirmed = 0;
  let discarded = 0;

  for (const row of pending) {
    if (!row.boardId) {
      await db.update(membershipEvents).set({ confirmedAt: now }).where(eq(membershipEvents.id, row.id));
      confirmed++;
      continue;
    }

    const board = await db.query.partyBoards.findFirst({ where: eq(partyBoards.id, row.boardId) });
    const event = board ? getCheckinEventByBoardName(board.name) : undefined;
    const dueAt =
      event && event.weekdays.includes(weekdayOf(today))
        ? windowFor(event, today).end
        : new Date(row.createdAt.getTime() + FALLBACK_CONFIRM_AFTER_MS);
    if (now < dueAt) continue; // event hasn't ended yet (or fallback delay hasn't elapsed) — not due

    const stillBusy = await db.query.partyBusyEntries.findFirst({
      where: and(eq(partyBusyEntries.boardId, row.boardId), eq(partyBusyEntries.memberId, row.memberId)),
    });

    if (stillBusy) {
      await db.update(membershipEvents).set({ confirmedAt: now }).where(eq(membershipEvents.id, row.id));
      confirmed++;
      // Fire-and-forget — a slow/failed DM shouldn't hold up the sweep.
      void notifyAdminsOfConfirmedLeave(row.memberId, row.boardId);
    } else {
      // No longer marked busy on that board (un-reacted through some path
      // that didn't go through the normal remove handler, e.g. the board
      // itself got deleted) — this pending event never became real.
      await db.delete(membershipEvents).where(eq(membershipEvents.id, row.id));
      discarded++;
    }
  }

  return { confirmed, discarded };
}
