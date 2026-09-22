"use client";

import type { Member } from "@/db/schema";
import { statusColors, statusLabels } from "@/lib/ui";
import { useJobClasses } from "@/components/job-classes-provider";
import { ClassIcon } from "@/components/class-icon";

export function StatusBadge({ status }: { status: Member["status"] }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColors[status]}`}
    >
      {statusLabels[status]}
    </span>
  );
}

/** Flags a member who still holds the tracked Discord role but is marked as not currently playing. */
export function BenchedBadge() {
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-300 ring-1 ring-inset ring-amber-500/30">
      Benched
    </span>
  );
}

export function ClassBadge({ className }: { className: string | null }) {
  const { colorClassOf } = useJobClasses();
  if (!className) return <span className="text-zinc-500">—</span>;
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${colorClassOf(className)}`}
    >
      <ClassIcon job={className} size={12} />
      {className}
    </span>
  );
}

/** Small muted tags for a member's secondary classes, after their ClassBadge. */
export function AltClassBadges({ altClasses }: { altClasses: string[] }) {
  if (altClasses.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1" title="Secondary classes (can also play)">
      {altClasses.map((c) => (
        <span
          key={c}
          className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-zinc-800/70 px-2 py-0.5 text-[11px] text-zinc-400 ring-1 ring-inset ring-zinc-700/60"
        >
          <ClassIcon job={c} size={10} />
          {c}
        </span>
      ))}
    </span>
  );
}

/** Emoji-only version of AltClassBadges for dense rows (tables, pickers) — names in the tooltip. */
export function AltClassIcons({ altClasses, size = 11 }: { altClasses: string[]; size?: number }) {
  if (altClasses.length === 0) return null;
  return (
    <span
      className="inline-flex shrink-0 items-center gap-px rounded-full bg-zinc-800/60 px-1 py-px ring-1 ring-inset ring-zinc-700/60"
      title={`Secondary classes: ${altClasses.join(", ")}`}
    >
      {altClasses.map((c) => (
        <ClassIcon key={c} job={c} size={size} />
      ))}
    </span>
  );
}
