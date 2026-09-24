// Pure helpers for the party page — no React, no server calls — so the
// board, the side panel and the sub finder all agree on what "a party's
// power", "missing a role" or "a good substitute" means.
import type { PartyRecipeEntry } from "@/db/schema";
import type { SlotWrite } from "@/app/actions/party";
import type { PartyBoardDetail, PartyBoardMemberRef, PartyGroupView, PartySlotView, PartyView } from "@/lib/party-data";

export const SLOTS_PER_PARTY = 5;

/** The class a slot actually fields: the per-slot override, else the occupant's main. */
export function seatedClass(slot: Pick<PartySlotView, "member" | "playingAs">): string | null {
  return slot.playingAs ?? slot.member?.className ?? null;
}

export function fullSlots(party: PartyView): PartySlotView[] {
  return Array.from(
    { length: SLOTS_PER_PARTY },
    (_, i) => party.slots.find((s) => s.slotIndex === i) ?? { slotIndex: i, member: null, playingAs: null, onLeave: false }
  );
}

/** "412k" / "1.2M" — CP is always shown rounded; exact numbers live on /pvp-stats. */
export function fmtCp(cp: number | null | undefined): string {
  if (cp == null) return "—";
  if (Math.abs(cp) >= 1_000_000) return `${(cp / 1_000_000).toFixed(2)}M`;
  return `${Math.round(cp / 1000)}k`;
}

export interface PartyStats {
  seated: number;
  present: number;
  leaveSeated: number;
  empty: number;
  /** Sum of the present members' CP (unknown CP counts as 0). */
  cp: number;
  /** Present members with no PVP stats on file. */
  cpUnknown: number;
  missing: { className: string; short: number }[];
}

export function partyStats(party: PartyView, recipe: PartyRecipeEntry[]): PartyStats {
  const slots = fullSlots(party);
  const seatedSlots = slots.filter((s) => s.member);
  const present = seatedSlots.filter((s) => !s.onLeave);
  const have = new Map<string, number>();
  for (const s of present) {
    const c = seatedClass(s);
    if (c) have.set(c, (have.get(c) ?? 0) + 1);
  }
  // An untouched (fully empty) party isn't "missing" anything yet — it's just unused.
  const missing = seatedSlots.length
    ? recipe.filter((r) => (have.get(r.className) ?? 0) < r.count).map((r) => ({ className: r.className, short: r.count - (have.get(r.className) ?? 0) }))
    : [];
  return {
    seated: seatedSlots.length,
    present: present.length,
    leaveSeated: seatedSlots.length - present.length,
    empty: SLOTS_PER_PARTY - seatedSlots.length,
    cp: present.reduce((a, s) => a + (s.member?.cp ?? 0), 0),
    cpUnknown: present.filter((s) => s.member?.cp == null).length,
    missing,
  };
}

/** Average party CP of a group, over parties that have anyone present. */
export function groupAverageCp(group: PartyGroupView, recipe: PartyRecipeEntry[]): number {
  const st = group.parties.map((p) => partyStats(p, recipe)).filter((s) => s.present > 0);
  return st.length ? st.reduce((a, s) => a + s.cp, 0) / st.length : 0;
}

// ---------------------------------------------------------------------------
// Layout snapshots: "which member (and playing-as) sits in each slot". Every
// layout-only change (drag between slots, sub in, auto-balance, undo) is a
// diff between two of these, sent to applySlotLayout.

type SlotValue = { memberId: string | null; playingAs: string | null };
const slotKey = (partyId: string, slotIndex: number) => `${partyId}:${slotIndex}`;

function layoutOf(board: PartyBoardDetail): Map<string, SlotValue> {
  const out = new Map<string, SlotValue>();
  for (const g of board.groups)
    for (const p of g.parties)
      for (const s of fullSlots(p)) out.set(slotKey(p.id, s.slotIndex), { memberId: s.member?.id ?? null, playingAs: s.member ? s.playingAs : null });
  return out;
}

/** Slots that differ between two boards: `next` values (to apply) and `prev` values (to undo). */
export function diffLayouts(prev: PartyBoardDetail, next: PartyBoardDetail): { apply: SlotWrite[]; undo: SlotWrite[] } {
  const a = layoutOf(prev);
  const b = layoutOf(next);
  const apply: SlotWrite[] = [];
  const undo: SlotWrite[] = [];
  for (const [key, nv] of b) {
    const pv = a.get(key) ?? { memberId: null, playingAs: null };
    if (pv.memberId === nv.memberId && pv.playingAs === nv.playingAs) continue;
    const i = key.lastIndexOf(":");
    const partyId = key.slice(0, i);
    const slotIndex = Number(key.slice(i + 1));
    apply.push({ partyId, slotIndex, ...nv });
    undo.push({ partyId, slotIndex, ...pv });
  }
  return { apply, undo };
}

