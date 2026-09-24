"use client";

import { useState } from "react";
import Link from "next/link";
import type { Overview, PersonRef, TrendRound } from "@/lib/overview-data";
import { ClassBadge } from "@/components/badges";
import { MemberAvatar } from "@/components/member-avatar";
import { HEX_CLASS, type ColorKey } from "@/lib/job-class-colors";
import { eventLabels, eventTypeDotColors } from "@/lib/ui";

export interface FeedItem {
  id: string;
  type: string;
  detail: string | null;
  createdAt: string;
  member: { id: string; name: string; avatar: string | null };
}

const DAY = 24 * 60 * 60 * 1000;
const TARGET = 0.85;
const C_IN = "#34d399";
const C_LEAVE = "#fbbf24";
const C_OUT = "#fb7185";

function fmtShort(date: string): string {
  return new Date(`${date}T12:00:00+07:00`).toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone: "Asia/Bangkok" });
}
function countdown(startIso: string, endIso: string, now: number): string {
  const s = new Date(startIso).getTime();
  const e = new Date(endIso).getTime();
  if (now >= s && now < e) return "live now";
  const mins = Math.max(0, Math.round((s - now) / 60000));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  return d > 0 ? `starts in ${d}d ${h}h` : `starts in ${h}h ${mins % 60}m`;
}

function Avatar({ p, size = 24 }: { p: { name: string; avatar: string | null }; size?: number }) {
  return (
    <span className="inline-flex shrink-0 overflow-hidden rounded-full" style={{ width: size, height: size }} title={p.name}>
      <MemberAvatar src={p.avatar} alt={p.name} width={size} height={size} className="rounded-full" />
    </span>
  );
}

function Spark({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return <div className="mt-1.5 h-[26px]" />;
  const w = 180;
  const h = 26;
  const mn = Math.min(...values);
  const sp = Math.max(...values) - mn || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - mn) / sp) * (h - 4)).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="mt-1.5 block h-[26px] w-full" aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Kpi({ label, value, delta, spark }: { label: string; value: React.ReactNode; delta?: React.ReactNode; spark?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-bold tabular-nums text-zinc-50">{value}</span>
        {delta}
      </div>
      {spark ?? <div className="mt-1.5 h-[26px]" />}
    </div>
  );
}

type Tip = { x: number; y: number; title: string; rows: [string, string][] } | null;

function Tooltip({ tip }: { tip: Tip }) {
  if (!tip) return null;
  return (
    <div className="pointer-events-none absolute z-10 min-w-[150px] rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-[11.5px] shadow-2xl" style={{ left: tip.x, top: tip.y }}>
      <div className="mb-1 font-semibold text-zinc-100">{tip.title}</div>
      {tip.rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-3 text-zinc-400">
          <span>{k}</span>
          <span className="tabular-nums text-zinc-100">{v}</span>
        </div>
      ))}
    </div>
  );
}

