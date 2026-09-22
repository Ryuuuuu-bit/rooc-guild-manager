"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { membershipEvents, partyBoards, partyBusyEntries, partySlots, partyGroupParties, partyGroups } from "@/db/schema";
import { requireAdmin } from "@/lib/authz";
import { getCheckinEvent, windowFor } from "@/lib/checkin-events";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** "YYYY-MM-DD" for now in Thailand's local time — same local-copy pattern
 * every other file in this codebase uses for this (see e.g.
 * bot/leave-schedule.ts's own copy). */
function thaiDateString(d: Date = new Date()): string {
  const thai = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return thai.toISOString().slice(0, 10);
}

/**
 * Lets an admin log a "ลา" a member reported outside Discord (DM, in
 * person, etc.) that never went through the reaction flow — e.g. a
 * personal/last-minute leave. Backdated to whatever date the admin picks
 * (not necessarily today), and inserted already-confirmed (no 30-minute
 * wait like the reaction flow — there's no reaction to accidentally
 * undo here, the admin is vouching for it directly), so it counts toward
 * /attendance stats immediately.
 *
 * boardId is optional — an admin can attribute the leave to a specific
 * board (e.g. "GL" or "WOE") if they know which event it was for, same as
 * a real reaction would; leaving it unset keeps the leave un-tied to any
 * board (shown as "ไม่ระบุกระดาน" on /attendance), same as before this was
 * selectable.
 */
export async function addManualLeave(memberId: string, formData: FormData): Promise<ActionResult> {
  const session = await requireAdmin();

  const dateStr = (formData.get("date") as string)?.trim();
  const reason = (formData.get("reason") as string)?.trim();
  const boardId = (formData.get("boardId") as string)?.trim() || null;

  if (!dateStr || !DATE_RE.test(dateStr)) {
    return { ok: false, error: "Please select a valid date" };
  }

  // Pin to noon Thailand time for the chosen date, rather than parsing the
  // bare date string as UTC midnight — that would land on the wrong local
  // day once displayed/filtered by day-range.
  const leaveDate = new Date(`${dateStr}T12:00:00+07:00`);
  if (Number.isNaN(leaveDate.getTime())) {
    return { ok: false, error: "Invalid date" };
  }
  // Compared as Thai-calendar DATES, not raw timestamps — the old
  // `leaveDate.getTime() > today.getTime()` check pinned the chosen date to
  // noon Thai time, but compared that against the actual current instant, so
  // picking TODAY'S own date before ~noon Thai time (e.g. logging an
  // overnight/early-morning leave at 8am) was wrongly rejected as "in
  // advance" even though it plainly wasn't. String comparison works directly
  // since both sides are "YYYY-MM-DD".
  const todayStr = thaiDateString();
  if (dateStr > todayStr) {
    return { ok: false, error: "Cannot log a leave in advance" };
  }

  if (reason && reason.length > 300) {
    return { ok: false, error: "Reason is too long (300 characters max)" };
  }

  const detail = reason
    ? `ลา (บันทึกย้อนหลังโดยแอดมิน) — ${reason}`
    : "ลา (บันทึกย้อนหลังโดยแอดมิน)";

  // When the leave is tied to a board, the LEAVE row alone is not enough:
  // /checkin's "on leave" lookup and /calendar both reconstruct who's out
  // by "last ATTENDANCE_LEAVE/RETURN per member on this board" with no date
  // bound (getLeaveMemberIds in src/lib/checkin-data.ts). A backdated leave
  // with nothing ever closing it left the member counted as on leave on
  // that board for EVERY later round — seen live: three members showed as
  // "On Leave" for a GL day none of them had asked off, purely from a
  // manual entry days earlier. So:
  //  - a leave for a date whose event window has already ended (the normal
  //    "log it after the fact" case) is written as a closed LEAVE→RETURN
  //    pair, the RETURN stamped just after that window's end so the leave
  //    still applies to that round (both pages evaluate at the window end)
  //    and to nothing after it;
  //  - a leave for TODAY whose event hasn't ended yet is treated like a live
  //    ลา instead: busy row + slot cleared, and the nightly reset closes it
  //    out with its own RETURN exactly as it does for a reaction.
  const board = boardId ? await db.query.partyBoards.findFirst({ where: eq(partyBoards.id, boardId) }) : null;
  const event = board?.checkinEventKey ? getCheckinEvent(board.checkinEventKey) : undefined;
  const now = new Date();
  // End of the round this leave is for: the linked event's window on that
  // date, or end of that Thai calendar day for a board with no event.
  const roundEnd = event ? windowFor(event, dateStr).end : new Date(`${dateStr}T23:59:59+07:00`);
  const stillOpen = roundEnd > now;

  await db.transaction(async (tx) => {
    await tx.insert(membershipEvents).values({
      memberId,
      type: "ATTENDANCE_LEAVE",
      detail,
      actor: session.user.username,
      boardId,
      confirmedAt: now,
      createdAt: leaveDate,
    });

    if (!board) return;

    if (stillOpen) {
      await tx
        .delete(partyBusyEntries)
        .where(and(eq(partyBusyEntries.boardId, board.id), eq(partyBusyEntries.memberId, memberId)));
      await tx.insert(partyBusyEntries).values({ boardId: board.id, memberId, sortOrder: 0 });
      const slotRows = await tx
        .select({ slotId: partySlots.id })
        .from(partySlots)
        .innerJoin(partyGroupParties, eq(partySlots.partyId, partyGroupParties.id))
        .innerJoin(partyGroups, eq(partyGroupParties.groupId, partyGroups.id))
        .where(and(eq(partySlots.memberId, memberId), eq(partyGroups.boardId, board.id)));
      for (const { slotId } of slotRows) {
        await tx.update(partySlots).set({ memberId: null, updatedAt: now }).where(eq(partySlots.id, slotId));
      }
      return;
    }

    await tx.insert(membershipEvents).values({
      memberId,
      type: "ATTENDANCE_RETURN",
      detail: `กลับจากลาในกระดาน "${board.name}" (ปิดรายการลาที่บันทึกย้อนหลังอัตโนมัติ)`,
      actor: session.user.username,
      boardId,
      createdAt: new Date(roundEnd.getTime() + 1000),
    });
  });

  revalidatePath("/");
  revalidatePath("/activity");
  revalidatePath("/attendance");
  revalidatePath("/calendar");
  revalidatePath("/checkin");
  revalidatePath("/party");
  revalidatePath(`/members/${memberId}`);
  return { ok: true };
}
