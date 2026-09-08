import { and, eq } from "drizzle-orm";
import { db } from "../src/db";
import { botReactionMessages, membershipEvents, partyBoards, partyBusyEntries } from "../src/db/schema";
import { ATTENDANCE_EMOJI } from "../src/lib/class-emoji";
import { addMessageReaction, removeAllReactionsForEmoji } from "../src/lib/discord";

/**
 * "YYYY-MM-DD" for the given instant in Thailand's local time (UTC+7),
 * computed without relying on the host machine's own timezone — same trick
 * used for the noon-Thailand date pin in the manual leave-entry action.
 */
export function thaiDateString(d: Date = new Date()): string {
  const thai = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return thai.toISOString().slice(0, 10);
}

/**
 * Clears every board's "Busy / ลา" list back to empty, and best-effort pulls
 * each board's attendance emoji off its tracked message, so every
 * member starts the new day available again without having to manually
 * un-react. Scheduled to run once per Thai calendar day — see the
 * midnight-check loop in index.ts.
 *
 * ALSO logs an ATTENDANCE_RETURN for each member cleared this way (see
 * below) — a previous version of this function deliberately skipped that to
 * avoid activity-feed noise, but that left a confirmed ATTENDANCE_LEAVE as
 * each such member's most recent event on that board FOREVER (nothing ever
 * closed it out), which made /checkin's "On Leave" lookup and /attendance's
 * leave stats (both driven by "what's the last LEAVE/RETURN logged for this
 * member+board" — see getLeaveMemberIds in src/lib/checkin-data.ts) keep
 * showing that member as on leave for every future round, even ones days or
 * weeks later, until someone happened to toggle them in/out of Busy/Leave
 * again — with nothing on the (now-empty-looking) party board itself to
 * suggest anything was wrong. Logging the return here keeps that history
 * honest: a small "Leave cancelled / returned" line for whoever was
 * actually on the list, once per board per night, in exchange for /checkin
 * and /attendance no longer permanently misattributing a stale leave.
 */
export async function resetDailyBusyLists(): Promise<{ boardsReset: number }> {
  const boards = await db.select({ id: partyBoards.id, name: partyBoards.name, emoji: partyBoards.emoji }).from(partyBoards);
  let boardsReset = 0;

  for (const board of boards) {
    const cleared = await db
      .delete(partyBusyEntries)
      .where(eq(partyBusyEntries.boardId, board.id))
      .returning({ memberId: partyBusyEntries.memberId });
    if (cleared.length === 0) continue; // nothing was busy on this board — no-op
    boardsReset++;

    // Being in partyBusyEntries always means this member's most recent
    // ATTENDANCE_LEAVE/RETURN event on this board was a LEAVE not yet
    // followed by a RETURN (reactions.ts and party.ts's moveMember both
    // keep the two in sync on every add/remove) — including one still
    // pending confirmation. Logging the return unconditionally is safe
    // either way: for an already-confirmed leave, this is exactly the
    // missing close-out described above; for a still-pending one (reacted
    // in the last 30 minutes before rollover), the pending row itself gets
    // discarded shortly after by confirmDueLeaves (it's no longer "still
    // busy" once this clears it), so this return is a harmless no-op next
    // to a leave that was never going to count anyway.
    for (const { memberId } of cleared) {
      await db.insert(membershipEvents).values({
        memberId,
        type: "ATTENDANCE_RETURN",
        detail: `ยกเลิกลาในกระดาน "${board.name}" อัตโนมัติ (รีเซ็ตประจำวัน)`,
        actor: "bot:midnight-reset",
        boardId: board.id,
      });
    }

    const tracked = await db.query.botReactionMessages.findFirst({
      where: and(eq(botReactionMessages.kind, "ATTENDANCE"), eq(botReactionMessages.boardId, board.id)),
    });
    if (tracked) {
      // Per-board emoji (see partyBoards.emoji) — falls back to the app-wide
      // default for boards that never customized theirs.
      const emoji = board.emoji || ATTENDANCE_EMOJI;
      await removeAllReactionsForEmoji(tracked.channelId, tracked.messageId, emoji);
      // removeAllReactionsForEmoji wipes EVERY reaction for that emoji off
      // the message, including the bot's own seed reaction from when the
      // message was first posted — without re-adding it, the message is
      // left with zero reactions of that emoji. For a role-restricted custom
      // emoji, Discord only lets a member without that role react by
      // clicking an *existing* reaction already on the message — they can't
      // add a brand-new one themselves — so once the seed reaction is gone,
      // those members silently lose the ability to react ลา at all until an
      // admin reposts the message. Re-seed it right after clearing so the
      // one-click option (and that piggyback path) survives every night's
      // reset. Best-effort — same as the seeding in postAttendanceMessage.
      await addMessageReaction(tracked.channelId, tracked.messageId, emoji).catch(() => {});
    }
  }

  return { boardsReset };
}
