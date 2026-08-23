import Link from "next/link";
import { getRecentActivity } from "@/lib/data";
import { requireUser } from "@/lib/authz";
import { ActivityListItem } from "@/components/activity-list-item";

const DAY_OPTIONS = [
  { value: "7", label: "7 วัน" },
  { value: "30", label: "30 วัน" },
  { value: "90", label: "90 วัน" },
  { value: "all", label: "ทั้งหมด" },
];

// Capped even in "ทั้งหมด" mode — this table only grows, so an unbounded
// feed on a guild active for a year+ would eventually get slow to load.
const MAX_ROWS = 500;

interface SearchParams {
  days?: string;
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireUser();
  const params = await searchParams;
  const daysParam = DAY_OPTIONS.some((o) => o.value === params.days) ? params.days : "30";
  const days = daysParam === "all" ? undefined : Number(daysParam);

  const activity = await getRecentActivity(MAX_ROWS, days);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-50">ประวัติกิจกรรม</h1>
          <p className="mt-1 text-sm text-zinc-400">
            บันทึกอัตโนมัติทุกครั้งที่มีคนเข้า/ออกกิลด์, ลากิจกรรม, เปลี่ยนอาชีพ, เปลี่ยนชื่อ Discord หรือแอดมินแก้ไขข้อมูล
          </p>
        </div>
        <div className="flex flex-wrap gap-1 rounded-xl border border-zinc-800 bg-zinc-900/50 p-1">
          {DAY_OPTIONS.map((opt) => (
            <Link
              key={opt.value}
              href={`/activity?days=${opt.value}`}
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
        <ul className="divide-y divide-zinc-800">
          {activity.length === 0 && (
            <li className="px-5 py-10 text-center text-sm text-zinc-500">
              ไม่มีกิจกรรมในช่วงเวลานี้
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
        {activity.length === MAX_ROWS && (
          <p className="border-t border-zinc-800 px-5 py-3 text-center text-xs text-zinc-600">
            แสดงเฉพาะ {MAX_ROWS} รายการล่าสุดในช่วงที่เลือก — อาจมีรายการเก่ากว่านี้ที่ไม่ได้แสดง
          </p>
        )}
      </div>
    </div>
  );
}
