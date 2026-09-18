import { db } from "@/db";
import {
  members,
  membershipEvents,
  partyBoards,
  partyBusyEntries,
  partyGroupParties,
  partyGroups,
  partySlots,
  scheduledLeaves,
} from "@/db/schema";
import { and, asc, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { memberDisplayName } from "@/lib/ui";
import { thaiDateString } from "@/lib/checkin-data";
import type { Member } from "@/db/schema";

/** Either the module-level `db`, or the `tx` handed to a `db.transaction`
 * callback — see loot-queue-data.ts's identical DbOrTx for why. */
type DbOrTx = typeof db | Parameters<Parameters<(typeof db)["transaction"]>[0]>[0];

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

/** A member with an advance /leave request on file for THIS board, not yet
 * due (or due today but the bot hasn't applied it yet — see
 * calendar-data.ts's dueTodayNotYetApplied for the same edge case). Lets a
 * party organizer see, before dragging anyone into a slot, who's already
 * planning to be out for an upcoming date — the board itself has no date
 * dimension (partyBusyEntries carries no date column), so without this a
 * member on file for e.g. the 20th looks perfectly available while composing
 * parties on the 19th. */
export interface UpcomingBoardLeave {
  memberId: string;
  name: string;
  discordAvatar: string | null;
  date: string; // "YYYY-MM-DD"
}

export interface PartyBoardDetail {
  id: string;
  name: string;
  /** Discord channel id the image-announce button last posted to, if any — see partyBoards.lastImageAnnounceChannelId. */
  lastImageAnnounceChannelId: string | null;
  groups: PartyGroupView[];
  busy: PartyBoardMemberRef[];
  unassigned: PartyBoardMemberRef[];
  /** Sorted by date, then Thai name — see UpcomingBoardLeave. */
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

/** Full nested detail for one board: groups → parties → slots, plus busy list and unassigned pool. */
export async function getPartyBoardDetail(boardId: string): Promise<PartyBoardDetail | null> {
  const board = await db.query.partyBoards.findFirst({ where: eq(partyBoards.id, boardId) });
  if (!board) return null;

  const today = thaiDateString(new Date());

  const [activeMembers, groups, busyRows, upcomingLeaveRows] = await Promise.all([
    // Benched members are still ACTIVE (still in Discord with the tracked
    // role) but flagged out of party/event management entirely.
    db.select().from(members).where(and(eq(members.status, "ACTIVE"), eq(members.benched, false))),
    db.select().from(partyGroups).where(eq(partyGroups.boardId, boardId)).orderBy(asc(partyGroups.sortOrder)),
    db.select().from(partyBusyEntries).where(eq(partyBusyEntries.boardId, boardId)),
    // >= today, not > today — a same-day request the bot hasn't applied yet
    // (normally cleared within a minute of midnight, see
    // applyTodaysScheduledLeaves) should still warn the organizer, same
    // reasoning as calendar-data.ts's dueTodayNotYetApplied.
    db
      .select({ memberId: scheduledLeaves.memberId, date: scheduledLeaves.date })
      .from(scheduledLeaves)
      .where(and(eq(scheduledLeaves.boardId, boardId), gte(scheduledLeaves.date, today))),
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

  // Silently drops a row whose member isn't in membersById (left the guild,
  // got kicked, or was benched since requesting) — same "just don't show
  // it" handling as the rest of this function uses for stale references.
  const upcomingLeaves: UpcomingBoardLeave[] = upcomingLeaveRows
    .map((row) => {
      const member = membersById.get(row.memberId);
      if (!member) return null;
      return { memberId: member.id, name: memberDisplayName(member), discordAvatar: member.discordAvatar, date: row.date };
    })
    .filter((v): v is UpcomingBoardLeave => v !== null)
    .sort((a, b) => (a.date === b.date ? a.name.localeCompare(b.name, "th") : a.date.localeCompare(b.date)));

  return {
    id: board.id,
    name: board.name,
    lastImageAnnounceChannelId: board.lastImageAnnounceChannelId,
    groups: groupViews,
    busy,
    unassigned,
    upcomingLeaves,
  };
}

/**
 * Resolves a member's still-open ลา status on a board before their
 * `partyBusyEntries` row for it is removed — discards a still-pending
 * ("confirmedAt: null") `ATTENDANCE_LEAVE` outright (same rule
 * `cancelCurrentLeave` in bot/reactions.ts follows for a member's own
 * un-react/`/leave` cancel), or logs `ATTENDANCE_RETURN` if it had already
 * event-confirmed. `moveMember` (src/app/actions/party.ts) already did this
 * correctly for its one member+board case; `resetPartyBoard`,
 * `markMemberKicked`, and `setMemberBenched` used to just delete the busy
 * row directly, leaving a still-pending ลา orphaned — confirmDueLeaves
 * (bot/attendance-confirm.ts) would later find the member no longer "still
 * busy" and silently discard it with no record it ever happened. Call this
 * for every board a member is currently busy on, inside the same
 * transaction that deletes their partyBusyEntries row(s), BEFORE that
 * delete runs.
 */
export async function reconcilePendingLeaveOnBoard(
  tx: DbOrTx,
  memberId: string,
  boardId: string,
  actor: string
): Promise<void> {
  const [pendingLeave] = await tx
    .select({ id: membershipEvents.id })
    .from(membershipEvents)
    .where(
      and(
        eq(membershipEvents.memberId, memberId),
        eq(membershipEvents.boardId, boardId),
        eq(membershipEvents.type, "ATTENDANCE_LEAVE"),
        isNull(membershipEvents.confirmedAt)
      )
    )
    .orderBy(desc(membershipEvents.createdAt))
    .limit(1);

  if (pendingLeave) {
    await tx.delete(membershipEvents).where(eq(membershipEvents.id, pendingLeave.id));
    return;
  }

  const board = await tx.query.partyBoards.findFirst({ where: eq(partyBoards.id, boardId) });
  await tx.insert(membershipEvents).values({
    memberId,
    type: "ATTENDANCE_RETURN",
    detail: `ยกเลิกลาในกระดาน "${board?.name ?? boardId}" โดยแอดมิน ${actor}`,
    actor,
    boardId,
  });
}

/** Runs reconcilePendingLeaveOnBoard for every board a member currently has
 * an OPEN busy entry on (a member can be busy on more than one board's
 * independent busy list at once) — for call sites (kick/bench) that clear a
 * member's busy status guild-wide rather than one board at a time. */
export async function reconcilePendingLeaveEverywhere(tx: DbOrTx, memberId: string, actor: string): Promise<void> {
  const busyRows = await tx
    .select({ boardId: partyBusyEntries.boardId })
    .from(partyBusyEntries)
    .where(eq(partyBusyEntries.memberId, memberId));
  for (const { boardId } of busyRows) {
    await reconcilePendingLeaveOnBoard(tx, memberId, boardId, actor);
  }
}
