// Relative-import mirror of src/lib/party-data.ts (see class-emoji.ts's note
// at the top of this folder) — the bot worker runs via `tsx`, which doesn't
// resolve the Next.js "@/" path alias, so anything the bot needs from the
// query layer gets a small local copy here instead of importing the web
// version directly. Adds `classEmoji` per member (the web app renders class
// icons client-side from a separate lookup) since the /party command needs
// it baked into the text it sends Discord.
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import {
  jobClasses,
  members,
  partyBoards,
  partyGroupParties,
  partyGroups,
  partySlots,
  type Member,
} from "../src/db/schema";
import { activeLeaveMemberIds, currentOccurrenceDate } from "../src/lib/leaves";

const SLOTS_PER_PARTY = 5;

export interface PartyBoardMemberRef {
  id: string;
  displayName: string;
  className: string | null;
  classEmoji: string | null;
}

export interface PartySlotView {
  slotIndex: number;
  member: PartyBoardMemberRef | null;
  /** Class the occupant plays in this slot when not their main (see src/lib/party-data.ts). */
  playingAs: string | null;
  /** The member in this slot is on leave for the board's current round —
   * they keep their slot (shown struck through) so nobody has to re-drag
   * them back when they return. */
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

export interface PartyBoardDetail {
  id: string;
  name: string;
  groups: PartyGroupView[];
  /** class name → emoji, for rendering a slot's playingAs. */
  classEmojiByName: Map<string, string>;
  /** "YYYY-MM-DD" the busy list refers to (the linked event's next round). */
  occurrenceDate: string;
  busy: PartyBoardMemberRef[];
  unassigned: PartyBoardMemberRef[];
}

function displayNameFor(member: Pick<Member, "discordNickname" | "discordGlobalName" | "discordUsername">): string {
  return member.discordNickname || member.discordGlobalName || member.discordUsername;
}

/** All boards (e.g. "GL", "WOE"), in display order — feeds the /party command's board autocomplete. */
export async function listPartyBoards(): Promise<PartyBoardListItem[]> {
  return db
    .select({ id: partyBoards.id, name: partyBoards.name })
    .from(partyBoards)
    .orderBy(asc(partyBoards.sortOrder), asc(partyBoards.createdAt));
}

/** Full nested detail for one board: groups → parties → slots, plus the
 * ลา list for the board's current round and the unassigned pool. */
export async function getPartyBoardDetail(boardId: string): Promise<PartyBoardDetail | null> {
  const board = await db.query.partyBoards.findFirst({ where: eq(partyBoards.id, boardId) });
  if (!board) return null;

  const occurrenceDate = currentOccurrenceDate(board);
  const [activeMembers, groups, onLeaveIds, classRows] = await Promise.all([
    db.select().from(members).where(and(eq(members.status, "ACTIVE"), eq(members.benched, false))),
    db.select().from(partyGroups).where(eq(partyGroups.boardId, boardId)).orderBy(asc(partyGroups.sortOrder)),
    activeLeaveMemberIds(boardId, occurrenceDate),
    db.select().from(jobClasses),
  ]);

  const classEmojiByName = new Map(classRows.map((c) => [c.name, c.emoji]));
  const toRef = (member: Member): PartyBoardMemberRef => ({
    id: member.id,
    displayName: displayNameFor(member),
    className: member.characterClass,
    classEmoji: member.characterClass ? (classEmojiByName.get(member.characterClass) ?? null) : null,
  });

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
        const member = row?.memberId ? (membersById.get(row.memberId) ?? null) : null;
        if (member) placedMemberIds.add(member.id);
        const playingAs = member && row?.playingAs && member.altClasses.includes(row.playingAs) ? row.playingAs : null;
        slotViews.push({ slotIndex: i, member: member ? toRef(member) : null, playingAs, onLeave: member ? onLeaveIds.has(member.id) : false });
      }
      return { id: p.id, label: p.label, slots: slotViews };
    }),
  }));

  const busy = activeMembers
    .filter((m) => onLeaveIds.has(m.id))
    .map(toRef)
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "th"));

  const unassigned = activeMembers
    .filter((m) => !placedMemberIds.has(m.id) && !onLeaveIds.has(m.id))
    .map(toRef)
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "th"));

  return { id: board.id, name: board.name, groups: groupViews, classEmojiByName, occurrenceDate, busy, unassigned };
}
