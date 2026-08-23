import Link from "next/link";
import { getAttendanceBoardBreakdown, getAttendanceStats } from "@/lib/data";
import { listPartyBoards } from "@/lib/party-data";
import { requireUser } from "@/lib/authz";
import { memberDisplayName } from "@/lib/ui";
import { MemberAvatar } from "@/components/member-avatar";

const DAY_OPTIONS = [
  { value: "7", label: "7 วัน" },
  { value: "30", label: "30 วัน" },
  { value: "90", label: "90 วัน" },
  { value: "all", label: "ทั้งหมด" },
];

const ALL_BOARDS_VALUE = "all";

interface SearchParams {
  days?: string;
  board?: string;
}

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireUser();
  const params = await searchParams;
  const daysParam = DAY_OPTIONS.some((o) => o.value === params.days) ? params.days : "30";
  const days = daysParam === "all" ? undefined : Number(daysParam);

  const boards = await listPartyBoards();
  const boardParam = boards.some((b) => b.id === params.board) ? params.board! : ALL_BOARDS_VALUE;
  const boardId = boardParam === ALL_BOARDS_VALUE ? undefined : boardParam;

  const [{ stats, totalLeaveEvents }, breakdown] = await Promise.all([
    getAttendanceStats(days, boardId),
    // Only needed for the "ทั้งหมด" view's summary pills — skip the extra
    // query when a specific board is already selected (its total is already
    // shown above the table).
    boardId ? Promise.resolve(null) : getAttendanceBoardBreakdown(days),
  ]);
  const maxLeaveCount = Math.max(1, ...stats.map((s) => s.leaveCount));
  const selectedBoardName = boardId ? boards.find((b) => b.id === boardId)?.name : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-50">สถิติการลา</h1>
          <p className="mt-1 text-sm text-zinc-400">
            จำนวนครั้งที่แต่ละสมาชิกกด &quot;ลา&quot;{selectedBoardName ? ` ในกระดาน "${selectedBoardName}"` : ""}
            ในช่วงเวลาที่เลือก — รวม {totalLeaveEvents} ครั้ง{selectedBoardName ? "" : "ทั้งหมด"} เรียงจากลาบ่อยสุดไปน้อยสุด
          </p>
          {session.user.isAdmin && (
            <p className="mt-1 text-xs text-zinc-500">
              ต้องการแก้ไขรายการลาของใครสักคน? กดชื่อสมาชิกด้านล่างเพื่อไปหน้าโปรไฟล์ — ลบรายการทดสอบ/ผิดพลาดได้จาก
              &quot;ประวัติกิจกรรม&quot; หรือเพิ่มลาย้อนหลัง (เช่นแจ้งลาทาง DM) ได้จาก &quot;บันทึกการลาย้อนหลัง&quot;
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {boards.length > 0 && (
            <div className="flex flex-wrap gap-1 rounded-xl border border-zinc-800 bg-zinc-900/50 p-1">
              <Link
                href={`/attendance?days=${daysParam}&board=${ALL_BOARDS_VALUE}`}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  boardParam === ALL_BOARDS_VALUE
                    ? "bg-amber-600 text-white"
                    : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                }`}
              >
                ทุกกระดาน
              </Link>
              {boards.map((b) => (
                <Link
                  key={b.id}
                  href={`/attendance?days=${daysParam}&board=${b.id}`}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                    boardParam === b.id
                      ? "bg-amber-600 text-white"
                      : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                  }`}
                >
                  {b.name}
                </Link>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-1 rounded-xl border border-zinc-800 bg-zinc-900/50 p-1">
            {DAY_OPTIONS.map((opt) => (
              <Link
                key={opt.value}
                href={`/attendance?days=${opt.value}&board=${boardParam}`}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  daysParam === opt.value
                    ? "bg-amber-600 text-white"
                    : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                }`}
              >
                {opt.label}
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Per-board split — only shown on the "ทุกกระดาน" view, e.g. lets an
          admin see "GL: 12 ครั้ง · WOE: 8 ครั้ง" at a glance without having
          to click through each board's tab one at a time. */}
      {breakdown && breakdown.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {breakdown.map((b) => (
            <Link
              key={b.boardId ?? "none"}
              href={b.boardId ? `/attendance?days=${daysParam}&board=${b.boardId}` : "#"}
              className={`rounded-full border border-zinc-800 bg-zinc-900/50 px-3 py-1 text-xs text-zinc-300 transition ${
                b.boardId ? "hover:border-amber-600/60 hover:text-amber-300" : "cursor-default"
              }`}
            >
              <span className="font-medium text-zinc-100">{b.boardName}</span>
              <span className="text-zinc-500"> — {b.leaveCount} ครั้ง</span>
            </Link>
          ))}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/50">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
              <th className="w-10 px-5 py-3 font-medium">#</th>
              <th className="px-5 py-3 font-medium">สมาชิก</th>
              <th className="px-5 py-3 font-medium">จำนวนครั้งที่ลา</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {stats.length === 0 && (
              <tr>
                <td colSpan={3} className="px-5 py-10 text-center text-zinc-500">
                  ไม่มีข้อมูลสมาชิก
                </td>
              </tr>
            )}
            {stats.map((row, i) => (
              <tr key={row.member.id} className="hover:bg-zinc-800/40">
                <td className="px-5 py-3 text-zinc-500">{i + 1}</td>
                <td className="px-5 py-3">
                  <Link href={`/members/${row.member.id}`} className="flex items-center gap-3">
                    <MemberAvatar
                      src={row.member.discordAvatar}
                      alt={row.member.discordUsername}
                      width={28}
                      height={28}
                      className="h-7 w-7 rounded-full ring-1 ring-zinc-700"
                    />
                    <span className="truncate font-medium text-zinc-100">{memberDisplayName(row.member)}</span>
                  </Link>
                </td>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2">
                    <div className="h-2 flex-1 max-w-40 overflow-hidden rounded-full bg-zinc-800">
                      {row.leaveCount > 0 && (
                        <div
                          className="h-full rounded-full bg-amber-500"
                          style={{ width: `${(row.leaveCount / maxLeaveCount) * 100}%` }}
                        />
                      )}
                    </div>
                    <span className="w-6 shrink-0 text-right text-zinc-300">{row.leaveCount}</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
