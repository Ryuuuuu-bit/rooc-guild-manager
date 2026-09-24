"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { DiscordRole } from "@/db/schema";
import type { DirectoryMember, MembersDirectory, RoundMark } from "@/lib/members-directory";
import { getMemberQuickProfile, type QuickProfile } from "@/app/actions/member-profile";
import { setMemberBenched, setMembersBenched } from "@/app/actions/members";
import { useJobClasses } from "@/components/job-classes-provider";
import { AltClassIcons, ClassBadge } from "@/components/badges";
import { ClassIcon } from "@/components/class-icon";
import { MemberAvatar } from "@/components/member-avatar";
import { RoleChips } from "@/components/role-chips";
import { eventLabels, eventTypeDotColors } from "@/lib/ui";

type StatusFilter = "current" | "active" | "benched" | "left" | "all";
type View = "table" | "roster";
type SortKey = "name" | "class" | "attendance" | "leaves" | "cp" | "joined";
type AttnKey = "noclass" | "noign" | "pvp" | "quota" | "lowatt" | "new";

const DAY = 24 * 60 * 60 * 1000;
const PVP_STALE_DAYS = 14;
const LOW_ATTENDANCE = 60;
const VIEW_STORAGE_KEY = "members-view";

const isCurrent = (m: DirectoryMember) => m.status === "ACTIVE";

function attendanceStats(m: DirectoryMember): { pct: number | null; counted: number } {
  const marks = m.attendance ?? [];
  const inCount = marks.filter((x) => x === "in").length;
  const outCount = marks.filter((x) => x === "out").length;
  const counted = inCount + outCount;
  return { pct: counted ? Math.round((inCount / counted) * 100) : null, counted };
}
const leaveTotal = (m: DirectoryMember) => Object.values(m.leaves ?? {}).reduce((a, b) => a + b, 0);

function tenure(joinedAt: string | null, now: number): string {
  if (!joinedAt) return "—";
  const days = Math.floor((now - new Date(joinedAt).getTime()) / DAY);
  if (days < 30) return `${Math.max(0, days)}d`;
  if (days < 365) return `${Math.floor(days / 30)} mo`;
  return `${(days / 365).toFixed(1)} y`;
}
function daysAgo(iso: string, now: number): string {
  const d = Math.floor((now - new Date(iso).getTime()) / DAY);
  return d <= 0 ? "today" : `${d}d ago`;
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit", timeZone: "Asia/Bangkok" });
}

const MARK_STYLE: Record<RoundMark, string> = {
  in: "h-4 bg-emerald-400",
  leave: "h-2.5 bg-amber-400",
  out: "h-1.5 bg-rose-400",
  na: "h-1 bg-zinc-700",
  void: "h-1 bg-zinc-700",
};
const MARK_LABEL: Record<RoundMark, string> = { in: "มา", leave: "ลา", out: "ขาด", na: "ไม่นับ", void: "พักการแข่ง" };

function AttendanceStrip({ marks, rounds, large = false }: { marks: RoundMark[]; rounds: MembersDirectory["rounds"]; large?: boolean }) {
  return (
    <div className={`flex items-end gap-0.5 ${large ? "h-6" : "h-4"}`}>
      {marks.map((mk, i) => (
        <span
          key={rounds[i]?.key ?? i}
          title={`${rounds[i]?.shortLabel ?? ""} ${rounds[i]?.date ?? ""} — ${MARK_LABEL[mk]}`}
          className={`rounded-[1px] ${large ? "w-3.5" : "w-1.5"} ${MARK_STYLE[mk]} ${large && mk === "in" ? "!h-6" : ""}`}
        />
      ))}
    </div>
  );
}

function StatusPill({ m }: { m: DirectoryMember }) {
  const [label, cls] =
    m.status === "KICKED"
      ? ["Kicked", "bg-rose-500/15 text-rose-300"]
      : m.status === "LEFT"
        ? ["Left", "bg-zinc-800 text-zinc-400"]
        : m.benched
          ? ["Benched", "bg-amber-500/15 text-amber-300"]
          : ["Active", "bg-emerald-500/15 text-emerald-300"];
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{label}</span>;
}
function statusDot(m: DirectoryMember): string {
  if (m.status === "KICKED") return "bg-rose-400";
  if (m.status === "LEFT") return "bg-zinc-500";
  return m.benched ? "bg-amber-400" : "bg-emerald-400";
}

