import Link from "next/link";
import Image from "next/image";
import { getRecentActivity } from "@/lib/data";
import { eventLabels } from "@/lib/ui";
import { formatDistanceToNow } from "date-fns";

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
            <li key={event.id} className="flex items-center gap-3 px-5 py-3">
              <Image
                src={member.discordAvatar ?? "https://cdn.discordapp.com/embed/avatars/0.png"}
                alt={member.discordUsername}
                width={32}
                height={32}
                unoptimized
                className="h-8 w-8 rounded-full ring-1 ring-zinc-700"
              />
              <div className="min-w-0 flex-1">
                <Link
                  href={`/members/${member.id}`}
                  className="truncate text-sm font-medium text-zinc-100 hover:text-indigo-300"
                >
                  {member.discordGlobalName ?? member.discordUsername}
                </Link>
                <p className="text-xs text-zinc-500">
                  {eventLabels[event.type] ?? event.type}
                  {event.detail ? ` — ${event.detail}` : ""}
                </p>
              </div>
              <span className="shrink-0 text-xs text-zinc-500">
                {formatDistanceToNow(event.createdAt, { addSuffix: true })}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
