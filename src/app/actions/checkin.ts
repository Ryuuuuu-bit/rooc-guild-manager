"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { checkinNotes } from "@/db/schema";
import { requireAdmin } from "@/lib/authz";
import { getCheckinEvent } from "@/lib/checkin-events";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Sets (or clears, if `note` is blank) the admin note on one member's row
 * for one check-in window — e.g. a member DMs an admin afterward explaining
 * why they weren't online, and the admin records that here so it's visible
 * next to their "ไม่เข้าร่วม" badge instead of living only in a DM.
 */
export async function setCheckinNote(
  eventKey: string,
  date: string,
  memberId: string,
  note: string
): Promise<ActionResult> {
  const session = await requireAdmin();
  if (!getCheckinEvent(eventKey)) return { ok: false, error: "Event not found" };

  const trimmed = note.trim();

  if (!trimmed) {
    await db
      .delete(checkinNotes)
      .where(and(eq(checkinNotes.eventKey, eventKey), eq(checkinNotes.date, date), eq(checkinNotes.memberId, memberId)));
  } else {
    await db
      .insert(checkinNotes)
      .values({ eventKey, date, memberId, note: trimmed, actor: session.user.username })
      .onConflictDoUpdate({
        target: [checkinNotes.eventKey, checkinNotes.date, checkinNotes.memberId],
        set: { note: trimmed, actor: session.user.username, updatedAt: new Date() },
      });
  }

  revalidatePath("/checkin");
  return { ok: true };
}
