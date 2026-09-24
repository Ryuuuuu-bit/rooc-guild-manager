import Link from "next/link";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { leaves } from "@/db/schema";
import { thaiMonthRange } from "@/lib/leaves";
import { Kpi, KpiGrid, PageHeader, Segmented } from "@/components/ui/kit";
import { LeaveStatsList, type LeaveStatRow } from "@/components/leave-stats/leave-stats-list";
import { getAttendanceBoardBreakdown, getAttendanceStats, getOverQuotaThisMonth } from "@/lib/data";
import { MONTHLY_LEAVE_LIMIT } from "@/lib/leave-quota";
import { listPartyBoards } from "@/lib/party-data";
import { requireUser } from "@/lib/authz";
import { memberDisplayName } from "@/lib/ui";
import { VoidLeavesForm } from "@/components/void-leaves-form";

const DAY_OPTIONS = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "all", label: "All" },
];

const ALL_BOARDS_VALUE = "all";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Start/end of the given "YYYY-MM-DD" as Thai-local (UTC+7) day boundaries — the offset is baked into the ISO string, so this is a direct, unambiguous parse (no manual UTC arithmetic needed, unlike a "relative to now" pin). */
function startOfThaiDay(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00+07:00`);
}
function endOfThaiDay(dateStr: string): Date {
  return new Date(`${dateStr}T23:59:59.999+07:00`);
}

interface SearchParams {
  days?: string;
  board?: string;
  from?: string;
  to?: string;
}

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireUser();
  const params = await searchParams;

  const boards = await listPartyBoards();
  const boardParam = boards.some((b) => b.id === params.board) ? params.board! : ALL_BOARDS_VALUE;
  const boardId = boardParam === ALL_BOARDS_VALUE ? undefined : boardParam;

  // A custom date range (both from/to present and well-formed) takes over
  // from the day-count presets entirely — the two are mutually exclusive
  // views into the same underlying filter, not stackable.
  const fromValid = params.from && DATE_RE.test(params.from) ? params.from : null;
  const toValid = params.to && DATE_RE.test(params.to) ? params.to : null;
  const isCustomRange = Boolean(fromValid && toValid);

  const daysParam = DAY_OPTIONS.some((o) => o.value === params.days) ? params.days! : "30";
  const days = daysParam === "all" ? undefined : Number(daysParam);

  // Swap silently if the custom range is picked backwards rather than
  // erroring — the two date inputs have no inherent "first/second"
  // ordering constraint.
  let from: Date | undefined;
  let to: Date | undefined;
  if (isCustomRange) {
    const a = startOfThaiDay(fromValid!);
    const b = endOfThaiDay(toValid!);
    [from, to] = a.getTime() <= b.getTime() ? [a, b] : [startOfThaiDay(toValid!), endOfThaiDay(fromValid!)];
  }
  // `days` (the day-count presets) is passed straight through to the
  // data layer rather than resolved to a cutoff Date here — see the
  // AttendanceRangeFilter doc comment in lib/data.ts for why.
  const rangeFilter = isCustomRange ? { from, to } : { days };

  // Preserved on every preset/board link so switching one filter doesn't
  // silently reset the other.
  const rangeQuery = isCustomRange ? `from=${fromValid}&to=${toValid}` : `days=${daysParam}`;

  const [{ stats, totalLeaveEvents }, breakdown, overQuota, monthCounts] = await Promise.all([
    getAttendanceStats({ ...rangeFilter, boardId }),
    // Only needed for the "All Boards" view's summary pills — skip the extra
    // query when a specific board is already selected (its total is already
    // shown above the table).
    boardId ? Promise.resolve(null) : getAttendanceBoardBreakdown(rangeFilter),
    getOverQuotaThisMonth(),
    // This calendar month per member per board — the same count the monthly
    // quota rule uses (ACTIVE leaves dated this month, incl. upcoming ones).
    (async () => {
      const { from: mFrom, to: mTo } = thaiMonthRange();
      return db
        .select({ memberId: leaves.memberId, boardId: leaves.boardId, n: sql<number>`count(*)::int` })
        .from(leaves)
        .where(and(eq(leaves.status, "ACTIVE"), gte(leaves.occurrenceDate, mFrom), lte(leaves.occurrenceDate, mTo)))
        .groupBy(leaves.memberId, leaves.boardId);
    })(),
  ]);
  const overQuotaIds = new Set(overQuota.map((o) => o.member.id));
  const boardNameById = new Map(boards.map((b) => [b.id, b.name]));
  const monthByMember = new Map<string, { board: string; count: number }[]>();
  for (const r of monthCounts) {
    if (!r.boardId || !boardNameById.has(r.boardId)) continue;
    const list = monthByMember.get(r.memberId) ?? [];
    list.push({ board: boardNameById.get(r.boardId)!, count: r.n });
    monthByMember.set(r.memberId, list);
  }
  const atLimit = new Set<string>();
  for (const [memberId, list] of monthByMember) if (!overQuotaIds.has(memberId) && list.some((x) => x.count === MONTHLY_LEAVE_LIMIT)) atLimit.add(memberId);
  const selectedBoardName = boardId ? boards.find((b) => b.id === boardId)?.name : null;
  const withLeave = stats.filter((s) => s.leaveCount > 0).length;
  const periodLabel = isCustomRange ? `${fromValid} → ${toValid}` : daysParam === "all" ? "all time" : `last ${daysParam} days`;

  const rows: LeaveStatRow[] = stats.map((s) => ({
    id: s.member.id,
    name: memberDisplayName(s.member),
    avatar: s.member.discordAvatar,
    className: s.member.characterClass,
    count: s.leaveCount,
    lastLeaveIso: s.lastLeaveAt ? s.lastLeaveAt.toISOString() : null,
    month: monthByMember.get(s.member.id) ?? [],
    over: overQuotaIds.has(s.member.id),
  }));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Leave Stats"
        description={
          <>
            Leaves per member{selectedBoardName ? ` on ${selectedBoardName}` : ""} — a leave counts once its round has ended and it
            wasn&apos;t cancelled. Limit: {MONTHLY_LEAVE_LIMIT} per board per month.
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        {boards.length > 0 && (
          <Segmented
            value={boardParam}
            items={[
              { key: ALL_BOARDS_VALUE, label: "All boards", href: `/attendance?${rangeQuery}&board=${ALL_BOARDS_VALUE}` },
              ...boards.map((b) => ({ key: b.id, label: b.name, href: `/attendance?${rangeQuery}&board=${b.id}` })),
            ]}
          />
        )}
        <Segmented
          value={isCustomRange ? "custom" : daysParam}
          items={[
            ...DAY_OPTIONS.map((o) => ({ key: o.value, label: o.label, href: `/attendance?days=${o.value}&board=${boardParam}` })),
            ...(isCustomRange ? [{ key: "custom", label: `${fromValid} → ${toValid}` }] : []),
          ]}
        />
        <details className="group relative">
          <summary className="cursor-pointer list-none rounded-lg border border-zinc-800 bg-zinc-900/70 px-2.5 py-1 text-xs text-zinc-300 transition hover:border-zinc-700">
            Custom range…
          </summary>
          <form action="/attendance" method="get" className="absolute left-0 z-20 mt-1 flex flex-wrap items-end gap-2 rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-xs shadow-xl sm:w-max">
            <input type="hidden" name="board" value={boardParam} />
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-zinc-500">From</span>
              <input type="date" name="from" defaultValue={fromValid ?? ""} className="[color-scheme:dark] rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-zinc-500">To</span>
              <input type="date" name="to" defaultValue={toValid ?? ""} className="[color-scheme:dark] rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none" />
            </label>
            <button type="submit" className="rounded-lg bg-amber-600 px-3 py-1.5 font-medium text-white hover:bg-amber-500">
              View
            </button>
            {isCustomRange && (
              <Link href={`/attendance?days=30&board=${boardParam}`} className="px-1 py-1.5 text-zinc-500 underline decoration-dotted hover:text-zinc-300">
                Clear
              </Link>
            )}
          </form>
        </details>
        {session.user.isAdmin && (
          <div className="w-full sm:ml-auto sm:w-auto">
            <VoidLeavesForm boards={boards} />
          </div>
        )}
      </div>

      <KpiGrid>
        <Kpi
          label="Leaves in period"
          value={totalLeaveEvents}
          hint={breakdown && breakdown.length ? breakdown.map((b) => `${b.boardName} ${b.leaveCount}`).join(" · ") : periodLabel}
        />
        <Kpi label="Members who took leave" value={withLeave} suffix={`/${stats.length}`} hint={stats.length ? `${Math.round((withLeave / stats.length) * 100)}% of the roster` : ""} />
        <Kpi
          label="Over quota this month"
          value={overQuota.length}
          tone={overQuota.length ? "bad" : "ok"}
          hint={overQuota.length ? overQuota.map((o) => memberDisplayName(o.member)).join(", ") : "Nobody over the limit ✓"}
        />
        <Kpi label="At the limit this month" value={atLimit.size} tone={atLimit.size ? "warn" : "ok"} hint={`Used ${MONTHLY_LEAVE_LIMIT}/${MONTHLY_LEAVE_LIMIT} on a board — one more goes over`} />
      </KpiGrid>

      <LeaveStatsList rows={rows} boards={boards.map((b) => b.name)} limit={MONTHLY_LEAVE_LIMIT} periodLabel={periodLabel} />
    </div>
  );
}
