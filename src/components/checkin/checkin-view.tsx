"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MemberAvatar } from "@/components/member-avatar";
import { ClassBadge } from "@/components/badges";
import { CheckinNoteCell } from "@/components/checkin-note-cell";
import { AppIcon } from "@/components/shell/app-icon";
import { Card, CardHeader, EmptyState, Kpi, KpiGrid, Segmented, StatusTag } from "@/components/ui/kit";
import type { CheckinRow, CheckinStatus, StripRound } from "@/lib/checkin-view";

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Thai-time "HH:MM" / "Thu 24/9", built by hand so server and browser render the same text. */
function thai(iso: string) {
  const d = new Date(new Date(iso).getTime() + 7 * 3600_000);
  return {
    hm: `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`,
    day: `${WD[d.getUTCDay()]} ${d.getUTCDate()}/${d.getUTCMonth() + 1}`,
  };
}

const ORDER: Record<CheckinStatus, number> = { absent: 0, leave: 1, late: 2, early: 3, live: 4, in: 5 };

function StatusCell({ row }: { row: CheckinRow }) {
  switch (row.status) {
    case "in":
      return <StatusTag tone="ok">✓ Present</StatusTag>;
    case "live":
      return <StatusTag tone="ok">● In channel</StatusTag>;
    case "late":
      return <StatusTag tone="warn">Late {row.lateBy}m</StatusTag>;
    case "early":
      return <StatusTag tone="warn">Left {row.earlyBy}m early</StatusTag>;
    case "leave":
      return <StatusTag tone="info">On leave</StatusTag>;
    case "absent":
      return <StatusTag tone="bad">Absent · no leave</StatusTag>;
  }
}

/** Presence bar across the window (plus 5 min either side): where they joined → where they left. */
function PresenceBar({ row, startMs, endMs, nowMs }: { row: CheckinRow; startMs: number; endMs: number; nowMs: number }) {
  if (!row.firstJoinIso) return <span className="text-xs text-zinc-600">—</span>;
  const pad = 5 * 60000;
  const from = startMs - pad;
  const span = endMs + pad - from;
  const a = Math.max(from, new Date(row.firstJoinIso).getTime());
  const b = Math.min(endMs + pad, row.lastLeaveIso ? new Date(row.lastLeaveIso).getTime() : Math.min(nowMs, endMs));
  const left = ((a - from) / span) * 100;
  const width = Math.max(1.5, ((b - a) / span) * 100);
  const warn = row.status === "late" || row.status === "early";
  return (
    <div className="relative h-2.5 overflow-hidden rounded-full bg-zinc-800/80" title={`${thai(row.firstJoinIso).hm} – ${row.lastLeaveIso ? thai(row.lastLeaveIso).hm : "now"}`}>
      <span className="absolute inset-y-0 w-px bg-zinc-600" style={{ left: `${(pad / span) * 100}%` }} />
      <span className="absolute inset-y-0 w-px bg-zinc-600" style={{ left: `${((endMs - from) / span) * 100}%` }} />
      <i className={`absolute inset-y-0 rounded-full ${warn ? "bg-amber-400" : "bg-emerald-400"}`} style={{ left: `${left}%`, width: `${width}%` }} />
    </div>
  );
}

