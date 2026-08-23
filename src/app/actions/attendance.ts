"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { membershipEvents } from "@/db/schema";
import { requireAdmin } from "@/lib/authz";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
    return { ok: false, error: "กรุณาเลือกวันที่ให้ถูกต้อง" };
  }

  // Pin to noon Thailand time for the chosen date, rather than parsing the
  // bare date string as UTC midnight — that would land on the wrong local
  // day once displayed/filtered by day-range.
  const leaveDate = new Date(`${dateStr}T12:00:00+07:00`);
  if (Number.isNaN(leaveDate.getTime())) {
    return { ok: false, error: "วันที่ไม่ถูกต้อง" };
  }
  const today = new Date();
  if (leaveDate.getTime() > today.getTime()) {
    return { ok: false, error: "ไม่สามารถบันทึกการลาล่วงหน้าได้" };
  }

  if (reason && reason.length > 300) {
    return { ok: false, error: "เหตุผลยาวเกินไป (สูงสุด 300 ตัวอักษร)" };
  }

  const detail = reason
    ? `ลา (บันทึกย้อนหลังโดยแอดมิน) — ${reason}`
    : "ลา (บันทึกย้อนหลังโดยแอดมิน)";

  await db.insert(membershipEvents).values({
    memberId,
    type: "ATTENDANCE_LEAVE",
    detail,
    actor: session.user.username,
    boardId,
    confirmedAt: new Date(),
    createdAt: leaveDate,
  });

  revalidatePath("/");
  revalidatePath("/activity");
  revalidatePath("/attendance");
  revalidatePath(`/members/${memberId}`);
  return { ok: true };
}
