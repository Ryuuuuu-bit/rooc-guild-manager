import { asc, desc, eq, inArray } from "drizzle-orm";
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
  }));
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
