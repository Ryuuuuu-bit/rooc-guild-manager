import { requireUser } from "@/lib/authz";
import { getPartyBoard } from "@/lib/party-data";
import { PartyBoardView } from "@/components/party/party-board";

export default async function PartyPage() {
  const session = await requireUser();
  const board = await getPartyBoard();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-50">จัดปาตี้ / กิจกรรม</h1>
        <p className="mt-1 text-sm text-zinc-400">
          {session.user.isAdmin
            ? "ลากรายชื่อสมาชิก (เฉพาะ role Rooc) เข้า/ออกปาตี้ได้ — รายชื่อซิงค์จาก Discord อัตโนมัติ"
            : "มุมมองปาตี้ปัจจุบันของกิลด์ — เฉพาะแอดมินแก้ไขได้"}
        </p>
      </div>
      <PartyBoardView initialBoard={board} isAdmin={session.user.isAdmin} />
    </div>
  );
}
