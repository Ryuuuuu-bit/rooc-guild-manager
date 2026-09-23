"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Member, PvpStatEntry } from "@/db/schema";
import { memberDisplayName } from "@/lib/ui";
import { fmtInt, fmtPct, type PvpCustomFieldDef } from "@/lib/pvp-stat-fields";
import { useJobClasses } from "@/components/job-classes-provider";
import { AltClassIcons, ClassBadge } from "@/components/badges";
import { ClassIcon } from "@/components/class-icon";
import { MemberAvatar } from "@/components/member-avatar";
import { PvpStatCard } from "@/components/pvp-stat-card";
import { PvpReviewBadge, PvpReviewButton } from "@/components/pvp-stat-review";
import { isReviewStatus } from "@/lib/pvp-stat-review";
import { AdminEditEntryButton } from "@/components/pvp-stat-admin-entry";

type PvpStatMember = Pick<
  Member,
  "id" | "discordNickname" | "discordGlobalName" | "discordUsername" | "discordAvatar" | "characterClass" | "altClasses" | "inGameName"
>;

type PvpStatsRow = { member: PvpStatMember; entry: PvpStatEntry | null };

/** "name" and "class" read off the member; a custom field is prefixed
 * "custom:<key>" to disambiguate from the fixed entry columns; every other
 * key is a numeric column straight off `entry` (cp, pDef, atk, ...). */
type SortKey = "name" | "class" | (string & {});
type SortDir = "asc" | "desc";

// ---------------------------------------------------------------------------
// Column model — every non-sticky column is one of these, so visibility,
// presets, the compare drawer and the table itself all read ONE list.
// ---------------------------------------------------------------------------

type ColumnGroup = "identity" | "base" | "defense" | "attack" | "custom" | "meta";

interface ColumnDef {
  key: string;
  label: string;
  group: ColumnGroup;
  /** Numeric stat (sortable, gets highlight badges, appears in compare). */
  numeric: boolean;
  isPercent?: boolean;
}

const FIXED_COLUMNS: ColumnDef[] = [
  { key: "class", label: "Class", group: "identity", numeric: false },
  { key: "role", label: "Role", group: "identity", numeric: false },
  { key: "status", label: "Status", group: "identity", numeric: false },
  { key: "cp", label: "CP", group: "base", numeric: true },
  { key: "pDef", label: "P.DEF", group: "defense", numeric: true },
  { key: "mDef", label: "M.DEF", group: "defense", numeric: true },
  { key: "pvpReduction", label: "PVP Red.", group: "defense", numeric: true },
  { key: "pDmgReductionPct", label: "P.DMG Red%", group: "defense", numeric: true, isPercent: true },
  { key: "mDmgReductionPct", label: "M.DMG Red%", group: "defense", numeric: true, isPercent: true },
  { key: "atk", label: "ATK", group: "attack", numeric: true },
  { key: "matk", label: "MATK", group: "attack", numeric: true },
  { key: "pvpBonus", label: "PVP Bonus", group: "attack", numeric: true },
  { key: "ignorePDef", label: "Ign. P.DEF", group: "attack", numeric: true },
  { key: "ignoreMDef", label: "Ign. M.DEF", group: "attack", numeric: true },
  { key: "pDmgBonusPct", label: "P.DMG Bonus%", group: "attack", numeric: true, isPercent: true },
  { key: "mDmgBonusPct", label: "M.DMG Bonus%", group: "attack", numeric: true, isPercent: true },
  { key: "bossCards", label: "Boss Cards", group: "meta", numeric: false },
  { key: "updatedAt", label: "Last Updated", group: "meta", numeric: false },
];

/** Admin-added fields join the fixed list; their group is inferred from the
 * admin's group title so the Tank/DPS presets pick them up too. */
function customToColumn(f: PvpCustomFieldDef): ColumnDef {
  const t = f.groupTitle.toLowerCase();
  // English or Thai group titles both route into the Tank/DPS presets.
  const group: ColumnGroup = /def|reduc|tank|hp|guard|ป้องกัน|ลดดาเมจ|ถึก/.test(t)
    ? "defense"
    : /atk|attack|dmg|damage|dps|offen|โจมตี|ดาเมจ|ตี/.test(t)
      ? "attack"
      : "custom";
  return { key: `custom:${f.key}`, label: f.label, group, numeric: true, isPercent: f.isPercent };
}

type PresetKey = "all" | "tank" | "dps" | "compact";

