import Link from "next/link";
import { getDashboardStats, getRecentActivity } from "@/lib/data";
import { StatCard } from "@/components/stat-card";
import { ActivityListItem } from "@/components/activity-list-item";

export default async function DashboardPage() {
  const [stats, activity] = await Promise.all([
    getDashboardStats(),
    getRecentActivity(8),
  ]);

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

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50">
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <h2 className="font-medium text-zinc-100">กิจกรรมล่าสุด</h2>
          <Link href="/activity" className="text-xs text-indigo-400 hover:text-indigo-300">
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
            <ActivityListItem key={event.id} event={event} member={member} />
          ))}
        </ul>
      </div>
    </div>
  );
}
