import { and, eq, isNull, lte } from "drizzle-orm";
import { db } from "../src/db";
import { membershipEvents, partyBusyEntries } from "../src/db/schema";

// How long a "ลา" reaction has to stay in place before it counts toward
// /attendance stats — see the confirm/discard flow described below.
export const CONFIRM_AFTER_MS = 30 * 60 * 1000;

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