const PRESETS: { key: PresetKey; label: string; hint: string; groups: ColumnGroup[] | null }[] = [
  { key: "all", label: "All columns", hint: "Everything", groups: null },
  { key: "tank", label: "Tank / Defensive", hint: "CP + defense stats", groups: ["identity", "base", "defense"] },
  { key: "dps", label: "DPS / Offensive", hint: "CP + attack stats", groups: ["identity", "base", "attack"] },
  { key: "compact", label: "Compact", hint: "CP, DEF, ATK only", groups: null },
];
const COMPACT_KEYS = new Set(["class", "cp", "pDef", "mDef", "atk", "matk", "updatedAt"]);
const VISIBILITY_STORAGE_KEY = "pvp-stats-hidden-columns";
const MAX_COMPARE = 4;

/** Name/class start A→Z; every numeric stat starts high-to-low — that's the
 * direction you want the first time you click a stat column while reviewing. */
function defaultDirFor(key: SortKey): SortDir {
  return key === "name" || key === "class" ? "asc" : "desc";
}

function getStatValue(entry: PvpStatEntry | null, key: string): number | null {
  if (!entry) return null;
  if (key.startsWith("custom:")) {
    const v = entry.customValues?.[key.slice(7)];
    return typeof v === "number" ? v : null;
  }
  const v = (entry as unknown as Record<string, unknown>)[key];
  return typeof v === "number" ? v : null;
}

function fmtStat(col: ColumnDef, value: number | null): string {
  return col.isPercent ? fmtPct(value) : fmtInt(value);
}

/** A submission older than this (or no submission at all) reads as overdue —
 * the guild's cadence is weekly, so two full cycles of silence is a fair
 * "someone should follow up" line without flagging everyone the week after
 * an event. */
const STALE_DAYS = 14;

function daysSince(date: Date | string | number): number {
  return Math.floor((Date.now() - new Date(date).getTime()) / (24 * 60 * 60 * 1000));
}

function isStale(entry: PvpStatEntry | null): boolean {
  return !entry || daysSince(entry.createdAt) > STALE_DAYS;
}

function StaleIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="mr-1 inline h-3 w-3 shrink-0 align-[-1px] text-rose-400">
      <path
        fillRule="evenodd"
        d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 6a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 6Zm0 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 12 12" fill="currentColor" className="h-3 w-3">
      <path d="M4.7 8.3 2.4 6l-.9.9L4.7 10l6-6-.9-.9z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Highlight badges — per numeric column, rank every submitted value; the top
// three get a medal-coloured badge and the top 10% a subtle green tint, so
// a standout number is visible without sorting by that column.
// ---------------------------------------------------------------------------

type Highlight = { rank: number; topDecile: boolean };

function computeHighlights(rows: PvpStatsRow[], columns: ColumnDef[]): Map<string, Map<string, Highlight>> {
  const out = new Map<string, Map<string, Highlight>>();
  for (const col of columns) {
    if (!col.numeric) continue;
    const vals = rows
      .map((r) => ({ id: r.member.id, v: getStatValue(r.entry, col.key) }))
      .filter((x): x is { id: string; v: number } => x.v !== null && x.v > 0)
      .sort((a, b) => b.v - a.v);
    const perMember = new Map<string, Highlight>();
    const decileCut = Math.max(3, Math.ceil(vals.length * 0.1));
    vals.forEach((x, i) => {
      // Ties share a rank (1, 1, 3 …).
      const rank = i > 0 && vals[i - 1].v === x.v ? perMember.get(vals[i - 1].id)!.rank : i + 1;
      perMember.set(x.id, { rank, topDecile: i < decileCut });
    });
    out.set(col.key, perMember);
  }
  return out;
}

const RANK_BADGE: Record<number, string> = {
  1: "bg-amber-400/20 text-amber-300 ring-amber-400/40",
  2: "bg-zinc-300/15 text-zinc-200 ring-zinc-400/40",
  3: "bg-orange-700/25 text-orange-300 ring-orange-600/40",
};

function StatCell({ col, value, hl }: { col: ColumnDef; value: number | null; hl?: Highlight }) {
  const text = fmtStat(col, value);
  if (value === null) return <span className="text-zinc-600">—</span>;
  if (hl && hl.rank <= 3) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ring-1 ring-inset ${RANK_BADGE[hl.rank]}`}
        title={`#${hl.rank} in ${col.label}`}
      >
        <span className="text-[9px] opacity-70">#{hl.rank}</span>
        {text}
      </span>
    );
  }
  return <span className={`tabular-nums ${hl?.topDecile ? "font-medium text-emerald-300" : col.key === "cp" ? "font-medium text-amber-200" : "text-zinc-300"}`}>{text}</span>;
}

