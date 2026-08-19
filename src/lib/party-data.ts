import { db } from "@/db";
import { members, partyBusyEntries, partyLeaders, partySlots } from "@/db/schema";
import { eq } from "drizzle-orm";
import { memberDisplayName } from "@/lib/ui";
import type { Member } from "@/db/schema";

const MAIN_PARTY_COUNT = 8;
const SUB_PARTIES_PER_GROUP = 4;
const SLOTS_PER_PARTY = 5;

export interface PartyBoardMemberRef {
  id: string;
  displayName: string;
  discordAvatar: string | null;
}

export interface PartySlotView {
  slotIndex: number;
  member: PartyBoardMemberRef | null;
  className: string | null;
}

export interface PartyView {
  partyNumber: number;
  slots: PartySlotView[];
}

export interface PartySubGroupView {
  leaderGroup: number;
  leaderName: string | null;
  parties: PartyView[];
}

export interface PartyBoard {
  mainParties: PartyView[];
  subGroups: PartySubGroupView[];
  busy: { member: PartyBoardMemberRef; className: string | null }[];
  unassigned: PartyBoardMemberRef[];
}

function toRef(member: Member): PartyBoardMemberRef {
  return {
    id: member.id,
    displayName: memberDisplayName(member),
    discordAvatar: member.discordAvatar,
  };
}

export async function getPartyBoard(): Promise<PartyBoard> {
  const [activeMembers, slots, leaders, busyRows] = await Promise.all([
    db.select().from(members).where(eq(members.status, "ACTIVE")),
    db.select().from(partySlots),
    db.select().from(partyLeaders),
    db.select().from(partyBusyEntries),
  ]);

  const membersById = new Map(activeMembers.map((m) => [m.id, m]));
  const placedMemberIds = new Set<string>();

  const slotByKey = new Map(
    slots.map((s) => [`${s.section}:${s.partyNumber}:${s.slotIndex}`, s])
  );

  function buildParty(section: "MAIN" | "SUB", partyNumber: number): PartyView {
    const slotViews: PartySlotView[] = [];
    for (let slotIndex = 0; slotIndex < SLOTS_PER_PARTY; slotIndex++) {
      const row = slotByKey.get(`${section}:${partyNumber}:${slotIndex}`);
      const member = row?.memberId ? membersById.get(row.memberId) ?? null : null;
      if (member) placedMemberIds.add(member.id);
      slotViews.push({
        slotIndex,
        member: member ? toRef(member) : null,
        className: member ? row?.className ?? null : null,
      });
    }
    return { partyNumber, slots: slotViews };
  }

  const mainParties: PartyView[] = [];
  for (let p = 1; p <= MAIN_PARTY_COUNT; p++) {
    mainParties.push(buildParty("MAIN", p));
  }

  const leaderByGroup = new Map(leaders.map((l) => [l.leaderGroup, l]));
  const subGroups: PartySubGroupView[] = [1, 2].map((leaderGroup) => {
    const startParty = (leaderGroup - 1) * SUB_PARTIES_PER_GROUP + 1;
    const parties: PartyView[] = [];
    for (let i = 0; i < SUB_PARTIES_PER_GROUP; i++) {
      parties.push(buildParty("SUB", startParty + i));
    }
    return {
      leaderGroup,
      leaderName: leaderByGroup.get(leaderGroup)?.name ?? null,
      parties,
    };
  });

  const busy = busyRows
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((row) => {
      const member = membersById.get(row.memberId);
      if (!member) return null;
      placedMemberIds.add(member.id);
      return { member: toRef(member), className: row.className };
    })
    .filter((v): v is { member: PartyBoardMemberRef; className: string | null } => v !== null);

  const unassigned = activeMembers
    .filter((m) => !placedMemberIds.has(m.id))
    .map(toRef)
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "th"));

  return { mainParties, subGroups, busy, unassigned };
}
