import type { ReactNode } from "react";

interface StatCardProps {
  label: string;
  value: number | string;
  hint?: string;
  icon?: ReactNode;
  accent?: "default" | "positive" | "negative";
}

const accentClasses: Record<NonNullable<StatCardProps["accent"]>, string> = {
  default: "text-zinc-50",
  positive: "text-emerald-400",
  negative: "text-rose-400",
};

export function StatCard({ label, value, hint, icon, accent = "default" }: StatCardProps) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm text-zinc-400">{label}</span>
        {icon && <span className="text-zinc-500">{icon}</span>}
      </div>
      <div className={`mt-2 text-3xl font-semibold ${accentClasses[accent]}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-zinc-500">{hint}</div>}
    </div>
  );
}
