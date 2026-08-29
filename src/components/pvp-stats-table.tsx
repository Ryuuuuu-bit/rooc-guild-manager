"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Member, PvpStatEntry } from "@/db/schema";
import { memberDisplayName } from "@/lib/ui";
import { fmtInt, fmtPct, type PvpCustomFieldDef } from "@/lib/pvp-stat-fields";
import { useJobClasses } from "@/components/job-classes-provider";
import { ClassBadge } from "@/components/badges";
import { MemberAvatar } from "@/components/member-avatar";
import { PvpStatCard } from "@/components/pvp-stat-card";
import { PvpReviewBadge, PvpReviewButton } from "@/components/pvp-stat-review";
import { isReviewStatus } from "@/lib/pvp-stat-review";
import { AdminEditEntryButton } from "@/components/pvp-stat-admin-entry";

type PvpStatMember = Pick<
  Member,
  "id" | "discordNickname" | "discordGlobalName" | "discordUsername" | "discordAvatar" | "characterClass" | "inGameName"
>;

type PvpStatsRow = { member: PvpStatMember; entry: PvpStatEntry | null };

/** "name" and "class" read off the member; a custom field is prefixed
 * "custom:<key>" to disambiguate from the fixed entry columns; every other
 * key is a numeric column straight off `entry` (cp, pDef, atk, ...). */
type SortKey = "name" | "class" | (string & {});
type SortDir = "asc" | "desc";

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

/** Right-aligned numeric header shared by every fixed + custom stat column — same SortHeader, just less to repeat per column. */
function StatHeader({
  fieldKey,
  label,
  sort,
  onSort,
}: {
  fieldKey: string;
  label: string;
  sort: { key: SortKey; dir: SortDir };
  onSort: (key: SortKey) => void;
}) {
  const active = sort.key === fieldKey;
  return (
    <th className="px-4 py-3 text-right">
      <SortHeader label={label} sortKey={fieldKey} active={active} dir={active ? sort.dir : defaultDirFor(fieldKey)} onSort={onSort} align="right" />
    </th>
  );
}

const FIXED_STAT_COLUMNS: { key: string; label: string }[] = [
  { key: "pDef", label: "P.DEF" },
  { key: "mDef", label: "M.DEF" },
  { key: "pvpBonus", label: "PVP Bonus" },
  { key: "pvpReduction", label: "PVP Reduction" },
  { key: "pDmgReductionPct", label: "P.DMG Red%" },
  { key: "mDmgReductionPct", label: "M.DMG Red%" },
  { key: "atk", label: "ATK" },
  { key: "matk", label: "MATK" },
  { key: "ignorePDef", label: "Ignore P.DEF" },
  { key: "ignoreMDef", label: "Ignore M.DEF" },
  { key: "pDmgBonusPct", label: "P.DMG Bonus%" },
  { key: "mDmgBonusPct", label: "M.DMG Bonus%" },
];

const PERCENT_KEYS = new Set(["pDmgReductionPct", "mDmgReductionPct", "pDmgBonusPct", "mDmgBonusPct"]);

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

/** Small warning triangle so "overdue" isn't color-only — shows before the date/"ยังไม่กรอก" text. */
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

/**
 * Sortable + searchable desktop table and mobile card list for the
 * /pvp-stats leaderboard. Client-side because both are interactive (click a
 * header to reorder, type to filter) — every stat column is sortable so an
 * admin reviewing submissions can pull the highest/lowest of any single
 * number to the top, not just CP.
 */