// ---------------------------------------------------------------------------
// Header + dropdown helpers
// ---------------------------------------------------------------------------

function SortHeader({
  label,
  sortKey,
  active,
  dir,
  onSort,
  align = "left",
}: {
  label: string;
  sortKey: SortKey;
  active: boolean;
  dir: SortDir;
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
}) {
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={`inline-flex w-full items-center gap-1 whitespace-nowrap font-medium transition hover:text-zinc-200 ${
        align === "right" ? "flex-row-reverse" : ""
      } ${active ? "text-amber-300" : "text-zinc-500"}`}
    >
      {label}
      <span className={active ? "text-[9px] opacity-100" : "text-[9px] opacity-30"}>{dir === "asc" ? "▲" : "▼"}</span>
    </button>
  );
}

/** Generic click-outside dropdown shell shared by the class filter and the column menu. */
function Dropdown({ trigger, children, width = "w-56" }: { trigger: (open: boolean) => React.ReactNode; children: React.ReactNode; width?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <div onClick={() => setOpen((v) => !v)}>{trigger(open)}</div>
      {open && (
        <div className={`absolute left-0 top-full z-30 mt-1 flex max-h-96 ${width} flex-col gap-0.5 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-900 p-1.5 shadow-xl`}>
          {children}
        </div>
      )}
    </div>
  );
}

function pillClass(active: boolean) {
  return `whitespace-nowrap rounded-xl border px-3 py-2 text-sm font-medium transition ${
    active ? "border-amber-500/60 bg-amber-500/15 text-amber-300" : "border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
  }`;
}

function CheckRow({ checked, onClick, children }: { checked: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition ${checked ? "bg-zinc-800/80" : "hover:bg-zinc-800/50"}`}>
      <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${checked ? "border-amber-500 bg-amber-500 text-zinc-950" : "border-zinc-700"}`}>
        {checked && <CheckIcon />}
      </span>
      {children}
    </button>
  );
}

function ClassFilterDropdown({ selected, onToggle, onClear }: { selected: Set<string>; onToggle: (name: string) => void; onClear: () => void }) {
  const { classes } = useJobClasses();
  return (
    <Dropdown trigger={() => <button type="button" className={pillClass(selected.size > 0)}>Class{selected.size > 0 ? ` · ${selected.size}` : ""}</button>}>
      {classes.length === 0 && <p className="px-2.5 py-2 text-xs text-zinc-500">No classes yet</p>}
      {classes.map((c) => (
        <CheckRow key={c.id} checked={selected.has(c.name)} onClick={() => onToggle(c.name)}>
          <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${c.colorClass}`}>
            <ClassIcon job={c.name} size={12} />
            {c.name}
          </span>
        </CheckRow>
      ))}
      {selected.size > 0 && (
        <button type="button" onClick={onClear} className="mt-1 rounded-lg border-t border-zinc-800 px-2.5 pt-2 text-left text-xs text-zinc-500 transition hover:text-zinc-300">
          Clear class filter
        </button>
      )}
    </Dropdown>
  );
}

const GROUP_LABEL: Record<ColumnGroup, string> = { identity: "Member", base: "Base", defense: "Defense", attack: "Attack", custom: "Other", meta: "Meta" };

function ColumnMenu({
  columns,
  hidden,
  preset,
  onPreset,
  onToggle,
}: {
  columns: ColumnDef[];
  hidden: Set<string>;
  preset: PresetKey | null;
  onPreset: (p: PresetKey) => void;
  onToggle: (key: string) => void;
}) {
  const visibleCount = columns.length - hidden.size;
  const groups = (["identity", "base", "defense", "attack", "custom", "meta"] as ColumnGroup[]).filter((g) => columns.some((c) => c.group === g));
  return (
    <Dropdown
      width="w-64"
      trigger={() => (
        <button type="button" className={pillClass(hidden.size > 0)}>
          Columns · {visibleCount}/{columns.length}
        </button>
      )}
    >
      <p className="px-2.5 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">View presets</p>
      {PRESETS.map((p) => (
        <button
          key={p.key}
          type="button"
          onClick={() => onPreset(p.key)}
          className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-sm transition ${preset === p.key ? "bg-amber-500/15 text-amber-300" : "text-zinc-300 hover:bg-zinc-800/50"}`}
        >
          <span>{p.label}</span>
          <span className="text-[10px] text-zinc-500">{p.hint}</span>
        </button>
      ))}
      {groups.map((g) => (
        <div key={g} className="mt-1 border-t border-zinc-800 pt-1">
          <p className="px-2.5 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{GROUP_LABEL[g]}</p>
          {columns
            .filter((c) => c.group === g)
            .map((c) => (
              <CheckRow key={c.key} checked={!hidden.has(c.key)} onClick={() => onToggle(c.key)}>
                <span className="text-zinc-300">{c.label}</span>
              </CheckRow>
            ))}
        </div>
      ))}
    </Dropdown>
  );
}

