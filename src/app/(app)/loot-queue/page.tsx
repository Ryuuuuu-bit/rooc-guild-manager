import { requireUser } from "@/lib/authz";
import { listMembers } from "@/lib/data";
import { lastServedByMember, listLootCategories, listLootRounds, roundLabelSuggestions } from "@/lib/loot-queue-data";
import { listOnlineMemberIds } from "@/lib/checkin-data";
import { memberDisplayName, isCurrentlyAuctionBanned } from "@/lib/ui";
import { LootQueueManager } from "@/components/loot-queue-manager";

export default async function LootQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const session = await requireUser();
  const params = await searchParams;

  const categories = await listLootCategories();
  const selectedCategoryId =
    params.category && categories.some((c) => c.id === params.category)
      ? params.category
      : categories[0]?.id ?? null;

  const [rounds, lastServed, members, onlineMemberIds] = await Promise.all([
    selectedCategoryId ? listLootRounds(selectedCategoryId) : Promise.resolve([]),
    selectedCategoryId ? lastServedByMember(selectedCategoryId) : Promise.resolve({}),
    // "active" here = not benched — a benched member isn't expected to be
    // bidding on loot, so leaving them out of the add-to-queue pool avoids
    // confusion. Doesn't affect anyone already queued from before they were
    // benched — the queue list itself is unrelated to this fetch.
    listMembers({ benched: "active" }),
    listOnlineMemberIds(),
  ]);

  const allMembers = members.map((m) => ({
    id: m.id,
    discordId: m.discordId,
    benched: m.benched,
    displayName: memberDisplayName(m),
    discordAvatar: m.discordAvatar,
    auctionBanUntil: m.auctionBanUntil,
    isAuctionBanned: isCurrentlyAuctionBanned(m),
  }));
  // The signed-in member (if they're on the roster) — non-admins get a "your position" card.
  const viewerMemberId = members.find((m) => m.discordId === session.user.discordId)?.id ?? null;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-50">Loot Queue</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Each category has its own queue. Running a round serves the next N people (skipping anyone auction-banned or
          benched) and moves them to the back of that category&apos;s queue.
        </p>
      </div>
      <LootQueueManager
        key={selectedCategoryId ?? "none"}
        categories={categories}
        selectedCategoryId={selectedCategoryId}
        initialRounds={rounds}
        lastServed={lastServed}
        allMembers={allMembers}
        onlineMemberIds={[...onlineMemberIds]}
        isAdmin={session.user.isAdmin}
        viewerMemberId={viewerMemberId}
        labelSuggestions={roundLabelSuggestions(new Date())}
      />
    </div>
  );
}
