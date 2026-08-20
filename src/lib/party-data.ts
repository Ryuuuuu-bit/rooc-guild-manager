import { db } from "@/db";
import { members, partyBoards, partyBusyEntries, partyGroupParties, partyGroups, partySlots } from "@/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import { memberDisplayName } from "@/lib/ui";
import type { Member } from "@/db/schema";

const SLOTS_PER_PARTY = 5;

// A member's class (job) lives once on `members.characterClass` and is
// carried on every PartyBoardMemberRef, so it's always in sync everywhere
// that member shows up — no separate per-slot/per-board copy to drift.
export interface PartyBoardMemberRef {
  id: string;
  displayName: string;
  discordAvatar: string | null;
  className: string | null;
}

export interface PartySlotView {
  slotIndex: number;
  member: PartyBoardMemberRef | null;
}

export interface PartyView {
  id: string;
  label: string;
  slots: PartySlotView[];
}

export interface PartyGroupView {
  id: string;
  name: string;
  parties: PartyView[];
}

export interface PartyBoardListItem {
  id: string;
  name: string;
}

export interface PartyBoardDetail {
  id: string;
  name: string;
  groups: PartyGroupView[];
  busy: PartyBoardMemberRef[];
  unassigned: PartyBoardMemberRef[];
}

function toRef(member: Member): PartyBoardMemberRef {
  return {
    id: member.id,
    displayName: memberDisplayName(member),
    discordAvatar: member.discordAvatar,
    className: member.characterClass,
  };
}

/** All boards (e.g. "ปกติ", "GVG"), in display order. */
export async function listPartyBoards(): Promise<PartyBoardListItem[]> {
  return db
    .select({ id: partyBoards.id, name: partyBoards.name })
    .from(partyBoards)
    .orderBy(asc(partyBoards.sortOrder), asc(partyBoards.createdAt));
}

/** Full nested detail for one board: groups → parties → slots, plus busy list and unassigned pool. */
export async function getPartyBoardDetail(boardId: string): Promise<PartyBoardDetail | null> {
  const board = await db.query.partyBoards.findFirst({ where: eq(partyBoards.id, boardId) });
  if (!board) return null;

  const [activeMembers, groups, busyRows] = await Promise.all([
    // Benched members are still ACTIVE (still in Discord with the tracked
    // role) but flagged out of party/event management entirely.
    db.select().from(members).where(and(eq(members.status, "ACTIVE"), eq(members.benched, false))),
    db.select().from(partyGroups).where(eq(partyGroups.boardId, boardId)).orderBy(asc(partyGroups.sortOrder)),
    db.select().from(partyBusyEntries).where(eq(partyBusyEntries.boardId, boardId)),
  ]);

  const membersById = new Map(activeMembers.map((m) => [m.id, m]));
  const placedMemberIds = new Set<string>();

  const groupIds = groups.map((g) => g.id);
  const parties = groupIds.length
    ? await db
        .select()
        .from(partyGroupParties)
        .where(inArray(partyGroupParties.groupId, groupIds))
        .orderBy(asc(partyGroupParties.sortOrder))
    : [];

  const partyIds = parties.map((p) => p.id);
  const slots = partyIds.length
    ? await db.select().from(partySlots).where(inArray(partySlots.partyId, partyIds))
    : [];

  const slotsByParty = new Map<string, typeof slots>();
  for (const s of slots) {
    const arr = slotsByParty.get(s.partyId) ?? [];
    arr.push(s);
    slotsByParty.set(s.partyId, arr);
  }

  const partiesByGroup = new Map<string, typeof parties>();
  for (const p of parties) {
    const arr = partiesByGroup.get(p.groupId) ?? [];
    arr.push(p);
    partiesByGroup.set(p.groupId, arr);
  }

  const groupViews: PartyGroupView[] = groups.map((g) => ({
    id: g.id,
    name: g.name,
    parties: (partiesByGroup.get(g.id) ?? []).map((p) => {
      const partySlotRows = slotsByParty.get(p.id) ?? [];
      const slotByIndex = new Map(partySlotRows.map((s) => [s.slotIndex, s]));
      const slotViews: PartySlotView[] = [];
      for (let i = 0; i < SLOTS_PER_PARTY; i++) {
        const row = slotByIndex.get(i);
        const member = row?.memberId ? membersById.get(row.memberId) ?? null : null;
        if (member) placedMemberIds.add(member.id);
        slotViews.push({ slotIndex: i, member: member ? toRef(member) : null });
      }
      return { id: p.id, label: p.label, slots: slotViews };
    }),
  }));

  const busy = busyRows
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((row) => {
      const member = membersById.get(row.memberId);
      if (!member) return null;
      placedMemberIds.add(member.id);
      return toRef(member);
    })
    .filter((v): v is PartyBoardMemberRef => v !== null);

  const unassigned = activeMembers
    .filter((m) => !placedMemberIds.has(m.id))
    .map(toRef)
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "th"));

  return { id: board.id, name: board.name, groups: groupViews, busy, unassigned };
}