// ---------------------------------------------------------------------------
// Compare drawer — up to 4 members side by side, best value per stat in
// green, worst in red, so the gap is obvious at a glance.
// ---------------------------------------------------------------------------

function CompareDrawer({ rows, columns, onClose, onRemove }: { rows: PvpStatsRow[]; columns: ColumnDef[]; onClose: () => void; onRemove: (id: string) => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const statCols = columns.filter((c) => c.numeric);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={onClose}>
      <div className="flex h-full w-full max-w-3xl flex-col border-l border-zinc-800 bg-zinc-950 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Compare members</h2>
            <p className="text-xs text-zinc-500">
              {rows.length} of {MAX_COMPARE} · <span className="text-emerald-300">green</span> = best, <span className="text-rose-300">red</span> = lowest per stat
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200">
            Close ✕
          </button>
        </div>
        <div className="pvp-scroll flex-1 overflow-auto">
          <table className="w-full min-w-max text-sm">
            <thead className="sticky top-0 z-10 bg-zinc-950">
              <tr className="border-b border-zinc-800">
                <th className="sticky left-0 z-20 bg-zinc-950 px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Stat</th>
                {rows.map(({ member, entry }) => (
                  <th key={member.id} className="min-w-[150px] px-3 py-3 text-left align-top">
                    <div className="flex items-start gap-2">
                      <MemberAvatar src={member.discordAvatar} alt={member.discordUsername} width={32} height={32} className="h-8 w-8 shrink-0 rounded-full ring-1 ring-zinc-700" />
                      <div className="min-w-0">
                        <Link href={`/pvp-stats/${member.id}`} className="block truncate text-sm font-medium text-zinc-100 hover:text-amber-300">
                          {memberDisplayName(member)}
                        </Link>
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          <ClassBadge className={member.characterClass} />
                          <AltClassIcons altClasses={member.altClasses} />
                        </div>
                        <div className="mt-1 text-[10px] font-normal text-zinc-500">{entry?.role ?? "—"}</div>
                      </div>
                      <button type="button" onClick={() => onRemove(member.id)} title="Remove from comparison" className="ml-auto text-xs text-zinc-600 hover:text-rose-400">
                        ✕
                      </button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {statCols.map((col) => {
                const values = rows.map((r) => getStatValue(r.entry, col.key));
                const nums = values.filter((v): v is number => v !== null);
                const best = nums.length > 1 ? Math.max(...nums) : null;
                const worst = nums.length > 1 ? Math.min(...nums) : null;
                return (
                  <tr key={col.key} className="hover:bg-zinc-900/60">
                    <td className="sticky left-0 z-10 bg-zinc-950 px-4 py-2 text-xs text-zinc-400">
                      {col.label}
                      <span className="ml-1.5 text-[9px] uppercase text-zinc-600">{GROUP_LABEL[col.group]}</span>
                    </td>
                    {values.map((v, i) => {
                      const tone =
                        v === null ? "text-zinc-600" : best !== null && v === best && best !== worst ? "text-emerald-300 font-semibold" : worst !== null && v === worst && best !== worst ? "text-rose-300" : "text-zinc-200";
                      return (
                        <td key={rows[i].member.id} className={`px-3 py-2 tabular-nums ${tone}`}>
                          {fmtStat(col, v)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              <tr>
                <td className="sticky left-0 z-10 bg-zinc-950 px-4 py-2 text-xs text-zinc-400">Last updated</td>
                {rows.map(({ member, entry }) => (
                  <td key={member.id} className={`px-3 py-2 text-xs ${isStale(entry) ? "text-rose-400" : "text-zinc-500"}`}>
                    {entry ? new Date(entry.createdAt).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok" }) : "Not submitted"}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

/**
 * Sortable + searchable desktop table and mobile card list for the
 * /pvp-stats leaderboard. The member column is pinned (sticky) while the
 * stat columns scroll horizontally inside their own container — the page
 * itself never overflows. Columns can be hidden one by one or via presets
 * (Tank / DPS / Compact, remembered per browser), and up to four members
 * can be ticked for a side-by-side comparison drawer.
 */
export function PvpStatsTable({ rows, activeFieldDefs, isAdmin }: { rows: PvpStatsRow[]; activeFieldDefs: PvpCustomFieldDef[]; isAdmin: boolean }) {
  const { options: classOrder } = useJobClasses();
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "cp", dir: "desc" });
  const [query, setQuery] = useState("");
  const [pendingOnly, setPendingOnly] = useState(false);
  const [selectedClasses, setSelectedClasses] = useState<Set<string>>(() => new Set());
  const [viewMode, setViewMode] = useState<"table" | "cards">("table");
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [preset, setPreset] = useState<PresetKey | null>("all");
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showRightShadow, setShowRightShadow] = useState(false);

  const columns = useMemo<ColumnDef[]>(() => {
    const custom = activeFieldDefs.map(customToColumn);
    // Custom fields slot in before the meta columns, grouped after the fixed stats.
    const meta = FIXED_COLUMNS.filter((c) => c.group === "meta");
    const rest = FIXED_COLUMNS.filter((c) => c.group !== "meta");
    return [...rest, ...custom, ...meta];
  }, [activeFieldDefs]);

  // Remembered per browser — a pure convenience, so a missing/blocked
  // localStorage just means "all columns".
  useEffect(() => {
    // Deferred a tick so the server-rendered "all columns" frame hydrates
    // cleanly first, then the remembered view is applied.
    const id = window.setTimeout(() => {
      try {
        const raw = localStorage.getItem(VISIBILITY_STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as { hidden?: string[]; preset?: PresetKey | null };
        if (Array.isArray(parsed.hidden)) setHidden(new Set(parsed.hidden));
        setPreset(parsed.preset ?? null);
      } catch {
        /* ignore */
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, []);
  function persist(nextHidden: Set<string>, nextPreset: PresetKey | null) {
    try {
      localStorage.setItem(VISIBILITY_STORAGE_KEY, JSON.stringify({ hidden: [...nextHidden], preset: nextPreset }));
    } catch {
      /* ignore */
    }
  }
  function applyPreset(p: PresetKey) {
    const def = PRESETS.find((x) => x.key === p)!;
    const next = new Set<string>();
    for (const c of columns) {
      const keep = p === "compact" ? COMPACT_KEYS.has(c.key) : def.groups === null ? true : def.groups.includes(c.group) || c.group === "meta";
      if (!keep) next.add(c.key);
    }
    setHidden(next);
    setPreset(p);
    persist(next, p);
  }
  function toggleColumn(key: string) {
    setHidden((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      persist(next, null);
      return next;
    });
    setPreset(null);
  }
  const visibleColumns = columns.filter((c) => !hidden.has(c.key));

  function handleSort(key: SortKey) {
    setSort((cur) => (cur.key === key ? { key, dir: cur.dir === "asc" ? "desc" : "asc" } : { key, dir: defaultDirFor(key) }));
  }
  function toggleClass(name: string) {
    setSelectedClasses((cur) => {
      const next = new Set(cur);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }
  function toggleCompare(id: string) {
    setCompareIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= MAX_COMPARE ? cur : [...cur, id]));
  }

  const pendingCount = useMemo(() => rows.filter((r) => r.entry && !isReviewStatus(r.entry.reviewStatus)).length, [rows]);

  const filteredRows = useMemo(() => {
    let result = rows;
    if (pendingOnly) result = result.filter((r) => r.entry && !isReviewStatus(r.entry.reviewStatus));
    if (selectedClasses.size > 0)
      result = result.filter((r) => (r.member.characterClass && selectedClasses.has(r.member.characterClass)) || r.member.altClasses.some((a) => selectedClasses.has(a)));
    const q = query.trim().toLowerCase();
    if (!q) return result;
    return result.filter(({ member }) => memberDisplayName(member).toLowerCase().includes(q) || (member.inGameName ?? "").toLowerCase().includes(q));
  }, [rows, query, pendingOnly, selectedClasses]);

  const sortedRows = useMemo(() => {
    const classRank = (name: string | null) => {
      if (!name) return classOrder.length + 1;
      const idx = classOrder.indexOf(name);
      return idx === -1 ? classOrder.length : idx;
    };
    const sign = sort.dir === "asc" ? 1 : -1;
    const byName = (a: PvpStatsRow, b: PvpStatsRow) => memberDisplayName(a.member).localeCompare(memberDisplayName(b.member), "th");
    return [...filteredRows].sort((a, b) => {
      if (sort.key === "name") return sign * byName(a, b);
      if (sort.key === "class") {
        const diff = classRank(a.member.characterClass) - classRank(b.member.characterClass);
        return diff !== 0 ? sign * diff : byName(a, b);
      }
      const va = getStatValue(a.entry, sort.key);
      const vb = getStatValue(b.entry, sort.key);
      if (va == null && vb == null) return byName(a, b);
      if (va == null) return 1;
      if (vb == null) return -1;
      return sign * (va - vb);
    });
  }, [filteredRows, sort, classOrder]);

  // Highlights are guild-wide (all rows), not per filter — "#1 P.DEF" should
  // mean the same thing whichever class filter is on.
  const highlights = useMemo(() => computeHighlights(rows, columns), [rows, columns]);
  const compareRows = useMemo(() => compareIds.map((id) => rows.find((r) => r.member.id === id)).filter((r): r is PvpStatsRow => Boolean(r)), [compareIds, rows]);

  const emptyMessage = rows.length === 0 ? "No members yet" : pendingOnly && selectedClasses.size === 0 && !query.trim() ? "Nothing pending review right now" : "No members match the filters";

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function update() {
      if (!el) return;
      setShowRightShadow(el.scrollWidth - el.clientWidth - el.scrollLeft > 2);
    }
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      ro.disconnect();
    };
  }, [sortedRows.length, visibleColumns.length]);

  const cell = "px-3 py-1.5";
  const numCell = `${cell} text-right whitespace-nowrap`;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative sm:w-72">
          <svg viewBox="0 0 20 20" fill="currentColor" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500">
            <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 3.61 9.65l3.62 3.62a.75.75 0 1 0 1.06-1.06l-3.62-3.62A5.5 5.5 0 0 0 9 3.5ZM5 9a4 4 0 1 1 8 0 4 4 0 0 1-8 0Z" clipRule="evenodd" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search members..."
            className="w-full rounded-xl border border-zinc-800 bg-zinc-900/50 py-2 pl-9 pr-3 text-sm text-zinc-100 placeholder:text-zinc-500 transition focus:border-amber-500 focus:outline-none"
          />
        </div>

        <ClassFilterDropdown selected={selectedClasses} onToggle={toggleClass} onClear={() => setSelectedClasses(new Set())} />
        <ColumnMenu columns={columns} hidden={hidden} preset={preset} onPreset={applyPreset} onToggle={toggleColumn} />

        {isAdmin && (
          <button type="button" onClick={() => setPendingOnly((v) => !v)} className={pillClass(pendingOnly)}>
            Pending Review · {pendingCount}
          </button>
        )}

        <div className="ml-auto hidden items-center gap-1 rounded-xl border border-zinc-800 bg-zinc-900/50 p-1 lg:flex">
          {(["table", "cards"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setViewMode(m)}
              className={`whitespace-nowrap rounded-lg px-2.5 py-1 text-sm font-medium transition ${viewMode === m ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}
            >
              {m === "table" ? "Table" : "Cards"}
            </button>
          ))}
        </div>
      </div>

      {/* Compare bar — appears as soon as anyone is ticked. */}
      {compareIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
          <span className="text-amber-200">
            Selected {compareIds.length}/{MAX_COMPARE}:
          </span>
          {compareRows.map(({ member }) => (
            <span key={member.id} className="inline-flex items-center gap-1 rounded-full bg-zinc-900/80 py-0.5 pl-1 pr-2 text-xs text-zinc-200 ring-1 ring-inset ring-zinc-700">
              <MemberAvatar src={member.discordAvatar} alt={member.discordUsername} width={18} height={18} className="h-[18px] w-[18px] rounded-full" />
              {memberDisplayName(member)}
              <button type="button" onClick={() => toggleCompare(member.id)} className="ml-0.5 text-zinc-500 hover:text-rose-400">
                ✕
              </button>
            </span>
          ))}
          <button
            type="button"
            disabled={compareIds.length < 2}
            onClick={() => setCompareOpen(true)}
            className="ml-auto rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Compare Selected ({compareIds.length}/{MAX_COMPARE})
          </button>
          <button type="button" onClick={() => setCompareIds([])} className="rounded-lg px-2 py-1.5 text-xs text-zinc-500 hover:text-zinc-200">
            Clear
          </button>
        </div>
      )}

      {/* Table: shown from lg up (it scrolls inside its own box, so no page overflow); cards below lg or on toggle. */}
      <div className={viewMode === "cards" ? "hidden" : "hidden lg:block"}>
        <div className="relative">
          <div ref={scrollRef} className="pvp-scroll overflow-x-auto rounded-2xl border border-zinc-800 bg-zinc-900/50">
            <table className="w-full min-w-max text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-[11px] uppercase tracking-wide text-zinc-500">
                  <th className="sticky left-0 z-20 border-r border-zinc-800 bg-zinc-900 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="w-4 shrink-0" />
                      <SortHeader label="Member" sortKey="name" active={sort.key === "name"} dir={sort.key === "name" ? sort.dir : "asc"} onSort={handleSort} />
                    </div>
                  </th>
                  {visibleColumns.map((col) =>
                    col.numeric ? (
                      <th key={col.key} className={`${cell} text-right`}>
                        <SortHeader label={col.label} sortKey={col.key} active={sort.key === col.key} dir={sort.key === col.key ? sort.dir : "desc"} onSort={handleSort} align="right" />
                      </th>
                    ) : col.key === "class" ? (
                      <th key={col.key} className={cell}>
                        <SortHeader label="Class" sortKey="class" active={sort.key === "class"} dir={sort.key === "class" ? sort.dir : "asc"} onSort={handleSort} />
                      </th>
                    ) : (
                      <th key={col.key} className={`${cell} font-medium`}>
                        {col.label}
                      </th>
                    )
                  )}
                  {isAdmin && <th className={`${cell} font-medium`}>Edit</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/80">
                {sortedRows.length === 0 && (
                  <tr>
                    <td colSpan={40} className="px-4 py-10 text-center text-zinc-500">
                      {emptyMessage}
                    </td>
                  </tr>
                )}
                {sortedRows.map(({ member, entry }) => {
                  const checked = compareIds.includes(member.id);
                  const full = !checked && compareIds.length >= MAX_COMPARE;
                  return (
                    <tr key={member.id} className={`group transition ${checked ? "bg-amber-500/5" : "hover:bg-zinc-800/40"}`}>
                      {/* Sticky member cell: position: sticky; left: 0; z-index: 10 (Tailwind sticky/left-0/z-10). */}
                      <td className={`sticky left-0 z-10 border-r border-zinc-800 px-3 py-1.5 ${checked ? "bg-[#1f1a10]" : "bg-zinc-900 group-hover:bg-zinc-800/95"}`}>
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={full}
                            onChange={() => toggleCompare(member.id)}
                            title={full ? `Up to ${MAX_COMPARE} members` : "Select to compare"}
                            className="h-4 w-4 shrink-0 cursor-pointer rounded border-zinc-600 bg-zinc-900 accent-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
                          />
                          <Link href={`/pvp-stats/${member.id}`} className="flex min-w-0 items-center gap-2">
                            <MemberAvatar src={member.discordAvatar} alt={member.discordUsername} width={24} height={24} className="h-6 w-6 shrink-0 rounded-full ring-1 ring-zinc-700" />
                            <span className="max-w-[160px] truncate text-[13px] font-medium text-zinc-100">{memberDisplayName(member)}</span>
                          </Link>
                        </div>
                      </td>
                      {visibleColumns.map((col) => {
                        if (col.numeric) {
                          return (
                            <td key={col.key} className={numCell}>
                              <StatCell col={col} value={getStatValue(entry, col.key)} hl={highlights.get(col.key)?.get(member.id)} />
                            </td>
                          );
                        }
                        switch (col.key) {
                          case "class":
                            return (
                              <td key={col.key} className={`${cell} whitespace-nowrap`}>
                                <span className="inline-flex items-center gap-1.5">
                                  <ClassBadge className={member.characterClass} />
                                  <AltClassIcons altClasses={member.altClasses} />
                                </span>
                              </td>
                            );
                          case "role":
                            return (
                              <td key={col.key} className={`${cell} whitespace-nowrap text-xs text-zinc-300`}>
                                {entry?.role ?? "—"}
                              </td>
                            );
                          case "status":
                            return (
                              <td key={col.key} className={`${cell} whitespace-nowrap`}>
                                {entry && (
                                  <div className="flex items-center gap-1.5" title={entry.reviewNote ?? undefined}>
                                    <PvpReviewBadge status={entry.reviewStatus} />
                                    {isAdmin && <PvpReviewButton entryId={entry.id} currentStatus={entry.reviewStatus} currentNote={entry.reviewNote} />}
                                  </div>
                                )}
                              </td>
                            );
                          case "bossCards":
                            return (
                              <td key={col.key} className={`${cell} max-w-[220px] break-words text-xs text-zinc-400`}>
                                {entry?.bossCards ?? "—"}
                              </td>
                            );
                          case "updatedAt":
                            return (
                              <td key={col.key} className={`${cell} whitespace-nowrap text-xs ${isStale(entry) ? "text-rose-400" : "text-zinc-500"}`}>
                                {isStale(entry) && <StaleIcon />}
                                {entry ? new Date(entry.createdAt).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok" }) : "Not submitted"}
                              </td>
                            );
                          default:
                            return <td key={col.key} className={cell} />;
                        }
                      })}
                      {isAdmin && <td className={cell}>{entry && <AdminEditEntryButton entry={entry} customFieldDefs={activeFieldDefs} />}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className={`pointer-events-none absolute inset-y-0 right-0 w-12 rounded-r-2xl bg-gradient-to-l from-zinc-900 to-transparent transition-opacity duration-200 ${showRightShadow ? "opacity-100" : "opacity-0"}`} />
        </div>
        <p className="mt-1.5 text-[11px] text-zinc-600">
          Badges: <span className="text-amber-300">#1</span> / <span className="text-zinc-300">#2</span> / <span className="text-orange-300">#3</span> guild-wide per stat · <span className="text-emerald-300">green</span> = top 10% · scroll sideways for more columns, or trim them with the Columns menu.
        </p>
      </div>

      {/* Cards: the default below lg, and on the toggle above lg. */}
      <div className={`grid gap-3 ${viewMode === "cards" ? "" : "lg:hidden"}`} style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
        {sortedRows.length === 0 && <p className="col-span-full py-10 text-center text-sm text-zinc-500">{emptyMessage}</p>}
        {sortedRows.map(({ member, entry }) => (
          <PvpStatCard
            key={member.id}
            entry={entry}
            customFieldDefs={activeFieldDefs}
            header={
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={compareIds.includes(member.id)}
                    disabled={!compareIds.includes(member.id) && compareIds.length >= MAX_COMPARE}
                    onChange={() => toggleCompare(member.id)}
                    className="h-4 w-4 shrink-0 accent-amber-500 disabled:opacity-40"
                  />
                  <Link href={`/pvp-stats/${member.id}`} className="flex min-w-0 items-center gap-2.5">
                    <MemberAvatar src={member.discordAvatar} alt={member.discordUsername} width={32} height={32} className="h-8 w-8 shrink-0 rounded-full ring-1 ring-zinc-700" />
                    <span className="truncate font-medium text-zinc-100">{memberDisplayName(member)}</span>
                  </Link>
                </div>
                <ClassBadge className={member.characterClass} />
                <AltClassIcons altClasses={member.altClasses} />
              </div>
            }
            reviewAction={
              entry && (
                <>
                  <PvpReviewBadge status={entry.reviewStatus} />
                  {isAdmin && (
                    <>
                      <PvpReviewButton entryId={entry.id} currentStatus={entry.reviewStatus} currentNote={entry.reviewNote} />
                      <AdminEditEntryButton entry={entry} customFieldDefs={activeFieldDefs} />
                    </>
                  )}
                </>
              )
            }
            footer={
              <div className="flex items-center justify-between border-t border-zinc-800 pt-2 text-xs text-zinc-500">
                <span className={isStale(entry) ? "text-rose-400" : "text-zinc-500"}>
                  {isStale(entry) && <StaleIcon />}
                  {entry ? new Date(entry.createdAt).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok" }) : "Not submitted"}
                </span>
                <Link href={`/pvp-stats/${member.id}`} className="text-amber-400 transition hover:text-amber-300">
                  View full history →
                </Link>
              </div>
            }
          />
        ))}
      </div>

      {compareOpen && compareRows.length > 0 && (
        <CompareDrawer
          rows={compareRows}
          // Compare what's on screen; if every stat column is hidden, fall back to all of them.
          columns={visibleColumns.some((c) => c.numeric) ? visibleColumns : columns}
          onClose={() => setCompareOpen(false)}
          onRemove={(id) => {
            toggleCompare(id);
            if (compareIds.length <= 1) setCompareOpen(false);
          }}
        />
      )}
    </>
  );
}
