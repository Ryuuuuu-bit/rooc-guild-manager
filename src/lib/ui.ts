import type { Member } from "@/db/schema";

/**
 * Best available display name for a member: their Discord server-specific
 * nickname first, then global display name, then falling back to username.
 */
export function memberDisplayName(
  member: Pick<Member, "discordNickname" | "discordGlobalName" | "discordUsername">
): string {
  return member.discordNickname || member.discordGlobalName || member.discordUsername;
}

export const statusLabels: Record<Member["status"], string> = {
  ACTIVE: "Active",
  LEFT: "Left",
  KICKED: "Kicked",
};

export const statusColors: Record<Member["status"], string> = {
  ACTIVE: "bg-emerald-400/15 text-emerald-300 ring-1 ring-inset ring-emerald-400/30",
  LEFT: "bg-zinc-400/15 text-zinc-400 ring-1 ring-inset ring-zinc-400/30",
  KICKED: "bg-rose-400/15 text-rose-300 ring-1 ring-inset ring-rose-400/30",
};

export const eventLabels: Record<string, string> = {
  JOIN: "Joined guild",
  LEAVE: "Left guild",
  KICK: "Kicked from guild",
  ROLE_UPDATE: "Discord role changed",
  PROFILE_UPDATE: "Profile edited",
  NOTE: "Note added",
  ATTENDANCE_LEAVE: "Leave",
  ATTENDANCE_RETURN: "Leave cancelled / returned",
  CLASS_CHANGE: "Class changed",
  NAME_CHANGE: "Discord name changed",
};

/**
 * Color-codes the activity feed so it's scannable at a glance: green for
 * someone joining, red for someone leaving/being kicked, amber for
 * everything else (profile edits, role changes, class/name changes, ลา —
 * i.e. "an update happened", not a membership change).
 */
export const eventTypeColors: Record<string, string> = {
  JOIN: "text-emerald-400",
  LEAVE: "text-rose-400",
  KICK: "text-rose-400",
  ROLE_UPDATE: "text-amber-400",
  PROFILE_UPDATE: "text-amber-400",
  NOTE: "text-amber-400",
  ATTENDANCE_LEAVE: "text-amber-400",
  ATTENDANCE_RETURN: "text-amber-400",
  CLASS_CHANGE: "text-amber-400",
  NAME_CHANGE: "text-amber-400",
};

export const eventTypeDotColors: Record<string, string> = {
  JOIN: "bg-emerald-400",
  LEAVE: "bg-rose-400",
  KICK: "bg-rose-400",
  ROLE_UPDATE: "bg-amber-400",
  PROFILE_UPDATE: "bg-amber-400",
  NOTE: "bg-amber-400",
  ATTENDANCE_LEAVE: "bg-amber-400",
  ATTENDANCE_RETURN: "bg-amber-400",
  CLASS_CHANGE: "bg-amber-400",
  NAME_CHANGE: "bg-amber-400",
};
