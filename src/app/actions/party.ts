"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { members, membershipEvents, partyBoards, partyBusyEntries, partyGroupParties, partyGroups, partySlots } from "@/db/schema";
import { requireAdmin } from "@/lib/authz";
import { isValidJobClassName } from "@/lib/job-classes";
import { getPartyBoardDetail } from "@/lib/party-data";
import { renderPartyBoardImage } from "@/lib/party-image";
import { createChannelMessageWithImage } from "@/lib/discord";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export interface ActionResultWithId extends ActionResult {
  id?: string;
}

export type PartyDestination =
  | { type: "slot"; partyId: string; slotIndex: number }
  | { type: "busy" }
  | { type: "unassigned" };

/** All party (group_parties) ids belonging to a board, via its groups. */
async function getPartyIdsForBoard(boardId: string): Promise<string[]> {
  const groups = await db
    .select({ id: partyGroups.id })
    .from(partyGroups)
    .where(eq(partyGroups.boardId, boardId));
  const groupIds = groups.map((g) => g.id);
  if (!groupIds.length) return [];
  const parties = await db
    .select({ id: partyGroupParties.id })
    .from(partyGroupParties)
    .where(inArray(partyGroupParties.groupId, groupIds));
  return parties.map((p) => p.id);
}

// --- Board management ---

export async function createBoard(name: string): Promise<ActionResultWithId> {
  await requireAdmin();
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Please enter a board name" };

  const [{ maxOrder } = { maxOrder: -1 }] = await db
    .select({ maxOrder: sql<number>`coalesce(max(${partyBoards.sortOrder}), -1)::int` })
    .from(partyBoards);

  const [inserted] = await db
    .insert(partyBoards)
    .values({ name: trimmed, sortOrder: maxOrder + 1 })
    .returning({ id: partyBoards.id });

  revalidatePath("/party");
  return { ok: true, id: inserted.id };
}

export async function renameBoard(boardId: string, name: string): Promise<ActionResult> {
  await requireAdmin();
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Please enter a board name" };

  await db.update(partyBoards).set({ name: trimmed, updatedAt: new Date() }).where(eq(partyBoards.id, boardId));
  revalidatePath("/party");
  return { ok: true };
}

export async function deleteBoard(boardId: string): Promise<ActionResult> {
  await requireAdmin();
  await db.delete(partyBoards).where(eq(partyBoards.id, boardId));
  revalidatePath("/party");
  return { ok: true };
}

// --- Group management ---

export async function createGroup(boardId: string, name: string): Promise<ActionResultWithId> {
  await requireAdmin();
  const trimmed = name.trim() || "New Group";

  const [{ maxOrder } = { maxOrder: -1 }] = await db
    .select({ maxOrder: sql<number>`coalesce(max(${partyGroups.sortOrder}), -1)::int` })
    .from(partyGroups)
    .where(eq(partyGroups.boardId, boardId));

  const [inserted] = await db
    .insert(partyGroups)
    .values({ boardId, name: trimmed, sortOrder: maxOrder + 1 })
    .returning({ id: partyGroups.id });

  revalidatePath("/party");
  return { ok: true, id: inserted.id };
}

export async function renameGroup(groupId: string, name: string): Promise<ActionResult> {
  await requireAdmin();
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Please enter a group name" };

  await db.update(partyGroups).set({ name: trimmed, updatedAt: new Date() }).where(eq(partyGroups.id, groupId));
  revalidatePath("/party");
  return { ok: true };
}

export async function deleteGroup(groupId: string): Promise<ActionResult> {
  await requireAdmin();
  await db.delete(partyGroups).where(eq(partyGroups.id, groupId));
  revalidatePath("/party");
  return { ok: true };
}

// --- Party (within a group) management ---

