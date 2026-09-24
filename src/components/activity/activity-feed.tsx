"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MemberAvatar } from "@/components/member-avatar";
import { AppIcon } from "@/components/shell/app-icon";
import { Card, CardHeader, Chip, EmptyState, Kpi, KpiGrid } from "@/components/ui/kit";
import { deleteMembershipEvent } from "@/app/actions/activity";
import { uiAlert, uiConfirm } from "@/components/feedback";

export interface FeedEvent {
  id: string;
  type: string;
  label: string;
  detail: string | null;
  createdAt: string; // ISO
  member: { id: string; name: string; avatar: string | null };
}

const CATEGORY: Record<string, "member" | "leave" | "class" | "admin"> = {
  JOIN: "member",
  LEAVE: "member",
  KICK: "member",
  ROLE_UPDATE: "member",
  RANK_UPDATE: "member",
  NAME_CHANGE: "member",
  PROFILE_UPDATE: "member",
  ATTENDANCE_LEAVE: "leave",
  ATTENDANCE_RETURN: "leave",
  LEAVE_SCHEDULED: "leave",
  LEAVE_SCHEDULE_CANCELLED: "leave",
  CLASS_CHANGE: "class",
  NOTE: "admin",
  AUCTION_BAN: "admin",
  AUCTION_UNBAN: "admin",
};

const LOOK: Record<string, { icon: string; tone: string }> = {
  JOIN: { icon: "userplus", tone: "text-emerald-300 bg-emerald-400/10" },
  LEAVE: { icon: "userminus", tone: "text-rose-300 bg-rose-500/10" },
  KICK: { icon: "ban", tone: "text-rose-300 bg-rose-500/10" },
  ROLE_UPDATE: { icon: "tag", tone: "text-zinc-300 bg-zinc-800" },
  RANK_UPDATE: { icon: "tag", tone: "text-zinc-300 bg-zinc-800" },
  NAME_CHANGE: { icon: "pencil", tone: "text-zinc-300 bg-zinc-800" },
  PROFILE_UPDATE: { icon: "pencil", tone: "text-zinc-300 bg-zinc-800" },
  ATTENDANCE_LEAVE: { icon: "calx", tone: "text-sky-300 bg-sky-400/10" },
  ATTENDANCE_RETURN: { icon: "undo", tone: "text-zinc-300 bg-zinc-800" },
  LEAVE_SCHEDULED: { icon: "calclock", tone: "text-sky-300 bg-sky-400/10" },
  LEAVE_SCHEDULE_CANCELLED: { icon: "undo", tone: "text-zinc-300 bg-zinc-800" },
  CLASS_CHANGE: { icon: "repeat", tone: "text-violet-300 bg-violet-400/10" },
  NOTE: { icon: "note", tone: "text-amber-200 bg-amber-400/10" },
  AUCTION_BAN: { icon: "ban", tone: "text-rose-300 bg-rose-500/10" },
  AUCTION_UNBAN: { icon: "undo", tone: "text-zinc-300 bg-zinc-800" },
};

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const thaiParts = (ms: number) => new Date(ms + 7 * 3600_000);
const dayKey = (ms: number) => thaiParts(ms).toISOString().slice(0, 10);

