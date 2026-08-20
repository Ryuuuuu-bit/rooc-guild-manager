import Link from "next/link";
import Image from "next/image";
import { formatDistanceToNow } from "date-fns";
import type { Member, MembershipEvent } from "@/db/schema";
import { eventLabels, eventTypeColors, eventTypeDotColors, memberDisplayName } from "@/lib/ui";

/** One row in the activity feed (dashboard preview + full /activity page) —
 * color-coded by event type (green join, red leave/kick, amber everything
 * else) so the feed is scannable at a glance. */
export function ActivityListItem({ event, member }: { event: MembershipEvent; member: Member }) {
  const dotColor = eventTypeDotColors[event.type] ?? "bg-zinc-500";
  const labelColor = eventTypeColors[event.type] ?? "text-zinc-400";

  return (
    <li className="flex items-center gap-3 px-5 py-3">
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
          {memberDisplayName(member)}
        </Link>
        <p className="flex items-center gap-1.5 text-xs text-zinc-500">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotColor}`} aria-hidden />
          <span className={labelColor}>{eventLabels[event.type] ?? event.type}</span>
          {event.detail ? <span>— {event.detail}</span> : null}
        </p>
      </div>
      <span className="shrink-0 text-xs text-zinc-500">
        {formatDistanceToNow(event.createdAt, { addSuffix: true })}
      </span>
    </li>
  );
}