function AttendanceChart({ trend }: { trend: TrendRound[] }) {
  const [filter, setFilter] = useState<"all" | "gl" | "woe">("all");
  const [tip, setTip] = useState<Tip>(null);
  const rounds = trend.filter((r) => filter === "all" || r.eventKey === filter);
  const W = 680;
  const H = 210;
  const pl = 34;
  const pb = 26;
  const pt = 10;
  const cw = (W - pl) / Math.max(1, rounds.length);
  const bw = Math.min(34, cw * 0.56);
  const y = (p: number) => pt + (H - pt - pb) * (1 - p);
  const keys = [...new Set(trend.map((r) => r.eventKey))];

  function show(e: React.MouseEvent, r: TrendRound) {
    const box = (e.currentTarget as SVGElement).closest("div")!.getBoundingClientRect();
    const total = r.attended + r.onLeave + r.absent;
    setTip({
      x: Math.min(e.clientX - box.left + 12, box.width - 170),
      y: e.clientY - box.top - 10,
      title: `${fmtShort(r.date)} · ${r.shortLabel}`,
      rows: r.void
        ? [["Break — leaves voided", ""]]
        : [
            ["Attended", `${r.attended} (${total ? Math.round((r.attended / total) * 100) : 0}%)`],
            ["On leave", String(r.onLeave)],
            ["Absent", String(r.absent)],
          ],
    });
  }

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-zinc-100">Attendance — last {trend.length} rounds</h2>
        {keys.length > 1 && (
          <div className="ml-auto flex gap-0.5 rounded-lg border border-zinc-800 bg-zinc-950/60 p-0.5">
            {(["all", ...keys] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setFilter(k as "all" | "gl" | "woe")}
                className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${filter === k ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}
              >
                {k === "all" ? "All" : k.toUpperCase()}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-400">
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: C_IN }} />Attended</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: C_LEAVE }} />On leave</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: C_OUT }} />Absent</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-[repeating-linear-gradient(135deg,#71717a_0_2px,transparent_2px_4px)]" />Break (voided)</span>
        <span className="flex items-center gap-1.5"><svg width="14" height="6" aria-hidden><line x1="0" y1="3" x2="14" y2="3" stroke="#a1a1aa" strokeDasharray="4 3" strokeWidth="2" /></svg>{Math.round(TARGET * 100)}% target</span>
      </div>
      {rounds.length === 0 ? (
        <p className="py-10 text-center text-sm text-zinc-500">No check-in data yet</p>
      ) : (
        <div className="relative" onMouseLeave={() => setTip(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} className="block w-full overflow-visible">
            <defs>
              <pattern id="ov-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="6" height="6" fill="#18181b" />
                <line x1="0" y1="0" x2="0" y2="6" stroke="#3f3f46" strokeWidth="2" />
              </pattern>
            </defs>
            {[0, 0.5, 1].map((p) => (
              <g key={p}>
                <line x1={pl} x2={W} y1={y(p)} y2={y(p)} stroke="#27272a" />
                <text x={pl - 6} y={y(p) + 3} fill="#52525b" fontSize="10" textAnchor="end">
                  {p * 100}%
                </text>
              </g>
            ))}
            {rounds.map((r, i) => {
              const x = pl + i * cw + (cw - bw) / 2;
              const total = r.attended + r.onLeave + r.absent;
              const label = (
                <>
                  <text x={x + bw / 2} y={H - 8} fill="#71717a" fontSize="10" textAnchor="middle">
                    {fmtShort(r.date)}
                  </text>
                  <rect x={x + bw / 2 - 2} y={H - 22} width="4" height="4" rx="1" fill={r.eventKey === "woe" ? "#818cf8" : "#38bdf8"} />
                </>
              );
              if (r.void || total === 0) {
                return (
                  <g key={r.key} onMouseMove={(e) => show(e, r)} className="cursor-pointer">
                    {label}
                    <rect x={x} y={y(1)} width={bw} height={y(0) - y(1)} rx="4" fill="url(#ov-hatch)" />
                  </g>
                );
              }
              const segs: [number, string][] = [
                [r.attended / total, C_IN],
                [r.onLeave / total, C_LEAVE],
                [r.absent / total, C_OUT],
              ];
              let cursor = y(0);
              const isLast = i === rounds.length - 1;
              return (
                <g key={r.key} onMouseMove={(e) => show(e, r)} className="cursor-pointer">
                  {label}
                  {segs.map(([p, c], si) => {
                    const h = (y(0) - y(1)) * p;
                    cursor -= h;
                    return h > 0 ? <rect key={si} x={x} y={cursor} width={bw} height={Math.max(0, h - 2)} rx={si === 2 || (si === 1 && r.absent === 0) || (si === 0 && r.onLeave + r.absent === 0) ? 4 : 0} fill={c} /> : null;
                  })}
                  {isLast && (
                    <text x={x + bw / 2} y={y(r.attended / total) - 5} fill="#e4e4e7" fontSize="10.5" fontWeight="600" textAnchor="middle">
                      {Math.round((r.attended / total) * 100)}%
                    </text>
                  )}
                </g>
              );
            })}
            <line x1={pl} x2={W} y1={y(TARGET)} y2={y(TARGET)} stroke="#a1a1aa" strokeDasharray="5 4" opacity="0.6" />
          </svg>
          <Tooltip tip={tip} />
        </div>
      )}
    </div>
  );
}

function FlowChart({ flow }: { flow: Overview["flow"] }) {
  const [tip, setTip] = useState<Tip>(null);
  const W = 340;
  const H = 170;
  const pl = 22;
  const pb = 22;
  const pt = 8;
  const mx = Math.max(3, ...flow.map((f) => Math.max(f.joined, f.left)));
  const cw = (W - pl) / flow.length;
  const bw = Math.min(12, cw * 0.3);
  const y = (v: number) => pt + (H - pt - pb) * (1 - v / mx);
  const J = flow.reduce((a, f) => a + f.joined, 0);
  const L = flow.reduce((a, f) => a + f.left, 0);
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="mb-2 flex items-center">
        <h2 className="text-sm font-semibold text-zinc-100">Membership flow</h2>
        <span className="ml-auto text-[11px] text-zinc-500">last 8 weeks</span>
      </div>
      <div className="mb-2 flex gap-3 text-[11px] text-zinc-400">
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-emerald-400" />Joined</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-rose-400" />Left / kicked</span>
      </div>
      <div className="relative" onMouseLeave={() => setTip(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full overflow-visible">
          {[0, Math.round(mx / 2), mx].map((v) => (
            <g key={v}>
              <line x1={pl} x2={W} y1={y(v)} y2={y(v)} stroke="#27272a" />
              <text x={pl - 5} y={y(v) + 3} fill="#52525b" fontSize="10" textAnchor="end">
                {v}
              </text>
            </g>
          ))}
          {flow.map((f, i) => {
            const cx = pl + i * cw + cw / 2;
            return (
              <g
                key={f.weekStart}
                className="cursor-pointer"
                onMouseMove={(e) => {
                  const box = (e.currentTarget as SVGElement).closest("div")!.getBoundingClientRect();
                  setTip({
                    x: Math.min(e.clientX - box.left + 12, box.width - 160),
                    y: e.clientY - box.top - 10,
                    title: `Week of ${fmtShort(f.weekStart)}`,
                    rows: [
                      ["Joined", String(f.joined)],
                      ["Left / kicked", String(f.left)],
                      ["Net", `${f.joined - f.left >= 0 ? "+" : ""}${f.joined - f.left}`],
                    ],
                  });
                }}
              >
                <rect x={cx - cw / 2} y={pt} width={cw} height={H - pt - pb} fill="transparent" />
                <rect x={cx - bw - 1} y={y(f.joined)} width={bw} height={y(0) - y(f.joined)} rx="3" fill="#34d399" />
                <rect x={cx + 1} y={y(f.left)} width={bw} height={y(0) - y(f.left)} rx="3" fill="#fb7185" />
                {i % 2 === 1 && (
                  <text x={cx} y={H - 6} fill="#71717a" fontSize="10" textAnchor="middle">
                    {fmtShort(f.weekStart)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        <Tooltip tip={tip} />
      </div>
      <p className="mt-2 text-xs text-zinc-400">
        <b className="text-emerald-400">+{J}</b> joined · <b className="text-rose-400">−{L}</b> left · net{" "}
        <b className="text-zinc-100">
          {J - L >= 0 ? "+" : ""}
          {J - L}
        </b>{" "}
        in 8 weeks
      </p>
    </div>
  );
}

const FEED_GROUPS: Record<string, string[]> = {
  leave: ["ATTENDANCE_LEAVE", "ATTENDANCE_RETURN", "LEAVE_SCHEDULED", "LEAVE_SCHEDULE_CANCELLED"],
  class: ["CLASS_CHANGE"],
  members: ["JOIN", "LEAVE", "KICK"],
};

function Feed({ items, now }: { items: FeedItem[]; now: number }) {
  const [filter, setFilter] = useState<"all" | "leave" | "class" | "members">("all");
  const shown = items.filter((i) => filter === "all" || FEED_GROUPS[filter].includes(i.type));
  const dayOf = (iso: string) => new Date(new Date(iso).getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  const today = dayOf(new Date(now).toISOString());
  const yesterday = dayOf(new Date(now - DAY).toISOString());
  const groups = new Map<string, FeedItem[]>();
  for (const i of shown) groups.set(dayOf(i.createdAt), [...(groups.get(dayOf(i.createdAt)) ?? []), i]);
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-zinc-100">Recent activity</h2>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {(
            [
              ["all", "All"],
              ["leave", "Leaves"],
              ["class", "Classes"],
              ["members", "Joins / Left"],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              type="button"
              onClick={() => setFilter(k)}
              className={`rounded-full border px-2.5 py-0.5 text-[11.5px] ${filter === k ? "border-amber-500/60 bg-amber-500/10 text-amber-200" : "border-zinc-800 text-zinc-400 hover:border-zinc-700"}`}
            >
              {l}
            </button>
          ))}
          <Link href="/activity" className="ml-1 text-xs text-amber-400 hover:text-amber-300">
            View all →
          </Link>
        </div>
      </div>
      {shown.length === 0 && <p className="py-6 text-center text-sm text-zinc-500">Nothing here yet</p>}
      {[...groups.entries()].map(([day, list]) => (
        <div key={day}>
          <p className="mb-1 mt-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
            {day === today ? "Today" : day === yesterday ? "Yesterday" : new Date(`${day}T12:00:00+07:00`).toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" })}
          </p>
          {list.map((i) => (
            <Link key={i.id} href={`/members/${i.member.id}`} className="flex items-center gap-2.5 rounded-lg px-1 py-1.5 transition hover:bg-zinc-800/40">
              <Avatar p={i.member} size={28} />
              <span className={`h-2 w-2 shrink-0 rounded-full ${eventTypeDotColors[i.type] ?? "bg-zinc-500"}`} />
              <span className="min-w-0 flex-1 truncate text-sm">
                <span className="font-semibold text-zinc-100">{i.member.name}</span> <span className="text-zinc-400">{eventLabels[i.type] ?? i.type}</span>
                {i.detail && <span className="text-zinc-500"> — {i.detail}</span>}
              </span>
              <span className="shrink-0 text-[11px] text-zinc-500">
                {new Date(i.createdAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" })}
              </span>
            </Link>
          ))}
        </div>
      ))}
    </div>
  );
}

function PeopleChips({ people, max = 6 }: { people: PersonRef[]; max?: number }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {people.slice(0, max).map((p) => (
        <Link key={p.id} href={`/members/${p.id}`} className="inline-flex items-center gap-1.5 rounded-full bg-zinc-950/60 py-0.5 pl-0.5 pr-2.5 text-xs text-zinc-200 hover:bg-zinc-800">
          <Avatar p={p} size={22} />
          <span className="max-w-[120px] truncate">{p.name}</span>
        </Link>
      ))}
      {people.length > max && <span className="self-center px-1 text-xs text-zinc-500">+{people.length - max}</span>}
    </div>
  );
}

export function OverviewDashboard({ overview: o, isAdmin, now, feed }: { overview: Overview; isAdmin: boolean; now: number; feed: FeedItem[] }) {
  const counted = o.trend.filter((t) => !t.void && t.attended + t.absent > 0);
  const rates = counted.map((t) => Math.round((t.attended / (t.attended + t.absent)) * 100));
  const avgRate = rates.length ? Math.round(rates.slice(-8).reduce((a, b) => a + b, 0) / Math.min(8, rates.length)) : null;
  const maxClass = Math.max(1, ...o.classes.map((c) => c.active + c.benched));
  const nr = o.nextRound;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-50">Guild Overview</h1>
        <p className="mt-1 text-sm text-zinc-400">
          {new Date(now).toLocaleDateString("th-TH", { weekday: "long", day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Bangkok" })} · member data synced from Discord
        </p>
      </div>

      <div className={`grid gap-4 ${isAdmin ? "lg:grid-cols-[2fr_1fr]" : ""}`}>
        <div className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-[radial-gradient(120%_140%_at_0%_0%,rgba(56,189,248,.16),transparent_55%)] bg-zinc-900/50 p-5">
          {!nr ? (
            <p className="text-sm text-zinc-500">No round scheduled in the next week.</p>
          ) : (
            <>
              <p className="flex flex-wrap items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-sky-300">
                ● Next round
                <span className="normal-case tracking-normal text-zinc-500">
                  {new Date(`${nr.date}T12:00:00+07:00`).toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" })} · {nr.timeLabel}
                </span>
              </p>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
                <span className="text-3xl font-bold text-zinc-50">{nr.label}</span>
                <span className="text-lg font-bold tabular-nums text-sky-300">{countdown(nr.start, nr.end, now)}</span>
              </div>
              <p className="mt-0.5 text-xs text-zinc-400">
                {nr.board ? `Party board “${nr.board.name}” · ${nr.board.parties} parties` : "No party board linked to this event"}
                {nr.lastRoundRate !== null ? ` · last round ${nr.lastRoundRate}% attended` : ""}
              </p>

              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-2.5">
                  <div className="text-xl font-bold tabular-nums text-zinc-50">{nr.expected}</div>
                  <div className="text-[10.5px] text-zinc-500">expected (active − on leave)</div>
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-2.5">
                  <div className="text-xl font-bold tabular-nums text-amber-300">{nr.onLeave.length}</div>
                  <div className="text-[10.5px] text-zinc-500">on leave</div>
                </div>
                {nr.board && (
                  <>
                    <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-2.5">
                      <div className="text-xl font-bold tabular-nums text-zinc-50">
                        {nr.board.slots - nr.board.empty}
                        <span className="text-sm text-zinc-500">/{nr.board.slots}</span>
                      </div>
                      <div className="text-[10.5px] text-zinc-500">slots filled</div>
                    </div>
                    <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-2.5">
                      <div className={`text-xl font-bold tabular-nums ${nr.board.seatedOnLeave ? "text-rose-400" : "text-emerald-400"}`}>{nr.board.seatedOnLeave}</div>
                      <div className="text-[10.5px] text-zinc-500">seated but on leave</div>
                    </div>
                  </>
                )}
              </div>

              {nr.board && nr.board.slots > 0 && (
                <div className="mt-3">
                  <div className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-zinc-800">
                    <span className="h-full bg-emerald-400" style={{ width: `${(nr.board.ready / nr.board.slots) * 100}%` }} />
                    <span className="h-full bg-amber-400" style={{ width: `${(nr.board.seatedOnLeave / nr.board.slots) * 100}%` }} />
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-3 text-[11px] text-zinc-400">
                    <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-emerald-400" />{nr.board.ready} ready</span>
                    {nr.board.seatedOnLeave > 0 && <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-amber-400" />{nr.board.seatedOnLeave} seated but on leave → needs a sub</span>}
                    <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-zinc-700" />{nr.board.empty} empty</span>
                  </div>
                </div>
              )}

              {nr.onLeave.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                  On leave:
                  <PeopleChips people={nr.onLeave} max={8} />
                </div>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                {nr.board && (
                  <Link href={`/party?board=${nr.board.id}`} className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-amber-500">
                    Open party board
                  </Link>
                )}
                <Link href="/calendar" className="rounded-lg bg-zinc-800 px-3 py-2 text-xs font-semibold text-zinc-100 transition hover:bg-zinc-700">
                  Calendar
                </Link>
                <Link href="/checkin" className="rounded-lg bg-zinc-800 px-3 py-2 text-xs font-semibold text-zinc-100 transition hover:bg-zinc-700">
                  Check-in
                </Link>
              </div>
            </>
          )}
        </div>

        {isAdmin && (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
            <h2 className="mb-2.5 text-sm font-semibold text-zinc-100">Needs attention</h2>
            <div className="flex flex-col gap-1.5">
              {o.attention.map((a) => {
                const tone = a.tone === "rose" ? "text-rose-400 bg-rose-500/10" : a.tone === "amber" ? "text-amber-300 bg-amber-500/10" : "text-sky-300 bg-sky-500/10";
                return (
                  <Link
                    key={a.key}
                    href={a.href}
                    className={`flex items-center gap-2.5 rounded-xl border border-transparent bg-zinc-950/50 px-3 py-2 transition hover:border-zinc-700 ${a.count === 0 ? "opacity-50" : ""}`}
                  >
                    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-sm font-bold tabular-nums ${a.count ? tone : "bg-zinc-800 text-zinc-500"}`}>{a.count > 99 ? "99+" : a.count}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-[12.5px] font-semibold text-zinc-100">{a.label}</span>
                      <span className="block truncate text-[11px] text-zinc-500">{a.hint}</span>
                    </span>
                    <span className="ml-auto text-zinc-600">›</span>
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-5">
        <Kpi
          label="Active members"
          value={o.counts.active}
          delta={<span className={`text-[11px] font-semibold ${o.activeDelta30 > 0 ? "text-emerald-400" : o.activeDelta30 < 0 ? "text-rose-400" : "text-zinc-500"}`}>{o.activeDelta30 > 0 ? "▲" : o.activeDelta30 < 0 ? "▼" : "─"} {Math.abs(o.activeDelta30)} <span className="font-normal text-zinc-500">30d</span></span>}
          spark={<Spark values={o.activeHistory} color="#34d399" />}
        />
        <Kpi label="Benched" value={o.counts.benched} delta={<span className="text-[11px] text-zinc-500">{o.counts.left + o.counts.kicked} left/kicked</span>} />
        <Kpi label="Avg attendance" value={avgRate === null ? "—" : `${avgRate}%`} delta={<span className="text-[11px] text-zinc-500">last {Math.min(8, rates.length)} rounds · leave excused</span>} spark={<Spark values={rates.slice(-8)} color="#34d399" />} />
        <Kpi
          label="PVP up to date"
          value={
            <>
              {o.pvpUpToDate}
              <span className="text-base text-zinc-500"> / {o.pvpRoster}</span>
            </>
          }
          delta={<span className="text-[11px] text-zinc-500">within 14 days</span>}
        />
        <Kpi label="Leaves this month" value={o.leavesThisMonth} delta={o.voidedThisMonth ? <span className="text-[11px] text-zinc-500">{o.voidedThisMonth} voided</span> : undefined} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <AttendanceChart trend={o.trend} />
        <FlowChart flow={o.flow} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
          <div className="mb-2 flex flex-wrap items-baseline gap-2">
            <h2 className="text-sm font-semibold text-zinc-100">Class composition</h2>
            <span className="ml-auto text-[11px] text-zinc-500">
              solid = active · faint = benched · +N also play it as secondary{o.partiesForRatio ? ` · / party = active ÷ ${o.partiesForRatio} parties` : ""}
            </span>
          </div>
          {o.classes.length === 0 ? (
            <p className="py-6 text-center text-sm text-zinc-500">No class data yet</p>
          ) : (
            <div className="flex flex-col">
              {o.classes.map((c) => {
                const color = HEX_CLASS[c.colorKey as ColorKey] ?? HEX_CLASS.stone;
                return (
                  <Link key={c.name} href={`/members?class=${encodeURIComponent(c.name)}`} className="grid grid-cols-[112px_1fr_34px_34px_44px] items-center gap-2.5 rounded-lg px-1 py-1 text-xs transition hover:bg-zinc-800/40">
                    <span className="truncate">
                      <ClassBadge className={c.name} />
                    </span>
                    <span className="flex h-2.5 gap-0.5 overflow-hidden rounded-sm bg-zinc-800/60" title={`${c.active} active · ${c.benched} benched`}>
                      <span className="h-full rounded-l-sm" style={{ width: `${(c.active / maxClass) * 100}%`, background: color }} />
                      <span className="h-full" style={{ width: `${(c.benched / maxClass) * 100}%`, background: color, opacity: 0.28 }} />
                    </span>
                    <span className="text-right font-medium tabular-nums text-zinc-200">{c.active}</span>
                    <span className="text-right text-[11px] tabular-nums text-zinc-500" title={c.alsoCount ? `${c.alsoCount} more list ${c.name} as a secondary class` : undefined}>
                      {c.alsoCount ? `+${c.alsoCount}` : ""}
                    </span>
                    <span className="text-right text-[11px] tabular-nums text-zinc-500">{o.partiesForRatio ? (c.active / o.partiesForRatio).toFixed(1) : ""}</span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
          <h2 className="text-sm font-semibold text-zinc-100">Shout-outs</h2>
          <div>
            <p className="mb-1.5 text-[10.5px] font-medium uppercase tracking-wide text-zinc-500">🏅 Perfect attendance this month ({o.shoutouts.perfect.length})</p>
            {o.shoutouts.perfect.length ? <PeopleChips people={o.shoutouts.perfect} /> : <p className="text-xs text-zinc-600">Needs at least 2 rounds this month</p>}
          </div>
          <div>
            <p className="mb-1.5 text-[10.5px] font-medium uppercase tracking-wide text-zinc-500">📈 Biggest CP gains this month</p>
            {o.shoutouts.climbers.length === 0 ? (
              <p className="text-xs text-zinc-600">No updates yet this month</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {o.shoutouts.climbers.map((p, i) => (
                  <Link key={p.id} href={`/pvp-stats/${p.id}`} className="flex items-center gap-2 text-xs hover:text-zinc-100">
                    <span className="w-3 text-zinc-600">{i + 1}</span>
                    <Avatar p={p} size={22} />
                    <span className="min-w-0 truncate text-zinc-200">{p.name}</span>
                    {p.className && <ClassBadge className={p.className} />}
                    <span className="ml-auto font-semibold tabular-nums text-emerald-400">+{p.gain.toLocaleString("th-TH")}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
          <div>
            <p className="mb-1.5 text-[10.5px] font-medium uppercase tracking-wide text-zinc-500">👋 Welcome aboard (last 14 days)</p>
            {o.shoutouts.welcome.length ? <PeopleChips people={o.shoutouts.welcome} /> : <p className="text-xs text-zinc-600">No new members</p>}
          </div>
        </div>
      </div>

      <Feed items={feed} now={now} />
    </div>
  );
}
