import { and, eq } from "drizzle-orm";
import { db } from "../src/db";
import { botReactionMessages, partyBoards, partyBusyEntries } from "../src/db/schema";
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
 * Deliberately does NOT touch membershipEvents / /attendance stats — those
 * are a separate, permanent record of confirmed leaves each pinned to its
 * own date, untouched by this daily reset of the *current* busy status.
 * Also deliberately does not log anything to each member's activity feed —
 * this runs for every board, every night, and logging an entry per member
 * would just spam their history with a no-op "returned" line.
 */
export async function resetDailyBusyLists(): Promise<{ boardsReset: number }> {
  const boards = await db.select({ id: partyBoards.id, emoji: partyBoards.emoji }).from(partyBoards);
  let boardsReset = 0;

  for (const board of boards) {
    const cleared = await db
      .delete(partyBusyEntries)
      .where(eq(partyBusyEntries.boardId, board.id))
      .returning({ id: partyBusyEntries.id });
    if (cleared.length === 0) continue; // nothing was busy on this board — no-op
    boardsReset++;

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
