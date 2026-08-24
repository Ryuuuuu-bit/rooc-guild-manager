import { requireUser } from "@/lib/authz";
import { listMembers } from "@/lib/data";
import { listLootCategories, listLootRounds } from "@/lib/loot-queue-data";
import { listOnlineMemberIds } from "@/lib/checkin-data";
import { memberDisplayName } from "@/lib/ui";
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

  const [rounds, members, onlineMemberIds] = await Promise.all([
    selectedCategoryId ? listLootRounds(selectedCategoryId) : Promise.resolve([]),
    // "active" here = not benched — a benched member isn't expected to be
    // bidding on loot, so leaving them out of the add-to-queue pool avoids
    // confusion. Doesn't affect anyone already queued from before they were
    // benched — the queue list itself is unrelated to this fetch.
    listMembers({ benched: "active" }),
    listOnlineMemberIds(),
  ]);

  const allMembers = members.map((m) => ({
    id: m.id,
    displayName: memberDisplayName(m),
    discordAvatar: m.discordAvatar,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-50">คิวประมูลของรางวัล</h1>
        <p className="mt-1 text-sm text-zinc-400">
          คิวแยกอิสระต่อหมวดหมู่ (เช่น เศษการ์ด, ขนนกขาว, ขนนกหลากสี, กล่องเศษบอสปลอม, ประมูลกิลด์ Fix 5 คน) —
          แอดมินจัดลำดับคิวเอง เวลารันรอบให้กรอกจำนวนคนที่ได้ในรอบนั้น ระบบจะดึงคนจากหัวคิวให้อัตโนมัติ
          แล้วย้ายคนที่ได้ไปต่อท้ายคิวของหมวดนั้น
        </p>
      </div>
      <LootQueueManager
        categories={categories}
        selectedCategoryId={selectedCategoryId}
        initialRounds={rounds}
        allMembers={allMembers}
        onlineMemberIds={[...onlineMemberIds]}
        isAdmin={session.user.isAdmin}
      />
    </div>
  );
}
