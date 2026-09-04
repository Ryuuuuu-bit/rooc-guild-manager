import Link from "next/link";
import { getAttendanceBoardBreakdown, getAttendanceStats } from "@/lib/data";
import { listPartyBoards } from "@/lib/party-data";
import { requireUser } from "@/lib/authz";
import { memberDisplayName } from "@/lib/ui";
import { MemberAvatar } from "@/components/member-avatar";

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

  const [{ stats, totalLeaveEvents }, breakdown] = await Promise.all([
    getAttendanceStats({ ...rangeFilter, boardId }),
    // Only needed for the "All Boards" view's summary pills — skip the extra
    // query when a specific board is already selected (its total is already
    // shown above the table).
    boardId ? Promise.resolve(null) : getAttendanceBoardBreakdown(rangeFilter),
  ]);
  const maxLeaveCount = Math.max(1, ...stats.map((s) => s.leaveCount));
  const selectedBoardName = boardId ? boards.find((b) => b.id === boardId)?.name : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-50">Leave Stats</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Number of times each member clicked &quot;Leave&quot;
            {selectedBoardName ? ` on the "${selectedBoardName}" board` : ""}
            {" "}in the selected period — {totalLeaveEvents} total{selectedBoardName ? "" : " across all boards"}, sorted
            most to least frequent
          </p>
          {session.user.isAdmin && (
            <p className="mt-1 text-xs text-zinc-500">
              Need to fix someone&apos;s leave entry? Click a member&apos;s name below to go to their profile — remove
              test/mistaken entries from their &quot;Activity Log&quot;, or add a backdated leave (e.g. one reported via
              DM) from &quot;Log Manual Leave&quot;. (Every leave entry already stores an exact date and time — hover
              the &quot;Last Leave&quot; column below to see the full timestamp, or view every entry broken down by day
              in that member&apos;s &quot;Activity Log&quot;.)
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {boards.length > 0 && (
            <div className="flex flex-wrap gap-1 rounded-xl border border-zinc-800 bg-zinc-900/50 p-1">
              <Link
                href={`/attendance?${rangeQuery}&board=${ALL_BOARDS_VALUE}`}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  boardParam === ALL_BOARDS_VALUE
                    ? "bg-amber-600 text-white"
                    : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                }`}
              >
                All Boards
              </Link>
              {boards.map((b) => (
                <Link
                  key={b.id}
                  href={`/attendance?${rangeQuery}&board=${b.id}`}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                    boardParam === b.id
                      ? "bg-amber-600 text-white"
                      : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                  }`}
                >
                  {b.name}
                </Link>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-1 rounded-xl border border-zinc-800 bg-zinc-900/50 p-1">
            {DAY_OPTIONS.map((opt) => (
              <Link
                key={opt.value}
                href={`/attendance?days=${opt.value}&board=${boardParam}`}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  !isCustomRange && daysParam === opt.value
                    ? "bg-amber-600 text-white"
                    : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                }`}
              >
                {opt.label}
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Custom date range — a plain GET form, no JS needed. Picking a
          preset above clears this (the preset links don't carry from/to);
          filling this in and submitting overrides whichever preset was
          active. */}
      <form
        action="/attendance"
        method="get"
        className={`flex flex-wrap items-end gap-2 rounded-xl border p-3 text-xs ${
          isCustomRange ? "border-amber-600/60 bg-amber-950/10" : "border-zinc-800 bg-zinc-900/50"
        }`}
      >
        <input type="hidden" name="board" value={boardParam} />
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-zinc-500">From</label>
          <input
            type="date"
            name="from"
            defaultValue={fromValid ?? ""}
            className="[color-scheme:dark] rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-zinc-500">To</label>
          <input
            type="date"
            name="to"
            defaultValue={toValid ?? ""}
            className="[color-scheme:dark] rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:bg-zinc-800"
        >
          View Range
        </button>
        {isCustomRange && (
          <Link
            href={`/attendance?days=30&board=${boardParam}`}
            className="rounded-lg px-3 py-1.5 text-xs text-zinc-500 underline decoration-dotted hover:text-zinc-300"
          >
            Clear custom range
          </Link>
        )}
      </form>

      {/* Per-board split — only shown on the "All Boards" view, e.g. lets an
          admin see "GL: 12 times · WOE: 8 times" at a glance without having
          to click through each board's tab one at a time. */}
      {breakdown && breakdown.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {breakdown.map((b) => (
            <Link
              key={b.boardId ?? "none"}
              href={b.boardId ? `/attendance?${rangeQuery}&board=${b.boardId}` : "#"}
              className={`whitespace-nowrap rounded-full border border-zinc-800 bg-zinc-900/50 px-3 py-1 text-xs text-zinc-300 transition ${
                b.boardId ? "hover:border-amber-600/60 hover:text-amber-300" : "cursor-default"
              }`}
            >
              <span className="font-medium text-zinc-100">{b.boardName}</span>
              <span className="text-zinc-500"> — {b.leaveCount} times</span>
            </Link>
          ))}
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-zinc-800 bg-zinc-900/50">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
              <th className="w-10 px-5 py-3 font-medium">#</th>
              <th className="px-5 py-3 font-medium">Member</th>
              <th className="px-5 py-3 font-medium">Leave Count</th>
              <th className="px-5 py-3 font-medium">Last Leave</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {stats.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-10 text-center text-zinc-500">
                  No member data
                </td>
              </tr>
            )}
            {stats.map((row, i) => (
              <tr key={row.member.id} className="hover:bg-zinc-800/40">
                <td className="px-5 py-3 text-zinc-500">{i + 1}</td>
                <td className="px-5 py-3">
                  <Link href={`/members/${row.member.id}`} className="flex items-center gap-3">
                    <MemberAvatar
                      src={row.member.discordAvatar}
                      alt={row.member.discordUsername}
                      width={28}
                      height={28}
                      className="h-7 w-7 rounded-full ring-1 ring-zinc-700"
                    />
                    <span className="truncate font-medium text-zinc-100">{memberDisplayName(row.member)}</span>
                  </Link>
                </td>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2">
                    <div className="h-2 flex-1 max-w-40 overflow-hidden rounded-full bg-zinc-800">
                      {row.leaveCount > 0 && (
                        <div
                          className="h-full rounded-full bg-amber-500"
                          style={{ width: `${(row.leaveCount / maxLeaveCount) * 100}%` }}
                        />
                      )}
                    </div>
                    <span className="w-6 shrink-0 text-right text-zinc-300">{row.leaveCount}</span>
                  </div>
                </td>
                <td className="px-5 py-3 text-xs text-zinc-400">
                  {row.lastLeaveAt ? (
                    <span
                      title={row.lastLeaveAt.toLocaleString("th-TH", {
                        dateStyle: "medium",
                        timeStyle: "short",
                        timeZone: "Asia/Bangkok",
                      })}
                    >
                      {row.lastLeaveAt.toLocaleDateString("th-TH", { dateStyle: "medium", timeZone: "Asia/Bangkok" })}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
