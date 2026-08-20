import Link from "next/link";
import Image from "next/image";
import { getAttendanceStats } from "@/lib/data";
import { requireUser } from "@/lib/authz";
import { memberDisplayName } from "@/lib/ui";

const DAY_OPTIONS = [
  { value: "7", label: "7 วัน" },
  { value: "30", label: "30 วัน" },
  { value: "90", label: "90 วัน" },
  { value: "all", label: "ทั้งหมด" },
];

interface SearchParams {
  days?: string;
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

  const { stats, totalLeaveEvents } = await getAttendanceStats(days);
  const maxLeaveCount = Math.max(1, ...stats.map((s) => s.leaveCount));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-50">สถิติการลา</h1>
          <p className="mt-1 text-sm text-zinc-400">
            จำนวนครั้งที่แต่ละสมาชิกกด &quot;ลา&quot; ในช่วงเวลาที่เลือก — รวม {totalLeaveEvents} ครั้งทั้งหมด
            เรียงจากลาบ่อยสุดไปน้อยสุด
          </p>
          {session.user.isAdmin && (
            <p className="mt-1 text-xs text-zinc-500">
              ต้องการแก้ไข/ลบรายการลาของใครสักคน (เช่น ข้อมูลทดสอบ)? กดชื่อสมาชิกด้านล่างเพื่อไปหน้าโปรไฟล์ แล้วลบรายการที่ต้องการออกจาก
              &quot;ประวัติกิจกรรม&quot; ได้เลย
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-1 rounded-xl border border-zinc-800 bg-zinc-900/50 p-1">
          {DAY_OPTIONS.map((opt) => (
            <Link
              key={opt.value}
              href={`/attendance?days=${opt.value}`}
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
                    <Image
                      src={row.member.discordAvatar ?? "https://cdn.discordapp.com/embed/avatars/0.png"}
                      alt={row.member.discordUsername}
                      width={28}
                      height={28}
                      unoptimized
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
