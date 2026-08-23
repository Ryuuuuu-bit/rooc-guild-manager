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
 * Admins get a delete button — e.g. to clean up a member's test "ลา" click
 * that would otherwise skew the /attendance stats page. */
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
  // A "ลา" reaction only counts toward /attendance stats once it's survived
  // 30 minutes uninterrupted — see confirmDueLeaves in
  // bot/attendance-confirm.ts. Surface that here so it's obvious a fresh
  // click hasn't been dropped, just not counted yet.
  const isPendingLeave = event.type === "ATTENDANCE_LEAVE" && !event.confirmedAt;

  function handleDelete() {
    if (!confirm(`ลบรายการนี้ออกจากประวัติ? การกระทำนี้ย้อนกลับไม่ได้\n\n"${eventLabels[event.type] ?? event.type}${event.detail ? " — " + event.detail : ""}"`)) {
      return;
    }
    startTransition(async () => {
      const res = await deleteMembershipEvent(event.id);
      if (!res.ok) {
        alert(res.error ?? "ลบไม่สำเร็จ");
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
          {isPendingLeave && (
            <span
              className="rounded-full bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400"
              title="นับในสถิติหลังกดค้างไว้ครบ 30 นาที"
            >
              รอยืนยัน
            </span>
          )}
        </p>
      </div>
      <span
        className="shrink-0 text-xs text-zinc-500"
        title={new Date(event.createdAt).toLocaleString("th-TH", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: "Asia/Bangkok",
        })}
      >
        {formatDistanceToNow(event.createdAt, { addSuffix: true })}
      </span>
      {isAdmin && (
        <button
          type="button"
          onClick={handleDelete}
          disabled={pending}
          title="ลบรายการนี้ (เช่น ข้อมูลทดสอบ)"
          className="shrink-0 rounded px-1.5 py-1 text-xs text-zinc-600 transition hover:bg-rose-950/40 hover:text-rose-400 disabled:opacity-50"
        >
          ✕
        </button>
      )}
    </li>
  );
}