export function ActivityFeed({ events, isAdmin, now, rangeLabel, capped }: { events: FeedEvent[]; isAdmin: boolean; now: number; rangeLabel: string; capped: boolean }) {
  const router = useRouter();
  const [cat, setCat] = useState<"all" | "member" | "leave" | "class" | "admin">("all");
  const [q, setQ] = useState("");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();

  const live = events.filter((e) => !hidden.has(e.id));
  const countCat = (c: typeof cat) => live.filter((e) => c === "all" || CATEGORY[e.type] === c).length;
  const joins = live.filter((e) => e.type === "JOIN").length;
  const lefts = live.filter((e) => e.type === "LEAVE" || e.type === "KICK").length;

  const query = q.trim().toLowerCase();
  const shown = live.filter((e) => (cat === "all" || CATEGORY[e.type] === cat) && (!query || e.member.name.toLowerCase().includes(query) || (e.detail ?? "").toLowerCase().includes(query)));

  const todayKey = dayKey(now);
  const yesterdayKey = dayKey(now - 86400_000);
  const dayLabel = (ms: number) => {
    const k = dayKey(ms);
    const d = thaiParts(ms);
    const base = `${WD[d.getUTCDay()]} ${d.getUTCDate()} ${MO[d.getUTCMonth()]}`;
    return k === todayKey ? `Today · ${base}` : k === yesterdayKey ? `Yesterday · ${base}` : base;
  };

  async function remove(e: FeedEvent) {
    if (!(await uiConfirm({ title: "Delete this log entry?", message: `“${e.label}${e.detail ? " — " + e.detail : ""}”\n\nLeave counts are not affected. This cannot be undone.`, confirmLabel: "Delete", danger: true }))) return;
    setHidden((h) => new Set(h).add(e.id));
    startTransition(async () => {
      try {
        const res = await deleteMembershipEvent(e.id);
        if (!res.ok) throw new Error(res.error ?? "Delete failed");
        router.refresh();
      } catch (err) {
        setHidden((h) => {
          const n = new Set(h);
          n.delete(e.id);
          return n;
        });
        uiAlert(err instanceof Error ? err.message : "Delete failed");
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <KpiGrid>
        <Kpi label="Joined" value={joins} tone="ok" hint={rangeLabel} />
        <Kpi label="Left / kicked" value={lefts} tone={lefts ? "bad" : "default"} hint={`Net ${joins - lefts >= 0 ? "+" : ""}${joins - lefts}`} />
        <Kpi label="Leaves & requests" value={countCat("leave")} tone="info" hint="Incl. cancellations" />
        <Kpi label="Class changes" value={countCat("class")} tone="violet" hint="Party boards update automatically" />
      </KpiGrid>
      <Card>
        <CardHeader
          right={
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name or detail…"
              className="w-44 rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
            />
          }
        >
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ["all", "All"],
                ["member", "Members"],
                ["leave", "Leave"],
                ["class", "Class"],
                ["admin", "Admin"],
              ] as const
            ).map(([k, l]) => (
              <Chip key={k} on={cat === k} onClick={() => setCat(k)} count={countCat(k)}>
                {l}
              </Chip>
            ))}
          </div>
        </CardHeader>
        {shown.length === 0 ? (
          <EmptyState>No activity matches</EmptyState>
        ) : (
          <ul className="pb-1">
            {shown.map((e, i) => {
              const ms = new Date(e.createdAt).getTime();
              const k = dayKey(ms);
              const header = i === 0 || dayKey(new Date(shown[i - 1].createdAt).getTime()) !== k ? dayLabel(ms) : null;
              const look = LOOK[e.type] ?? { icon: "activity", tone: "text-zinc-300 bg-zinc-800" };
              const d = thaiParts(ms);
              return (
                <li key={e.id}>
                  {header && <p className="sticky top-[49px] z-[1] bg-zinc-900/95 px-3.5 pb-1 pt-3 text-[10.5px] uppercase tracking-[0.12em] text-zinc-600 backdrop-blur">{header}</p>}
                  <div className="group flex items-start gap-3 px-3.5 py-2 hover:bg-zinc-800/30">
                    <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${look.tone}`}>
                      <AppIcon name={look.icon} size={15} />
                    </span>
                    <Link href={`/members/${e.member.id}`} className="relative mt-0.5 inline-block h-7 w-7 shrink-0 overflow-hidden rounded-full ring-1 ring-zinc-700">
                      <MemberAvatar src={e.member.avatar} alt="" fill sizes="28px" className="object-cover" />
                    </Link>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px]">
                        <Link href={`/members/${e.member.id}`} className="font-semibold text-zinc-100 hover:text-amber-300">
                          {e.member.name}
                        </Link>{" "}
                        <span className="text-zinc-400">{e.label}</span>
                      </p>
                      {e.detail && <p className="break-words text-xs text-zinc-500">{e.detail}</p>}
                    </div>
                    <span className="shrink-0 text-[11px] tabular-nums text-zinc-600">
                      {String(d.getUTCHours()).padStart(2, "0")}:{String(d.getUTCMinutes()).padStart(2, "0")}
                    </span>
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => remove(e)}
                        title="Delete this log line (leave counts are not affected)"
                        aria-label="Delete log entry"
                        className="shrink-0 rounded p-1 text-zinc-600 opacity-60 transition hover:bg-rose-950/40 hover:text-rose-400 group-hover:opacity-100"
                      >
                        <AppIcon name="trash" size={14} />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {capped && <p className="border-t border-zinc-800 px-4 py-2.5 text-center text-xs text-zinc-600">Showing the most recent 500 entries in this range — pick a shorter range to see everything.</p>}
      </Card>
    </div>
  );
}
