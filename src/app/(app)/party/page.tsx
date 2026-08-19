import { requireUser } from "@/lib/authz";
import { getPartyBoardDetail, listPartyBoards } from "@/lib/party-data";
import { PartyBoardView } from "@/components/party/party-board";

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
      <div>
        <h1 className="text-2xl font-semibold text-zinc-50">จัดปาตี้ / กิจกรรม</h1>
        <p className="mt-1 text-sm text-zinc-400">
          {session.user.isAdmin
            ? "สร้างกระดานแยกตาม content ได้อิสระ (เช่น ปกติ, GVG) ลากรายชื่อสมาชิก (role Rooc) เข้า/ออกปาตี้ได้"
            : "มุมมองปาตี้ปัจจุบันของกิลด์ — เฉพาะแอดมินแก้ไขได้"}
        </p>
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
