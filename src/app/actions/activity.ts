"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { membershipEvents } from "@/db/schema";
import { requireAdmin } from "@/lib/authz";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Deletes a single activity-log row — e.g. to clean up test data (a member
 * tried the "ลา" reaction just to see how it works) that would otherwise
 * skew the /attendance stats page or clutter the activity feed/member
 * history. Admin-only, irreversible — the UI confirms before calling this.
 */
export async function deleteMembershipEvent(eventId: string): Promise<ActionResult> {
  await requireAdmin();

  const [deleted] = await db
    .delete(membershipEvents)
    .where(eq(membershipEvents.id, eventId))
    .returning({ memberId: membershipEvents.memberId });
  if (!deleted) return { ok: false, error: "ไม่พบรายการนี้ (อาจถูกลบไปแล้ว)" };

  revalidatePath("/");
  revalidatePath("/activity");
  revalidatePath("/attendance");
  revalidatePath(`/members/${deleted.memberId}`);
  return { ok: true };
}
