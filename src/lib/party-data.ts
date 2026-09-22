import { db } from "@/db";
import { members, partyBoards, partyGroupParties, partyGroups, partySlots } from "@/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import { memberDisplayName } from "@/lib/ui";
import { activeLeaveMemberIds, addDays, currentOccurrenceDate, listActiveLeavesForBoard } from "@/lib/leaves";
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
  /** The member in this slot is on leave for the board's current round.
   * They keep their slot (rendered faded) so nobody has to re-drag them
   * back when they return; the "ลา" zone lists them too. */
  onLeave: boolean;
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

/** A member with a leave on file for THIS board on a date AFTER the current
 * round. Lets a party organizer see, before dragging anyone into a slot,
 * who's already planning to be out for an upcoming date. */
export interface UpcomingBoardLeave {
  memberId: string;
  name: string;
  discordAvatar: string | null;
  /** The member's class — lets the board suggest same-class substitutes
   * from the unassigned pool next to the warning (see party-board.tsx). */
  className: string | null;
  date: string; // "YYYY-MM-DD"
}

export interface PartyBoardDetail {
  id: string;
  name: string;
  /** Discord channel id the image-announce button last posted to, if any — see partyBoards.lastImageAnnounceChannelId. */
  lastImageAnnounceChannelId: string | null;
  groups: PartyGroupView[];
  /** Linked check-in event key (gl/woe) or null — see partyBoards.checkinEventKey. */
  checkinEventKey: string | null;
  /** "YYYY-MM-DD" the ลา zone refers to: the linked event's next
   * not-yet-ended round, or today for an unlinked board. */
  occurrenceDate: string;
  /** Members on leave for `occurrenceDate` (they may also still hold a slot). */
  busy: PartyBoardMemberRef[];
  unassigned: PartyBoardMemberRef[];
  /** Leaves dated after `occurrenceDate`, sorted by date then Thai name. */
  upcomingLeaves: UpcomingBoardLeave[];
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

/** Full nested detail for one board: groups → parties → slots, plus the ลา
 * list for the board's current round and the unassigned pool. */
export async function getPartyBoardDetail(boardId: string): Promise<PartyBoardDetail | null> {
  const board = await db.query.partyBoards.findFirst({ where: eq(partyBoards.id, boardId) });
  if (!board) return null;

  const occurrenceDate = currentOccurrenceDate(board);

  const [activeMembers, groups, onLeaveIds, upcomingLeaveRows] = await Promise.all([
    // Benched members are still ACTIVE (still in Discord with the tracked
    // role) but flagged out of party/event management entirely.
    db.select().from(members).where(and(eq(members.status, "ACTIVE"), eq(members.benched, false))),
    db.select().from(partyGroups).where(eq(partyGroups.boardId, boardId)).orderBy(asc(partyGroups.sortOrder)),
    activeLeaveMemberIds(boardId, occurrenceDate),
    listActiveLeavesForBoard(boardId, addDays(occurrenceDate, 1)),
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
        slotViews.push({ slotIndex: i, member: member ? toRef(member) : null, onLeave: member ? onLeaveIds.has(member.id) : false });
      }
      return { id: p.id, label: p.label, slots: slotViews };
    }),
  }));

  const busy = activeMembers
    .filter((m) => onLeaveIds.has(m.id))
    .map(toRef)
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "th"));

  // On-leave members are neither "unassigned" (they're in the ลา zone) nor
  // draggable candidates for this round.
  const unassigned = activeMembers
    .filter((m) => !placedMemberIds.has(m.id) && !onLeaveIds.has(m.id))
    .map(toRef)
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "th"));

  // Silently drops a row whose member isn't in membersById (left the guild,
  // got kicked, or was benched since requesting) — same "just don't show
  // it" handling as the rest of this function uses for stale references.
  const upcomingLeaves: UpcomingBoardLeave[] = upcomingLeaveRows
    .map((row) => {
      const member = membersById.get(row.memberId);
      if (!member) return null;
      return {
        memberId: member.id,
        name: memberDisplayName(member),
        discordAvatar: member.discordAvatar,
        className: member.characterClass,
        date: row.occurrenceDate,
      };
    })
    .filter((v): v is UpcomingBoardLeave => v !== null)
    .sort((a, b) => (a.date === b.date ? a.name.localeCompare(b.name, "th") : a.date.localeCompare(b.date)));

  return {
    id: board.id,
    name: board.name,
    lastImageAnnounceChannelId: board.lastImageAnnounceChannelId,
    groups: groupViews,
    checkinEventKey: board.checkinEventKey,
    occurrenceDate,
    busy,
    unassigned,
    upcomingLeaves,
  };
}
