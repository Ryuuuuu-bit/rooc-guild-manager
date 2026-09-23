"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { formatDistanceToNow } from "date-fns";
import type { Member, MembershipEvent } from "@/db/schema";
import { eventLabels, eventTypeColors, eventTypeDotColors, memberDisplayName } from "@/lib/ui";
import { deleteMembershipEvent } from "@/app/actions/activity";
import { MemberAvatar } from "@/components/member-avatar";

/** One row in the activity feed (dashboard preview, /activity page, and
 * member profile history) — color-coded by event type (green join, red
 * leave/kick, amber everything else) so the feed is scannable at a glance.
 * Admins get a delete button to remove a log line (test data, a mistaken
 * note). Leave STATS live in the `leaves` table, not here — to un-count a
 * leave use the party board / "Void leaves" on /attendance. */
export function ActivityListItem({
  event,
  member,
  isAdmin = false,
}: {
  event: MembershipEvent;
  member: Member;
  isAdmin?: boolean;
}) {
  const router = useRouter();
  const [deleted, setDeleted] = useState(false);
  const [pending, startTransition] = useTransition();
  const dotColor = eventTypeDotColors[event.type] ?? "bg-zinc-500";
  const labelColor = eventTypeColors[event.type] ?? "text-zinc-400";

  function handleDelete() {
    if (!confirm(`Delete this entry from the log? This cannot be undone.\n\n"${eventLabels[event.type] ?? event.type}${event.detail ? " — " + event.detail : ""}"`)) {
      return;
    }
    startTransition(async () => {
      const res = await deleteMembershipEvent(event.id);
      if (!res.ok) {
        alert(res.error ?? "Delete failed");
        return;
      }
      setDeleted(true);
      router.refresh();
    });
  }

  if (deleted) return null;

  return (
    <li className="flex items-center gap-3 px-5 py-3">
      <MemberAvatar
        src={member.discordAvatar}
        alt={member.discordUsername}
        width={32}
        height={32}
        className="h-8 w-8 rounded-full ring-1 ring-zinc-700"
      />
      <div className="min-w-0 flex-1">
        <Link
          href={`/members/${member.id}`}
          className="truncate text-sm font-medium text-zinc-100 hover:text-amber-300"
        >
          {memberDisplayName(member)}
        </Link>
        <p className="flex items-center gap-1.5 text-xs text-zinc-500">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotColor}`} aria-hidden />
          <span className={labelColor}>{eventLabels[event.type] ?? event.type}</span>
          {event.detail ? <span>— {event.detail}</span> : null}
        </p>
      </div>
      {/* Both the relative time (glanceable) and the absolute Thai
          date/time (precise — matters when pinning down exactly when
          something happened, e.g. checking whether a reset ran on schedule)
          shown directly, not just on hover — a tooltip is unreachable on
          touch devices, and this feed gets checked from phones. */}
      <span className="flex shrink-0 flex-col items-end text-right text-xs text-zinc-500">
        <span>{formatDistanceToNow(event.createdAt, { addSuffix: true })}</span>
        <span className="text-[10px] text-zinc-600">
          {new Date(event.createdAt).toLocaleString("th-TH", {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: "Asia/Bangkok",
          })}
        </span>
      </span>
      {isAdmin && (
        <button
          type="button"
          onClick={handleDelete}
          disabled={pending}
          title="Delete this log line only (leave counts are not affected — use the party board or Void leaves on /attendance for that)"
          className="shrink-0 rounded px-1.5 py-1 text-xs text-zinc-600 transition hover:bg-rose-950/40 hover:text-rose-400 disabled:opacity-50"
        >
          ✕
        </button>
      )}
    </li>
  );
}
