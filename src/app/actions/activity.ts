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
 * Deletes a single activity-log row (test data, a mistaken note) so it
 * stops cluttering the feed / member history. Audit only: leave counts come
 * from the `leaves` table (src/lib/leaves.ts), so this never changes
 * /attendance — cancel the leave on the party board or via "Void leaves"
 * for that. Admin-only, irreversible — the UI confirms before calling this.
 */
export async function deleteMembershipEvent(eventId: string): Promise<ActionResult> {
  await requireAdmin();

  const [deleted] = await db
    .delete(membershipEvents)
    .where(eq(membershipEvents.id, eventId))
    .returning({ memberId: membershipEvents.memberId });
  if (!deleted) return { ok: false, error: "Entry not found (it may have already been deleted)" };

  revalidatePath("/");
  revalidatePath("/activity");
  revalidatePath("/attendance");
  revalidatePath(`/members/${deleted.memberId}`);
  return { ok: true };
}