export function CheckinView({
  events,
  eventKey,
  strip,
  older,
  selectedDate,
  window,
  rows,
  isAdmin,
  now,
}: {
  events: { key: string; label: string }[];
  eventKey: string;
  strip: StripRound[];
  older: string[];
  selectedDate: string;
  window: { startIso: string; endIso: string };
  rows: CheckinRow[];
  isAdmin: boolean;
  now: number;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<"all" | "present" | "late" | "early" | "leave" | "absent">("all");
  const [q, setQ] = useState("");
  const startMs = new Date(window.startIso).getTime();
  const endMs = new Date(window.endIso).getTime();
  const winMin = Math.round((endMs - startMs) / 60000);

  const count = (s: CheckinStatus[]) => rows.filter((r) => s.includes(r.status)).length;
  const present = count(["in", "late", "early", "live"]);
  const onLeave = count(["leave"]);
  const absent = count(["absent"]);
  const expected = rows.length - onLeave;
  const attendedRows = rows.filter((r) => r.minutes > 0);
  const avgMin = attendedRows.length ? Math.round(attendedRows.reduce((a, r) => a + r.minutes, 0) / attendedRows.length) : 0;
  const selectedStrip = strip.find((s) => s.date === selectedDate);

  const shown = useMemo(() => {
    const query = q.trim().toLowerCase();
    return rows
      .filter((r) => {
        if (filter === "present") return ["in", "late", "early", "live"].includes(r.status);
        if (filter === "all") return true;
        return r.status === filter;
      })
      .filter((r) => !query || r.name.toLowerCase().includes(query))
      .sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.minutes - a.minutes || a.name.localeCompare(b.name, "th"));
  }, [rows, filter, q]);

  function exportCsv() {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = [["Member", "Status", "Minutes", "First joined", "Last left", "Note"].join(",")];
    for (const r of shown) lines.push([esc(r.name), r.status, r.minutes, r.firstJoinIso ? thai(r.firstJoinIso).hm : "", r.lastLeaveIso ? thai(r.lastLeaveIso).hm : r.stillConnected ? "in channel" : "", esc(r.note ?? "")].join(","));
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `checkin-${eventKey}-${selectedDate}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented items={events.map((e) => ({ key: e.key, label: e.label, href: `/checkin?event=${e.key}` }))} value={eventKey} />
        <button type="button" onClick={exportCsv} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/70 px-2.5 py-1.5 text-xs text-zinc-300 transition hover:border-zinc-700 hover:text-zinc-50">
          <AppIcon name="download" size={14} /> CSV
        </button>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {strip.map((s) => {
          const on = s.date === selectedDate;
          const rate = s.rate == null ? null : Math.round(s.rate * 100);
          const tone = s.voided || rate == null ? "text-zinc-500" : rate >= 85 ? "text-emerald-400" : rate >= 75 ? "text-amber-300" : "text-rose-400";
          return (
            <Link
              key={s.date}
              href={`/checkin?event=${eventKey}&date=${s.date}`}
              scroll={false}
              className={`min-w-[108px] max-w-[170px] flex-1 shrink-0 rounded-xl border px-2.5 py-2 transition ${
                on ? "border-amber-600 bg-gradient-to-b from-amber-600/20 to-amber-600/5" : s.live ? "border-emerald-700/60 bg-zinc-900/60" : "border-zinc-800 bg-zinc-900/60 hover:border-zinc-600"
              } ${s.voided ? "bg-[repeating-linear-gradient(135deg,rgba(39,39,42,0.6)_0_6px,transparent_6px_12px)]" : ""}`}
            >
              <span className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                {thai(s.startIso).day}
                {s.live && <span className="rounded-full bg-emerald-500/15 px-1.5 text-[9.5px] font-bold text-emerald-300">LIVE</span>}
                {s.voided && <span className="rounded-full bg-zinc-800 px-1.5 text-[9.5px] text-zinc-400">break</span>}
              </span>
              <span className={`block text-[17px] font-bold tabular-nums ${tone}`}>{s.voided || rate == null ? "—" : `${rate}%`}</span>
              <span className="mt-1 block h-1 overflow-hidden rounded bg-zinc-800">
                <i className="block h-full bg-emerald-400" style={{ width: `${s.voided || rate == null ? 0 : rate}%` }} />
              </span>
            </Link>
          );
        })}
        {older.length > 0 && (
          <select
            value={older.includes(selectedDate) ? selectedDate : ""}
            onChange={(e) => e.target.value && router.push(`/checkin?event=${eventKey}&date=${e.target.value}`)}
            className="shrink-0 self-stretch rounded-xl border border-zinc-800 bg-zinc-900/60 px-2 text-xs text-zinc-300 focus:border-amber-500 focus:outline-none"
            aria-label="Older rounds"
          >
            <option value="">Older…</option>
            {older.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        )}
      </div>

      <KpiGrid>
        <Kpi
          label="Present"
          value={present}
          suffix={`/${expected}`}
          tone="ok"
          bar={{ pct: expected ? (present / expected) * 100 : 0, tone: "ok" }}
          hint={selectedStrip?.live ? "Live from the voice channel" : "On-leave members not counted"}
        />
        <Kpi label="Absent · no leave" value={absent} tone={absent ? "bad" : "ok"} hint={absent ? "Add a note if they explained later" : "Everyone accounted for ✓"} />
        <Kpi label="On leave" value={onLeave} tone="info" hint="From the leave channel + admins" />
        <Kpi label="Avg. time present" value={avgMin} suffix={` / ${winMin} min`} hint={`Late ${count(["late"])} · left early ${count(["early"])}`} />
      </KpiGrid>

      <Card>
        <CardHeader
          right={
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name…"
              className="w-40 rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
            />
          }
        >
          <Segmented
            value={filter}
            onSelect={(k) => setFilter(k as typeof filter)}
            items={[
              { key: "all", label: "All", count: rows.length },
              { key: "present", label: "Present", count: present },
              { key: "late", label: "Late", count: count(["late"]) },
              { key: "early", label: "Left early", count: count(["early"]) },
              { key: "leave", label: "On leave", count: onLeave },
              { key: "absent", label: "Absent", count: absent },
            ]}
          />
        </CardHeader>
        <div className="hidden grid-cols-[minmax(0,1.4fr)_140px_minmax(0,1.4fr)_70px_minmax(0,1fr)] gap-3 px-3.5 py-2 text-[10.5px] uppercase tracking-wider text-zinc-600 md:grid">
          <span>Member</span>
          <span>Status</span>
          <span>
            In channel ({thai(window.startIso).hm}–{thai(window.endIso).hm})
          </span>
          <span>Time</span>
          <span>Note</span>
        </div>
        {shown.length === 0 ? (
          <EmptyState>No members match</EmptyState>
        ) : (
          <ul>
            {shown.map((r) => (
              <li key={r.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-t border-zinc-800/70 px-3.5 py-2 hover:bg-zinc-800/30 md:grid-cols-[minmax(0,1.4fr)_140px_minmax(0,1.4fr)_70px_minmax(0,1fr)]">
                <Link href={`/members/${r.id}`} className="flex min-w-0 items-center gap-2.5">
                  <span className="relative inline-block h-7 w-7 shrink-0 overflow-hidden rounded-full ring-1 ring-zinc-700">
                    <MemberAvatar src={r.avatar} alt="" fill sizes="28px" className="object-cover" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold text-zinc-100">{r.name}</span>
                    <span className="flex items-center gap-1.5 md:hidden">
                      <span className="text-[11px] text-zinc-500">
                        {r.minutes > 0 ? `${r.minutes} min · ${r.firstJoinIso ? thai(r.firstJoinIso).hm : ""}–${r.lastLeaveIso ? thai(r.lastLeaveIso).hm : "now"}` : (r.note ?? "")}
                      </span>
                    </span>
                    <span className="hidden md:block">
                      <ClassBadge className={r.className} />
                    </span>
                  </span>
                </Link>
                <span className="justify-self-end md:justify-self-start">
                  <StatusCell row={r} />
                </span>
                <span className="hidden md:block">
                  {r.status === "leave" || r.status === "absent" ? <span className="text-xs text-zinc-600">—</span> : <PresenceBar row={r} startMs={startMs} endMs={endMs} nowMs={now} />}
                </span>
                <span className="hidden text-xs tabular-nums text-zinc-400 md:block">{r.minutes > 0 ? `${r.minutes} min` : "—"}</span>
                <span className={`col-span-2 md:col-span-1 ${r.note || (isAdmin && r.status === "absent") ? "" : "hidden md:block"}`}>
                  <CheckinNoteCell key={`${eventKey}-${selectedDate}-${r.id}`} eventKey={eventKey} date={selectedDate} memberId={r.id} note={r.note} isAdmin={isAdmin} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
