import type { Member } from "@/db/schema";
import { statusColors, statusLabels } from "@/lib/ui";
import { classColors } from "@/lib/classes";
import { ClassIcon } from "@/components/class-icon";

export function StatusBadge({ status }: { status: Member["status"] }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColors[status]}`}>
      {statusLabels[status]}
    </span>
  );
}

export function ClassBadge({ className }: { className: string | null }) {
  if (!className) return <span className="text-zinc-500">—</span>;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
        classColors[className] ?? "bg-zinc-700 text-zinc-300"
      }`}
    >
      <ClassIcon job={className} size={12} />
      {className}
    </span>
  );
}