function Kpi({ label, value, hint, dot, active, onClick }: { label: string; value: string | number; hint: string; dot: string; active?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`rounded-2xl border bg-zinc-900/50 px-4 py-3 text-left transition disabled:cursor-default ${
        active ? "border-amber-500/60 ring-1 ring-amber-500/30" : "border-zinc-800 enabled:hover:border-zinc-700"
      }`}
    >
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-400">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-zinc-50">{value}</div>
      <div className="text-[11px] text-zinc-500">{hint}</div>
    </button>
  );
}

function Chip({ on, warn, onClick, children }: { on: boolean; warn?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${
        on
          ? warn
            ? "border-rose-500/50 bg-rose-500/10 text-rose-300"
            : "border-amber-500/60 bg-amber-500/10 text-amber-200"
          : "border-zinc-800 bg-zinc-900/50 text-zinc-300 hover:border-zinc-700"
      }`}
    >
      {children}
    </button>
  );
}

function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function MembersDirectoryView({
  directory,
  roles,
  isAdmin,
  now,
  initial,
}: {
  directory: MembersDirectory;
  roles: DiscordRole[];
  isAdmin: boolean;
  /** Server "now" (ms) — keeps tenure/staleness identical on server and client renders. */
  now: number;
  initial: { status?: StatusFilter; className?: string; roleId?: string; q?: string };
}) {
  const router = useRouter();
  const { options: classOrder } = useJobClasses();
  const { members: all, rounds, monthlyLimit } = directory;
  const rolesById = useMemo(() => new Map(roles.map((r) => [r.id, r])), [roles]);

  const [status, setStatus] = useState<StatusFilter>(initial.status ?? "current");
  const [cls, setCls] = useState<string | null>(initial.className ?? null);
  const [roleId, setRoleId] = useState<string | null>(initial.roleId ?? null);
  const [attn, setAttn] = useState<AttnKey | null>(null);
  const [query, setQuery] = useState(initial.q ?? "");
  const [view, setView] = useState<View>("table");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "name", dir: 1 });
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const id = window.setTimeout(() => {
      try {
        const v = localStorage.getItem(VIEW_STORAGE_KEY);
        if (v === "table" || v === "roster") setView(v);
      } catch {
        /* ignore */
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, []);
  function changeView(v: View) {
    setView(v);
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, v);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "Escape") setOpenId(null);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const isNew = (m: DirectoryMember) => !!m.joinedAt && now - new Date(m.joinedAt).getTime() < 30 * DAY;
  const pvpStale = (m: DirectoryMember) => !m.pvp || now - new Date(m.pvp.updatedAt).getTime() > PVP_STALE_DAYS * DAY;
  const overQuota = (m: DirectoryMember) => Object.values(m.leaves ?? {}).some((n) => n > monthlyLimit);

  const ATTN: { key: AttnKey; label: string; test: (m: DirectoryMember) => boolean }[] = [
    { key: "noclass", label: "No class", test: (m) => isCurrent(m) && !m.className },
    { key: "noign", label: "No in-game name", test: (m) => isCurrent(m) && !m.inGameName },
    { key: "pvp", label: `PVP stale / missing`, test: (m) => isCurrent(m) && !m.benched && pvpStale(m) },
    { key: "quota", label: "Over leave quota", test: (m) => isCurrent(m) && overQuota(m) },
    {
      key: "lowatt",
      label: `Attendance < ${LOW_ATTENDANCE}%`,
      test: (m) => {
        const s = attendanceStats(m);
        return isCurrent(m) && !m.benched && s.counted >= 3 && s.pct !== null && s.pct < LOW_ATTENDANCE;
      },
    },
    { key: "new", label: "Joined < 30 days", test: (m) => isCurrent(m) && isNew(m) },
  ];

  const current = all.filter(isCurrent);
  const activeList = current.filter((m) => !m.benched);
  const benchedList = current.filter((m) => m.benched);
  const goneList = all.filter((m) => !isCurrent(m));
  const avgAttendance = (() => {
    const pcts = activeList.map((m) => attendanceStats(m).pct).filter((p): p is number => p !== null);
    return pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null;
  })();

  const base = all.filter((m) =>
    status === "current" ? isCurrent(m) : status === "active" ? isCurrent(m) && !m.benched : status === "benched" ? isCurrent(m) && m.benched : status === "left" ? !isCurrent(m) : true
  );
  const q = query.trim().toLowerCase();
  const attnTest = ATTN.find((a) => a.key === attn)?.test;
  const filtered = base.filter(
    (m) =>
      (!cls || m.className === cls || m.altClasses.includes(cls)) &&
      (!roleId || m.roleIds.includes(roleId)) &&
      (!attnTest || attnTest(m)) &&
      (!q || [m.name, m.username, m.inGameName ?? ""].some((x) => x.toLowerCase().includes(q)))
  );

  const sorted = [...filtered].sort((a, b) => {
    const key = (m: DirectoryMember): number | string => {
      switch (sort.key) {
        case "name":
          return m.name.toLowerCase();
        case "class":
          return m.className ? classOrder.indexOf(m.className) : 999;
        case "attendance":
          return attendanceStats(m).pct ?? -1;
        case "leaves":
          return leaveTotal(m);
        case "cp":
          return m.pvp?.cp ?? -1;
        case "joined":
          return m.joinedAt ? new Date(m.joinedAt).getTime() : 0;
      }
    };
    const x = key(a);
    const y = key(b);
    return (x < y ? -1 : x > y ? 1 : 0) * sort.dir || a.name.localeCompare(b.name, "th");
  });

  // Class chips: main-class count in the current status scope, plus how many more list it as a secondary.
  const classCounts = new Map<string, { main: number; alt: number }>();
  for (const m of base) {
    if (m.className) classCounts.set(m.className, { ...(classCounts.get(m.className) ?? { main: 0, alt: 0 }), main: (classCounts.get(m.className)?.main ?? 0) + 1 });
    for (const a of m.altClasses) {
      if (a === m.className) continue;
      classCounts.set(a, { ...(classCounts.get(a) ?? { main: 0, alt: 0 }), alt: (classCounts.get(a)?.alt ?? 0) + 1 });
    }
  }
  const classChips = [...classCounts.entries()].filter(([, c]) => c.main > 0).sort((a, b) => b[1].main - a[1].main);
  const roleCounts = roles.map((r) => ({ role: r, n: base.filter((m) => m.roleIds.includes(r.id)).length })).filter((x) => x.n > 0);

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "name" || key === "class" ? 1 : -1 }));
  }
  function toggleSelect(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const allVisibleSelected = sorted.length > 0 && sorted.every((m) => selected.has(m.id));
  function toggleAll() {
    setSelected((cur) => {
      const next = new Set(cur);
      if (allVisibleSelected) sorted.forEach((m) => next.delete(m.id));
      else sorted.forEach((m) => next.add(m.id));
      return next;
    });
  }

  function bulkBench(benched: boolean) {
    const people = all.filter((m) => selected.has(m.id) && isCurrent(m) && m.benched !== benched);
    if (people.length === 0) return;
    const verb = benched ? "Bench" : "Unbench";
    if (!confirm(`${verb} ${people.length} member(s)?\n\n${people.map((m) => m.name).join(", ")}${benched ? "\n\nBenching removes them from every party board and cancels their open leaves." : ""}`)) return;
    startTransition(async () => {
      try {
        const res = await setMembersBenched(
          people.map((m) => m.id),
          benched
        );
        if (!res.ok || res.error) alert(res.error ?? "Some members could not be updated");
        setSelected(new Set());
        router.refresh();
      } catch (err) {
        console.error("Bulk bench failed", err);
        alert("Failed. Please try again.");
      }
    });
  }
  async function copyMentions() {
    const text = all
      .filter((m) => selected.has(m.id))
      .map((m) => `<@${m.discordId}>`)
      .join(" ");
    try {
      await navigator.clipboard.writeText(text);
      alert(`Copied ${selected.size} mention(s) — paste into Discord.`);
    } catch {
      prompt("Copy these mentions:", text);
    }
  }
  function exportCsv() {
    const rows = selected.size ? sorted.filter((m) => selected.has(m.id)) : sorted;
    const head = ["Name", "Username", "In-game name", "Class", "Secondary classes", "Roles", "Status", "Joined", "CP", "PVP updated"];
    if (isAdmin) head.push("Attendance %", "Leaves this month");
    const lines = rows.map((m) => {
      const cells = [
        m.name,
        m.username,
        m.inGameName ?? "",
        m.className ?? "",
        m.altClasses.join(" / "),
        m.roleIds.map((id) => rolesById.get(id)?.name ?? "").filter(Boolean).join(" / "),
        m.status === "ACTIVE" ? (m.benched ? "Benched" : "Active") : m.status === "KICKED" ? "Kicked" : "Left",
        m.joinedAt ? m.joinedAt.slice(0, 10) : "",
        m.pvp?.cp != null ? String(m.pvp.cp) : "",
        m.pvp ? m.pvp.updatedAt.slice(0, 10) : "",
      ];
      if (isAdmin) {
        const s = attendanceStats(m);
        cells.push(s.pct === null ? "" : String(s.pct), Object.entries(m.leaves ?? {}).map(([k, n]) => `${k} ${n}`).join(" / "));
      }
      return cells.map(csvEscape).join(",");
    });
    const blob = new Blob(["﻿" + [head.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `members-${new Date(now).toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const sortHead = (key: SortKey, label: string) => (
    <th className="whitespace-nowrap px-3 py-2.5 text-left">
      <button type="button" onClick={() => toggleSort(key)} className={`inline-flex items-center gap-1 font-medium ${sort.key === key ? "text-amber-300" : "text-zinc-500 hover:text-zinc-300"}`}>
        {label}
        <span className={`text-[9px] ${sort.key === key ? "" : "opacity-30"}`}>{sort.key === key && sort.dir === -1 ? "▼" : "▲"}</span>
      </button>
    </th>
  );

  const table = (
    <div className="overflow-auto rounded-2xl border border-zinc-800 bg-zinc-900/50 max-h-[calc(100dvh-7rem)] [scrollbar-width:thin]">
      <table className="w-full min-w-[980px] text-sm">
        <thead className="sticky top-0 z-10 bg-zinc-900 text-[11px] uppercase tracking-wide [&_th]:shadow-[inset_0_-1px_0_#27272a]">
          <tr>
            {isAdmin && (
              <th className="w-10 px-3 py-2.5">
                <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} aria-label="Select all visible" className="h-4 w-4 accent-amber-500" />
              </th>
            )}
            {sortHead("name", "Member")}
            {sortHead("class", "Class")}
            <th className="px-3 py-2.5 text-left font-medium text-zinc-500">Roles</th>
            {isAdmin && sortHead("attendance", `Attendance · ${rounds.length} rounds`)}
            {isAdmin && sortHead("leaves", "Leaves this month")}
            {sortHead("cp", "PVP")}
            {sortHead("joined", "Joined")}
            <th className="px-3 py-2.5 text-left font-medium text-zinc-500">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/70">
          {sorted.length === 0 && (
            <tr>
              <td colSpan={9} className="px-4 py-10 text-center text-zinc-500">
                No members match
              </td>
            </tr>
          )}
          {sorted.map((m) => {
            const att = attendanceStats(m);
            const viaAlt = cls && m.className !== cls;
            return (
              <tr
                key={m.id}
                onClick={() => setOpenId(m.id)}
                className={`cursor-pointer transition hover:bg-zinc-800/40 ${selected.has(m.id) ? "bg-amber-500/5" : ""} ${isCurrent(m) ? "" : "opacity-60"}`}
              >
                {isAdmin && (
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(m.id)} onChange={() => toggleSelect(m.id)} aria-label={`Select ${m.name}`} className="h-4 w-4 accent-amber-500" />
                  </td>
                )}
                <td className="px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="relative shrink-0">
                      <MemberAvatar src={m.avatar} alt={m.name} width={34} height={34} className="h-[34px] w-[34px] rounded-full" />
                      <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-zinc-900 ${statusDot(m)}`} />
                    </span>
                    <div className="min-w-0">
                      <div className="max-w-[220px] truncate font-semibold text-zinc-100">{m.name}</div>
                      <div className="max-w-[220px] truncate text-[11px] text-zinc-500">
                        @{m.username}
                        {!m.inGameName ? <span className="text-rose-400"> · no IGN</span> : m.inGameName !== m.name ? <span className="text-zinc-400"> · IGN {m.inGameName}</span> : null}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  <span className="inline-flex items-center gap-1.5">
                    <ClassBadge className={m.className} />
                    <AltClassIcons altClasses={m.altClasses} />
                    {viaAlt && <span className="rounded bg-zinc-800 px-1 text-[10px] text-zinc-400">รอง</span>}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <RoleChips roleIds={m.roleIds} rolesById={rolesById} max={2} />
                </td>
                {isAdmin && (
                  <td className="px-3 py-2">
                    {rounds.length === 0 ? (
                      <span className="text-xs text-zinc-600">no data</span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <AttendanceStrip marks={m.attendance ?? []} rounds={rounds} />
                        <span className={`text-[11px] tabular-nums ${att.pct !== null && att.pct < LOW_ATTENDANCE ? "text-rose-400" : "text-zinc-400"}`}>{att.pct === null ? "—" : `${att.pct}%`}</span>
                      </div>
                    )}
                  </td>
                )}
                {isAdmin && (
                  <td className="whitespace-nowrap px-3 py-2 text-xs tabular-nums">
                    {Object.keys(m.leaves ?? {}).length === 0 ? (
                      <span className="text-zinc-600">—</span>
                    ) : (
                      Object.entries(m.leaves ?? {}).map(([k, n]) => (
                        <span key={k} className={`mr-2 ${n > monthlyLimit ? "font-semibold text-rose-400" : "text-zinc-300"}`} title={`Guild rule: ${monthlyLimit} per board per month`}>
                          {k} {n}
                          {n > monthlyLimit ? " ⚠" : ""}
                        </span>
                      ))
                    )}
                  </td>
                )}
                <td className="whitespace-nowrap px-3 py-2">
                  {m.pvp?.cp != null ? (
                    <>
                      <div className="font-semibold tabular-nums text-amber-200">{m.pvp.cp.toLocaleString("th-TH")}</div>
                      <div className={`text-[11px] ${pvpStale(m) ? "text-rose-400" : "text-zinc-500"}`}>{daysAgo(m.pvp.updatedAt, now)}</div>
                    </>
                  ) : (
                    <span className="text-[11px] text-zinc-600">not submitted</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  <div className="text-xs text-zinc-300">{tenure(m.joinedAt, now)}</div>
                  <div className="text-[11px] text-zinc-500">{m.joinedAt ? fmtDate(m.joinedAt) : ""}</div>
                </td>
                <td className="px-3 py-2">
                  <StatusPill m={m} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const roster = (() => {
    // With a class filter on, people who only match via a SECONDARY class get
    // their own column instead of showing up under their main class.
    const ALT = "\u0000alt";
    const groups = new Map<string, DirectoryMember[]>();
    for (const m of sorted) {
      const key = cls && m.className !== cls ? ALT : (m.className ?? "");
      groups.set(key, [...(groups.get(key) ?? []), m]);
    }
    const rank = (k: string) => (k === ALT ? 2 : k ? 0 : 1);
    const cols = [...groups.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || b[1].length - a[1].length);
    const mini = (m: DirectoryMember) => (
      <button key={m.id} type="button" onClick={() => setOpenId(m.id)} className={`flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left transition hover:bg-zinc-800 ${m.benched || !isCurrent(m) ? "opacity-50" : ""}`}>
        <MemberAvatar src={m.avatar} alt={m.name} width={24} height={24} className="h-6 w-6 shrink-0 rounded-full" />
        <span className="min-w-0 flex-1 truncate text-xs text-zinc-200">{m.name}</span>
        {m.altClasses.length > 0 && <AltClassIcons altClasses={m.altClasses} size={10} />}
      </button>
    );
    return (
      <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))" }}>
        {cols.length === 0 && <p className="col-span-full py-10 text-center text-sm text-zinc-500">No members match</p>}
        {cols.map(([c, list]) => {
          const main = list.filter((m) => isCurrent(m) && !m.benched);
          const rest = list.filter((m) => !isCurrent(m) || m.benched);
          return (
            <div key={c || "none"} className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-2.5">
              <div className="mb-1.5 flex items-center justify-between px-1">
                {c === ALT ? (
                  <span className="text-xs font-medium text-zinc-300">Plays {cls} as secondary</span>
                ) : c ? (
                  <ClassBadge className={c} />
                ) : (
                  <span className="text-xs text-zinc-500">No class</span>
                )}
                <span className="text-[11px] text-zinc-500">
                  {main.length}
                  {rest.length ? ` + ${rest.length} benched/gone` : ""}
                </span>
              </div>
              {main.map(mini)}
              {rest.length > 0 && <p className="mx-1.5 mb-1 mt-2 text-[9px] font-semibold uppercase tracking-wider text-zinc-600">Benched / gone</p>}
              {rest.map(mini)}
            </div>
          );
        })}
      </div>
    );
  })();

  const open = all.find((m) => m.id === openId) ?? null;

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-50">Guild Members</h1>
          <p className="mt-1 text-sm text-zinc-400">
            {current.length} current members · {goneList.length} left or kicked
          </p>
        </div>
        <button type="button" onClick={exportCsv} className="ml-auto rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-xs text-zinc-300 transition hover:border-zinc-700">
          ⤓ Export CSV{selected.size ? ` (${selected.size})` : ""}
        </button>
      </div>

      <div className={`grid gap-2.5 grid-cols-2 ${isAdmin ? "md:grid-cols-5" : "md:grid-cols-4"}`}>
        <Kpi label="Active" value={activeList.length} hint="playing, not benched" dot="bg-emerald-400" active={status === "active"} onClick={() => setStatus(status === "active" ? "current" : "active")} />
        <Kpi label="Benched" value={benchedList.length} hint="out of party & loot" dot="bg-amber-400" active={status === "benched"} onClick={() => setStatus(status === "benched" ? "current" : "benched")} />
        <Kpi label="New (30 days)" value={current.filter(isNew).length} hint="joined the server recently" dot="bg-sky-400" active={attn === "new"} onClick={() => setAttn(attn === "new" ? null : "new")} />
        {isAdmin && <Kpi label="Avg attendance" value={avgAttendance === null ? "—" : `${avgAttendance}%`} hint={`last ${rounds.length} rounds, leave excused`} dot="bg-violet-400" />}
        <Kpi label="Left / kicked" value={goneList.length} hint="kept for history" dot="bg-zinc-500" active={status === "left"} onClick={() => setStatus(status === "left" ? "current" : "left")} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <svg viewBox="0 0 20 20" fill="currentColor" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500">
            <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 3.61 9.65l3.62 3.62a.75.75 0 1 0 1.06-1.06l-3.62-3.62A5.5 5.5 0 0 0 9 3.5ZM5 9a4 4 0 1 1 8 0 4 4 0 0 1-8 0Z" clipRule="evenodd" />
          </svg>
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, @username or in-game name"
            className="w-full rounded-xl border border-zinc-800 bg-zinc-900/50 py-2 pl-9 pr-8 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none"
          />
          <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-zinc-700 px-1 text-[10px] text-zinc-500">/</kbd>
        </div>
        <div className="flex flex-wrap items-center gap-0.5 rounded-xl border border-zinc-800 bg-zinc-900/50 p-0.5">
          {(
            [
              ["current", "Current", current.length],
              ["active", "Active", activeList.length],
              ["benched", "Benched", benchedList.length],
              ["left", "Left/Kicked", goneList.length],
              ["all", "All", all.length],
            ] as const
          ).map(([k, label, n]) => (
            <button
              key={k}
              type="button"
              onClick={() => setStatus(k)}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${status === k ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}
            >
              {label}
              <span className={`ml-1 tabular-nums ${status === k ? "text-zinc-400" : "text-zinc-600"}`}>{n}</span>
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-0.5 rounded-xl border border-zinc-800 bg-zinc-900/50 p-0.5">
          {(["table", "roster"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => changeView(v)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${view === v ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}
            >
              {v === "table" ? "☰ Table" : "▦ Roster"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">Class</span>
        {classChips.map(([name, c]) => (
          <Chip key={name} on={cls === name} onClick={() => setCls(cls === name ? null : name)}>
            <ClassIcon job={name} size={12} />
            {name}
            <span className="tabular-nums text-zinc-500">
              {c.main}
              {c.alt ? <span title="also list it as a secondary class"> +{c.alt}</span> : null}
            </span>
          </Chip>
        ))}
        {roleCounts.length > 0 && <span className="ml-2 mr-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">Role</span>}
        {roleCounts.map(({ role, n }) => (
          <Chip key={role.id} on={roleId === role.id} onClick={() => setRoleId(roleId === role.id ? null : role.id)}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: role.color ? `#${role.color.toString(16).padStart(6, "0")}` : "#71717a" }} />
            {role.name}
            <span className="tabular-nums text-zinc-500">{n}</span>
          </Chip>
        ))}
      </div>

      {isAdmin && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">Needs attention</span>
          {ATTN.map((a) => {
            const n = all.filter(a.test).length;
            if (!n) return null;
            return (
              <Chip
                key={a.key}
                on={attn === a.key}
                warn
                onClick={() => {
                  setAttn(attn === a.key ? null : a.key);
                  if (attn !== a.key) setStatus("current");
                }}
              >
                {a.label}
                <span className="tabular-nums text-zinc-500">{n}</span>
              </Chip>
            );
          })}
        </div>
      )}

      {view === "table" ? table : roster}

      {isAdmin && rounds.length > 0 && view === "table" && (
        <p className="-mt-1.5 text-[11px] text-zinc-600">
          Attendance strip, oldest → newest: <span className="text-emerald-400">■</span> in voice · <span className="text-amber-300">■</span> on leave (excused) · <span className="text-rose-400">■</span> absent · <span className="text-zinc-500">▪</span> not counted (benched / not joined yet / break). % = in ÷ (in + absent).
        </p>
      )}

      {isAdmin && selected.size > 0 && (
        <div className="sticky bottom-3 z-20 mx-auto flex flex-wrap items-center gap-2 rounded-2xl border border-zinc-700 bg-zinc-800/95 px-3 py-2 shadow-2xl backdrop-blur">
          <span className="text-sm font-semibold text-zinc-100">{selected.size} selected</span>
          <button type="button" disabled={pending} onClick={() => bulkBench(true)} className="rounded-lg bg-zinc-700 px-2.5 py-1 text-xs text-zinc-100 hover:bg-zinc-600 disabled:opacity-50">
            Bench
          </button>
          <button type="button" disabled={pending} onClick={() => bulkBench(false)} className="rounded-lg bg-zinc-700 px-2.5 py-1 text-xs text-zinc-100 hover:bg-zinc-600 disabled:opacity-50">
            Unbench
          </button>
          <button type="button" onClick={copyMentions} className="rounded-lg bg-zinc-700 px-2.5 py-1 text-xs text-zinc-100 hover:bg-zinc-600">
            Copy @mentions
          </button>
          <button type="button" onClick={exportCsv} className="rounded-lg bg-zinc-700 px-2.5 py-1 text-xs text-zinc-100 hover:bg-zinc-600">
            Export CSV
          </button>
          <button type="button" onClick={() => setSelected(new Set())} className="px-1.5 text-xs text-zinc-400 hover:text-zinc-200">
            Clear
          </button>
        </div>
      )}

      <QuickProfileDrawer member={open} isAdmin={isAdmin} rounds={rounds} monthlyLimit={monthlyLimit} now={now} onClose={() => setOpenId(null)} />
    </div>
  );
}

