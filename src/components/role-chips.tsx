import type { DiscordRole } from "@/db/schema";

interface RoleChipsProps {
  roleIds: string[];
  rolesById: Map<string, DiscordRole>;
  max?: number;
}

/** Renders a compact row of Discord role badges, colored to match Discord's role color. */
export function RoleChips({ roleIds, rolesById, max = 3 }: RoleChipsProps) {
  const resolved = roleIds
    .map((id) => rolesById.get(id))
    .filter((r): r is DiscordRole => Boolean(r))
    // Discord shows higher-position roles first.
    .sort((a, b) => b.position - a.position);

  if (resolved.length === 0) {
    return <span className="text-xs text-zinc-600">—</span>;
  }

  const shown = resolved.slice(0, max);
  const overflow = resolved.length - shown.length;

  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((role) => {
        const hex = role.color ? `#${role.color.toString(16).padStart(6, "0")}` : null;
        return (
          <span
            key={role.id}
            className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300 ring-1 ring-inset ring-zinc-700"
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: hex ?? "#71717a" }}
            />
            {role.name}
          </span>
        );
      })}
      {overflow > 0 && (
        <span className="text-xs text-zinc-500">+{overflow}</span>
      )}
    </div>
  );
}
