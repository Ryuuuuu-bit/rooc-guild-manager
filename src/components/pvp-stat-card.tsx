import type { ReactNode } from "react";
import type { PvpStatEntry } from "@/db/schema";
import { PVP_STAT_FIELD_GROUPS, fmtInt, fmtPct } from "@/lib/pvp-stat-fields";

interface PvpStatCardProps {
  header: ReactNode;
  entry: PvpStatEntry | null;
  /** Admin review badge + button row — omitted entirely when there's no entry to review. */
  reviewAction?: ReactNode;
  footer?: ReactNode;
}

/**
 * One member's (or one submission's) stats as a mobile-friendly card — the
 * narrow-screen counterpart to the wide desktop table, reading the same
 * field list from pvp-stat-fields.ts so the two never drift apart.
 */
export function PvpStatCard({ header, entry, reviewAction, footer }: PvpStatCardProps) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
      {header}

      {!entry ? (
        <p className="text-sm text-zinc-500">ยังไม่กรอกสถิติ</p>
      ) : (
        <>
          {reviewAction && <div className="flex flex-wrap items-center gap-2">{reviewAction}</div>}

          {entry.reviewNote && (
            <p className="rounded-lg bg-zinc-950 px-3 py-2 text-xs text-zinc-400 ring-1 ring-inset ring-zinc-800">
              {entry.reviewNote}
            </p>
          )}

          {entry.role && (
            <p className="text-xs text-zinc-500">
              Role: <span className="text-zinc-300">{entry.role}</span>
            </p>
          )}

          <div className="flex flex-col gap-3">
            {PVP_STAT_FIELD_GROUPS.map((group) => (
              <div key={group.title} className="flex flex-col gap-1">
                <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">{group.title}</p>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  {group.fields.map((f) => (
                    <div key={f.key} className="flex items-center justify-between gap-2">
                      <span className="text-zinc-500">{f.label}</span>
                      <span
                        className={`font-medium tabular-nums ${f.key === "cp" ? "text-amber-300" : "text-zinc-200"}`}
                      >
                        {f.isPercent ? fmtPct(entry[f.key]) : fmtInt(entry[f.key])}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {entry.bossCards && (
            <p className="text-xs text-zinc-400">
              <span className="text-zinc-500">การ์ดบอส: </span>
              {entry.bossCards}
            </p>
          )}
        </>
      )}

      {footer}
    </div>
  );
}
