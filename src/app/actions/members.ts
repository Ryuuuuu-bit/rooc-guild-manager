"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { members, membershipEvents, memberNotes, partyBusyEntries, partySlots } from "@/db/schema";
import { requireAdmin } from "@/lib/authz";
import { isValidJobClassName } from "@/lib/job-classes";
import { env } from "@/lib/env";
import { DiscordApiError, kickGuildMember } from "@/lib/discord";

export interface UpdateMemberResult {
  ok: boolean;
  error?: string;
  /** Set when the primary action succeeded but a secondary side-effect
   * (e.g. the actual Discord kick) didn't — shown as a softer, non-red
   * notice since the app's own state is still correct. */
  warning?: string;
}

export async function updateMemberProfile(
  memberId: string,
  formData: FormData
): Promise<UpdateMemberResult> {
  const session = await requireAdmin();

  const inGameName = (formData.get("inGameName") as string | null)?.trim() || null;
  const characterClassRaw = (formData.get("characterClass") as string | null)?.trim() || null;
  const notes = (formData.get("notes") as string | null)?.trim() || null;

  if (characterClassRaw && !(await isValidJobClassName(characterClassRaw))) {
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

  // Class changes get their own event type (see schema's eventTypeEnum) so
  // they're a distinct, filterable row in the activity feed regardless of
  // which admin surface (here, the party board's per-slot dropdown, or the
  // Sheet sync tool) made the change.
  if (existing.characterClass !== characterClass) {
    await db.insert(membershipEvents).values({
      memberId,
      type: "CLASS_CHANGE",
      detail: characterClass
        ? `เปลี่ยนอาชีพเป็น ${characterClass} โดยแอดมิน ${session.user.username}`
        : `ล้างอาชีพโดยแอดมิน ${session.user.username}`,
      actor: session.user.username,
    });
  }

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

/**
 * Kicks a member: marks them KICKED in the app (clearing them off every
 * party board) AND actually removes them from the Discord server via the
 * bot. The Discord removal is best-effort — if the bot lacks the "Kick
 * Members" permission or its role sits below the target's highest role,
 * the in-app status change still goes through, but the caller gets back a
 * `warning` explaining that the person is still in Discord and needs to be
 * removed manually there.
 */
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

  let discordWarning: string | undefined;
  try {
    await kickGuildMember(env.discordGuildId, existing.discordId, reason || undefined);
  } catch (err) {
    discordWarning =
      err instanceof DiscordApiError && err.status === 403
        ? "อัปเดตสถานะในระบบแล้ว แต่เตะออกจาก Discord ไม่สำเร็จ — บอทไม่มีสิทธิ์ \"Kick Members\" หรือ role บอทต่ำกว่า role ของสมาชิกคนนี้ กรุณาเตะออกจาก Discord ด้วยตัวเอง"
        : `อัปเดตสถานะในระบบแล้ว แต่เตะออกจาก Discord ไม่สำเร็จ (${err instanceof Error ? err.message : "unknown error"}) กรุณาเตะออกจาก Discord ด้วยตัวเอง`;
  }

  await db.insert(membershipEvents).values({
    memberId,
    type: "KICK",
    detail:
      (reason || `ทำเครื่องหมายว่าถูกเตะโดย ${session.user.username}`) +
      (discordWarning ? " (เตะออกจาก Discord ไม่สำเร็จ — ต้องทำเอง)" : ""),
    actor: session.user.username,
  });

  revalidatePath(`/members/${memberId}`);
  revalidatePath("/members");
  revalidatePath("/");
  revalidatePath("/party");

  return discordWarning ? { ok: true, warning: discordWarning } : { ok: true };
}

/**
 * Adds a timestamped internal comment to a member (e.g. "AFK ใน GVG 20/8").
 * Admin-only to write AND to read — kept in its own table rather than
 * mixed into the membershipEvents audit feed, since that feed is shown
 * more broadly and these notes are meant to stay private to admins.
 */
export async function addMemberNote(memberId: string, body: string): Promise<UpdateMemberResult> {
  const session = await requireAdmin();

  const trimmed = body.trim();
  if (!trimmed) return { ok: false, error: "กรุณากรอกข้อความ" };
  if (trimmed.length > 1000) return { ok: false, error: "ข้อความยาวเกินไป (สูงสุด 1000 ตัวอักษร)" };

  await db.insert(memberNotes).values({
    memberId,
    body: trimmed,
    authorUsername: session.user.username,
  });

  revalidatePath(`/members/${memberId}`);
  return { ok: true };
}

export async function deleteMemberNote(noteId: string, memberId: string): Promise<UpdateMemberResult> {
  await requireAdmin();
  await db.delete(memberNotes).where(eq(memberNotes.id, noteId));
  revalidatePath(`/members/${memberId}`);
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
