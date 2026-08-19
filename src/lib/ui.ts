import type { Member } from "@/db/schema";

export const rankLabels: Record<Member["guildRank"], string> = {
  LEADER: "Guild Leader",
  OFFICER: "Officer",
  VETERAN: "Veteran",
  MEMBER: "Member",
  RECRUIT: "Recruit",
};

export const rankOrder: Member["guildRank"][] = [
  "LEADER",
  "OFFICER",
  "VETERAN",
  "MEMBER",
  "RECRUIT",
];

export const rankColors: Record<Member["guildRank"], string> = {
  LEADER: "bg-amber-400/15 text-amber-300 ring-1 ring-inset ring-amber-400/30",
  OFFICER: "bg-violet-400/15 text-violet-300 ring-1 ring-inset ring-violet-400/30",
  VETERAN: "bg-sky-400/15 text-sky-300 ring-1 ring-inset ring-sky-400/30",
  MEMBER: "bg-emerald-400/15 text-emerald-300 ring-1 ring-inset ring-emerald-400/30",
  RECRUIT: "bg-zinc-400/15 text-zinc-300 ring-1 ring-inset ring-zinc-400/30",
};

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
  RANK_UPDATE: "Guild rank changed",
  PROFILE_UPDATE: "Profile updated",
  NOTE: "Note added",
};
