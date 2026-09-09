"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { lootQueueEntries, members, membershipEvents, memberNotes, partyBusyEntries, partySlots } from "@/db/schema";
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
    return { ok: false, error: "Invalid class" };
  }
  const characterClass = characterClassRaw;

  const existing = await db.query.members.findFirst({ where: eq(members.id, memberId) });
  if (!existing) return { ok: false, error: "Member not found" };

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
    detail: `แก้ไขโปรไฟล์โดยแอดมิน ${session.user.username}`,
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
  if (!existing) return { ok: false, error: "Member not found" };

  await db
    .update(members)
    .set({ status: "KICKED", leftDiscordAt: new Date(), updatedAt: new Date() })
    .where(eq(members.id, memberId));
  await db
    .update(partySlots)
    .set({ memberId: null, updatedAt: new Date() })
    .where(eq(partySlots.memberId, memberId));
  await db.delete(partyBusyEntries).where(eq(partyBusyEntries.memberId, memberId));
  // Also drop them from every loot-queue category — otherwise their row
  // just sits there forever (the members row itself is never deleted, only
  // its status, so the table's onDelete: "cascade" never fires) and an
  // admin has to remove them by hand before running a round.
  await db.delete(lootQueueEntries).where(eq(lootQueueEntries.memberId, memberId));

  let discordWarning: string | undefined;
  try {
    await kickGuildMember(env.discordGuildId, existing.discordId, reason || undefined);
  } catch (err) {
    discordWarning =
      err instanceof DiscordApiError && err.status === 403
        ? "Status updated, but failed to kick from Discord — the bot lacks the \"Kick Members\" permission, or its role is below this member's role. Please kick them from Discord yourself."
        : `Status updated, but failed to kick from Discord (${err instanceof Error ? err.message : "unknown error"}). Please kick them from Discord yourself.`;
  }

  await db.insert(membershipEvents).values({
    memberId,
    type: "KICK",
    detail:
      (reason || `ทำเครื่องหมายว่าถูกเตะโดยแอดมิน ${session.user.username}`) +
      (discordWarning ? " (เตะออกจาก Discord ไม่สำเร็จ — ต้องทำเอง)" : ""),
    actor: session.user.username,
  });

  revalidatePath(`/members/${memberId}`);
  revalidatePath("/members");
  revalidatePath("/");
  revalidatePath("/party");
  revalidatePath("/loot-queue");

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
  if (!trimmed) return { ok: false, error: "Please enter a message" };
  if (trimmed.length > 1000) return { ok: false, error: "Message too long (maximum 1000 characters)" };

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
    detail: `เปลี่ยนสถานะกลับเป็น Active โดยแอดมิน ${session.user.username}`,
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
  if (!existing) return { ok: false, error: "Member not found" };

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
      ? `พักการเล่น (ไม่รวมในระบบจัดปาร์ตี้) โดยแอดมิน ${session.user.username}`
      : `เลิกพักการเล่น โดยแอดมิน ${session.user.username}`,
    actor: session.user.username,
  });

  revalidatePath(`/members/${memberId}`);
  revalidatePath("/members");
  revalidatePath("/");
  revalidatePath("/party");

  return { ok: true };
}

/**
 * Suspends a member from the loot auction queue guild-wide (every category
 * at once, not just one) for `days` days from now — e.g. for misbehavior
 * during a round. Enforced in runLootRound (src/app/actions/loot-queue.ts),
 * which skips a currently-banned member when picking who gets served
 * instead of removing them from the queue: their position holds exactly
 * where it is and they simply pick back up once the ban lapses, so no one
 * has to remember to re-add them. A repeat ban just overwrites the existing
 * one (extends or shortens it, admin's call) rather than stacking.
 */
export async function banMemberFromAuction(memberId: string, days: number, reason: string): Promise<UpdateMemberResult> {
  const session = await requireAdmin();
  if (!Number.isFinite(days) || days <= 0) return { ok: false, error: "Number of days must be greater than 0" };

  const existing = await db.query.members.findFirst({ where: eq(members.id, memberId) });
  if (!existing) return { ok: false, error: "Member not found" };

  const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const trimmedReason = reason.trim() || null;

  await db
    .update(members)
    .set({ auctionBanUntil: until, auctionBanReason: trimmedReason, updatedAt: new Date() })
    .where(eq(members.id, memberId));

  const daysLabel = days === 1 ? "1 day" : `${days} days`;
  await db.insert(membershipEvents).values({
    memberId,
    type: "AUCTION_BAN",
    detail: `ห้ามประมูล (ทุกหมวด) ${daysLabel} โดยแอดมิน ${session.user.username}${trimmedReason ? ` — เหตุผล: ${trimmedReason}` : ""} (ถึง ${until.toISOString()})`,
    actor: session.user.username,
  });

  revalidatePath(`/members/${memberId}`);
  revalidatePath("/members");
  revalidatePath("/loot-queue");

  return { ok: true };
}

/** Lifts an auction ban early. A ban that's already expired on its own doesn't need this — runLootRound and the queue display both just compare against now() — but this is here for "actually, never mind" before it lapses naturally. */
export async function unbanMemberFromAuction(memberId: string): Promise<UpdateMemberResult> {
  const session = await requireAdmin();

  const existing = await db.query.members.findFirst({ where: eq(members.id, memberId) });
  if (!existing) return { ok: false, error: "Member not found" };
  if (!existing.auctionBanUntil || existing.auctionBanUntil.getTime() <= Date.now()) {
    return { ok: false, error: "This member isn't currently banned" };
  }

  await db.update(members).set({ auctionBanUntil: new Date(), updatedAt: new Date() }).where(eq(members.id, memberId));

  await db.insert(membershipEvents).values({
    memberId,
    type: "AUCTION_UNBAN",
    detail: `ยกเลิกห้ามประมูลก่อนกำหนด โดยแอดมิน ${session.user.username}`,
    actor: session.user.username,
  });

  revalidatePath(`/members/${memberId}`);
  revalidatePath("/members");
  revalidatePath("/loot-queue");

  return { ok: true };
}
