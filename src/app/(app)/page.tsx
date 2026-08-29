import Link from "next/link";
import { getClassDistribution, getDashboardStats, getRecentActivity } from "@/lib/data";
import { requireUser } from "@/lib/authz";
import { StatCard } from "@/components/stat-card";
import { ActivityListItem } from "@/components/activity-list-item";
import { AttendanceTrendChart } from "@/components/attendance-trend-chart";
import { GRADIENT_CLASS, type ColorKey } from "@/lib/job-class-colors";
import { CHECKIN_EVENTS, getAttendanceTrend } from "@/lib/checkin-data";

// Small, deliberately plain icon glyphs (simple strokes/arcs, not traced from
// an external icon set) — just enough to give each stat tile's accent chip a
// shape instead of being color-only.
function UsersIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <circle cx="10" cy="6.5" r="3" />
      <path d="M4 17a6 6 0 0 1 12 0H4Z" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <path d="M4 10.5l4 4 8-9" />
    </svg>
  );
}
function ExitIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <path d="M4 10h10M14 10l-3-3M14 10l-3 3" />
    </svg>
  );
}
function XIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4">
      <path d="M6 6l8 8M14 6l-8 8" />
    </svg>
  );
}
function TrendIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <path d="M3 13l4-4 3 3 6-7" />
    </svg>
  );
}
function PauseIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <rect x="6" y="5" width="2.5" height="10" rx="1" />
      <rect x="11.5" y="5" width="2.5" height="10" rx="1" />
    </svg>
  );
}

export default async function DashboardPage() {
  const session = await requireUser();
  const [stats, activity, classDistribution, attendanceTrends] = await Promise.all([
    getDashboardStats(),
    getRecentActivity(8),
    getClassDistribution(),
    Promise.all(CHECKIN_EVENTS.map((e) => getAttendanceTrend(e.key))),
  ]);
  const totalClassed = classDistribution.known.reduce((sum, c) => sum + c.count, 0) + classDistribution.unassignedCount;
  const maxClassCount = Math.max(1, ...classDistribution.known.map((c) => c.count), classDistribution.unassignedCount);

  return (
    <div className="relative flex flex-col gap-8">
      {/* Faint dot-grid canvas behind the whole page — the one purely decorative
          touch here, kept subtle enough (3.5% white) to never compete with content. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-60"
        style={{
          backgroundImage: "radial-gradient(rgba(255,255,255,0.035) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
        }}
      />

      <div>
        <h1 className="text-2xl font-semibold text-zinc-50">ภาพรวมกิลด์</h1>
        <p className="mt-1 text-sm text-zinc-400">
          ข้อมูลสมาชิกซิงค์อัตโนมัติจาก Discord server ของกิลด์
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="สมาชิกทั้งหมด" value={stats.total} icon={<UsersIcon />} />
        <StatCard label="สมาชิกที่ยังอยู่" value={stats.active} accent="positive" icon={<CheckIcon />} />
        <StatCard label="ออกจากกิลด์" value={stats.left} icon={<ExitIcon />} />
        <StatCard label="ถูกเตะออก" value={stats.kicked} accent="negative" icon={<XIcon />} />
        <StatCard
          label="เข้า/ออก 7 วันล่าสุด"
          value={
            <>
              <span className="text-emerald-400">+{stats.joinsLast7Days}</span>
              <span className="mx-1 text-zinc-600">/</span>
              <span className="text-rose-400">-{stats.leavesLast7Days}</span>
            </>
          }
          icon={<TrendIcon />}
        />
        <StatCard label="พักการเล่น" value={stats.benched} accent="warning" icon={<PauseIcon />} />
      </div>

      {CHECKIN_EVENTS.some((_, i) => attendanceTrends[i].some((p) => p.rate !== null)) && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {CHECKIN_EVENTS.map((e, i) => (
            <AttendanceTrendChart key={e.key} title={`เทรนด์การเข้าร่วม — ${e.label}`} points={attendanceTrends[i]} />
          ))}
        </div>
      )}

      <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/50 p-5">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="font-medium text-zinc-100">สัดส่วนอาชีพ</h2>
          {totalClassed > 0 && (
            <span className="text-xs text-zinc-500">
              รวม <span className="font-medium tabular-nums text-zinc-300">{totalClassed}</span> คน
            </span>
          )}
        </div>
        {totalClassed === 0 ? (
          <p className="text-sm text-zinc-500">ยังไม่มีข้อมูลอาชีพของสมาชิก</p>
        ) : (
          <div className="flex flex-col gap-1">
            {classDistribution.known.map((c) => (
              <div key={c.name} className="flex items-center gap-3 rounded-lg px-1.5 py-1.5 transition hover:bg-zinc-800/40">
                <span className="flex w-28 shrink-0 items-center gap-1.5 truncate text-sm text-zinc-300">
                  <span className="text-xs">{c.emoji}</span> {c.name}
                </span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-zinc-800/70">
                  <div
                    className={`h-full rounded-full bg-gradient-to-r transition-[width] ${
                      GRADIENT_CLASS[c.colorKey as ColorKey] ?? GRADIENT_CLASS.stone
                    }`}
                    style={{ width: `${Math.max(3, (c.count / maxClassCount) * 100)}%` }}
                  />
                </div>
                <span className="w-8 shrink-0 text-right text-sm font-medium tabular-nums text-zinc-300">{c.count}</span>
              </div>
            ))}
            {classDistribution.unassignedCount > 0 && (
              <div className="flex items-center gap-3 rounded-lg px-1.5 py-1.5 transition hover:bg-zinc-800/40">
                <span className="w-28 shrink-0 truncate text-sm text-zinc-500">— ไม่ระบุ</span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-zinc-800/70">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-zinc-600/50 to-zinc-500"
                    style={{ width: `${Math.max(3, (classDistribution.unassignedCount / maxClassCount) * 100)}%` }}
                  />
                </div>
                <span className="w-8 shrink-0 text-right text-sm font-medium tabular-nums text-zinc-500">
                  {classDistribution.unassignedCount}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/50">
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
