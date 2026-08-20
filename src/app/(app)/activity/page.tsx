import { getRecentActivity } from "@/lib/data";
import { ActivityListItem } from "@/components/activity-list-item";

export default async function ActivityPage() {
  const activity = await getRecentActivity(100);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-50">ประวัติกิจกรรม</h1>
        <p className="mt-1 text-sm text-zinc-400">
          บันทึกอัตโนมัติทุกครั้งที่มีคนเข้า/ออกกิลด์ หรือแอดมินแก้ไขข้อมูล
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/50">
        <ul className="divide-y divide-zinc-800">
          {activity.length === 0 && (
            <li className="px-5 py-10 text-center text-sm text-zinc-500">
              ยังไม่มีกิจกรรม
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
