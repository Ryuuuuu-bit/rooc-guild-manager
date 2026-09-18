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

// Each accent gets a big number color, a corner "status dot", an icon-chip
// tint, and a soft full-card gradient wash — every class here is written out
// in full (not assembled from a template string) since Tailwind's build-time
// scanner only picks up literal class names that appear in source, same
// reasoning as COLOR_PALETTE/GRADIENT_CLASS in job-class-colors.ts.
const ACCENT: Record<
  NonNullable<StatCardProps["accent"]>,
  { text: string; dot: string; chip: string; wash: string }
> = {
  default: {
    text: "text-zinc-50",
    dot: "bg-sky-400",
    chip: "bg-white/10 text-zinc-200",
    wash: "from-sky-500/15 via-indigo-500/10 to-transparent",
  },
  positive: {
    text: "text-emerald-300",
    dot: "bg-emerald-400",
    chip: "bg-emerald-500/15 text-emerald-300",
    wash: "from-emerald-500/20 via-emerald-500/5 to-transparent",
  },
  negative: {
    text: "text-rose-300",
    dot: "bg-rose-400",
    chip: "bg-rose-500/15 text-rose-300",
    wash: "from-rose-500/20 via-rose-500/5 to-transparent",
  },
  warning: {
    text: "text-amber-300",
    dot: "bg-amber-400",
    chip: "bg-amber-500/15 text-amber-300",
    wash: "from-amber-500/20 via-amber-500/5 to-transparent",
  },
};

/** Dashboard KPI tile — a soft accent-colored gradient wash across the whole
 * card (color = at-a-glance good/bad reading, never the only signal since
 * the label always says what it is), a small status dot top-right, an
 * optional icon chip next to the hint, and a big tabular-nums value so a row
 * of these lines up like a real gauge panel. Same props as before — only
 * the visual treatment changed, so every call site is untouched. */
export function StatCard({ label, value, hint, icon, accent = "default" }: StatCardProps) {
  const a = ACCENT[accent];
  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-900/60 bg-gradient-to-br ${a.wash} p-5 transition hover:border-zinc-700`}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-wide text-zinc-400">{label}</span>
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${a.dot}`} />
      </div>
      <div className={`mt-3 text-3xl font-semibold tabular-nums ${a.text}`}>{value}</div>
      {(icon || hint) && (
        <div className="mt-2 flex items-center gap-2">
          {icon && (
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${a.chip}`}>{icon}</span>
          )}
          {hint && <span className="text-xs text-zinc-500">{hint}</span>}
        </div>
      )}
    </div>
  );
}
