"use server";

import { revalidatePath } from "next/cache";
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { lootCategories, lootQueueEntries, lootRounds } from "@/db/schema";
import { requireAdmin } from "@/lib/authz";
import { memberDisplayName } from "@/lib/ui";
import { createChannelMessage } from "@/lib/discord";
import { computeNumberingStart, type LootQueueMemberRef } from "@/lib/loot-queue-data";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

function revalidateEverywhere() {
  revalidatePath("/loot-queue");
}

// --- Categories -------------------------------------------------------

export async function createLootCategory(name: string): Promise<ActionResult> {
  await requireAdmin();
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Please enter a category name" };

  const dup = await db.query.lootCategories.findFirst({ where: eq(lootCategories.name, trimmed) });
  if (dup) return { ok: false, error: "A category with this name already exists" };

  const [{ maxOrder } = { maxOrder: -1 }] = await db
    .select({ maxOrder: sql<number>`coalesce(max(${lootCategories.sortOrder}), -1)::int` })
    .from(lootCategories);

  await db.insert(lootCategories).values({ name: trimmed, sortOrder: maxOrder + 1 });
  revalidateEverywhere();
  return { ok: true };
}

export async function renameLootCategory(id: string, name: string): Promise<ActionResult> {
  await requireAdmin();
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Please enter a category name" };

  const dup = await db.query.lootCategories.findFirst({
    where: and(eq(lootCategories.name, trimmed), ne(lootCategories.id, id)),
  });
  if (dup) return { ok: false, error: "A category with this name already exists" };

  await db.update(lootCategories).set({ name: trimmed }).where(eq(lootCategories.id, id));
  revalidateEverywhere();
  return { ok: true };
}

export async function deleteLootCategory(id: string): Promise<ActionResult> {
  await requireAdmin();
  await db.delete(lootCategories).where(eq(lootCategories.id, id)); // cascades queue entries + round history
  revalidateEverywhere();
  return { ok: true };
}

/** Swaps sortOrder with the adjacent category — a no-op at either end. Same pattern as moveJobClass. */
export async function moveLootCategory(id: string, direction: "up" | "down"): Promise<ActionResult> {
  await requireAdmin();

  const all = await db.select().from(lootCategories).orderBy(asc(lootCategories.sortOrder));
  const idx = all.findIndex((c) => c.id === id);
  if (idx === -1) return { ok: false, error: "Category not found" };

  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= all.length) return { ok: true };

  const a = all[idx];
  const b = all[swapIdx];
  await db.update(lootCategories).set({ sortOrder: b.sortOrder }).where(eq(lootCategories.id, a.id));
  await db.update(lootCategories).set({ sortOrder: a.sortOrder }).where(eq(lootCategories.id, b.id));

  revalidateEverywhere();
  return { ok: true };
}

// --- Queue membership ---------------------------------------------------

/** Adds a member to the BACK of one category's queue. No-op error if already queued there. */
export async function addToLootQueue(categoryId: string, memberId: string): Promise<ActionResult> {
  await requireAdmin();

  const existing = await db.query.lootQueueEntries.findFirst({
    where: and(eq(lootQueueEntries.categoryId, categoryId), eq(lootQueueEntries.memberId, memberId)),
  });
  if (existing) return { ok: false, error: "This member is already in this category's queue" };

  const [{ maxPos } = { maxPos: -1 }] = await db
    .select({ maxPos: sql<number>`coalesce(max(${lootQueueEntries.position}), -1)::int` })
    .from(lootQueueEntries)
    .where(eq(lootQueueEntries.categoryId, categoryId));

  await db.insert(lootQueueEntries).values({ categoryId, memberId, position: maxPos + 1 });
  revalidateEverywhere();
  return { ok: true };
}

export async function removeFromLootQueue(categoryId: string, memberId: string): Promise<ActionResult> {
  await requireAdmin();
  await db
    .delete(lootQueueEntries)
    .where(and(eq(lootQueueEntries.categoryId, categoryId), eq(lootQueueEntries.memberId, memberId)));
  revalidateEverywhere();
  return { ok: true };
}