export function PvpStatsTable({
  rows,
  activeFieldDefs,
  isAdmin,
}: {
  rows: PvpStatsRow[];
  activeFieldDefs: PvpCustomFieldDef[];
  isAdmin: boolean;
}) {
  const { options: classOrder } = useJobClasses();
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "cp", dir: "desc" });
  const [query, setQuery] = useState("");
  const [pendingOnly, setPendingOnly] = useState(false);

  function handleSort(key: SortKey) {
    setSort((cur) => (cur.key === key ? { key, dir: cur.dir === "asc" ? "desc" : "asc" } : { key, dir: defaultDirFor(key) }));
  }

  // Guild-wide count, off the full unfiltered list — the badge should read
  // "how much review backlog is there", not "how much matches my search".
  const pendingCount = useMemo(() => rows.filter((r) => r.entry && !isReviewStatus(r.entry.reviewStatus)).length, [rows]);

  const filteredRows = useMemo(() => {
    let result = rows;
    if (pendingOnly) result = result.filter((r) => r.entry && !isReviewStatus(r.entry.reviewStatus));
    const q = query.trim().toLowerCase();
    if (!q) return result;
    return result.filter(({ member }) => {
      const name = memberDisplayName(member).toLowerCase();
      const inGame = (member.inGameName ?? "").toLowerCase();
      return name.includes(q) || inGame.includes(q);
    });
  }, [rows, query, pendingOnly]);

  const sortedRows = useMemo(() => {
    // Admin-configured class order (from /classes) — unknown/no class sorts after every real class.
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
      // Every other key is a numeric stat (fixed or "custom:<key>") — never-submitted
      // members and blank fields always sort last regardless of direction.
      const va = getStatValue(a.entry, sort.key);
      const vb = getStatValue(b.entry, sort.key);
      if (va == null && vb == null) return byName(a, b);
      if (va == null) return 1;
      if (vb == null) return -1;
      return sign * (va - vb);
    });
  }, [filteredRows, sort, classOrder]);

  const emptyMessage =
    rows.length === 0
      ? "ยังไม่มีสมาชิกในระบบ"
      : pendingOnly && !query.trim()
        ? "ไม่มีรายการรอตรวจแล้วตอนนี้"
        : "ไม่พบสมาชิกที่ตรงกับคำค้นหา";

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative sm:w-80">
          <svg viewBox="0 0 20 20" fill="currentColor" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500">
            <path
              fillRule="evenodd"
              d="M9 3.5a5.5 5.5 0 1 0 3.61 9.65l3.62 3.62a.75.75 0 1 0 1.06-1.06l-3.62-3.62A5.5 5.5 0 0 0 9 3.5ZM5 9a4 4 0 1 1 8 0 4 4 0 0 1-8 0Z"
              clipRule="evenodd"
            />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ค้นหาสมาชิก..."
            className="w-full rounded-xl border border-zinc-800 bg-zinc-900/50 py-2 pl-9 pr-3 text-sm text-zinc-100 placeholder:text-zinc-500 transition focus:border-amber-500 focus:outline-none"
          />
        </div>

        {isAdmin && (
          <button
            type="button"
            onClick={() => setPendingOnly((v) => !v)}
            className={`whitespace-nowrap rounded-xl border px-3 py-2 text-sm font-medium transition ${
              pendingOnly
                ? "border-amber-500/60 bg-amber-500/15 text-amber-300"
                : "border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
            }`}
          >
            รอตรวจ · {pendingCount}
          </button>
        )}
      </div>

      {/* Wide table only once the viewport is actually wide enough to show it without an awkward
          drag-to-scroll (19+ columns need ~1500px) — below that, the card list reads far better,
          so the switch point is 2xl (1536px), not the usual lg (1024px) a typical laptop still hits. */}
      <div className="hidden overflow-x-auto rounded-2xl border border-zinc-800 bg-zinc-900/50 2xl:block">
        <table className="w-full min-w-[1500px] text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
              <th className="sticky left-0 z-20 bg-zinc-900 px-4 py-3">
                <SortHeader label="สมาชิก" sortKey="name" active={sort.key === "name"} dir={sort.key === "name" ? sort.dir : defaultDirFor("name")} onSort={handleSort} />
              </th>
              <th className="px-4 py-3">
                <SortHeader label="อาชีพ" sortKey="class" active={sort.key === "class"} dir={sort.key === "class" ? sort.dir : defaultDirFor("class")} onSort={handleSort} />
              </th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">สถานะ</th>
              <StatHeader fieldKey="cp" label="CP" sort={sort} onSort={handleSort} />
              {FIXED_STAT_COLUMNS.map((col) => (
                <StatHeader key={col.key} fieldKey={col.key} label={col.label} sort={sort} onSort={handleSort} />
              ))}
              {activeFieldDefs.map((f) => (
                <StatHeader key={f.key} fieldKey={`custom:${f.key}`} label={f.label} sort={sort} onSort={handleSort} />
              ))}
              <th className="px-4 py-3 font-medium">การ์ดบอส</th>
              <th className="px-4 py-3 font-medium">อัปเดตล่าสุด</th>
              {isAdmin && <th className="px-4 py-3 font-medium">แก้ไข</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {sortedRows.length === 0 && (
              <tr>
                <td colSpan={40} className="px-4 py-10 text-center text-zinc-500">
                  {emptyMessage}
                </td>
              </tr>
            )}
            {sortedRows.map(({ member, entry }) => (
              <tr key={member.id} className="group transition hover:bg-zinc-800/40">
                <td className="sticky left-0 z-10 border-r border-zinc-800 bg-zinc-900 px-4 py-3 group-hover:bg-zinc-800/90">
                  <Link href={`/pvp-stats/${member.id}`} className="flex items-center gap-3">
                    <MemberAvatar
                      src={member.discordAvatar}
                      alt={member.discordUsername}
                      width={28}
                      height={28}
                      className="h-7 w-7 rounded-full ring-1 ring-zinc-700"
                    />
                    <span className="truncate font-medium text-zinc-100">{memberDisplayName(member)}</span>
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <ClassBadge className={member.characterClass} />
                </td>
                <td className="px-4 py-3 text-zinc-300">{entry?.role ?? "—"}</td>
                <td className="px-4 py-3">
                  {entry && (
                    <div className="flex flex-nowrap items-center gap-1.5" title={entry.reviewNote ?? undefined}>
                      <PvpReviewBadge status={entry.reviewStatus} />
                      {isAdmin && (
                        <PvpReviewButton
                          entryId={entry.id}
                          currentStatus={entry.reviewStatus}
                          currentNote={entry.reviewNote}
                        />
                      )}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-right font-medium text-amber-300">{entry ? fmtInt(entry.cp) : "—"}</td>
                {FIXED_STAT_COLUMNS.map((col) => (
                  <td key={col.key} className="px-4 py-3 text-right text-zinc-300">
                    {entry
                      ? PERCENT_KEYS.has(col.key)
                        ? fmtPct(entry[col.key as keyof PvpStatEntry] as number | null)
                        : fmtInt(entry[col.key as keyof PvpStatEntry] as number | null)
                      : "—"}
                  </td>
                ))}
                {activeFieldDefs.map((f) => (
                  <td key={f.key} className="px-4 py-3 text-right text-zinc-300">
                    {entry ? (f.isPercent ? fmtPct(entry.customValues?.[f.key]) : fmtInt(entry.customValues?.[f.key])) : "—"}
                  </td>
                ))}
                <td className="px-4 py-3 text-zinc-400">{entry?.bossCards ?? "—"}</td>
                <td className={`px-4 py-3 whitespace-nowrap ${isStale(entry) ? "text-rose-400" : "text-zinc-500"}`}>
                  {isStale(entry) && <StaleIcon />}
                  {entry ? new Date(entry.createdAt).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok" }) : "ยังไม่กรอก"}
                </td>
                {isAdmin && <td className="px-4 py-3">{entry && <AdminEditEntryButton entry={entry} customFieldDefs={activeFieldDefs} />}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Card list is the default on anything narrower than 2xl — laptops included. Same sort/filter as the table above. */}
      <div className="flex flex-col gap-3 2xl:hidden">
        {sortedRows.length === 0 && (
          <p className="py-10 text-center text-sm text-zinc-500">{emptyMessage}</p>
        )}
        {sortedRows.map(({ member, entry }) => (
          <PvpStatCard
            key={member.id}
            entry={entry}
            customFieldDefs={activeFieldDefs}
            header={
              <div className="flex items-center justify-between gap-3">
                <Link href={`/pvp-stats/${member.id}`} className="flex min-w-0 items-center gap-2.5">
                  <MemberAvatar
                    src={member.discordAvatar}
                    alt={member.discordUsername}
                    width={32}
                    height={32}
                    className="h-8 w-8 shrink-0 rounded-full ring-1 ring-zinc-700"
                  />
                  <span className="truncate font-medium text-zinc-100">{memberDisplayName(member)}</span>
                </Link>
                <ClassBadge className={member.characterClass} />
              </div>
            }
            reviewAction={
              entry && (
                <>
                  <PvpReviewBadge status={entry.reviewStatus} />
                  {isAdmin && (
                    <>
                      <PvpReviewButton
                        entryId={entry.id}
                        currentStatus={entry.reviewStatus}
                        currentNote={entry.reviewNote}
                      />
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
                  {entry
                    ? new Date(entry.createdAt).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok" })
                    : "ยังไม่กรอก"}
                </span>
                <Link href={`/pvp-stats/${member.id}`} className="text-amber-400 transition hover:text-amber-300">
                  ดูประวัติทั้งหมด →
                </Link>
              </div>
            }
          />
        ))}
      </div>
    </>
  );
}
