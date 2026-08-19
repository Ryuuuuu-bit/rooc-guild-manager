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
  JOIN: "Joined Discord",
  LEAVE: "Left Discord",
  KICK: "Kicked from Discord",
  ROLE_UPDATE: "Discord roles changed",
  PROFILE_UPDATE: "Profile updated",
  NOTE: "Note added",
};
