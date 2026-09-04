import { and, eq, isNull, lte } from "drizzle-orm";
import { db } from "../src/db";
import { members, membershipEvents, partyBoards, partyBusyEntries } from "../src/db/schema";
import { sendDirectMessage } from "../src/lib/discord";

// How long a "ลา" reaction has to stay in place before it counts toward
// /attendance stats — see the confirm/discard flow described below.
export const CONFIRM_AFTER_MS = 30 * 60 * 1000;

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
 * Promotes pending ATTENDANCE_LEAVE events (member reacted "ลา", not yet
 * confirmed) to confirmed once they've survived CONFIRM_AFTER_MS
 * uninterrupted — only confirmed leaves count toward the /attendance stats
 * page (see getAttendanceStats in src/lib/data.ts). This is what keeps a
 * member's curious test-click from skewing the numbers: un-reacting before
 * confirmation discards the event entirely instead of logging it (see
 * handleReactionRemove in reactions.ts).
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
  const cutoff = new Date(Date.now() - CONFIRM_AFTER_MS);
  const pending = await db
    .select({
      id: membershipEvents.id,
      memberId: membershipEvents.memberId,
      boardId: membershipEvents.boardId,
    })
    .from(membershipEvents)
    .where(
      and(
        eq(membershipEvents.type, "ATTENDANCE_LEAVE"),
        isNull(membershipEvents.confirmedAt),
        lte(membershipEvents.createdAt, cutoff)
      )
    );

  let confirmed = 0;
  let discarded = 0;

  for (const row of pending) {
    if (!row.boardId) {
      await db
        .update(membershipEvents)
        .set({ confirmedAt: new Date() })
        .where(eq(membershipEvents.id, row.id));
      confirmed++;
      continue;
    }

    const stillBusy = await db.query.partyBusyEntries.findFirst({
      where: and(eq(partyBusyEntries.boardId, row.boardId), eq(partyBusyEntries.memberId, row.memberId)),
    });

    if (stillBusy) {
      await db
        .update(membershipEvents)
        .set({ confirmedAt: new Date() })
        .where(eq(membershipEvents.id, row.id));
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
