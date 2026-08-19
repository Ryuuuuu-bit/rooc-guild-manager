"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { members, partyBusyEntries, partyLeaders, partySlots } from "@/db/schema";
import { requireAdmin } from "@/lib/authz";
import { CLASS_OPTIONS } from "@/lib/classes";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export type PartyDestination =
  | { type: "slot"; section: "MAIN" | "SUB"; partyNumber: number; slotIndex: number }
  | { type: "busy" }
  | { type: "unassigned" };

function isValidClassName(className: string | null | undefined): className is string {
  return Boolean(className) && (CLASS_OPTIONS as readonly string[]).includes(className!);
}

/**
 * Moves a member to a new place on the party board (a slot, the "busy"
 * list, or back out to the unassigned pool) — clearing them from wherever
 * they currently sit first, since a member can only be in one place at a
 * time. Powers drag-and-drop on the /party page.
 */
export async function moveMember(
  memberId: string,
  destination: PartyDestination,
  className?: string | null
): Promise<ActionResult> {
  await requireAdmin();

  const member = await db.query.members.findFirst({ where: eq(members.id, memberId) });
  if (!member || member.status !== "ACTIVE") {
    return { ok: false, error: "ไม่พบสมาชิก หรือสมาชิกไม่ได้อยู่ในกิลด์แล้ว" };
  }

  // Remember their previous class assignment (if any) so moving a member
  // between slots doesn't forget which class they were playing.
  const [prevSlot] = await db
    .select({ className: partySlots.className })
    .from(partySlots)
    .where(eq(partySlots.memberId, memberId));
  const [prevBusy] = await db
    .select({ className: partyBusyEntries.className })
    .from(partyBusyEntries)
    .where(eq(partyBusyEntries.memberId, memberId));
  const carriedClassName = prevSlot?.className ?? prevBusy?.className ?? null;
  const resolvedClassName = className !== undefined ? className : carriedClassName;
  const finalClassName = isValidClassName(resolvedClassName) ? resolvedClassName : null;

  // Clear from wherever they currently are.
  await db
    .update(partySlots)
    .set({ memberId: null, className: null, updatedAt: new Date() })
    .where(eq(partySlots.memberId, memberId));
  await db.delete(partyBusyEntries).where(eq(partyBusyEntries.memberId, memberId));

  if (destination.type === "slot") {
    const { section, partyNumber, slotIndex } = destination;
    await db
      .insert(partySlots)
      .values({
        section,
        partyNumber,
        slotIndex,
        memberId,
        className: finalClassName,
      })
      .onConflictDoUpdate({
        target: [partySlots.section, partySlots.partyNumber, partySlots.slotIndex],
        set: { memberId, className: finalClassName, updatedAt: new Date() },
      });
  } else if (destination.type === "busy") {
    const [{ maxOrder } = { maxOrder: 0 }] = await db
      .select({ maxOrder: sql<number>`coalesce(max(${partyBusyEntries.sortOrder}), 0)::int` })
      .from(partyBusyEntries);
    await db.insert(partyBusyEntries).values({
      memberId,
      className: finalClassName,
      sortOrder: maxOrder + 1,
    });
  }
  // destination.type === "unassigned": nothing further to do, already cleared.

  revalidatePath("/party");
  return { ok: true };
}

/** Updates just the class shown for a member already placed on the board, without moving them. */
export async function setMemberClass(memberId: string, className: string | null): Promise<ActionResult> {
  await requireAdmin();

  const finalClassName = isValidClassName(className) ? className : null;

  await db
    .update(partySlots)
    .set({ className: finalClassName, updatedAt: new Date() })
    .where(eq(partySlots.memberId, memberId));
  await db
    .update(partyBusyEntries)
    .set({ className: finalClassName })
    .where(eq(partyBusyEntries.memberId, memberId));

  revalidatePath("/party");
  return { ok: true };
}

/** Clears whatever slot currently sits at this position (if occupied). */
export async function clearSlot(
  section: "MAIN" | "SUB",
  partyNumber: number,
  slotIndex: number
): Promise<ActionResult> {
  await requireAdmin();

  await db
    .update(partySlots)
    .set({ memberId: null, className: null, updatedAt: new Date() })
    .where(
      and(
        eq(partySlots.section, section),
        eq(partySlots.partyNumber, partyNumber),
        eq(partySlots.slotIndex, slotIndex)
      )
    );

  revalidatePath("/party");
  return { ok: true };
}

/** Sets the display name for one of the two Sub Stage leader groups. */
export async function setLeaderName(leaderGroup: 1 | 2, name: string): Promise<ActionResult> {
  await requireAdmin();

  const trimmed = name.trim() || null;
  await db
    .insert(partyLeaders)
    .values({ leaderGroup, name: trimmed })
    .onConflictDoUpdate({
      target: partyLeaders.leaderGroup,
      set: { name: trimmed, updatedAt: new Date() },
    });

  revalidatePath("/party");
  return { ok: true };
}

/** Clears the entire board back to empty — every slot and the busy list. */
export async function resetPartyBoard(): Promise<ActionResult> {
  await requireAdmin();

  await db.delete(partySlots);
  await db.delete(partyBusyEntries);

  revalidatePath("/party");
  return { ok: true };
}