/** Swaps queue position with the adjacent member — for manual order corrections (not the normal "served" rotation, which runLootRound handles). */
export async function moveLootQueueEntry(
  categoryId: string,
  memberId: string,
  direction: "up" | "down"
): Promise<ActionResult> {
  await requireAdmin();

  const all = await db
    .select()
    .from(lootQueueEntries)
    .where(eq(lootQueueEntries.categoryId, categoryId))
    .orderBy(asc(lootQueueEntries.position));
  const idx = all.findIndex((e) => e.memberId === memberId);
  if (idx === -1) return { ok: false, error: "Member not found in queue" };

  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= all.length) return { ok: true };

  const a = all[idx];
  const b = all[swapIdx];
  await db.update(lootQueueEntries).set({ position: b.position }).where(eq(lootQueueEntries.id, a.id));
  await db.update(lootQueueEntries).set({ position: a.position }).where(eq(lootQueueEntries.id, b.id));

  revalidateEverywhere();
  return { ok: true };
}

/**
 * Jumps a member straight to a 1-indexed rank in the queue (typed in by the
 * admin) instead of walking there one ▲▼ swap at a time — the up/down
 * reorder above gets painfully slow on long queues (60+ people). Pulls the
 * member out and reinserts at the target rank, then re-stamps every
 * member's position to their new 0-indexed rank (positions aren't
 * necessarily contiguous beforehand, e.g. after addToLootQueue appends —
 * this also normalizes them along the way).
 */
export async function moveLootQueueEntryToPosition(
  categoryId: string,
  memberId: string,
  newRank: number
): Promise<ActionResult> {
  await requireAdmin();
  if (!Number.isInteger(newRank) || newRank < 1) return { ok: false, error: "Position must be an integer of 1 or greater" };

  return db.transaction(async (tx) => {
    const all = await tx
      .select()
      .from(lootQueueEntries)
      .where(eq(lootQueueEntries.categoryId, categoryId))
      .orderBy(asc(lootQueueEntries.position));
    const idx = all.findIndex((e) => e.memberId === memberId);
    if (idx === -1) return { ok: false, error: "Member not found in queue" };

    const targetIdx = Math.min(newRank - 1, all.length - 1);
    if (targetIdx === idx) return { ok: true };

    const [entry] = all.splice(idx, 1);
    all.splice(targetIdx, 0, entry);

    for (let i = 0; i < all.length; i++) {
      if (all[i].position !== i) {
        await tx.update(lootQueueEntries).set({ position: i }).where(eq(lootQueueEntries.id, all[i].id));
      }
    }

    revalidateEverywhere();
    return { ok: true };
  });
}

// --- Rounds ---------------------------------------------------------------

export interface RunRoundResult extends ActionResult {
  served?: LootQueueMemberRef[];
  /** True when fewer people were served than requested, because the queue ran out. */
  short?: boolean;
  /** The number the announcement's numbered list should start counting
   * from — normally 1, but a category linked via numberingBaseCategoryId
   * continues on from another category's latest round instead. */
  startNumber?: number;
}

/**
 * Serves the next `count` people in one category's queue: records a round
 * (for history + undo), then moves exactly those members to the back —
 * re-stamped to position = current-max+1, +2, ... in their served order —
 * leaving everyone else's position untouched. If the queue has fewer than
 * `count` members, serves everyone available (`short: true` tells the
 * caller so it can say so).
 */
