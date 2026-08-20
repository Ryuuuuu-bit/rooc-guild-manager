"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { members, membershipEvents, partyBusyEntries, partySlots } from "@/db/schema";
import { requireAdmin } from "@/lib/authz";
import { CLASS_OPTIONS } from "@/lib/classes";

export interface UpdateMemberResult {
  ok: boolean;
  error?: string;
}

export async function updateMemberProfile(
  memberId: string,
  formData: FormData
): Promise<UpdateMemberResult> {
  const session = await requireAdmin();

  const inGameName = (formData.get("inGameName") as string | null)?.trim() || null;
  const characterClassRaw = (formData.get("characterClass") as string | null)?.trim() || null;
  const notes = (formData.get("notes") as string | null)?.trim() || null;

  if (characterClassRaw && !(CLASS_OPTIONS as readonly string[]).includes(characterClassRaw)) {
    return { ok: false, error: "Class ไม่ถูกต้อง" };
  }
  const characterClass = characterClassRaw;

  const existing = await db.query.members.findFirst({ where: eq(members.id, memberId) });
  if (!existing) return { ok: false, error: "ไม่พบสมาชิก" };

  await db
    .update(members)
    .set({
      inGameName,
      characterClass,
      notes,
      updatedAt: new Date(),
    })
    .where(eq(members.id, memberId));

  await db.insert(membershipEvents).values({
    memberId,
    type: "PROFILE_UPDATE",
    detail: `แก้ไขโปรไฟล์โดย ${session.user.username}`,
    actor: session.user.username,
  });

  revalidatePath(`/members/${memberId}`);
  revalidatePath("/members");
  revalidatePath("/");
  revalidatePath("/party");

  return { ok: true };
}

export async function markMemberKicked(memberId: string, reason: string): Promise<UpdateMemberResult> {
  const session = await requireAdmin();

  const existing = await db.query.members.findFirst({ where: eq(members.id, memberId) });
  if (!existing) return { ok: false, error: "ไม่พบสมาชิก" };

  await db
    .update(members)
    .set({ status: "KICKED", leftDiscordAt: new Date(), updatedAt: new Date() })
    .where(eq(members.id, memberId));
  await db
    .update(partySlots)
    .set({ memberId: null, updatedAt: new Date() })
    .where(eq(partySlots.memberId, memberId));
  await db.delete(partyBusyEntries).where(eq(partyBusyEntries.memberId, memberId));

  await db.insert(membershipEvents).values({
    memberId,
    type: "KICK",
    detail: reason || `ทำเครื่องหมายว่าถูกเตะโดย ${session.user.username}`,
    actor: session.user.username,
  });

  revalidatePath(`/members/${memberId}`);
  revalidatePath("/members");
  revalidatePath("/");
  revalidatePath("/party");

  return { ok: true };
}

export async function restoreMemberStatus(memberId: string): Promise<UpdateMemberResult> {
  const session = await requireAdmin();

  await db
    .update(members)
    .set({ status: "ACTIVE", leftDiscordAt: null, updatedAt: new Date() })
    .where(eq(members.id, memberId));

  await db.insert(membershipEvents).values({
    memberId,
    type: "NOTE",
    detail: `เปลี่ยนสถานะกลับเป็น Active โดย ${session.user.username}`,
    actor: session.user.username,
  });

  revalidatePath(`/members/${memberId}`);
  revalidatePath("/members");
  revalidatePath("/");
  revalidatePath("/party");

  return { ok: true };
}

/**
 * Flags a member as "benched" (still in Discord/holding the tracked role,
 * but not currently playing) or clears that flag. Independent of `status`
 * — the bot's role sync never touches this, only an admin can. Benching
 * someone clears them from every party board (they'd otherwise vanish from
 * the unassigned pool but leave a dangling slot/busy-entry reference).
 */
export async function setMemberBenched(memberId: string, benched: boolean): Promise<UpdateMemberResult> {
  const session = await requireAdmin();

  const existing = await db.query.members.findFirst({ where: eq(members.id, memberId) });
  if (!existing) return { ok: false, error: "ไม่พบสมาชิก" };

  await db.update(members).set({ benched, updatedAt: new Date() }).where(eq(members.id, memberId));

  if (benched) {
    await db
      .update(partySlots)
      .set({ memberId: null, updatedAt: new Date() })
      .where(eq(partySlots.memberId, memberId));
    await db.delete(partyBusyEntries).where(eq(partyBusyEntries.memberId, memberId));
  }

  await db.insert(membershipEvents).values({
    memberId,
    type: "NOTE",
    detail: benched
      ? `พักการเล่น (ไม่รวมในระบบจัดปาตี้) โดย ${session.user.username}`
      : `เลิกพักการเล่น โดย ${session.user.username}`,
    actor: session.user.username,
  });

  revalidatePath(`/members/${memberId}`);
  revalidatePath("/members");
  revalidatePath("/");
  revalidatePath("/party");

  return { ok: true };
}
