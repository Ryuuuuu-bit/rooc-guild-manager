"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { MemberAvatar } from "@/components/member-avatar";
import { ClassBadge } from "@/components/badges";
import { Card, CardHeader, Chip, EmptyState, Segmented, StatusTag } from "@/components/ui/kit";

export interface LeaveStatRow {
  id: string;
  name: string;
  avatar: string | null;
  className: string | null;
  /** Counted leaves in the selected period/board. */
  count: number;
  lastLeaveIso: string | null;
  /** This calendar month, per board (includes upcoming requested rounds — same as the quota rule). */
  month: { board: string; count: number }[];
  over: boolean;
}

function fmtDay(iso: string) {
  const d = new Date(new Date(iso).getTime() + 7 * 3600_000);
  return `${d.getUTCDate()}/${d.getUTCMonth() + 1}/${String(d.getUTCFullYear() + 543).slice(-2)}`;
}

function QuotaDots({ count, limit }: { count: number; limit: number }) {
  const n = Math.max(limit, count);
  return (
    <span className="inline-flex gap-[3px]" title={`${count}/${limit} this month`}>
      {Array.from({ length: n }, (_, i) => (
        <i key={i} className={`h-[9px] w-[9px] rounded-full ${i < count ? (i >= limit ? "bg-rose-400" : "bg-amber-300") : "bg-zinc-800 ring-1 ring-inset ring-zinc-700"}`} />
      ))}
    </span>
  );
}

export function LeaveStatsList({ rows, boards, limit, periodLabel }: { rows: LeaveStatRow[]; boards: string[]; limit: number; periodLabel: string }) {
  const [sort, setSort] = useState<"count" | "name">("count");
  const [showZero, setShowZero] = useState(false);
  const [q, setQ] = useState("");
  const max = Math.max(1, ...rows.map((r) => r.count));

  const shown = useMemo(() => {
    const query = q.trim().toLowerCase();
    return rows
      .filter((r) => showZero || r.count > 0 || r.over)
      .filter((r) => !query || r.name.toLowerCase().includes(query))
      .sort((a, b) => (sort === "count" ? b.count - a.count || a.name.localeCompare(b.name, "th") : a.name.localeCompare(b.name, "th")));
  }, [rows, sort, showZero, q]);

  return (
    <Card>
      <CardHeader
        right={
          <>
            <Chip on={showZero} onClick={() => setShowZero((v) => !v)} count={rows.filter((r) => r.count === 0).length}>
              Show 0 leaves
            </Chip>
            <Segmented
              value={sort}
              onSelect={(k) => setSort(k as typeof sort)}
              items={[
                { key: "count", label: "Most" },
                { key: "name", label: "Name" },
              ]}
            />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name…"
              className="w-36 rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
            />
          </>
        }
      >
        <span className="text-xs text-zinc-500">
          {shown.length} members · counted leaves {periodLabel} · dots = this month vs the {limit}/board limit
        </span>
      </CardHeader>
      {shown.length === 0 ? (
        <EmptyState>No leaves in this period</EmptyState>
      ) : (
        <ul>
          {shown.map((r, i) => (
            <li key={r.id} className="grid grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-3 border-t border-zinc-800/70 px-3.5 py-2 first:border-t-0 hover:bg-zinc-800/30 md:grid-cols-[22px_minmax(0,1.2fr)_minmax(0,1.3fr)_minmax(150px,auto)_80px]">
              <span className="text-[11px] tabular-nums text-zinc-600">{i + 1}</span>
              <Link href={`/members/${r.id}`} className="flex min-w-0 items-center gap-2.5">
                <span className="relative inline-block h-7 w-7 shrink-0 overflow-hidden rounded-full ring-1 ring-zinc-700">
                  <MemberAvatar src={r.avatar} alt="" fill sizes="28px" className="object-cover" />
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-semibold text-zinc-100">{r.name}</span>
                    {r.over && <StatusTag tone="bad">over quota</StatusTag>}
                  </span>
                  <ClassBadge className={r.className} />
                </span>
              </Link>
              <span className="hidden items-center gap-2 md:flex">
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-800">
                  <i className={`block h-full rounded-full ${r.over ? "bg-rose-400" : "bg-gradient-to-r from-amber-600 to-amber-300"}`} style={{ width: `${(r.count / max) * 100}%` }} />
                </span>
                <span className="w-6 text-right text-sm font-semibold tabular-nums text-zinc-200">{r.count}</span>
              </span>
              <span className="flex flex-col gap-1 text-[11px]">
                <span className="text-right text-sm font-semibold tabular-nums text-zinc-200 md:hidden">{r.count}</span>
                {boards.map((b) => (
                  <span key={b} className="flex items-center gap-2">
                    <b className="w-9 truncate font-medium text-zinc-500">{b}</b>
                    <QuotaDots count={r.month.find((m) => m.board === b)?.count ?? 0} limit={limit} />
                  </span>
                ))}
              </span>
              <span className="hidden text-right text-[11px] text-zinc-500 md:block">{r.lastLeaveIso ? `last ${fmtDay(r.lastLeaveIso)}` : ""}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