export async function runLootRound(categoryId: string, count: number, label?: string): Promise<RunRoundResult> {
  const session = await requireAdmin();
  if (!Number.isInteger(count) || count <= 0) return { ok: false, error: "Number of people must be an integer greater than 0" };

  return db.transaction(async (tx) => {
    const queue = await tx
      .select({ entry: lootQueueEntries, member: lootQueueEntries.memberId })
      .from(lootQueueEntries)
      .where(eq(lootQueueEntries.categoryId, categoryId))
      .orderBy(asc(lootQueueEntries.position));
    if (queue.length === 0) return { ok: false, error: "This category's queue has no members" };

    const servedEntries = queue.slice(0, count).map((r) => r.entry);
    const short = servedEntries.length < count;

    // Computed BEFORE inserting this round's history row below, so it
    // doesn't count itself.
    const startNumber = (await computeNumberingStart(tx, categoryId)) + 1;

    const [{ maxPos } = { maxPos: -1 }] = await tx
      .select({ maxPos: sql<number>`coalesce(max(${lootQueueEntries.position}), -1)::int` })
      .from(lootQueueEntries)
      .where(eq(lootQueueEntries.categoryId, categoryId));

    for (let i = 0; i < servedEntries.length; i++) {
      await tx
        .update(lootQueueEntries)
        .set({ position: maxPos + 1 + i })
        .where(eq(lootQueueEntries.id, servedEntries[i].id));
    }

    await tx.insert(lootRounds).values({
      categoryId,
      label: label?.trim() || null,
      memberIds: servedEntries.map((e) => e.memberId),
      previousPositions: servedEntries.map((e) => e.position),
      actor: session.user.username,
    });

    const servedMembers = await tx.query.members.findMany({
      where: (m, { inArray }) =>
        inArray(
          m.id,
          servedEntries.map((e) => e.memberId)
        ),
    });
    const byId = new Map(servedMembers.map((m) => [m.id, m]));
    const served: LootQueueMemberRef[] = servedEntries
      .map((e) => byId.get(e.memberId))
      .filter((m): m is NonNullable<typeof m> => Boolean(m))
      .map((m) => ({ id: m.id, displayName: memberDisplayName(m), discordAvatar: m.discordAvatar }));

    revalidateEverywhere();
    return { ok: true, served, short, startNumber };
  });
}

/** Sets (or clears, with `baseCategoryId: null`) which other category's
 * numbering this one continues from — see computeNumberingStart. Rejects a
 * category linking to itself; doesn't otherwise guard against longer
 * cycles (A→B→A) since chasing that through isn't worth the complexity for
 * what's a two-category admin setting today. */
export async function setLootCategoryNumberingBase(
  categoryId: string,
  baseCategoryId: string | null
): Promise<ActionResult> {
  await requireAdmin();
  if (baseCategoryId === categoryId) return { ok: false, error: "A category cannot reference itself" };

  await db.update(lootCategories).set({ numberingBaseCategoryId: baseCategoryId }).where(eq(lootCategories.id, categoryId));
  revalidateEverywhere();
  return { ok: true };
}

/**
 * Reverses a round — but ONLY if it's still the most recent round run for
 * that category (checked here, not just trusted from the client), since
 * restoring saved `previousPositions` is only safe when nothing has moved
 * since. Anything served in that round moves back exactly where it was;
 * the round's history row is deleted.
 */
export async function undoLootRound(roundId: string): Promise<ActionResult> {
  await requireAdmin();

  return db.transaction(async (tx) => {
    const round = await tx.query.lootRounds.findFirst({ where: eq(lootRounds.id, roundId) });
    if (!round) return { ok: false, error: "Round not found (it may have been deleted)" };

    const [mostRecent] = await tx
      .select()
      .from(lootRounds)
      .where(eq(lootRounds.categoryId, round.categoryId))
      .orderBy(desc(lootRounds.createdAt))
      .limit(1);
    if (mostRecent?.id !== roundId) {
      return { ok: false, error: "Only the most recent round for this category can be undone — a newer round has already been run" };
    }

    for (let i = 0; i < round.memberIds.length; i++) {
      await tx
        .update(lootQueueEntries)
        .set({ position: round.previousPositions[i] })
        .where(and(eq(lootQueueEntries.categoryId, round.categoryId), eq(lootQueueEntries.memberId, round.memberIds[i])));
    }

    await tx.delete(lootRounds).where(eq(lootRounds.id, roundId));
    revalidateEverywhere();
    return { ok: true };
  });
}

/** Posts an already-composed message (built client-side from the round result — see the numbered-list format the guild already uses in Discord) to a channel via the bot. Kept generic (just content in, message id out) rather than re-deriving the text server-side, so the admin can tweak wording before posting. */
export async function postLootRoundMessage(channelId: string, content: string): Promise<ActionResult> {
  await requireAdmin();
  if (!content.trim()) return { ok: false, error: "Message is empty" };
  try {
    await createChannelMessage(channelId, content);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to post" };
  }
}

/** Removes a round from the history log only — for cleaning up e.g. a duplicate/test entry. Does NOT touch queue positions (use undoLootRound for that, and only while it's still the latest round). */
export async function deleteLootRoundHistory(roundId: string): Promise<ActionResult> {
  await requireAdmin();
  await db.delete(lootRounds).where(eq(lootRounds.id, roundId));
  revalidateEverywhere();
  return { ok: true };
}
