import { and, eq, isNull } from "drizzle-orm";
import { db } from "../src/db";
import { members, membershipEvents, partyBoards, partyBusyEntries } from "../src/db/schema";
import { sendDirectMessage } from "../src/lib/discord";
import { getCheckinEvent, nextOccurrenceEnd } from "../src/lib/checkin-events";

// Fallback for a board with no linked CHECKIN_EVENTS entry (partyBoards.
// checkinEventKey is null or points at an unknown key) — such a board has no
// known "event end time" to gate on, so it keeps the flat-delay behavior this
// whole file used to use for every board before the per-event gating below
// was added.
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

/**
 * Best-effort DM to every configured admin the moment a member is marked
 * "ลา" — from a live reaction (reactions.ts's handleReactionAdd) or an
 * advance /leave request auto-applying (leave-schedule.ts's
 * applyTodaysScheduledLeaves) — so admins can rework the party board well
 * ahead of the event.
 *
 * Previously this only fired once confirmDueLeaves below flipped
 * confirmedAt — which, now that confirmation itself waits for the event's
 * own end time (see this file's header comment), meant the admin DM arrived
 * only AFTER the event was already over: useless for "go rework the party",
 * the entire point of notifying them. Firing immediately at mark-time
 * instead (matching how the party board's own Busy/ลา list and
 * getLeaveMemberIds already treat a leave as live right away, not just once
 * confirmed) trades that off against maybe pinging admins about a leave that
 * gets cancelled a few minutes later — worth it, since a late-but-guaranteed
 * notification is not actually useful for this purpose.
 */
export async function notifyAdminsOfLeave(memberId: string, boardId: string) {
  const notifyIds = leaveNotifyUserIds();
  if (notifyIds.length === 0) return;

  const member = await db.query.members.findFirst({ where: eq(members.id, memberId) });
  if (!member) return;
  const board = await db.query.partyBoards.findFirst({ where: eq(partyBoards.id, boardId) });
  const displayName = member.discordNickname || member.discordGlobalName || member.discordUsername;

  const text =
    `📋 แจ้งลา: ${displayName} ลาในกระดาน "${board?.name ?? boardId}" ` +
    "(ยังไม่ล็อกจนกว่ากิจกรรมจะจบ — อาจถูกยกเลิกได้ก่อนหน้านั้น เช็ค /party ก่อนเริ่มงานอีกทีถ้าจะย้ายคนแทนที่)\n" +
    "เตรียมจัดปาร์ตี้ทดแทนได้เลยครับ";

  for (const userId of notifyIds) {
    try {
      await sendDirectMessage(userId, text);
    } catch (err) {
      console.error(`[bot] failed to DM admin ${userId} about a new leave`, err);
    }
  }
}

/**
 * Promotes pending ATTENDANCE_LEAVE events (a member marked ลา — via a live
 * reaction, or an advance /leave request that already auto-applied — not yet
 * confirmed) to confirmed once the MATCHING EVENT'S NEXT NOT-YET-ENDED
 * OCCURRENCE actually ends — only confirmed leaves count toward the
 * /attendance stats page (see getAttendanceStats in src/lib/data.ts) and the
 * monthly leave quota. This is what keeps a member free to change their mind
 * any time before the event happens: cancelling before then (un-reacting, or
 * the self-service option in /leave — see cancelCurrentLeave in
 * reactions.ts) discards the event entirely instead of logging it, no matter
 * how long ago it was originally marked.
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
 * Uses nextOccurrenceEnd (checkin-events.ts) rather than just checking
 * whether TODAY matches the event's weekday — an earlier version did that,
 * on the assumption that a live "ลา" reaction always happens same-day as the
 * event it's for. In practice the "ลา" message is a standing, never-reposted
 * board message a member can click on ANY day (see postAttendanceMessage in
 * src/app/actions/bot-messages.ts), so that assumption doesn't hold: reacting
 * on a day the event doesn't run, or reacting after that day's own window had
 * already closed, both used to fall back to FALLBACK_CONFIRM_AFTER_MS below —
 * locking the leave in within half an hour regardless of how far away the
 * actual event still was, reintroducing the exact "confirmed long before the
 * event, no real way to undo it" problem this whole redesign exists to fix.
 * nextOccurrenceEnd always finds the true next not-yet-ended occurrence
 * instead, so reacting early behaves the same as scheduling that date via
 * /leave. A board with no linked CHECKIN_EVENTS entry at all (see
 * partyBoards.checkinEventKey in schema.ts) still falls back to the flat
 * FALLBACK_CONFIRM_AFTER_MS delay this file used for every board before
 * per-event gating existed — there's no event schedule to gate on there.
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
 *
 * Does NOT notify admins itself (see notifyAdminsOfLeave above) — that fires
 * immediately at mark-time now, from reactions.ts/leave-schedule.ts, instead
 * of waiting for this sweep to confirm (which, gated on the event's own end
 * time, would mean the notification arrived only after the event was already
 * over — too late to be useful for "go rework the party").
 */
export async function confirmDueLeaves(): Promise<{ confirmed: number; discarded: number }> {
  const now = new Date();

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
    const event = board?.checkinEventKey ? getCheckinEvent(board.checkinEventKey) : undefined;
    const dueAt = event ? nextOccurrenceEnd(event, now) : new Date(row.createdAt.getTime() + FALLBACK_CONFIRM_AFTER_MS);
    if (now < dueAt) continue; // event hasn't ended yet (or fallback delay hasn't elapsed) — not due

    const stillBusy = await db.query.partyBusyEntries.findFirst({
      where: and(eq(partyBusyEntries.boardId, row.boardId), eq(partyBusyEntries.memberId, row.memberId)),
    });

    if (stillBusy) {
      await db.update(membershipEvents).set({ confirmedAt: now }).where(eq(membershipEvents.id, row.id));
      confirmed++;
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