function rosterOf(board: PartyBoardDetail): Map<string, PartyBoardMemberRef> {
  const out = new Map<string, PartyBoardMemberRef>();
  for (const g of board.groups) for (const p of g.parties) for (const s of p.slots) if (s.member) out.set(s.member.id, s.member);
  for (const m of board.busy) out.set(m.id, m);
  for (const m of board.unassigned) out.set(m.id, m);
  return out;
}

/** Local (optimistic) mirror of applySlotLayout. */
export function applyWritesLocal(board: PartyBoardDetail, writes: SlotWrite[]): PartyBoardDetail {
  const roster = rosterOf(board);
  const busyIds = new Set(board.busy.map((m) => m.id));
  const byKey = new Map(writes.map((w) => [slotKey(w.partyId, w.slotIndex), w]));
  const placing = new Set(writes.map((w) => w.memberId).filter(Boolean) as string[]);

  const groups = board.groups.map((g) => ({
    ...g,
    parties: g.parties.map((p) => ({
      ...p,
      slots: fullSlots(p).map((s): PartySlotView => {
        const w = byKey.get(slotKey(p.id, s.slotIndex));
        if (w) {
          const member = w.memberId ? roster.get(w.memberId) ?? null : null;
          const playingAs = member && w.playingAs && w.playingAs !== member.className ? w.playingAs : null;
          return { slotIndex: s.slotIndex, member, playingAs, onLeave: member ? busyIds.has(member.id) : false };
        }
        if (s.member && placing.has(s.member.id)) return { slotIndex: s.slotIndex, member: null, playingAs: null, onLeave: false };
        return s;
      }),
    })),
  }));

  const seated = new Set<string>();
  for (const g of groups) for (const p of g.parties) for (const s of p.slots) if (s.member) seated.add(s.member.id);
  const unassigned = [...roster.values()]
    .filter((m) => !seated.has(m.id) && !busyIds.has(m.id))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "th"));
  return { ...board, groups, unassigned };
}

// ---------------------------------------------------------------------------
// Finding a substitute for a seated member who's on leave.

export interface SubCandidate {
  member: PartyBoardMemberRef;
  /** Class they'd play in the seat (null = their main). */
  playingAs: string | null;
  /** How they match the class needed. */
  kind: "main" | "alt" | "moved" | "other";
  /** Set when they'd be pulled out of another party (that seat becomes empty). */
  from: { partyId: string; slotIndex: number; label: string } | null;
}

const byCpDesc = (a: SubCandidate, b: SubCandidate) => (b.member.cp ?? -1) - (a.member.cp ?? -1);

/**
 * Candidates for the seat (partyId, slotIndex): same class first — free
 * members whose main it is, free members who list it as a secondary class,
 * then the same class sitting in a party of ANOTHER group (pulling from the
 * same group would just move the hole) — all by CP; then a few free members
 * of other classes.
 */
export function findSubCandidates(
  board: PartyBoardDetail,
  partyId: string,
  slotIndex: number
): { need: string | null; sameClass: SubCandidate[]; others: SubCandidate[] } {
  let need: string | null = null;
  let groupId: string | null = null;
  for (const g of board.groups)
    for (const p of g.parties)
      if (p.id === partyId) {
        groupId = g.id;
        const s = p.slots.find((x) => x.slotIndex === slotIndex);
        if (s) need = seatedClass(s);
      }

  const free = board.unassigned;
  if (!need) {
    return { need, sameClass: [], others: free.map((m): SubCandidate => ({ member: m, playingAs: null, kind: "other", from: null })).sort(byCpDesc).slice(0, 8) };
  }
  const sameClass: SubCandidate[] = [];
  for (const m of free) {
    if (m.className === need) sameClass.push({ member: m, playingAs: null, kind: "main", from: null });
    else if (m.altClasses.includes(need)) sameClass.push({ member: m, playingAs: need, kind: "alt", from: null });
  }
  for (const g of board.groups) {
    if (g.id === groupId) continue;
    for (const p of g.parties)
      for (const s of p.slots) {
        if (!s.member || s.onLeave || seatedClass(s) !== need) continue;
        sameClass.push({
          member: s.member,
          playingAs: s.playingAs,
          kind: "moved",
          from: { partyId: p.id, slotIndex: s.slotIndex, label: `${g.name} · ${p.label}` },
        });
      }
  }
  sameClass.sort(byCpDesc);
  const others = free
    .filter((m) => m.className !== need && !m.altClasses.includes(need!))
    .map((m): SubCandidate => ({ member: m, playingAs: null, kind: "other", from: null }))
    .sort(byCpDesc)
    .slice(0, 5);
  return { need, sameClass, others };
}

