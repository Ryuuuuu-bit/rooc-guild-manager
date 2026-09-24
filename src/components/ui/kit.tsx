// Shared page building blocks (the "Design kit"): page header, KPI tiles,
// segmented control, chips, cards and status tags — so every page reads the
// same. Server-safe (no hooks); interactive bits pass plain onClick / href.
import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-[13px] text-zinc-400">{description}</p>}
      </div>
      {actions && <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">{actions}</div>}
    </div>
  );
}

const TONE_TEXT = {
  default: "text-zinc-50",
  ok: "text-emerald-400",
  warn: "text-amber-300",
  bad: "text-rose-400",
  info: "text-sky-300",
  violet: "text-violet-300",
  dim: "text-zinc-500",
} as const;
export type Tone = keyof typeof TONE_TEXT;

/** One KPI tile — fixed min height and a bottom-pinned hint so a row of them always lines up. */
export function Kpi({ label, value, suffix, hint, tone = "default", bar, alert = false }: { label: string; value: ReactNode; suffix?: ReactNode; hint?: ReactNode; tone?: Tone; bar?: { pct: number; tone?: "amber" | "ok" | "bad" }; alert?: boolean }) {
  const barClass = bar?.tone === "ok" ? "from-emerald-600 to-emerald-400" : bar?.tone === "bad" ? "from-rose-600 to-rose-400" : "from-amber-600 to-amber-300";
  return (
    <div className={`flex min-h-[100px] min-w-0 flex-col rounded-xl border bg-zinc-900/60 px-3.5 py-2.5 ${alert ? "border-amber-400/35" : "border-zinc-800"}`}>
      <div className="truncate text-[10.5px] uppercase tracking-wider text-zinc-400">{label}</div>
      <div className={`mt-0.5 text-[21px] font-bold tabular-nums ${TONE_TEXT[tone]}`}>
        {value}
        {suffix != null && <span className="text-[13px] font-medium text-zinc-500">{suffix}</span>}
      </div>
      {bar && (
        <div className="mt-1.5 h-1.5 overflow-hidden rounded bg-zinc-800">
          <i className={`block h-full rounded bg-gradient-to-r ${barClass}`} style={{ width: `${Math.max(0, Math.min(100, bar.pct))}%` }} />
        </div>
      )}
      {hint != null && <div className="mt-auto truncate pt-1 text-[11px] text-zinc-500">{hint}</div>}
    </div>
  );
}

export function KpiGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">{children}</div>;
}

export interface SegmentItem {
  key: string;
  label: ReactNode;
  count?: number;
  href?: string;
}

/** Single-choice control. Items with `href` render as links (server pages); otherwise buttons calling onSelect. */
export function Segmented({ items, value, onSelect }: { items: SegmentItem[]; value: string; onSelect?: (key: string) => void }) {
  return (
    <div className="inline-flex max-w-full flex-wrap rounded-lg border border-zinc-800 bg-zinc-950/70 p-0.5">
      {items.map((it) => {
        const cls = `whitespace-nowrap rounded-md px-2.5 py-1 text-xs transition ${it.key === value ? "bg-zinc-800 font-medium text-zinc-50" : "text-zinc-500 hover:text-zinc-200"}`;
        const body = (
          <>
            {it.label}
            {it.count != null && <span className="ml-1 text-[11px] text-zinc-500">{it.count}</span>}
          </>
        );
        return it.href ? (
          <Link key={it.key} href={it.href} className={cls} scroll={false}>
            {body}
          </Link>
        ) : (
          <button key={it.key} type="button" onClick={() => onSelect?.(it.key)} className={cls}>
            {body}
          </button>
        );
      })}
    </div>
  );
}

/** Toggle / filter chip. */
export function Chip({ on, onClick, children, count, title }: { on: boolean; onClick: () => void; children: ReactNode; count?: number; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs transition ${
        on ? "border-amber-600 bg-amber-600/15 text-amber-100" : "border-zinc-800 bg-zinc-950/70 text-zinc-300 hover:border-zinc-600"
      }`}
    >
      {children}
      {count != null && <span className="text-[11px] text-zinc-500">{count}</span>}
    </button>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`min-w-0 rounded-xl border border-zinc-800 bg-zinc-900/60 ${className}`}>{children}</section>;
}

export function CardHeader({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-3.5 py-2.5">
      {children}
      {right && <div className="ml-auto flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}

const TAG = {
  ok: "bg-emerald-400/15 text-emerald-300",
  warn: "bg-amber-400/15 text-amber-200",
  bad: "bg-rose-500/15 text-rose-300",
  info: "bg-sky-400/15 text-sky-300",
  violet: "bg-violet-400/15 text-violet-300",
  mute: "bg-zinc-800 text-zinc-400",
} as const;

export function StatusTag({ tone, children, title }: { tone: keyof typeof TAG; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-px text-[10.5px] font-semibold ${TAG[tone]}`}>
      {children}
    </span>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="px-4 py-10 text-center text-sm text-zinc-500">{children}</div>;
}
