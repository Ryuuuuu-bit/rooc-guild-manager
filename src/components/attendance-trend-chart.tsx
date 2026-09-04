import type { AttendanceTrendPoint } from "@/lib/checkin-data";

interface AttendanceTrendChartProps {
  title: string;
  points: AttendanceTrendPoint[];
}

function fmtShortDate(dateStr: string): string {
  // dateStr is "YYYY-MM-DD" — render as "Aug 27" to match the compact date
  // pills used elsewhere (checkin/attendance pages).
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone: "UTC" });
}

const CHART_HEIGHT = 132;
// 5 evenly-spaced guides (100/75/50/25/0) — recessive grid, no per-line
// labels; the two edges are enough to anchor the scale (see the "100%"/"0%"
// tags below) without cluttering a panel this small.
const GRID_STEPS = [0, 1, 2, 3, 4];

/**
 * Bar-chart panel: attendance rate for the last few check-in windows of one
 * event, oldest to newest left-to-right. Single series (one event's own
 * history) so no legend — the title already says what's plotted. Bars are a
 * uniform accent color (magnitude reads from height, not a color ramp); the
 * latest bar gets a direct label and a brighter fill since it's the one
 * number the glance is usually for. Hover reveals the exact figures via a
 * pure-CSS (group-hover) tooltip anchored to each bar — no client JS needed
 * for what's ultimately just a `:hover` reveal.
 */
export function AttendanceTrendChart({ title, points }: AttendanceTrendChartProps) {
  const withData = points.filter((p) => p.rate !== null);
  const latest = points[points.length - 1];

  return (
    <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/50 p-5">
      <div className="mb-5 flex items-baseline justify-between">
        <h2 className="font-medium text-zinc-100">{title}</h2>
        {latest && latest.rate !== null && (
          <span className="text-xs text-zinc-500">
            Latest <span className="font-semibold tabular-nums text-amber-400">{Math.round(latest.rate * 100)}%</span>
          </span>
        )}
      </div>

      {withData.length === 0 ? (
        <p className="py-10 text-center text-sm text-zinc-500">Not enough data for a chart yet</p>
      ) : (
        <>
          <div className="relative" style={{ height: CHART_HEIGHT }}>
            {/* recessive grid */}
            <div className="absolute inset-0 flex flex-col justify-between">
              {GRID_STEPS.map((i) => (
                <div key={i} className="border-t border-zinc-800/60" />
              ))}
            </div>
            <span className="absolute -top-4 left-0 text-[10px] text-zinc-600">100%</span>
            <span className="absolute -bottom-4 left-0 text-[10px] text-zinc-600">0%</span>

            {/* bars — columns are capped with max-w so a handful of points
                (a fresh event with little history yet) cluster at a normal
                bar width instead of each stretching to fill the panel and
                leaving huge gaps; justify-center keeps the cluster balanced
                in the available space rather than pinned to one edge. */}
            <div className="absolute inset-0 flex items-end justify-center gap-2.5">
              {points.map((p, i) => {
                const isLast = i === points.length - 1;
                const heightPct = p.rate === null ? 0 : Math.max(3, Math.round(p.rate * 100));
                return (
                  <div key={p.date} className="group relative flex h-full max-w-16 flex-1 items-end justify-center">
                    {/* hover tooltip */}
                    <div className="pointer-events-none absolute bottom-[calc(100%+8px)] z-10 hidden flex-col items-center gap-0.5 whitespace-nowrap rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-[11px] shadow-xl group-hover:flex">
                      <span className="font-medium text-zinc-200">{fmtShortDate(p.date)}</span>
                      <span className="text-zinc-500">
                        {p.rate === null
                          ? "No data"
                          : `Attended ${p.attendedCount}/${p.totalCount} · ${Math.round(p.rate * 100)}%`}
                      </span>
                    </div>

                    {isLast && p.rate !== null && (
                      <span
                        className="absolute text-[11px] font-medium text-zinc-300 transition-opacity group-hover:opacity-0"
                        style={{ bottom: `calc(${heightPct}% + 6px)` }}
                      >
                        {Math.round(p.rate * 100)}%
                      </span>
                    )}
                    <div
                      className={`w-full max-w-9 rounded-t-md transition-colors ${
                        p.rate === null
                          ? "bg-zinc-800 group-hover:bg-zinc-700"
                          : isLast
                            ? "bg-amber-400 group-hover:bg-amber-300"
                            : "bg-amber-500/55 group-hover:bg-amber-500/85"
                      }`}
                      style={{ height: `${heightPct}%` }}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-2 flex justify-center gap-2.5">
            {points.map((p) => (
              <span key={p.date} className="max-w-16 flex-1 text-center text-[10px] whitespace-nowrap text-zinc-500">
                {fmtShortDate(p.date)}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
