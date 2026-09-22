"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { members, membershipEvents, partyBoards, partyGroupParties, partyGroups, partySlots } from "@/db/schema";
import { requireAdmin } from "@/lib/authz";
import { isValidJobClassName } from "@/lib/job-classes";
import { normalizeAltClasses } from "@/lib/alt-classes";
import { cancelBoardOpenLeaves, cancelLeave, currentOccurrenceDate, requestLeave } from "@/lib/leaves";
import { getPartyBoardDetail } from "@/lib/party-data";
import { syncBoardEventLink } from "@/lib/board-link";
import { renderPartyBoardImage } from "@/lib/party-image";
import { createChannelMessageWithImage } from "@/lib/discord";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export interface ActionResultWithId extends ActionResult {
  id?: string;
}

/**
 * Where a member goes on a board. Leave v2: "busy" files a leave for the
 * board's current round (the member keeps their slot, shown faded);
 * "return" cancels that leave (slot untouched); "slot"/"unassigned" only
 * move the slot — except a slot move with `cancelLeave` (dragging someone
 * out of the ลา zone into a party), which does both.
 */
export type PartyDestination =
  | { type: "slot"; partyId: string; slotIndex: number; cancelLeave?: boolean }
  | { type: "busy" }
  | { type: "return" }
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
  // "GL" / "WOE" boards link to their check-in event by name.
  await syncBoardEventLink(inserted.id, trimmed);

  revalidatePath("/party");
  return { ok: true, id: inserted.id };
}

