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
