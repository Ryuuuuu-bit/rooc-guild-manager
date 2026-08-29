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
import { AdminEditEntryButton } from "@/components/pvp-stat-admin-entry";

type PvpStatMember = Pick<
  Member,
  "id" | "discordNickname" | "discordGlobalName" | "discordUsername" | "discordAvatar" | "characterClass" | "inGameName"
>;

type PvpStatsRow = { member: PvpStatMember; entry: PvpStatEntry | null };

type SortKey = "name" | "class" | "cp";
type SortDir = "asc" | "desc";

/** Column-specific starting direction the first time it's clicked — CP starts
 * high-to-low (matches the old fixed sort), name/class start A→Z. */
const DEFAULT_DIR: Record<SortKey, SortDir> = { name: "asc", class: "asc", cp: "desc" };

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
      className={`inline-flex items-center gap-1 whitespace-nowrap font-medium transition hover:text-zinc-200 ${
        align === "right" ? "flex-row-reverse" : ""
      } ${active ? "text-amber-300" : "text-zinc-500"}`}
    >
      {label}
      <span className={active ? "text-[9px] opacity-100" : "text-[9px] opacity-30"}>{dir === "asc" ? "▲" : "▼"}</span>
    </button>
  );
}

/**
 * Sortable desktop table + mobile card list for the /pvp-stats leaderboard.
 * Client-side because sorting is interactive (click a header to reorder) —
 * everything else about the two layouts is unchanged from the plain server
 * render this replaced, just now driven off `sortedRows` instead of `rows`.
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

  function handleSort(key: SortKey) {
    setSort((cur) => (cur.key === key ? { key, dir: cur.dir === "asc" ? "desc" : "asc" } : { key, dir: DEFAULT_DIR[key] }));
  }

  const sortedRows = useMemo(() => {
    // Admin-configured class order (from /classes) — unknown/no class sorts after every real class.
    const classRank = (name: string | null) => {
      if (!name) return classOrder.length + 1;
      const idx = classOrder.indexOf(name);
      return idx === -1 ? classOrder.length : idx;
    };
    const sign = sort.dir === "asc" ? 1 : -1;
    const byName = (a: PvpStatsRow, b: PvpStatsRow) => memberDisplayName(a.member).localeCompare(memberDisplayName(b.member), "th");

    return [...rows].sort((a, b) => {
      if (sort.key === "name") return sign * byName(a, b);
      if (sort.key === "class") {
        const diff = classRank(a.member.characterClass) - classRank(b.member.characterClass);
        return diff !== 0 ? sign * diff : byName(a, b);
      }
      // cp — never-submitted members always sort last regardless of direction, same as before sorting was clickable.
      const cpA = a.entry?.cp;
      const cpB = b.entry?.cp;
      if (cpA == null && cpB == null) return byName(a, b);
      if (cpA == null) return 1;
      if (cpB == null) return -1;
      return sign * (cpA - cpB);
    });
  }, [rows, sort, classOrder]);

  return (
    <>
      {/* Wide table only once the viewport is actually wide enough to show it without an awkward
          drag-to-scroll (19+ columns need ~1500px) — below that, the card list reads far better,
          so the switch point is 2xl (1536px), not the usual lg (1024px) a typical laptop still hits. */}
      <div className="hidden overflow-x-auto rounded-2xl border border-zinc-800 bg-zinc-900/50 2xl:block">
        <table className="w-full min-w-[1500px] text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
              <th className="sticky left-0 z-20 bg-zinc-900 px-4 py-3">
                <SortHeader label="สมาชิก" sortKey="name" active={sort.key === "name"} dir={sort.key === "name" ? sort.dir : DEFAULT_DIR.name} onSort={handleSort} />
              </th>
              <th className="px-4 py-3">
                <SortHeader label="อาชีพ" sortKey="class" active={sort.key === "class"} dir={sort.key === "class" ? sort.dir : DEFAULT_DIR.class} onSort={handleSort} />
              </th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">สถานะ</th>
              <th className="px-4 py-3 text-right">
                <SortHeader label="CP" sortKey="cp" active={sort.key === "cp"} dir={sort.key === "cp" ? sort.dir : DEFAULT_DIR.cp} onSort={handleSort} align="right" />
              </th>
              <th className="px-4 py-3 text-right font-medium">P.DEF</th>
              <th className="px-4 py-3 text-right font-medium">M.DEF</th>
              <th className="px-4 py-3 text-right font-medium">PVP Bonus</th>
              <th className="px-4 py-3 text-right font-medium">PVP Reduction</th>
              <th className="px-4 py-3 text-right font-medium">P.DMG Red%</th>
              <th className="px-4 py-3 text-right font-medium">M.DMG Red%</th>
              <th className="px-4 py-3 text-right font-medium">ATK</th>
              <th className="px-4 py-3 text-right font-medium">MATK</th>
              <th className="px-4 py-3 text-right font-medium">Ignore P.DEF</th>
              <th className="px-4 py-3 text-right font-medium">Ignore M.DEF</th>
              <th className="px-4 py-3 text-right font-medium">P.DMG Bonus%</th>
              <th className="px-4 py-3 text-right font-medium">M.DMG Bonus%</th>
              {activeFieldDefs.map((f) => (
                <th key={f.key} className="px-4 py-3 text-right font-medium">
                  {f.label}
                </th>
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
                  ยังไม่มีสมาชิกในระบบ
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
                <td className="px-4 py-3 text-right text-zinc-300">{entry ? fmtInt(entry.pDef) : "—"}</td>
                <td className="px-4 py-3 text-right text-zinc-300">{entry ? fmtInt(entry.mDef) : "—"}</td>
                <td className="px-4 py-3 text-right text-zinc-300">{entry ? fmtInt(entry.pvpBonus) : "—"}</td>
                <td className="px-4 py-3 text-right text-zinc-300">{entry ? fmtInt(entry.pvpReduction) : "—"}</td>
                <td className="px-4 py-3 text-right text-zinc-300">{entry ? fmtPct(entry.pDmgReductionPct) : "—"}</td>
                <td className="px-4 py-3 text-right text-zinc-300">{entry ? fmtPct(entry.mDmgReductionPct) : "—"}</td>
                <td className="px-4 py-3 text-right text-zinc-300">{entry ? fmtInt(entry.atk) : "—"}</td>
                <td className="px-4 py-3 text-right text-zinc-300">{entry ? fmtInt(entry.matk) : "—"}</td>
                <td className="px-4 py-3 text-right text-zinc-300">{entry ? fmtInt(entry.ignorePDef) : "—"}</td>
                <td className="px-4 py-3 text-right text-zinc-300">{entry ? fmtInt(entry.ignoreMDef) : "—"}</td>
                <td className="px-4 py-3 text-right text-zinc-300">{entry ? fmtPct(entry.pDmgBonusPct) : "—"}</td>
                <td className="px-4 py-3 text-right text-zinc-300">{entry ? fmtPct(entry.mDmgBonusPct) : "—"}</td>
                {activeFieldDefs.map((f) => (
                  <td key={f.key} className="px-4 py-3 text-right text-zinc-300">
                    {entry ? (f.isPercent ? fmtPct(entry.customValues?.[f.key]) : fmtInt(entry.customValues?.[f.key])) : "—"}
                  </td>
                ))}
                <td className="px-4 py-3 text-zinc-400">{entry?.bossCards ?? "—"}</td>
                <td className="px-4 py-3 whitespace-nowrap text-zinc-500">
                  {entry ? new Date(entry.createdAt).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok" }) : "ยังไม่กรอก"}
                </td>
                {isAdmin && <td className="px-4 py-3">{entry && <AdminEditEntryButton entry={entry} customFieldDefs={activeFieldDefs} />}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Card list is the default on anything narrower than 2xl — laptops included. Same sort order as the table above. */}
      <div className="flex flex-col gap-3 2xl:hidden">
        {sortedRows.length === 0 && <p className="py-10 text-center text-sm text-zinc-500">ยังไม่มีสมาชิกในระบบ</p>}
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
                <span>
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