export async function createParty(groupId: string): Promise<ActionResultWithId> {
  await requireAdmin();

  const [{ maxOrder, partyCount } = { maxOrder: -1, partyCount: 0 }] = await db
    .select({
      maxOrder: sql<number>`coalesce(max(${partyGroupParties.sortOrder}), -1)::int`,
      partyCount: sql<number>`count(*)::int`,
    })
    .from(partyGroupParties)
    .where(eq(partyGroupParties.groupId, groupId));

  const [inserted] = await db
    .insert(partyGroupParties)
    .values({ groupId, label: `Party ${partyCount + 1}`, sortOrder: maxOrder + 1 })
    .returning({ id: partyGroupParties.id });

  revalidatePath("/party");
  return { ok: true, id: inserted.id };
}

export async function deleteParty(partyId: string): Promise<ActionResult> {
  await requireAdmin();
  await db.delete(partyGroupParties).where(eq(partyGroupParties.id, partyId));
  revalidatePath("/party");
  return { ok: true };
}

// --- Member placement (scoped per board) ---

/**
 * Moves a member to a new place on a board (a slot, the "busy" list, or
 * back out to the unassigned pool) — clearing them from wherever they
 * currently sit on THIS board first (a member can hold an independent spot
 * on each board, but only one place within a given board). A member's class
 * is a profile-level attribute (see setMemberClass), not part of this move.
 */
export async function moveMember(
  boardId: string,
  memberId: string,
  destination: PartyDestination
): Promise<ActionResult> {
  const session = await requireAdmin();

  const member = await db.query.members.findFirst({ where: eq(members.id, memberId) });
  if (!member || member.status !== "ACTIVE") {
    return { ok: false, error: "Member not found, or they are no longer in the guild" };
  }

  // Checked before clearing below, so we know whether this move is a ลา (→
  // busy, wasn't already), a return (busy → elsewhere), or neither — used
  // to log ATTENDANCE_LEAVE/ATTENDANCE_RETURN only on an actual transition.
  const wasBusy = await db.query.partyBusyEntries.findFirst({
    where: and(eq(partyBusyEntries.boardId, boardId), eq(partyBusyEntries.memberId, memberId)),
  });

  const partyIds = await getPartyIdsForBoard(boardId);

  if (partyIds.length) {
    await db
      .update(partySlots)
      .set({ memberId: null, updatedAt: new Date() })
      .where(and(eq(partySlots.memberId, memberId), inArray(partySlots.partyId, partyIds)));
  }
  await db
    .delete(partyBusyEntries)
    .where(and(eq(partyBusyEntries.boardId, boardId), eq(partyBusyEntries.memberId, memberId)));

  if (destination.type === "busy" && !wasBusy) {
    const board = await db.query.partyBoards.findFirst({ where: eq(partyBoards.id, boardId) });
    await db.insert(membershipEvents).values({
      memberId,
      type: "ATTENDANCE_LEAVE",
      detail: `ลาในกระดาน "${board?.name ?? boardId}" โดยแอดมิน ${session.user.username}`,
      actor: session.user.username,
      // Without this, an admin-added ลา has no board attached to its
      // audit-log row — it still shows up in the board's own busy list
      // (partyBusyEntries always has boardId), but /attendance's per-board
      // breakdown dumps it in "ไม่ระบุกระดาน" and /checkin's "who's on
      // leave" lookup can't find it at all (both read membershipEvents.
      // boardId, not partyBusyEntries). Found via two real members an
      // admin had marked ลา manually not showing up in either place.
      boardId,
    });
  } else if (destination.type !== "busy" && wasBusy) {
    const board = await db.query.partyBoards.findFirst({ where: eq(partyBoards.id, boardId) });
    await db.insert(membershipEvents).values({
      memberId,
      type: "ATTENDANCE_RETURN",
      detail: `ยกเลิกลาในกระดาน "${board?.name ?? boardId}" โดยแอดมิน ${session.user.username}`,
      actor: session.user.username,
      boardId,
    });
  }

  if (destination.type === "slot") {
    await db
      .insert(partySlots)
      .values({
        partyId: destination.partyId,
        slotIndex: destination.slotIndex,
        memberId,
      })
      .onConflictDoUpdate({
        target: [partySlots.partyId, partySlots.slotIndex],
        set: { memberId, updatedAt: new Date() },
      });
  } else if (destination.type === "busy") {
    const [{ maxOrder } = { maxOrder: 0 }] = await db
      .select({ maxOrder: sql<number>`coalesce(max(${partyBusyEntries.sortOrder}), 0)::int` })
      .from(partyBusyEntries)
      .where(eq(partyBusyEntries.boardId, boardId));
    await db.insert(partyBusyEntries).values({
      boardId,
      memberId,
      sortOrder: maxOrder + 1,
    });
  }

  revalidatePath("/party");
  return { ok: true };
}