export async function deleteBoard(boardId: string): Promise<ActionResult> {
  const session = await requireAdmin();

  await db.transaction(async (tx) => {
    // Open (not-yet-ended) leaves on this board are cancelled with an audit
    // line; past ones stay counted. leaves.boardId is "set null" on this
    // FK, so the history survives the delete.
    await cancelBoardOpenLeaves(boardId, session.user.username, `(ลบกระดานโดยแอดมิน ${session.user.username})`, new Date(), tx);
    // membershipEvents.boardId is "set null" (not cascade) on this FK — see
    // schema.ts's comment — so the leave/attendance history logged against
    // this board survives the delete instead of being wiped along with it.
    await tx.delete(partyBoards).where(eq(partyBoards.id, boardId));
  });

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

  const existing = await db
    .select({ label: partyGroupParties.label, sortOrder: partyGroupParties.sortOrder })
    .from(partyGroupParties)
    .where(eq(partyGroupParties.groupId, groupId));

  const maxOrder = existing.reduce((m, p) => Math.max(m, p.sortOrder), -1);
  // Name the new party after the highest existing "Party N" number, not by
  // how many parties currently exist — counting was wrong the moment a party
  // got deleted from the middle: e.g. deleting "Party 2" out of 1/2/3 drops
  // the count to 2, so the next created party was named "Party 3" again,
  // colliding with the "Party 3" still sitting right there.
  const usedNumbers = existing
    .map((p) => /^Party (\d+)$/.exec(p.label)?.[1])
    .filter((n): n is string => Boolean(n))
    .map(Number);
  const nextNumber = (usedNumbers.length ? Math.max(...usedNumbers) : 0) + 1;

  const [inserted] = await db
    .insert(partyGroupParties)
    .values({ groupId, label: `Party ${nextNumber}`, sortOrder: maxOrder + 1 })
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
 * Moves a member on a board — see PartyDestination for what each target
 * means. A member can hold an independent slot on each board, but only one
 * slot within a given board. Leave state lives in the `leaves` table (one
 * row per member+board+round, see src/lib/leaves.ts) and is keyed by the
 * board's CURRENT round, so an admin marking someone ลา on Monday for GL
 * files it for Tuesday's round — the same row the member's own ห้องลา
 * request would have written.
 *
 * The slot clear + insert run as one transaction so a failure partway can't
 * leave the member half-moved.
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
  // Benched members are supposed to be cleared off every board (see
  // setMemberBenched) and never appear in a board's own lists — but the
  // client's list of pickable members can go stale (another admin benches
  // this member while this board is still open in a browser), and this is
  // the only real gate left once that happens. Removing them stays allowed.
  if (member.benched && destination.type !== "unassigned" && destination.type !== "return") {
    return { ok: false, error: "This member is currently benched and can't be placed on a party board" };
  }

  const board = await db.query.partyBoards.findFirst({ where: eq(partyBoards.id, boardId) });
  if (!board) return { ok: false, error: "Board not found" };
  const occurrenceDate = currentOccurrenceDate(board);
  const actor = session.user.username;

  if (destination.type === "busy") {
    await requestLeave({ memberId, boardId, occurrenceDate, source: "ADMIN", actor, detailSuffix: `โดยแอดมิน ${actor} (จากหน้าจัดปาร์ตี้)` });
    revalidatePath("/party");
    return { ok: true };
  }

  if (destination.type === "return") {
    await cancelLeave({ memberId, boardId, occurrenceDate, actor, detailSuffix: `โดยแอดมิน ${actor} (จากหน้าจัดปาร์ตี้)` });
    revalidatePath("/party");
    return { ok: true };
  }

  const partyIds = await getPartyIdsForBoard(boardId);
  // Defense-in-depth: the current UI always passes a partyId that actually
  // belongs to boardId, but a future caller passing a mismatched pair would
  // otherwise silently seat the member on a different board than the one
  // whose checks just ran above.
  if (destination.type === "slot" && !partyIds.includes(destination.partyId)) {
    return { ok: false, error: "That party doesn't belong to this board" };
  }

  await db.transaction(async (tx) => {
    // A per-slot "playing as" choice follows the member to their new slot
    // (and is dropped when they leave the board).
    let playingAs: string | null = null;
    if (partyIds.length) {
      const [prev] = await tx
        .select({ playingAs: partySlots.playingAs })
        .from(partySlots)
        .where(and(eq(partySlots.memberId, memberId), inArray(partySlots.partyId, partyIds)))
        .limit(1);
      playingAs = prev?.playingAs ?? null;
      await tx
        .update(partySlots)
        .set({ memberId: null, playingAs: null, updatedAt: new Date() })
        .where(and(eq(partySlots.memberId, memberId), inArray(partySlots.partyId, partyIds)));
    }
    if (destination.type === "slot") {
      await tx
        .insert(partySlots)
        .values({ partyId: destination.partyId, slotIndex: destination.slotIndex, memberId, playingAs })
        .onConflictDoUpdate({
          target: [partySlots.partyId, partySlots.slotIndex],
          set: { memberId, playingAs, updatedAt: new Date() },
        });
      if (destination.cancelLeave) {
        await cancelLeave({ memberId, boardId, occurrenceDate, actor, detailSuffix: `โดยแอดมิน ${actor} (จากหน้าจัดปาร์ตี้)` }, tx);
      }
    }
  });

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
  if (!existing) return { ok: false, error: "Member not found" };

  await db
    .update(members)
    .set({
      characterClass: finalClassName,
      // The new main class can't also be listed as a secondary one.
      altClasses: normalizeAltClasses(existing.altClasses, finalClassName),
      updatedAt: new Date(),
    })
    .where(eq(members.id, memberId));

  if (existing.characterClass !== finalClassName) {
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
    .set({ memberId: null, playingAs: null, updatedAt: new Date() })
    .where(and(eq(partySlots.partyId, partyId), eq(partySlots.slotIndex, slotIndex)));

  revalidatePath("/party");
  return { ok: true };
}

/**
 * Sets which of the occupant's classes they play in THIS slot — one of
 * their secondary classes, or null for their main class. Purely a board
 * choice: the member's profile (main/secondary classes) is untouched, so
 * fielding someone as their alt this week doesn't rewrite who they are.
 */
export async function setSlotPlayingAs(partyId: string, slotIndex: number, className: string | null): Promise<ActionResult> {
  await requireAdmin();

  const [slot] = await db
    .select({ id: partySlots.id, memberId: partySlots.memberId })
    .from(partySlots)
    .where(and(eq(partySlots.partyId, partyId), eq(partySlots.slotIndex, slotIndex)))
    .limit(1);
  if (!slot?.memberId) return { ok: false, error: "That slot is empty" };
  const member = await db.query.members.findFirst({ where: eq(members.id, slot.memberId) });
  if (!member) return { ok: false, error: "Member not found" };

  // null / their main class → main; otherwise must be one of their alts.
  const playingAs = !className || className === member.characterClass ? null : className;
  if (playingAs && !member.altClasses.includes(playingAs)) {
    return { ok: false, error: "That isn't one of this member's classes — set it on their profile or via the Discord class picker first" };
  }

  await db.update(partySlots).set({ playingAs, updatedAt: new Date() }).where(eq(partySlots.id, slot.id));
  revalidatePath("/party");
  return { ok: true };
}

/** Clears an entire board back to empty — every slot, and every open
 * (not-yet-ended) leave on it. Past leaves stay counted. */
export async function resetPartyBoard(boardId: string): Promise<ActionResult> {
  const session = await requireAdmin();

  const partyIds = await getPartyIdsForBoard(boardId);
  // One transaction — otherwise a failure between the two (e.g. a deploy
  // landing mid-request) leaves the board half-reset with no way to tell.
  await db.transaction(async (tx) => {
    if (partyIds.length) {
      await tx.delete(partySlots).where(inArray(partySlots.partyId, partyIds));
    }
    await cancelBoardOpenLeaves(boardId, session.user.username, `(ล้างกระดานโดยแอดมิน ${session.user.username})`, new Date(), tx);
  });

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
