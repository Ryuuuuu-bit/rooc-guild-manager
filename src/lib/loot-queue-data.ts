import { and, asc, desc, eq, gt, inArray } from "drizzle-orm";
import { db } from "@/db";
import { lootCategories, lootQueueEntries, lootRounds, members } from "@/db/schema";
import { memberDisplayName } from "@/lib/ui";
import type { Member } from "@/db/schema";

export interface LootQueueMemberRef {
  id: string;
  displayName: string;
  discordAvatar: string | null;
}

export interface LootCategoryView {
  id: string;
  name: string;
  sortOrder: number;
  queue: LootQueueMemberRef[];
  /** When set, this category's round-result numbering continues from
   * wherever the linked category's most recent round left off, instead of
   * starting fresh at 1 — see computeNumberingStart below. */
  numberingBaseCategoryId: string | null;
}

function toRef(m: Member): LootQueueMemberRef {
  return { id: m.id, displayName: memberDisplayName(m), discordAvatar: m.discordAvatar };
}

/** Every loot category with its current queue, in order. Categories sorted
 * by sortOrder (admin-arranged, see moveLootCategory); each queue sorted by
 * position ascending — first entry is "next up" for that category. */
export async function listLootCategories(): Promise<LootCategoryView[]> {
  const categories = await db.select().from(lootCategories).orderBy(asc(lootCategories.sortOrder));
  if (categories.length === 0) return [];

  const entries = await db
    .select({ entry: lootQueueEntries, member: members })
    .from(lootQueueEntries)
    .innerJoin(members, eq(lootQueueEntries.memberId, members.id))
    .where(
      inArray(
        lootQueueEntries.categoryId,
        categories.map((c) => c.id)
      )
    )
    .orderBy(asc(lootQueueEntries.categoryId), asc(lootQueueEntries.position));

  const queueByCategory = new Map<string, LootQueueMemberRef[]>();
  for (const { entry, member } of entries) {
    const list = queueByCategory.get(entry.categoryId) ?? [];
    list.push(toRef(member));
    queueByCategory.set(entry.categoryId, list);
  }

  return categories.map((c) => ({
    id: c.id,
    name: c.name,
    sortOrder: c.sortOrder,
    queue: queueByCategory.get(c.id) ?? [],
    numberingBaseCategoryId: c.numberingBaseCategoryId,
  }));
}

/** Either the module-level `db`, or the `tx` handed to a `db.transaction`
 * callback — computeNumberingStart is called from inside runLootRound's
 * transaction, so it needs to run its reads against that same tx (seeing
 * the "before this round" state consistently), not a separate connection. */
type DbOrTx = typeof db | Parameters<Parameters<(typeof db)["transaction"]>[0]>[0];

/**
 * Works out what number a category's NEXT round-result announcement should
 * start counting from. Categories with no `numberingBaseCategoryId` linked
 * just start at 1 (returns offset 0 — the caller adds 1). A linked category
 * (e.g. "ขนนกหลากสี" linked to "ขนนกขาว") continues from wherever the
 * linked category's most recent round left off, plus anything already
 * served in THIS category since that round — so running this category
 * several times in a row keeps climbing, and it resets the moment the
 * linked category's own round is run again (a fresh "since" boundary).
 */
export async function computeNumberingStart(executor: DbOrTx, categoryId: string): Promise<number> {
  const [category] = await executor.select().from(lootCategories).where(eq(lootCategories.id, categoryId));
  if (!category?.numberingBaseCategoryId) return 0;

  const [latestBaseRound] = await executor
    .select()
    .from(lootRounds)
    .where(eq(lootRounds.categoryId, category.numberingBaseCategoryId))
    .orderBy(desc(lootRounds.createdAt))
    .limit(1);

  const baseOffset = latestBaseRound?.memberIds.length ?? 0;
  const sinceTime = latestBaseRound?.createdAt;

  const ownRounds = await executor
    .select()
    .from(lootRounds)
    .where(
      sinceTime
        ? and(eq(lootRounds.categoryId, categoryId), gt(lootRounds.createdAt, sinceTime))
        : eq(lootRounds.categoryId, categoryId)
    );
  const ownSum = ownRounds.reduce((sum, r) => sum + r.memberIds.length, 0);

  return baseOffset + ownSum;
}

export interface LootRoundView {
  id: string;
  label: string | null;
  actor: string | null;
  createdAt: Date;
  /** Served members, in served order — a best-effort join against the
   * CURRENT members table; a member removed from the guild since then just
   * doesn't get a name here (their id stays in the historical record). */
  members: LootQueueMemberRef[];
}

/** Most recent rounds run for one category, newest first — the history log shown under that category's queue manager. */
export async function listLootRounds(categoryId: string, limit = 20): Promise<LootRoundView[]> {
  const rounds = await db
    .select()
    .from(lootRounds)
    .where(eq(lootRounds.categoryId, categoryId))
    .orderBy(desc(lootRounds.createdAt))
    .limit(limit);
  if (rounds.length === 0) return [];

  const allMemberIds = [...new Set(rounds.flatMap((r) => r.memberIds))];
  const memberRows = allMemberIds.length
    ? await db.select().from(members).where(inArray(members.id, allMemberIds))
    : [];
  const memberById = new Map(memberRows.map((m) => [m.id, toRef(m)]));

  return rounds.map((r) => ({
    id: r.id,
    label: r.label,
    actor: r.actor,
    createdAt: r.createdAt,
    members: r.memberIds.map((id) => memberById.get(id)).filter((m): m is LootQueueMemberRef => Boolean(m)),
  }));
}