/**
 * Sets a member's class (job). This is a profile-level attribute (stored on
 * `members.characterClass`), shared across every board/party/slot the
 * member appears in — so picking it once from any party slot keeps it in
 * sync everywhere, including the member's own profile page.
 */
export async function setMemberClass(memberId: string, className: string | null): Promise<ActionResult> {
  const session = await requireAdmin();

  const finalClassName = className && (await isValidJobClassName(className)) ? className : null;
  if (className && !finalClassName) return { ok: false, error: "Invalid class" };

  const existing = await db.query.members.findFirst({ where: eq(members.id, memberId) });

  await db
    .update(members)
    .set({ characterClass: finalClassName, updatedAt: new Date() })
    .where(eq(members.id, memberId));

  if (existing && existing.characterClass !== finalClassName) {
    await db.insert(membershipEvents).values({
      memberId,
      type: "CLASS_CHANGE",
      detail: finalClassName
        ? `เปลี่ยนอาชีพเป็น ${finalClassName} โดยแอดมิน ${session.user.username} (จากหน้าจัดปาร์ตี้)`
        : `ล้างอาชีพโดยแอดมิน ${session.user.username} (จากหน้าจัดปาร์ตี้)`,
      actor: session.user.username,
    });
  }

  revalidatePath("/party");
  revalidatePath(`/members/${memberId}`);
  revalidatePath("/members");
  return { ok: true };
}

/** Clears whatever slot currently sits at this position (if occupied). */
export async function clearSlot(partyId: string, slotIndex: number): Promise<ActionResult> {
  await requireAdmin();

  await db
    .update(partySlots)
    .set({ memberId: null, updatedAt: new Date() })
    .where(and(eq(partySlots.partyId, partyId), eq(partySlots.slotIndex, slotIndex)));

  revalidatePath("/party");
  return { ok: true };
}

/** Clears an entire board back to empty — every slot and its busy list. */
export async function resetPartyBoard(boardId: string): Promise<ActionResult> {
  await requireAdmin();

  const partyIds = await getPartyIdsForBoard(boardId);
  if (partyIds.length) {
    await db.delete(partySlots).where(inArray(partySlots.partyId, partyIds));
  }
  await db.delete(partyBusyEntries).where(eq(partyBusyEntries.boardId, boardId));

  revalidatePath("/party");
  return { ok: true };
}

/**
 * Renders the board's CURRENT full layout (every group, every party, every
 * slot — see renderPartyBoardImage) as a PNG and posts it to a Discord
 * channel via the bot, so "จัดปาร์ตี้เสร็จแล้ว" can be announced as an
 * actual picture instead of admins typing out the roster by hand. Re-reads
 * the board fresh rather than trusting client-side state, so what gets
 * posted always matches what's actually saved.
 */
export async function announcePartyBoardImage(boardId: string, channelId: string): Promise<ActionResult> {
  await requireAdmin();
  if (!channelId) return { ok: false, error: "Please select a channel" };

  const board = await getPartyBoardDetail(boardId);
  if (!board) return { ok: false, error: "Board not found" };

  try {
    const image = renderPartyBoardImage(board);
    const dateStr = new Date().toLocaleString("th-TH", {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: "Asia/Bangkok",
    });
    await createChannelMessageWithImage(
      channelId,
      `📋 ผังปาร์ตี้ล่าสุด — **${board.name}** (${dateStr})`,
      image,
      "party-board.png"
    );
    // Remembered so the picker defaults to this channel next time instead
    // of making the admin re-pick the same channel every announcement.
    await db.update(partyBoards).set({ lastImageAnnounceChannelId: channelId }).where(eq(partyBoards.id, boardId));
    revalidatePath("/party");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to post." };
  }
}
