import { and, asc, desc, eq, gt, inArray } from "drizzle-orm";
import { db } from "@/db";
import { lootCategories, lootQueueEntries, lootRounds, members } from "@/db/schema";
import { memberDisplayName, isCurrentlyAuctionBanned } from "@/lib/ui";
import { CHECKIN_EVENTS, lastOccurrenceEnd, nextOccurrenceDate, windowFor } from "@/lib/checkin-events";
import type { Member } from "@/db/schema";

export interface LootQueueMemberRef {
  id: string;
  /** For the "tag everyone" copy format (<@discordId>). */
  discordId: string;
  /** Benched members keep their place but are passed over in a round,
   * exactly like an auction ban (see runLootRound). */
  benched: boolean;
  displayName: string;
  discordAvatar: string | null;
  /** Kept for display (exact expiry in tooltips) — a PAST timestamp here
   * means a ban exists on record but has already lapsed. Don't compare this
   * against `Date.now()` in a client component's render: calling Date.now()
   * during render is impure (React flags it, and it risks a hydration
   * mismatch). Use `isAuctionBanned` below instead, which is computed once
   * server-side per request. */
  auctionBanUntil: Date | null;
  /** Whether this member is banned from the auction queue *right now* —
   * computed server-side (see toRef) so client components never need to
   * call Date.now() themselves during render. */
  isAuctionBanned: boolean;
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
  /** The most recent round run for this category, if any. */
  lastRound: { label: string | null; createdAt: Date; count: number } | null;
  /** What the NEXT round's numbered list would start at (see computeNumberingStart). */
  nextStartNumber: number;
}

export function toRef(m: Member): LootQueueMemberRef {
  return {
    id: m.id,
    discordId: m.discordId,
    benched: m.benched,
    displayName: memberDisplayName(m),
    discordAvatar: m.discordAvatar,
    auctionBanUntil: m.auctionBanUntil,
    isAuctionBanned: isCurrentlyAuctionBanned(m),
  };
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

  // Latest round per category (one small query; DISTINCT ON keeps just the newest row each).
  const latest = await db
    .selectDistinctOn([lootRounds.categoryId], { categoryId: lootRounds.categoryId, label: lootRounds.label, createdAt: lootRounds.createdAt, memberIds: lootRounds.memberIds })
    .from(lootRounds)
    .orderBy(lootRounds.categoryId, desc(lootRounds.createdAt));
  const latestByCategory = new Map(latest.map((r) => [r.categoryId, r]));
  const starts = await Promise.all(categories.map((c) => computeNumberingStart(db, c.id)));

  return categories.map((c, i) => {
    const lr = latestByCategory.get(c.id);
    return {
      id: c.id,
      name: c.name,
      sortOrder: c.sortOrder,
      queue: queueByCategory.get(c.id) ?? [],
      numberingBaseCategoryId: c.numberingBaseCategoryId,
      lastRound: lr ? { label: lr.label, createdAt: lr.createdAt, count: lr.memberIds.length } : null,
      nextStartNumber: starts[i] + 1,
    };
  });
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
  /** Where this round's numbered list started — null for rounds run before it was recorded. */
  startNumber: number | null;
  /** Every served member id, in served order (including anyone who has since left). */
  memberIds: string[];
  /** Display names in served order, "(left the guild)" for ids no longer on file — keeps numbering intact when copying. */
  names: string[];
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
    startNumber: r.startNumber,
    memberIds: r.memberIds,
    names: r.memberIds.map((id) => memberById.get(id)?.displayName ?? "(left the guild)"),
    members: r.memberIds.map((id) => memberById.get(id)).filter((m): m is LootQueueMemberRef => Boolean(m)),
  }));
}

/** When each member in a category last got served ("YYYY-MM-DDTHH..." ISO), from its recent round history. */
export async function lastServedByMember(categoryId: string, rounds = 120): Promise<Record<string, string>> {
  const rows = await db
    .select({ memberIds: lootRounds.memberIds, createdAt: lootRounds.createdAt })
    .from(lootRounds)
    .where(eq(lootRounds.categoryId, categoryId))
    .orderBy(desc(lootRounds.createdAt))
    .limit(rounds);
  const out: Record<string, string> = {};
  for (const r of rows) for (const id of r.memberIds) if (!(id in out)) out[id] = r.createdAt.toISOString();
  return out;
}

/** Bangkok "YYYY-MM-DD" for an instant. */
function thaiDate(d: Date): string {
  return new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
}

/** Round-label suggestions from the check-in schedule, e.g. "gl 24/9" for
 * the round that just ended today and "woe 27/9" for the next one. */
export function roundLabelSuggestions(now: Date): { label: string; hint: "today" | "latest" | "next" }[] {
  const today = thaiDate(now);
  const fmt = (key: string, date: string) => `${key} ${Number(date.slice(8, 10))}/${Number(date.slice(5, 7))}`;
  const out: { label: string; hint: "today" | "latest" | "next"; sort: number }[] = [];
  for (const ev of CHECKIN_EVENTS) {
    const lastEnd = lastOccurrenceEnd(ev, now);
    if (lastEnd && now.getTime() - lastEnd.getTime() < 3 * 86400_000) {
      const d = thaiDate(lastEnd);
      out.push({ label: fmt(ev.key, d), hint: d === today ? "today" : "latest", sort: now.getTime() - lastEnd.getTime() });
    }
    const next = nextOccurrenceDate(ev, now);
    out.push({ label: fmt(ev.key, next), hint: next === today ? "today" : "next", sort: 1e12 + windowFor(ev, next).start.getTime() - now.getTime() });
  }
  const seen = new Set<string>();
  return out
    .sort((a, b) => a.sort - b.sort)
    .filter((o) => (seen.has(o.label) ? false : (seen.add(o.label), true)))
    .map(({ label, hint }) => ({ label, hint }));
}