function QuickProfileDrawer({
  member,
  isAdmin,
  rounds,
  monthlyLimit,
  now,
  onClose,
}: {
  member: DirectoryMember | null;
  isAdmin: boolean;
  rounds: MembersDirectory["rounds"];
  monthlyLimit: number;
  now: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const [profile, setProfile] = useState<{ id: string; data: QuickProfile } | null>(null);
  const [pending, startTransition] = useTransition();
  const memberId = member?.id ?? null;

  useEffect(() => {
    if (!memberId) return;
    let cancelled = false;
    getMemberQuickProfile(memberId)
      .then((data) => {
        if (!cancelled) setProfile({ id: memberId, data });
      })
      .catch((err) => console.error("Failed to load quick profile", err));
    return () => {
      cancelled = true;
    };
  }, [memberId]);

  const data = profile && profile.id === memberId ? profile.data : null;
  const att = member ? attendanceStats(member) : { pct: null, counted: 0 };

  function toggleBench() {
    if (!member) return;
    const next = !member.benched;
    if (!confirm(next ? `Bench ${member.name}? They'll be removed from every party board and their open leaves cancelled.` : `Unbench ${member.name}?`)) return;
    startTransition(async () => {
      try {
        const res = await setMemberBenched(member.id, next);
        if (!res.ok) alert(res.error ?? "Failed");
        router.refresh();
      } catch (err) {
        console.error("Bench toggle failed", err);
        alert("Failed. Please try again.");
      }
    });
  }

  return (
    <>
      <div className={`fixed inset-0 z-40 bg-black/50 transition-opacity ${member ? "opacity-100" : "pointer-events-none opacity-0"}`} onClick={onClose} />
      <aside
        className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-[420px] flex-col border-l border-zinc-700 bg-zinc-950 shadow-2xl transition-transform duration-200 ${member ? "translate-x-0" : "translate-x-full"}`}
        aria-hidden={!member}
      >
        {member && (
          <>
            <div className="relative flex items-center gap-3.5 border-b border-zinc-800 bg-[linear-gradient(160deg,rgba(245,158,11,.1),transparent_55%)] p-4">
              <MemberAvatar src={member.avatar} alt={member.name} width={60} height={60} className="h-[60px] w-[60px] shrink-0 rounded-full" />
              <div className="min-w-0">
                <div className="truncate text-lg font-bold text-zinc-50">{member.name}</div>
                <div className="truncate text-xs text-zinc-500">
                  @{member.username}
                  {member.inGameName ? ` · IGN ${member.inGameName}` : ""}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <ClassBadge className={member.className} />
                  {member.altClasses.map((a) => (
                    <ClassBadge key={a} className={a} />
                  ))}
                  <StatusPill m={member} />
                </div>
              </div>
              <button type="button" onClick={onClose} className="absolute right-3 top-2.5 text-lg text-zinc-500 hover:text-zinc-200" aria-label="Close">
                ✕
              </button>
            </div>

            <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
              <div className={`grid gap-1.5 text-center ${isAdmin ? "grid-cols-3" : "grid-cols-2"}`}>
                {isAdmin && (
                  <div className="rounded-xl bg-zinc-900 p-2">
                    <div className={`text-lg font-bold tabular-nums ${att.pct !== null && att.pct < LOW_ATTENDANCE ? "text-rose-400" : "text-emerald-300"}`}>{att.pct === null ? "—" : `${att.pct}%`}</div>
                    <div className="text-[10px] text-zinc-500">attendance</div>
                  </div>
                )}
                <div className="rounded-xl bg-zinc-900 p-2">
                  <div className="text-lg font-bold tabular-nums text-amber-200">{member.pvp?.cp != null ? member.pvp.cp.toLocaleString("th-TH") : "—"}</div>
                  <div className="text-[10px] text-zinc-500">CP</div>
                </div>
                <div className="rounded-xl bg-zinc-900 p-2">
                  <div className="text-lg font-bold tabular-nums text-zinc-100">{tenure(member.joinedAt, now)}</div>
                  <div className="text-[10px] text-zinc-500">in the server</div>
                </div>
              </div>

              {isAdmin && rounds.length > 0 && (
                <div>
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Last {rounds.length} rounds</p>
                  <AttendanceStrip marks={member.attendance ?? []} rounds={rounds} large />
                </div>
              )}

              {isAdmin && (
                <div>
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Leaves this month</p>
                  {Object.keys(member.leaves ?? {}).length === 0 ? (
                    <p className="text-xs text-zinc-500">None</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(member.leaves ?? {}).map(([k, n]) => (
                        <span key={k} className={`rounded-full px-2 py-0.5 text-xs ${n > monthlyLimit ? "bg-rose-500/15 font-semibold text-rose-300" : "bg-zinc-800 text-zinc-300"}`}>
                          {k} {n}/{monthlyLimit}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Recent activity</p>
                {!data ? (
                  <p className="text-xs text-zinc-600">Loading…</p>
                ) : data.events.length === 0 ? (
                  <p className="text-xs text-zinc-500">Nothing logged yet</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {data.events.map((e) => (
                      <div key={e.id} className="flex gap-2.5 text-xs">
                        <span className="w-16 shrink-0 text-[11px] text-zinc-500">{fmtDate(e.createdAt)}</span>
                        <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${eventTypeDotColors[e.type] ?? "bg-zinc-500"}`} />
                        <span className="min-w-0 text-zinc-300">
                          <span className="text-zinc-400">{eventLabels[e.type] ?? e.type}</span>
                          {e.detail ? ` — ${e.detail}` : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {isAdmin && data?.note && (
                <div>
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Latest internal note</p>
                  <div className="rounded-xl bg-zinc-900 p-2.5 text-xs text-zinc-300">
                    {data.note.body}
                    <div className="mt-1 text-[10px] text-zinc-500">
                      — {data.note.author}, {fmtDate(data.note.createdAt)}
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-auto grid grid-cols-2 gap-1.5">
                <Link href={`/members/${member.id}`} className="col-span-2 rounded-lg bg-amber-600 px-3 py-2 text-center text-sm font-medium text-white transition hover:bg-amber-500">
                  Open full profile →
                </Link>
                {isAdmin && isCurrent(member) && (
                  <button type="button" disabled={pending} onClick={toggleBench} className="rounded-lg bg-zinc-800 px-3 py-2 text-xs text-zinc-100 transition hover:bg-zinc-700 disabled:opacity-50">
                    {member.benched ? "Unbench" : "Bench"}
                  </button>
                )}
                {isAdmin && (
                  <Link href={`/members/${member.id}`} className="rounded-lg bg-zinc-800 px-3 py-2 text-center text-xs text-zinc-100 transition hover:bg-zinc-700">
                    Edit class · log leave · kick
                  </Link>
                )}
              </div>
            </div>
          </>
        )}
      </aside>
    </>
  );
}
