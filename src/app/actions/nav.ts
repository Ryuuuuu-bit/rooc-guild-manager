"use server";

// Live numbers for the app chrome (sidebar badges, the next-event widget,
// the Ctrl+K member list). Fetched by the client shell after the page has
// rendered — never blocks a page load — and refreshed on navigation / every
// minute. Read-only.
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/db";
import { members, membershipEvents, partyBoards, partyGroupParties, partyGroups, partySlots, pvpStatEntries } from "@/db/schema";
import { requireUser } from "@/lib/authz";
import { CHECKIN_EVENTS, nextOccurrenceDate, windowFor } from "@/lib/checkin-events";
import { listOnlineMemberIds } from "@/lib/checkin-data";
import { activeLeaveMemberIds, currentOccurrenceDate, listActiveLeavesBetween, thaiMonthRange } from "@/lib/leaves";
import { MONTHLY_LEAVE_LIMIT } from "@/lib/leave-quota";
import { pvpEntryLastUpdated } from "@/lib/pvp-stat-fields";
import { memberDisplayName } from "@/lib/ui";

export interface NavBadge {
  count: number;
  hint: string;
  tone: "red" | "amber";
}

export interface NavStatus {
  /** Keyed by NavBadgeKey — only non-zero badges are present. */
  badges: Partial<Record<"party" | "members" | "activity" | "leave", NavBadge>>;
  /** The event whose window is open right now, if any. */
  live: { label: string; endsAt: string } | null;
  /** The next event to start (after any live one). */
  next: { label: string; startsAt: string } | null;
  inVoice: number;
  /** Leaves on file for the live/next round's board. */
  onLeave: number | null;
}

const STALE_PVP_DAYS = 14;

function thaiDayStart(now: Date): Date {
  const d = new Date(now.getTime() + 7 * 3600_000);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - 7 * 3600_000);
}

export async function getNavStatus(): Promise<NavStatus> {
  const session = await requireUser();
  const isAdmin = session.user.isAdmin;
  const now = new Date();

  // --- live / next event (pure schedule math) ---
  let live: NavStatus["live"] = null;
  let next: NavStatus["next"] = null;
  let focusKey: string | null = null;
  let focusDate: string | null = null;
  for (const ev of CHECKIN_EVENTS) {
    const date = nextOccurrenceDate(ev, now);
    const w = windowFor(ev, date);
    if (w.start <= now && now < w.end) {
      live = { label: ev.label, endsAt: w.end.toISOString() };
      focusKey = ev.key;
      focusDate = date;
    } else if (w.start > now && (!next || w.start.getTime() < new Date(next.startsAt).getTime())) {
      next = { label: ev.label, startsAt: w.start.toISOString() };
      if (!live) {
        focusKey = ev.key;
        focusDate = date;
      }
    }
  }

  const boards = await db.select({ id: partyBoards.id, checkinEventKey: partyBoards.checkinEventKey }).from(partyBoards);
  const focusBoard = focusKey ? boards.find((b) => b.checkinEventKey === focusKey) : undefined;

  const [online, focusLeaves] = await Promise.all([
    listOnlineMemberIds(),
    focusBoard && focusDate ? activeLeaveMemberIds(focusBoard.id, focusDate) : Promise.resolve(null),
  ]);

  const status: NavStatus = { badges: {}, live, next, inVoice: online.size, onLeave: focusLeaves ? focusLeaves.size : null };
  if (!isAdmin) return status;

  // --- party: seated members who are on leave for their board's current round ---
  let seatedOnLeave = 0;
  await Promise.all(
    boards.map(async (b) => {
      const date = currentOccurrenceDate(b, now);
      const [leaveIds, seated] = await Promise.all([
        activeLeaveMemberIds(b.id, date),
        db
          .select({ memberId: partySlots.memberId })
          .from(partySlots)
          .innerJoin(partyGroupParties, eq(partySlots.partyId, partyGroupParties.id))
          .innerJoin(partyGroups, eq(partyGroupParties.groupId, partyGroups.id))
          .where(eq(partyGroups.boardId, b.id)),
      ]);
      for (const s of seated) if (s.memberId && leaveIds.has(s.memberId)) seatedOnLeave++;
    })
  );
  if (seatedOnLeave) status.badges.party = { count: seatedOnLeave, hint: `${seatedOnLeave} seated member(s) on leave — need a sub`, tone: "red" };

  // --- members: no class, or PVP stats missing / older than 14 days ---
  const active = await db
    .select({ id: members.id, characterClass: members.characterClass })
    .from(members)
    .where(and(eq(members.status, "ACTIVE"), eq(members.benched, false)));
  const ids = active.map((m) => m.id);
  const pvp = ids.length
    ? await db
        .select({ memberId: pvpStatEntries.memberId, createdAt: pvpStatEntries.createdAt, updatedAt: pvpStatEntries.updatedAt })
        .from(pvpStatEntries)
        .where(inArray(pvpStatEntries.memberId, ids))
        .orderBy(desc(pvpStatEntries.createdAt))
    : [];
  const lastPvp = new Map<string, number>();
  for (const p of pvp) {
    const t = pvpEntryLastUpdated(p).getTime();
    if (t > (lastPvp.get(p.memberId) ?? 0)) lastPvp.set(p.memberId, t);
  }
  const staleCutoff = now.getTime() - STALE_PVP_DAYS * 86400_000;
  let noClass = 0;
  let stalePvp = 0;
  const flagged = new Set<string>();
  for (const m of active) {
    if (!m.characterClass) {
      noClass++;
      flagged.add(m.id);
    }
    if ((lastPvp.get(m.id) ?? 0) < staleCutoff) {
      stalePvp++;
      flagged.add(m.id);
    }
  }
  if (flagged.size) status.badges.members = { count: flagged.size, hint: `No class: ${noClass} · PVP stats missing/older than ${STALE_PVP_DAYS} days: ${stalePvp}`, tone: "amber" };

  // --- activity: events logged today (Thai time) ---
  const today = await db.select({ id: membershipEvents.id }).from(membershipEvents).where(gte(membershipEvents.createdAt, thaiDayStart(now)));
  if (today.length) status.badges.activity = { count: today.length, hint: `${today.length} new entries today`, tone: "amber" };

  // --- leave: members over the monthly quota on any board ---
  const { from, to } = thaiMonthRange(now);
  const monthLeaves = await listActiveLeavesBetween(from, to);
  const perKey = new Map<string, number>();
  for (const l of monthLeaves) {
    if (!l.boardId) continue;
    const k = `${l.memberId}:${l.boardId}`;
    perKey.set(k, (perKey.get(k) ?? 0) + 1);
  }
  const over = new Set<string>();
  for (const [k, n] of perKey) if (n > MONTHLY_LEAVE_LIMIT) over.add(k.split(":")[0]);
  if (over.size) status.badges.leave = { count: over.size, hint: `${over.size} member(s) over the ${MONTHLY_LEAVE_LIMIT}/month leave quota`, tone: "red" };

  return status;
}

export interface PaletteMember {
  id: string;
  name: string;
  avatar: string | null;
  className: string | null;
}

/** Every current member, for the Ctrl+K palette (loaded once, on first open). */
export async function getPaletteMembers(): Promise<PaletteMember[]> {
  await requireUser();
  const rows = await db.select().from(members).where(eq(members.status, "ACTIVE"));
  return rows
    .map((m) => ({ id: m.id, name: memberDisplayName(m), avatar: m.discordAvatar, className: m.characterClass }))
    .sort((a, b) => a.name.localeCompare(b.name, "th"));
}
