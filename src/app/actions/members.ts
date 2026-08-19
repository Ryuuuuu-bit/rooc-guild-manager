"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { members, membershipEvents, partyBusyEntries, partySlots } from "@/db/schema";
import { requireAdmin } from "@/lib/authz";

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
  const characterClass = (formData.get("characterClass") as string | null)?.trim() || null;
  const levelRaw = (formData.get("level") as string | null)?.trim();
  const level = levelRaw ? Number(levelRaw) : null;
  const notes = (formData.get("notes") as string | null)?.trim() || null;

  if (level !== null && (Number.isNaN(level) || level < 0 || level > 9999)) {
    return { ok: false, error: "เลเวลไม่ถูกต้อง" };
  }

  const existing = await db.query.members.findFirst({ where: eq(members.id, memberId) });
  if (!existing) return { ok: false, error: "ไม่พบสมาชิก" };

  await db
    .update(members)
    .set({
      inGameName,
      characterClass,
      level,
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
    .set({ memberId: null, className: null, updatedAt: new Date() })
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
