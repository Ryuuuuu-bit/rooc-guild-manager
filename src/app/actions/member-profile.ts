"use server";

import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { memberNotes, membershipEvents } from "@/db/schema";
import { requireUser } from "@/lib/authz";

export interface QuickProfile {
  events: { id: string; type: string; detail: string | null; createdAt: string }[];
  /** Latest internal note — admins only (null for everyone else). */
  note: { body: string; author: string; createdAt: string } | null;
}

/** What the /members quick-profile drawer loads on open: the member's last
 * few log lines, plus the latest internal note for admins. */
export async function getMemberQuickProfile(memberId: string): Promise<QuickProfile> {
  const session = await requireUser();
  const events = await db
    .select({ id: membershipEvents.id, type: membershipEvents.type, detail: membershipEvents.detail, createdAt: membershipEvents.createdAt })
    .from(membershipEvents)
    .where(eq(membershipEvents.memberId, memberId))
    .orderBy(desc(membershipEvents.createdAt))
    .limit(6);
  let note: QuickProfile["note"] = null;
  if (session.user.isAdmin) {
    const [n] = await db.select().from(memberNotes).where(eq(memberNotes.memberId, memberId)).orderBy(desc(memberNotes.createdAt)).limit(1);
    if (n) note = { body: n.body, author: n.authorUsername, createdAt: n.createdAt.toISOString() };
  }
  return {
    events: events.map((e) => ({ id: e.id, type: e.type, detail: e.detail, createdAt: e.createdAt.toISOString() })),
    note,
  };
}
