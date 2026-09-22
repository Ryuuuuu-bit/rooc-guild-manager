"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/authz";
import { requestLeave, thaiDateString } from "@/lib/leaves";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Lets an admin log a "ลา" a member reported outside Discord (DM, in
 * person, etc.) that never went through ห้องลา — e.g. a personal or
 * last-minute leave. Backdated to whatever date the admin picks; a leave
 * whose round has already ended counts toward /attendance immediately, one
 * for today's still-open round behaves exactly like the member's own
 * request (shows on the board, cancellable until the round ends).
 *
 * boardId is optional — an admin can attribute the leave to a specific
 * board (e.g. "GL" or "WOE") if they know which event it was for; leaving
 * it unset keeps the leave un-tied to any board (shown as "ไม่ระบุกระดาน"
 * on /attendance).
 */
export async function addManualLeave(memberId: string, formData: FormData): Promise<ActionResult> {
  const session = await requireAdmin();

  const dateStr = (formData.get("date") as string)?.trim();
  const reason = (formData.get("reason") as string)?.trim();
  const boardId = (formData.get("boardId") as string)?.trim() || null;

  if (!dateStr || !DATE_RE.test(dateStr)) {
    return { ok: false, error: "Please select a valid date" };
  }
  if (Number.isNaN(new Date(`${dateStr}T12:00:00+07:00`).getTime())) {
    return { ok: false, error: "Invalid date" };
  }
  // Compared as Thai-calendar DATES ("YYYY-MM-DD" strings), so picking
  // today's own date early in the morning isn't rejected as "in advance".
  if (dateStr > thaiDateString()) {
    return { ok: false, error: "Cannot log a leave in advance" };
  }
  if (reason && reason.length > 300) {
    return { ok: false, error: "Reason is too long (300 characters max)" };
  }

  await requestLeave({
    memberId,
    boardId,
    occurrenceDate: dateStr,
    source: "ADMIN",
    actor: session.user.username,
    note: reason || null,
    detailSuffix: `(บันทึกย้อนหลังโดยแอดมิน ${session.user.username})`,
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
