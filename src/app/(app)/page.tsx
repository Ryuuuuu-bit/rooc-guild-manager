import Link from "next/link";
import { getClassDistribution, getDashboardStats, getRecentActivity } from "@/lib/data";
import { requireUser } from "@/lib/authz";
import { StatCard } from "@/components/stat-card";
import { ActivityListItem } from "@/components/activity-list-item";
import { SWATCH_CLASS } from "@/lib/job-class-colors";

export default async function DashboardPage() {
  const session = await requireUser();
  const [stats, activity, classDistribution] = await Promise.all([
    getDashboardStats(),
    getRecentActivity(8),
    getClassDistribution(),
  ]);
  const totalClassed = classDistribution.known.reduce((sum, c) => sum + c.count, 0) + classDistribution.unassignedCount;
  const maxClassCount = Math.max(1, ...classDistribution.known.map((c) => c.count), classDistribution.unassignedCount);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-50">ภาพรวมกิลด์</h1>
        <p className="mt-1 text-sm text-zinc-400">
          ข้อมูลสมาชิกซิงค์อัตโนมัติจาก Discord server ของกิลด์
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="สมาชิกทั้งหมด" value={stats.total} />
        <StatCard label="สมาชิกที่ยังอยู่" value={stats.active} accent="positive" />
        <StatCard label="ออกจากกิลด์" value={stats.left} />
        <StatCard label="ถูกเตะออก" value={stats.kicked} accent="negative" />
        <StatCard
          label="เข้า/ออก 7 วันล่าสุด"
          value={`+${stats.joinsLast7Days} / -${stats.leavesLast7Days}`}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="พักการเล่น" value={stats.benched} />
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
        <h2 className="mb-4 font-medium text-zinc-100">สัดส่วนอาชีพ</h2>
        {totalClassed === 0 ? (
          <p className="text-sm text-zinc-500">ยังไม่มีข้อมูลอาชีพของสมาชิก</p>
        ) : (
          <div className="flex flex-col gap-2">
            {classDistribution.known.map((c) => (
              <div key={c.name} className="flex items-center gap-2 text-sm">
                <span className="w-28 shrink-0 truncate text-zinc-300">
                  {c.emoji} {c.name}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className={`h-full rounded-full ${SWATCH_CLASS[c.colorKey as keyof typeof SWATCH_CLASS] ?? SWATCH_CLASS.stone}`}
                    style={{ width: `${(c.count / maxClassCount) * 100}%` }}
                  />
                </div>
                <span className="w-8 shrink-0 text-right text-zinc-400">{c.count}</span>
              </div>
            ))}
            {classDistribution.unassignedCount > 0 && (
              <div className="flex items-center gap-2 text-sm">
                <span className="w-28 shrink-0 truncate text-zinc-500">— ไม่ระบุ</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full rounded-full bg-zinc-600"
                    style={{ width: `${(classDistribution.unassignedCount / maxClassCount) * 100}%` }}
                  />
                </div>
                <span className="w-8 shrink-0 text-right text-zinc-500">{classDistribution.unassignedCount}</span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50">
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <h2 className="font-medium text-zinc-100">กิจกรรมล่าสุด</h2>
          <Link href="/activity" className="text-xs text-amber-400 hover:text-amber-300">
            ดูทั้งหมด →
          </Link>
        </div>
        <ul className="divide-y divide-zinc-800">
          {activity.length === 0 && (
            <li className="px-5 py-6 text-center text-sm text-zinc-500">
              ยังไม่มีกิจกรรม — บอทจะเริ่มบันทึกเมื่อมีคนเข้า/ออกกิลด์
            </li>
          )}
          {activity.map(({ event, member }) => (
            <ActivityListItem
              key={event.id}
              event={event}
              member={member}
              isAdmin={session.user.isAdmin}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}
