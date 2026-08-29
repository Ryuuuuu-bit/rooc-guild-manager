import type { AttendanceTrendPoint } from "@/lib/checkin-data";

interface AttendanceTrendChartProps {
  title: string;
  points: AttendanceTrendPoint[];
}

function fmtShortDate(dateStr: string): string {
  // dateStr is "YYYY-MM-DD" (Thai calendar) — render as "27 ส.ค." to match
  // the compact date pills used elsewhere (checkin/attendance pages).
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.toLocaleDateString("th-TH", { day: "numeric", month: "short", timeZone: "UTC" });
}

/**
 * Small bar-chart panel: attendance rate for the last few check-in windows
 * of one event, oldest to newest left-to-right. Single series (one event's
 * own history) so no legend — the title already says what's plotted, per
 * the app's one-series-needs-no-legend rule. Bars are a uniform accent
 * color (magnitude reads from height, not a color ramp); the latest bar
 * gets a direct label since it's the one number the glance is usually
 * for, and every bar carries the exact count in its hover title.
 */
export function AttendanceTrendChart({ title, points }: AttendanceTrendChartProps) {
  const withData = points.filter((p) => p.rate !== null);
  const latest = points[points.length - 1];

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="font-medium text-zinc-100">{title}</h2>
        {latest && latest.rate !== null && (
          <span className="text-xs text-zinc-500">
            ล่าสุด <span className="font-medium text-amber-400">{Math.round(latest.rate * 100)}%</span>
          </span>
        )}
      </div>

      {withData.length === 0 ? (
        <p className="text-sm text-zinc-500">ยังไม่มีข้อมูลเพียงพอสำหรับกราฟ</p>
      ) : (
        <div className="flex h-28 items-end gap-3">
          {points.map((p, i) => {
            const isLast = i === points.length - 1;
            const heightPct = p.rate === null ? 0 : Math.max(4, Math.round(p.rate * 100));
            return (
              <div key={p.date} className="flex w-11 shrink-0 flex-col items-center gap-1.5">
                <div className="relative flex h-20 w-full items-end justify-center">
                  {isLast && p.rate !== null && (
                    <span className="absolute -top-5 text-[11px] font-medium text-zinc-300">
                      {Math.round(p.rate * 100)}%
                    </span>
                  )}
                  <div
                    className={`w-full rounded-t ${p.rate === null ? "bg-zinc-800" : "bg-amber-500"}`}
                    style={{ height: `${heightPct}%` }}
                    title={
                      p.rate === null
                        ? `${fmtShortDate(p.date)} — ไม่มีข้อมูล`
                        : `${fmtShortDate(p.date)} — เข้าร่วม ${p.attendedCount}/${p.totalCount} คน (${Math.round(p.rate * 100)}%)`
                    }
                  />
                </div>
                <span className="whitespace-nowrap text-[10px] text-zinc-500">{fmtShortDate(p.date)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