/** Writes that seat `candidate` in (partyId, slotIndex). The on-leave
 * occupant just loses the seat (they stay on the ลา list); the seat the
 * candidate came from, if any, is left empty. */
export function subInWrites(partyId: string, slotIndex: number, candidate: SubCandidate): SlotWrite[] {
  const writes: SlotWrite[] = [{ partyId, slotIndex, memberId: candidate.member.id, playingAs: candidate.playingAs }];
  if (candidate.from) writes.push({ partyId: candidate.from.partyId, slotIndex: candidate.from.slotIndex, memberId: null, playingAs: null });
  return writes;
}

// ---------------------------------------------------------------------------
// Auto-balance: even out CP across a group's parties by swapping members
// who field the SAME class (so no party's composition changes). Only full
// parties (5 present) take part — a party with an empty or on-leave seat is
// "weak" only until it's filled, and balancing around the hole would just
// pull strong players into it. On-leave members and members with no CP on
// file are never moved (they count at the group's median CP). Greedy: each step takes the single swap that most
// reduces the spread (sum of squared deviations from the mean); stops when
// no swap helps.

/** Median CP of everyone seated (and present) in the group — stands in for
 * members with no PVP stats, so an unknown doesn't read as "0 CP". */
export function groupMedianCp(group: PartyGroupView): number {
  const cps = group.parties
    .flatMap((p) => p.slots)
    .filter((s) => s.member && !s.onLeave && s.member.cp != null)
    .map((s) => s.member!.cp!)
    .sort((a, b) => a - b);
  if (!cps.length) return 0;
  const mid = Math.floor(cps.length / 2);
  return cps.length % 2 ? cps[mid] : (cps[mid - 1] + cps[mid]) / 2;
}

/** A party's CP with unknowns counted at `fallback` (see groupMedianCp). */
export function partyCpEstimate(party: Pick<PartyView, "slots">, fallback: number): number {
  return party.slots.reduce((a, s) => a + (s.member && !s.onLeave ? s.member.cp ?? fallback : 0), 0);
}

export function isFullParty(party: PartyView): boolean {
  return fullSlots(party).every((s) => s.member && !s.onLeave);
}

export function autoBalanceWrites(group: PartyGroupView, maxSwaps = 24): { writes: SlotWrite[]; swaps: number } {
  const parties = group.parties.filter(isFullParty).map((p) => ({ id: p.id, slots: fullSlots(p).map((s) => ({ ...s })) }));
  if (parties.length < 2) return { writes: [], swaps: 0 };
  const fallback = groupMedianCp(group);
  const cps = parties.map((p) => partyCpEstimate(p, fallback));
  let swaps = 0;
  for (let it = 0; it < maxSwaps; it++) {
    let best: { i: number; j: number; ai: number; bi: number; gain: number } | null = null;
    for (let i = 0; i < parties.length; i++)
      for (let j = i + 1; j < parties.length; j++) {
        const gap = cps[i] - cps[j];
        if (gap === 0) continue;
        for (let ai = 0; ai < SLOTS_PER_PARTY; ai++) {
          const a = parties[i].slots[ai];
          if (!a.member || a.member.cp == null) continue;
          for (let bi = 0; bi < SLOTS_PER_PARTY; bi++) {
            const b = parties[j].slots[bi];
            if (!b.member || b.member.cp == null || seatedClass(a) !== seatedClass(b)) continue;
            const d = a.member.cp - b.member.cp; // CP moving from i to j
            // Change in (cp_i - m)^2 + (cp_j - m)^2 when i loses d and j gains d.
            const gain = 2 * d * gap - 2 * d * d;
            if (gain > 1 && (!best || gain > best.gain)) best = { i, j, ai, bi, gain };
          }
        }
      }
    if (!best) break;
    const { i, j, ai, bi } = best;
    const a = parties[i].slots[ai];
    const b = parties[j].slots[bi];
    const d = (a.member!.cp ?? 0) - (b.member!.cp ?? 0);
    parties[i].slots[ai] = { ...b, slotIndex: ai };
    parties[j].slots[bi] = { ...a, slotIndex: bi };
    cps[i] -= d;
    cps[j] += d;
    swaps++;
  }
  if (!swaps) return { writes: [], swaps };
  const writes: SlotWrite[] = [];
  const before = new Map(group.parties.map((p) => [p.id, fullSlots(p)]));
  for (const p of parties)
    for (const s of p.slots) {
      const o = before.get(p.id)![s.slotIndex];
      if (o.member?.id !== s.member?.id || o.playingAs !== s.playingAs)
        writes.push({ partyId: p.id, slotIndex: s.slotIndex, memberId: s.member?.id ?? null, playingAs: s.member ? s.playingAs : null });
    }
  return { writes, swaps };
}
