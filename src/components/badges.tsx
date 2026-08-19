import type { Member } from "@/db/schema";
import { rankColors, rankLabels, statusColors, statusLabels } from "@/lib/ui";

export function RankBadge({ rank }: { rank: Member["guildRank"] }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${rankColors[rank]}`}>
      {rankLabels[rank]}
    </span>
  );
}

export function StatusBadge({ status }: { status: Member["status"] }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColors[status]}`}>
      {statusLabels[status]}
    </span>
  );
}
