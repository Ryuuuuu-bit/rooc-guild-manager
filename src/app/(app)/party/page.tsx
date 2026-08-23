import { requireUser } from "@/lib/authz";
import { getPartyBoardDetail, listPartyBoards } from "@/lib/party-data";
import { PartyBoardView } from "@/components/party/party-board";
import { ClassSelectBroadcastPanel } from "@/components/class-select-broadcast-panel";

export default async function PartyPage({
  searchParams,
}: {
  searchParams: Promise<{ board?: string }>;
}) {
  const session = await requireUser();
  const params = await searchParams;

  const boards = await listPartyBoards();
  const selectedBoardId = params.board && boards.some((b) => b.id === params.board)
    ? params.board
    : boards[0]?.id;

  const board = selectedBoardId ? await getPartyBoardDetail(selectedBoardId) : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-50">จัดปาร์ตี้ / กิจกรรม</h1>
          <p className="mt-1 text-sm text-zinc-400">
            {session.user.isAdmin
              ? "สร้างกระดานแยกตาม content ได้อิสระ (เช่น ปกติ, GVG) ลากรายชื่อสมาชิก (role Rooc) เข้า/ออกปาร์ตี้ได้"
              : "มุมมองปาร์ตี้ปัจจุบันของกิลด์ — เฉพาะแอดมินแก้ไขได้"}
          </p>
        </div>
        {/* Guild-wide (not tied to any one board), so it lives at page level
         * rather than inside a per-board panel — kept here rather than on
         * /members since setting up classes is part of the same event-prep
         * flow as posting each board's ลา message below. */}
        {session.user.isAdmin && <ClassSelectBroadcastPanel />}
      </div>
      <PartyBoardView
        key={selectedBoardId ?? "empty"}
        boards={boards}
        selectedBoardId={selectedBoardId ?? null}
        initialBoard={board}
        isAdmin={session.user.isAdmin}
      />
    </div>
  );
}
