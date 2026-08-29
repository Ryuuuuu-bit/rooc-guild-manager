import type { ReactNode } from "react";

interface StatCardProps {
  label: string;
  /** Usually a plain number/string, but takes ReactNode too so a value like
   * "+3 / -1" can color-code its parts instead of reading as flat text. */
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
  accent?: "default" | "positive" | "negative" | "warning";
}

const ACCENT: Record<NonNullable<StatCardProps["accent"]>, { text: string; bar: string; chip: string }> = {
  default: { text: "text-zinc-50", bar: "bg-zinc-600", chip: "bg-zinc-800 text-zinc-400" },
  positive: { text: "text-emerald-400", bar: "bg-emerald-500", chip: "bg-emerald-500/15 text-emerald-300" },
  negative: { text: "text-rose-400", bar: "bg-rose-500", chip: "bg-rose-500/15 text-rose-300" },
  warning: { text: "text-amber-400", bar: "bg-amber-500", chip: "bg-amber-500/15 text-amber-300" },
};

/** Dashboard KPI tile — a hairline accent bar on top (color = at-a-glance
 * good/bad reading, never the only signal since the label always says what
 * it is), an optional icon chip in the same accent, and a big tabular-nums
 * value so a column of these lines up like a real gauge panel. */
export function StatCard({ label, value, hint, icon, accent = "default" }: StatCardProps) {
  const a = ACCENT[accent];
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-900/50 p-5 transition hover:border-zinc-700">
      <div className={`absolute inset-x-0 top-0 h-0.5 ${a.bar}`} />
      <div className="flex items-start justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</span>
        {icon && (
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${a.chip}`}>{icon}</span>
        )}
      </div>
      <div className={`mt-3 text-3xl font-semibold tabular-nums ${a.text}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-zinc-500">{hint}</div>}
    </div>
  );
}
