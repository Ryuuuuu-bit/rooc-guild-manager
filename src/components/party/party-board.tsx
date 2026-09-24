"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { MemberChip } from "./member-chip";
import { PartySlot } from "./party-slot";
import { MemberPicker } from "./member-picker";
import { getCheckinEvent } from "@/lib/checkin-events";
import { AnnounceBoardImageButton } from "./announce-board-image-button";
import { useJobClasses } from "@/components/job-classes-provider";
import {
  applySlotLayout,
  createGroup,
  createParty,
  deleteBoard,
  deleteGroup,
  deleteParty,
  moveMember,
  renameGroup,
  resetPartyBoard,
  setBoardRecipe,
  setMemberClass,
  setSlotPlayingAs,
  type PartyDestination,
  type SlotWrite,
} from "@/app/actions/party";
import type { PartyRecipeEntry } from "@/db/schema";
import type { PartyBoardDetail, PartyBoardListItem, PartyBoardMemberRef, PartyGroupView } from "@/lib/party-data";
import { applyWritesLocal, autoBalanceWrites, diffLayouts, groupAverageCp, seatedClass, subInWrites, type SubCandidate } from "./party-board-logic";
import {
  ChangesCard,
  ClassHighlightBar,
  NeedsSubCard,
  PartyCardHeader,
  PartyPowerCard,
  ReadinessStrip,
  RecipeEditor,
  SideCard,
  SubFinderPopover,
  UndoToast,
  type ChangeLogEntry,
  type SubTarget,
} from "./party-board-panels";

/** "YYYY-MM-DD" -> "20 Sep" — noon UTC+7 anchor avoids the date shifting a
 * day when parsed in a browser on a different local timezone. */
function fmtLeaveDate(date: string): string {
  return new Date(`${date}T12:00:00+07:00`).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Bangkok",
  });
}

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function fmtWeekdays(days: number[]): string {
  return days.map((d) => WEEKDAY_SHORT[d]).join("/");
}

export function parseDestination(id: string): PartyDestination | null {
  if (id === "busy") return { type: "busy" };
  if (id === "unassigned") return { type: "unassigned" };
  const match = id.match(/^slot:(.+):(\d+)$/);
  if (match) return { type: "slot", partyId: match[1], slotIndex: Number(match[2]) };
  return null;
}

function isInAnySlot(groups: PartyBoardDetail["groups"], memberId: string): boolean {
  return groups.some((g) => g.parties.some((p) => p.slots.some((s) => s.member?.id === memberId)));
}

/** Moves a member (in local optimistic state) — mirrors moveMember's
 * semantics (src/app/actions/party.ts): "busy" files a leave (slot kept,
 * shown faded), "return" cancels it, "slot"/"unassigned" move the slot only
 * unless the slot move also carries cancelLeave. */
function computeNext(prev: PartyBoardDetail, member: PartyBoardMemberRef, destination: PartyDestination): PartyBoardDetail {
  const wasOnLeave = prev.busy.some((b) => b.id === member.id);
  let busy = prev.busy;
  let unassigned = prev.unassigned;
  let groups = prev.groups;

  if (destination.type === "busy") {
    if (!wasOnLeave) busy = [...busy, member].sort((a, b) => a.displayName.localeCompare(b.displayName, "th"));
    unassigned = unassigned.filter((u) => u.id !== member.id);
    groups = groups.map((g) => ({
      ...g,
      parties: g.parties.map((p) => ({ ...p, slots: p.slots.map((s) => (s.member?.id === member.id ? { ...s, onLeave: true } : s)) })),
    }));
    return { ...prev, groups, busy, unassigned };
  }

  if (destination.type === "return") {
    busy = busy.filter((b) => b.id !== member.id);
    groups = groups.map((g) => ({
      ...g,
      parties: g.parties.map((p) => ({ ...p, slots: p.slots.map((s) => (s.member?.id === member.id ? { ...s, onLeave: false } : s)) })),
    }));
    if (!isInAnySlot(groups, member.id) && !unassigned.some((u) => u.id === member.id)) {
      unassigned = [...unassigned, member].sort((a, b) => a.displayName.localeCompare(b.displayName, "th"));
    }
    return { ...prev, groups, busy, unassigned };
  }

  const stillOnLeave = wasOnLeave && !(destination.type === "slot" && destination.cancelLeave);
  // Their per-slot "playing as" moves with them (mirrors moveMember).
  let carriedPlayingAs: string | null = null;
  for (const g of groups) for (const p of g.parties) for (const s of p.slots) if (s.member?.id === member.id) carriedPlayingAs = s.playingAs;
  groups = groups.map((g) => ({
    ...g,
    parties: g.parties.map((p) => ({
      ...p,
      slots: p.slots.map((s) => (s.member?.id === member.id ? { ...s, member: null, playingAs: null, onLeave: false } : s)),
    })),
  }));
  unassigned = unassigned.filter((u) => u.id !== member.id);
  if (!stillOnLeave) busy = busy.filter((b) => b.id !== member.id);

  if (destination.type === "slot") {
    let bumpedOccupant: PartyBoardMemberRef | null = null;
    groups = groups.map((g) => ({
      ...g,
      parties: g.parties.map((p) => {
        if (p.id !== destination.partyId) return p;
        return {
          ...p,
          slots: p.slots.map((s) => {
            if (s.slotIndex !== destination.slotIndex) return s;
            if (s.member && s.member.id !== member.id) bumpedOccupant = s.member;
            return { slotIndex: s.slotIndex, member, playingAs: carriedPlayingAs, onLeave: stillOnLeave };
          }),
        };
      }),
    }));
    // A bumped occupant who's on leave stays in the ลา zone, not the pool.
    if (bumpedOccupant && !busy.some((b) => b.id === bumpedOccupant!.id)) unassigned = [...unassigned, bumpedOccupant];
  } else if (!stillOnLeave) {
    unassigned = [...unassigned, member];
  }

  return { ...prev, groups, busy, unassigned };
}

/** Patches a member's className everywhere they currently appear on the board (optimistic update). */
function patchMemberClass(prev: PartyBoardDetail, memberId: string, className: string | null): PartyBoardDetail {
  // The new main class can't also be an alt — mirrors setMemberClass.
  const patch = (m: PartyBoardMemberRef) => (m.id === memberId ? { ...m, className, altClasses: m.altClasses.filter((a) => a !== className) } : m);
  return {
    ...prev,
    groups: prev.groups.map((g) => ({
      ...g,
      parties: g.parties.map((p) => ({
        ...p,
        // "Playing as" the class that just became their main = main (mirrors setMemberClass).
        slots: p.slots.map((s) =>
          s.member ? { ...s, member: patch(s.member), playingAs: s.member.id === memberId && s.playingAs === className ? null : s.playingAs } : s
        ),
      })),
    })),
    busy: prev.busy.map(patch),
    unassigned: prev.unassigned.map(patch),
    upcomingLeaves: prev.upcomingLeaves.map((l) => (l.memberId === memberId ? { ...l, className } : l)),
  };
}

function DroppableZone({
  id,
  children,
  label,
  maxHeightClass = "max-h-36",
  tapTarget = false,
  onBackgroundClick,
  layout = "wrap",
}: {
  id: string;
  children: React.ReactNode;
  label?: string;
  /** Tailwind max-height class — the pool (often 50-150+ members) gets a
   * taller cap than the busy list (usually just a handful) so most rosters
   * are fully visible without an internal scrollbar (which a full-page
   * screenshot can't capture past). Still bounded so a big influx of
   * members doesn't shove the rest of the page down and feel like a jump. */
  maxHeightClass?: string;
  /** True while a member is selected via tap-to-move, so this zone can look
   * tappable the same way it looks "isOver" during a drag. */
  tapTarget?: boolean;
  /** Fires when the zone's own background (not a member chip inside it,
   * which stops propagation on its own click) is tapped while a selection
   * is pending — completes a tap-to-move here. */
  onBackgroundClick?: () => void;
  /** "list" stacks full-width chips (the side-panel pool); "wrap" flows them. */
  layout?: "wrap" | "list";
}) {
  const { isOver, setNodeRef } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      onClick={onBackgroundClick}
      className={`flex ${maxHeightClass} min-h-[52px] ${layout === "list" ? "flex-col" : "flex-wrap content-start"} gap-1.5 overflow-y-auto rounded-xl border p-2 transition ${
        isOver || tapTarget ? "border-amber-400 bg-amber-500/10" : "border-zinc-800 bg-zinc-900/40"
      }`}
      aria-label={label}
    >
      {children}
    </div>
  );
}

interface PartyCardProps {
  party: PartyGroupView["parties"][number];
  isAdmin: boolean;
  pickableMembers: PartyBoardMemberRef[];
  onClassChange: (memberId: string, value: string) => void;
  onPlayingAsChange: (partyId: string, slotIndex: number, value: string | null) => void;
  onClear: (partyId: string, slotIndex: number) => void;
  onAssign: (partyId: string, slotIndex: number, memberId: string) => void;
  onSendBusy: (partyId: string, slotIndex: number) => void;
  onReturn: (partyId: string, slotIndex: number) => void;
  onDelete: (partyId: string, label: string) => void;
  /** Passed through to each slot's MemberChip — see MemberChip's `stacked` prop. */
  stacked?: boolean;
  /** Tap-to-move: the currently selected member (if any), and the two
   * actions a slot needs — select the member sitting in it, or complete a
   * pending move onto it. See PartyBoardView for the selection state itself. */
  selectedMember?: PartyBoardMemberRef | null;
  onSelectMember?: (member: PartyBoardMemberRef) => void;
  onPlaceSelected?: (partyId: string, slotIndex: number) => void;
  /** Working-view extras (all off in screenshot mode). */
  recipe?: PartyRecipeEntry[];
  groupAvg?: number;
  highlightClass?: string | null;
  onFindSub?: (partyId: string, slotIndex: number, anchor: HTMLElement) => void;
  showExtras?: boolean;
}

/** One party as a self-contained card (header + 5 slot rows) so cards can wrap freely regardless of party count. */
function PartyCard({
  party,
  isAdmin,
  pickableMembers,
  onClassChange,
  onPlayingAsChange,
  onClear,
  onAssign,
  onSendBusy,
  onReturn,
  onDelete,
  stacked = false,
  selectedMember = null,
  onSelectMember,
  onPlaceSelected,
  recipe = [],
  groupAvg = 0,
  highlightClass = null,
  onFindSub,
  showExtras = false,
}: PartyCardProps) {
  // Which empty slot's "pick a member" popover is open. Controlled here (rather
  // than left uncontrolled inside each PartySlot) so a successful pick can
  // auto-advance straight to the next empty slot for fast sequential filling.
  const [openSlotIndex, setOpenSlotIndex] = useState<number | null>(null);
  const filledCount = party.slots.filter((s) => s.member && !s.onLeave).length;

  function handleAssign(slotIndex: number, memberId: string) {
    onAssign(party.id, slotIndex, memberId);
    const next = [0, 1, 2, 3, 4].find(
      (i) => i > slotIndex && !party.slots.find((s) => s.slotIndex === i)?.member
    );
    setOpenSlotIndex(next ?? null);
  }

  const leaveSeated = party.slots.some((s) => s.member && s.onLeave);
  const missingRole = showExtras && recipe.length > 0 && party.slots.some((s) => s.member) && recipe.some((r) => party.slots.filter((s) => s.member && !s.onLeave && seatedClass(s) === r.className).length < r.count);
  const borderClass = !showExtras ? "border-zinc-800" : leaveSeated ? "border-rose-500/50" : missingRole ? "border-amber-400/45" : "border-zinc-800";

  return (
    <div className={`flex flex-col rounded-lg border bg-zinc-950 ${borderClass}`}>
      {showExtras ? (
        <PartyCardHeader party={party} recipe={recipe} groupAvg={groupAvg} isAdmin={isAdmin} onDelete={() => onDelete(party.id, party.label)} />
      ) : (
      <div className="flex items-center justify-between gap-1 rounded-t-lg bg-sky-500/10 px-2.5 py-2 text-xs font-semibold text-sky-300">
        <span className="truncate">{party.label}</span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="font-normal text-sky-400/70">{filledCount}/5</span>
          {isAdmin && (
            <button
              type="button"
              onClick={() => onDelete(party.id, party.label)}
              className="text-sky-400/60 hover:text-rose-400"
              title={`Delete ${party.label}`}
            >
              ✕
            </button>
          )}
        </span>
      </div>
      )}
      <div className="flex flex-col gap-1.5 p-1.5">
        {[0, 1, 2, 3, 4].map((slotIndex) => {
          const slot = party.slots.find((s) => s.slotIndex === slotIndex) ?? { slotIndex, member: null, playingAs: null, onLeave: false };
          const memberId = slot.member?.id;
          const cls = seatedClass(slot);
          const highlight = showExtras && highlightClass ? (slot.member && !slot.onLeave && cls === highlightClass ? "match" : "dim") : null;
          return (
            <PartySlot
              key={slotIndex}
              id={`slot:${party.id}:${slotIndex}`}
              member={slot.member}
              onLeave={slot.onLeave}
              playingAs={slot.playingAs}
              isAdmin={isAdmin}
              onClassChange={(value) => memberId && onClassChange(memberId, value)}
              onPlayingAsChange={(value) => onPlayingAsChange(party.id, slotIndex, value)}
              onClear={() => onClear(party.id, slotIndex)}
              onSendBusy={memberId ? () => onSendBusy(party.id, slotIndex) : undefined}
              onReturn={memberId ? () => onReturn(party.id, slotIndex) : undefined}
              pickableMembers={pickableMembers}
              onAssign={(selectedMemberId) => handleAssign(slotIndex, selectedMemberId)}
              pickerOpen={openSlotIndex === slotIndex}
              onPickerOpenChange={(open) => setOpenSlotIndex(open ? slotIndex : null)}
              stacked={stacked}
              selectedMember={selectedMember}
              onSelectMember={onSelectMember}
              onPlaceSelected={onPlaceSelected ? () => onPlaceSelected(party.id, slotIndex) : undefined}
              highlight={highlight}
              showCp={showExtras}
              onFindSub={showExtras && isAdmin && onFindSub && slot.onLeave ? (anchor) => onFindSub(party.id, slotIndex, anchor) : undefined}
            />
          );
        })}
      </div>
    </div>
  );
}

interface PartyBoardViewProps {
  boards: PartyBoardListItem[];
  selectedBoardId: string | null;
  initialBoard: PartyBoardDetail | null;
  isAdmin: boolean;
  /** Server render time (ms) — seeds the round countdown without reading the clock during render. */
  now: number;
}

interface HistoryEntry {
  label: string;
  undo: SlotWrite[];
}

function clockNow(): string {
  return new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });
}

export function PartyBoardView({ boards, selectedBoardId, initialBoard, isAdmin, now }: PartyBoardViewProps) {
  const router = useRouter();
  const { options: classOptions } = useJobClasses();
  const [board, setBoard] = useState<PartyBoardDetail | null>(initialBoard);
  const [activeMember, setActiveMember] = useState<PartyBoardMemberRef | null>(null);
  // Tap-to-move: an alternative to dragging, mainly for touch screens where
  // precise drag-and-drop is fiddly. Tap a member to select them, then tap
  // any slot/pool/busy zone to place them there — same placeMember() as
  // drag underneath, so it's a second way to trigger the same move, not a
  // parallel implementation. Purely additive: drag keeps working unchanged.
  const [selectedMember, setSelectedMember] = useState<PartyBoardMemberRef | null>(null);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(initialBoard?.groups[0]?.id ?? null);
  const [poolQuery, setPoolQuery] = useState("");
  const [poolClassFilter, setPoolClassFilter] = useState("");
  // "Screenshot mode" — hides admin edit controls and the working pool/busy
  // lists so the party grid alone looks clean when captured for an
  // announcement. Purely a local view toggle, not persisted.
  const [screenshotMode, setScreenshotMode] = useState(false);
  const effectiveAdmin = isAdmin && !screenshotMode;
  const [, startTransition] = useTransition();
  const [highlightClass, setHighlightClass] = useState<string | null>(null);
  const [subTarget, setSubTarget] = useState<SubTarget | null>(null);
  const closeSubFinder = useCallback(() => setSubTarget(null), []);
  // Undo covers layout-only changes (who sits where, and as which class):
  // drags between slots/the pool, หาแทน, Auto-balance, slot class. Leave
  // changes (ลา / return) aren't undoable here — they're real leave records
  // with their own audit trail; drag them back instead.
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [log, setLog] = useState<ChangeLogEntry[]>([]);
  const logId = useRef(0);
  const [toast, setToast] = useState<{ text: string; undoable: boolean } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [recipeOpen, setRecipeOpen] = useState(false);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  function addLog(text: string) {
    logId.current += 1;
    const id = logId.current;
    setLog((prev) => [{ id, text, at: clockNow() }, ...prev].slice(0, 30));
  }

  function showToast(text: string, undoable: boolean) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ text, undoable });
    toastTimer.current = setTimeout(() => setToast(null), 4500);
  }

  function partyLabel(partyId: string): string {
    for (const g of board?.groups ?? []) for (const p of g.parties) if (p.id === partyId) return board!.groups.length > 1 ? `${g.name} · ${p.label}` : p.label;
    return "party";
  }

  function describeMove(member: PartyBoardMemberRef, destination: PartyDestination): string {
    switch (destination.type) {
      case "busy":
        return `${member.displayName} ลา`;
      case "return":
        return `${member.displayName} กลับมา`;
      case "unassigned":
        return `${member.displayName} → waiting`;
      case "slot":
        return `${member.displayName}${destination.cancelLeave ? " กลับมา" : ""} → ${partyLabel(destination.partyId)}`;
    }
  }

  /** Sends a batch of slot writes to the server; drops `entry` from the undo stack if it fails. */
  function runLayout(writes: SlotWrite[], entry?: HistoryEntry) {
    if (!selectedBoardId) return;
    startTransition(async () => {
      try {
        const result = await applySlotLayout(selectedBoardId, writes);
        if (!result.ok) {
          alert(result.error ?? "Failed to save the change. Please try again.");
          if (entry) setHistory((h) => h.filter((e) => e !== entry));
          router.refresh();
        }
      } catch (err) {
        console.error("Failed to apply slot layout", err);
        alert("Failed to save the change. Please try again.");
        if (entry) setHistory((h) => h.filter((e) => e !== entry));
        router.refresh();
      }
    });
  }

  /** Applies a layout change (optimistically), records it for Undo, and saves it. */
  function commitLayout(label: string, writes: SlotWrite[], toastText?: string) {
    if (!board || !writes.length) return;
    const next = applyWritesLocal(board, writes);
    const { apply, undo } = diffLayouts(board, next);
    if (!apply.length) return;
    const entry: HistoryEntry = { label, undo };
    setHistory((h) => [...h, entry].slice(-30));
    addLog(label);
    setBoard(next);
    showToast(toastText ?? label, true);
    runLayout(apply, entry);
  }

  function handleUndo() {
    const entry = history[history.length - 1];
    if (!entry || !board) return;
    setHistory((h) => h.slice(0, -1));
    setBoard(applyWritesLocal(board, entry.undo));
    addLog(`↶ Undo: ${entry.label}`);
    showToast(`Undone: ${entry.label}`, false);
    runLayout(entry.undo);
  }

  function openFindSub(partyId: string, slotIndex: number, anchor: HTMLElement) {
    const r = anchor.getBoundingClientRect();
    setSelectedMember(null);
    setSubTarget({ partyId, slotIndex, rect: { left: r.left, top: r.top, bottom: r.bottom } });
  }

  function handlePickSub(candidate: SubCandidate) {
    if (!subTarget || !board) return;
    let outName = "";
    for (const g of board.groups)
      for (const p of g.parties) if (p.id === subTarget.partyId) outName = p.slots.find((s) => s.slotIndex === subTarget.slotIndex)?.member?.displayName ?? "";
    setSubTarget(null);
    const label = `${candidate.member.displayName} ลงแทน ${outName}`;
    commitLayout(label, subInWrites(subTarget.partyId, subTarget.slotIndex, candidate), candidate.from ? `${label} · ช่องเดิม (${candidate.from.label}) ว่างแล้ว` : label);
  }

  function handleAutoBalance() {
    const group = board?.groups.find((g) => g.id === activeGroupId);
    if (!group) return;
    const { writes, swaps } = autoBalanceWrites(group);
    if (!swaps) {
      showToast("สมดุลดีอยู่แล้ว — no same-class swap between full parties narrows the gap", false);
      return;
    }
    commitLayout(`Auto-balance ${group.name}: ${swaps} swap${swaps > 1 ? "s" : ""}`, writes, `Auto-balance: สลับ ${swaps} คู่ (อาชีพเดียวกันเท่านั้น) — ช่วง CP แคบลง`);
  }

  async function handleSaveRecipe(recipe: PartyRecipeEntry[]) {
    if (!selectedBoardId) return;
    try {
      const result = await setBoardRecipe(selectedBoardId, recipe);
      if (!result.ok) {
        alert(result.error ?? "Failed to save the recipe.");
        return;
      }
      setBoard((prev) => (prev ? { ...prev, recipe } : prev));
      setRecipeOpen(false);
      addLog("Recipe updated");
    } catch (err) {
      console.error("Failed to save recipe", err);
      alert("Failed to save the recipe. Please try again.");
    }
  }

  // Structural edits (create/rename/delete board/group/party) go through
  // router.refresh() rather than local optimistic state, so re-sync local
  // state whenever the server gives us a fresh board. Adjusting state during
  // render (rather than in an effect) avoids an extra cascading render.
  const [syncedInitialBoard, setSyncedInitialBoard] = useState(initialBoard);
  if (initialBoard !== syncedInitialBoard) {
    setSyncedInitialBoard(initialBoard);
    setBoard(initialBoard);
    setSelectedMember(null); // a pending tap-selection from the old board wouldn't mean anything on the new one
    setActiveGroupId((prev) =>
      initialBoard?.groups.some((g) => g.id === prev) ? prev : initialBoard?.groups[0]?.id ?? null
    );
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // Escape backs out of a pending tap-selection, same as it already does
  // for the member-picker popover.
  useEffect(() => {
    if (!selectedMember) return;
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setSelectedMember(null);
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [selectedMember]);

  function placeMember(member: PartyBoardMemberRef, destination: PartyDestination) {
    if (!selectedBoardId || !board) return;
    // Tried animating this move with the View Transitions API (smooth glide
    // between old/new position) — reverted per user feedback: with several
    // chips potentially moving/reflowing across a busy board at once, the
    // motion read as disorienting/nauseating in real use, not smooth. Back
    // to a plain instant update. The actual "page jumps" bug this was meant
    // to layer polish on top of is still fixed via the slot's min-h-[77px]
    // (party-slot.tsx) — that's what stops the real layout shift.
    const next = computeNext(board, member, destination);
    const text = describeMove(member, destination);
    // Only pure seat moves go on the undo stack (see `history`).
    const layoutOnly = destination.type === "unassigned" || (destination.type === "slot" && !destination.cancelLeave);
    let entry: HistoryEntry | null = null;
    if (layoutOnly) {
      const { undo } = diffLayouts(board, next);
      if (undo.length) {
        const e: HistoryEntry = { label: text, undo };
        entry = e;
        setHistory((h) => [...h, e].slice(-30));
      }
    }
    addLog(text);
    setBoard(next);
    startTransition(async () => {
      try {
        const result = await moveMember(selectedBoardId, member.id, destination);
        if (!result.ok) {
          alert(result.error ?? "Failed to move member. Please try again.");
          if (entry) setHistory((h) => h.filter((x) => x !== entry));
          router.refresh();
        }
      } catch (err) {
        // moveMember's transaction can throw (not just return {ok:false}) —
        // without this catch, the optimistic move above stays on screen as
        // if it had succeeded even though nothing was actually saved, and
        // only a manual refresh would reveal the mismatch.
        console.error("Failed to move member", err);
        alert("Failed to move member. Please try again.");
        router.refresh();
      }
    });
  }

  function handleDragStart(event: DragStartEvent) {
    const data = event.active.data.current as { member?: PartyBoardMemberRef } | undefined;
    setActiveMember(data?.member ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveMember(null);
    const { active, over } = event;
    if (!over || !board) return;

    const data = active.data.current as { member: PartyBoardMemberRef; fromBusy?: boolean } | undefined;
    if (!data) return;
    let destination = parseDestination(String(over.id));
    if (!destination) return;

    // Dragging a chip OUT of the ลา zone means "they're back": into a slot
    // cancels the leave and seats them; into the pool just cancels it
    // (their slot, if any, is untouched).
    if (data.fromBusy) {
      if (destination.type === "busy") return;
      destination = destination.type === "slot" ? { ...destination, cancelLeave: true } : { type: "return" };
    }

    placeMember(data.member, destination);
  }

  // Tap-to-move needs to know whether the selection came from the ลา zone,
  // for the same "dragging out of ลา = they're back" rewrite handleDragEnd
  // applies — without it a tap from ลา to the pool did nothing visible.
  const [selectedFromBusy, setSelectedFromBusy] = useState(false);

  function handleToggleSelect(member: PartyBoardMemberRef, fromBusy = false) {
    setSelectedMember((prev) => (prev?.id === member.id ? null : member));
    setSelectedFromBusy(fromBusy);
  }

  function handlePlaceSelected(destination: PartyDestination) {
    if (!selectedMember) return;
    let target = destination;
    if (selectedFromBusy) {
      if (target.type === "busy") {
        setSelectedMember(null);
        return;
      }
      target = target.type === "slot" ? { ...target, cancelLeave: true } : { type: "return" };
    }
    placeMember(selectedMember, target);
    setSelectedMember(null);
    setSelectedFromBusy(false);
  }

  function handleAssignToSlot(partyId: string, slotIndex: number, memberId: string) {
    const member = board?.unassigned.find((m) => m.id === memberId);
    if (!member) return;
    placeMember(member, { type: "slot", partyId, slotIndex });
  }

  function handleAssignBusy(memberId: string) {
    const member = board?.unassigned.find((m) => m.id === memberId);
    if (!member) return;
    placeMember(member, { type: "busy" });
  }

  function handleClassChange(memberId: string, value: string) {
    if (!board) return;
    const className = value || null;
    setBoard((prev) => (prev ? patchMemberClass(prev, memberId, className) : prev));
    startTransition(async () => {
      try {
        const result = await setMemberClass(memberId, className);
        if (!result.ok) {
          alert(result.error ?? "Failed to change class. Please try again.");
          router.refresh();
        }
      } catch (err) {
        console.error("Failed to change class", err);
        alert("Failed to change class. Please try again.");
        router.refresh();
      }
    });
  }

  function handlePlayingAsChange(partyId: string, slotIndex: number, value: string | null) {
    if (!board) return;
    for (const g of board.groups)
      for (const p of g.parties) {
        if (p.id !== partyId) continue;
        const slot = p.slots.find((s) => s.slotIndex === slotIndex);
        if (!slot?.member) continue;
        const label = `${slot.member.displayName} เล่น ${value ?? slot.member.className ?? "main"}`;
        setHistory((h) => [...h, { label, undo: [{ partyId, slotIndex, memberId: slot.member!.id, playingAs: slot.playingAs }] }].slice(-30));
        addLog(label);
      }
    setBoard((prev) =>
      prev
        ? {
            ...prev,
            groups: prev.groups.map((g) => ({
              ...g,
              parties: g.parties.map((p) =>
                p.id !== partyId ? p : { ...p, slots: p.slots.map((s) => (s.slotIndex === slotIndex ? { ...s, playingAs: value } : s)) }
              ),
            })),
          }
        : prev
    );
    startTransition(async () => {
      try {
        const result = await setSlotPlayingAs(partyId, slotIndex, value);
        if (!result.ok) {
          alert(result.error ?? "Failed to change class. Please try again.");
          router.refresh();
        }
      } catch (err) {
        console.error("Failed to change slot class", err);
        alert("Failed to change class. Please try again.");
        router.refresh();
      }
    });
  }

  function handleClearSlot(partyId: string, slotIndex: number) {
    if (!board) return;
    let member: PartyBoardMemberRef | null = null;
    for (const g of board.groups) {
      for (const p of g.parties) {
        if (p.id !== partyId) continue;
        const slot = p.slots.find((s) => s.slotIndex === slotIndex);
        if (slot?.member) member = slot.member;
      }
    }
    if (!member) return;
    placeMember(member, { type: "unassigned" });
  }

  function handleSendBusy(partyId: string, slotIndex: number) {
    if (!board) return;
    let member: PartyBoardMemberRef | null = null;
    for (const g of board.groups) {
      for (const p of g.parties) {
        if (p.id !== partyId) continue;
        const slot = p.slots.find((s) => s.slotIndex === slotIndex);
        if (slot?.member) member = slot.member;
      }
    }
    if (!member) return;
    placeMember(member, { type: "busy" });
  }

  function handleBusyRemove(memberId: string) {
    if (!board) return;
    const member = board.busy.find((b) => b.id === memberId);
    if (!member) return;
    placeMember(member, { type: "return" });
  }

  function handleReturnFromSlot(partyId: string, slotIndex: number) {
    if (!board) return;
    let member: PartyBoardMemberRef | null = null;
    for (const g of board.groups) {
      for (const p of g.parties) {
        if (p.id !== partyId) continue;
        const slot = p.slots.find((s) => s.slotIndex === slotIndex);
        if (slot?.member) member = slot.member;
      }
    }
    if (!member) return;
    placeMember(member, { type: "return" });
  }

  // Every handler below talks to a server action that can THROW (not just
  // return {ok:false}) — requireAdmin() rejecting a stale session, or a DB
  // connection blip (this project's Railway deploys routinely interrupt
  // in-flight requests, see bot/index.ts's restart-safety fixes) all surface
  // as a rejected promise, not an ActionResult. Without a catch, that
  // rejection is just an unhandled promise rejection in the console — the
  // button silently does nothing, with no error and no state change, and an
  // admin who doesn't notice may click again thinking the first click didn't
  // register. Same class of bug moveMember/setMemberClass below were
  // already hardened against; these structural actions (board/group/party
  // create/rename/delete) had the exact same gap.

  async function handleReset() {
    if (!selectedBoardId) return;
    if (!confirm("Clear this entire board back to empty? This cannot be undone.")) return;
    try {
      const result = await resetPartyBoard(selectedBoardId);
      if (result.ok) {
        setHistory([]);
        addLog("Board cleared");
        router.refresh();
      }
      else if (result.error) alert(result.error);
    } catch (err) {
      console.error("Failed to reset board", err);
      alert("Failed to reset board. Please try again.");
    }
  }

  async function handleDeleteBoard() {
    if (!board || !selectedBoardId) return;
    if (!confirm(`Delete the entire "${board.name}" board? This cannot be undone.`)) return;
    try {
      const result = await deleteBoard(selectedBoardId);
      if (result.ok) {
        const remaining = boards.filter((b) => b.id !== selectedBoardId);
        router.push(remaining[0] ? `/party?board=${remaining[0].id}` : "/party");
        router.refresh();
      }
    } catch (err) {
      console.error("Failed to delete board", err);
      alert("Failed to delete board. Please try again.");
    }
  }

  async function handleCreateGroup() {
    if (!selectedBoardId) return;
    const name = window.prompt("New group name (e.g. Main Stage, Party A, team leader's name):");
    if (!name) return;
    try {
      const result = await createGroup(selectedBoardId, name);
      if (result.ok) router.refresh();
      else if (result.error) alert(result.error);
    } catch (err) {
      console.error("Failed to create group", err);
      alert("Failed to create group. Please try again.");
    }
  }

  async function handleRenameGroup(groupId: string, currentName: string) {
    const name = window.prompt("Rename group:", currentName);
    if (!name) return;
    try {
      const result = await renameGroup(groupId, name);
      if (result.ok) router.refresh();
      else if (result.error) alert(result.error);
    } catch (err) {
      console.error("Failed to rename group", err);
      alert("Failed to rename group. Please try again.");
    }
  }

  async function handleDeleteGroup(groupId: string, name: string) {
    if (!confirm(`Delete the entire "${name}" group (including every party inside it)? This cannot be undone.`)) return;
    try {
      const result = await deleteGroup(groupId);
      if (result.ok) router.refresh();
    } catch (err) {
      console.error("Failed to delete group", err);
      alert("Failed to delete group. Please try again.");
    }
  }

  async function handleCreateParty(groupId: string) {
    try {
      const result = await createParty(groupId);
      if (result.ok) router.refresh();
      else if (result.error) alert(result.error);
    } catch (err) {
      console.error("Failed to create party", err);
      alert("Failed to create party. Please try again.");
    }
  }

  async function handleDeleteParty(partyId: string, label: string) {
    if (!confirm(`Delete ${label}?`)) return;
    try {
      const result = await deleteParty(partyId);
      if (result.ok) router.refresh();
    } catch (err) {
      console.error("Failed to delete party", err);
      alert("Failed to delete party. Please try again.");
    }
  }

  const placedCount = useMemo(() => {
    if (!board) return 0;
    return board.groups.reduce(
      (sum, g) => sum + g.parties.reduce((s, p) => s + p.slots.filter((sl) => sl.member && !sl.onLeave).length, 0),
      0
    );
  }, [board]);

  const filteredUnassigned = useMemo(() => {
    if (!board) return [];
    const q = poolQuery.trim().toLowerCase();
    return board.unassigned.filter((m) => {
      if (poolClassFilter && m.className !== poolClassFilter && !m.altClasses.includes(poolClassFilter)) return false;
      if (q && !m.displayName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [board, poolQuery, poolClassFilter]);

  const activeGroup = board?.groups.find((g) => g.id === activeGroupId) ?? null;
  const linkedEvent = board?.checkinEventKey ? getCheckinEvent(board.checkinEventKey) : undefined;
  const activeGroupAvg = activeGroup && board ? groupAverageCp(activeGroup, board.recipe) : 0;

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex flex-col gap-4">
        {/* Board switcher */}
        <div className="flex flex-wrap items-center gap-1 rounded-xl border border-zinc-800 bg-zinc-900/50 p-1.5">
          {boards.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => router.push(`/party?board=${b.id}`)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                b.id === selectedBoardId
                  ? "bg-amber-600 text-white"
                  : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              }`}
            >
              {b.name}
            </button>
          ))}
        </div>

        {!board ? (
          <div className="rounded-xl border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-500">
            No boards yet
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 text-xs text-zinc-400">
              <span className="flex flex-wrap items-center gap-x-1.5">
                <span>
                  Board <span className="font-medium text-zinc-200">{board.name}</span>
                </span>
                {linkedEvent ? (
                  <span
                    className="rounded-full bg-sky-400/10 px-2 py-0.5 text-[11px] text-sky-300 ring-1 ring-inset ring-sky-400/30"
                    title="Linked by board name — ห้องลา, /checkin and /calendar use this board for this event"
                  >
                    🔗 {linkedEvent.label} · {fmtWeekdays(linkedEvent.weekdays)} {linkedEvent.startTime.slice(0, 5)}–{linkedEvent.endTime.slice(0, 5)}
                  </span>
                ) : (
                  <span
                    className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-300 ring-1 ring-inset ring-amber-500/30"
                    title="Only a board named GL or WOE is linked to a check-in event"
                  >
                    ⚠ not linked to an event — name the board GL or WOE
                  </span>
                )}
                <span>
                  · {placedCount} placed · {board.unassigned.length} open · ลา {fmtLeaveDate(board.occurrenceDate)}: {board.busy.length}
                </span>
              </span>
              {isAdmin && (
                <div className="flex flex-wrap items-center gap-2">
                  {effectiveAdmin && (
                    <button
                      type="button"
                      onClick={handleUndo}
                      disabled={!history.length}
                      title={history.length ? `Undo: ${history[history.length - 1].label}` : "Nothing to undo"}
                      className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 transition hover:bg-zinc-800 disabled:cursor-default disabled:opacity-40"
                    >
                      ↶ Undo
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setScreenshotMode((v) => !v)}
                    title="Hide all management controls — good for taking a screenshot to announce"
                    className={`rounded-lg border px-2.5 py-1 text-xs transition ${
                      screenshotMode
                        ? "border-amber-500 bg-amber-500/10 text-amber-300"
                        : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                    }`}
                  >
                    {screenshotMode ? "✓ Screenshot mode" : "Screenshot mode"}
                  </button>
                  {effectiveAdmin && selectedBoardId && (
                    <>
                      <AnnounceBoardImageButton
                        boardId={selectedBoardId}
                        boardName={board.name}
                        lastChannelId={board.lastImageAnnounceChannelId}
                      />
                      <button
                        type="button"
                        onClick={handleReset}
                        className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 transition hover:bg-zinc-800"
                      >
                        Clear This Board
                      </button>
                      <button
                        type="button"
                        onClick={handleDeleteBoard}
                        className="rounded-lg border border-rose-900/60 px-2.5 py-1 text-xs text-rose-400 transition hover:bg-rose-950/40"
                      >
                        Delete This Board
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            {!screenshotMode && (
              <ReadinessStrip board={board} activeGroup={activeGroup} now={now} isAdmin={effectiveAdmin} onEditRecipe={() => setRecipeOpen(true)} />
            )}

            {/* Warns an organizer, before they start dragging people into
                slots, that someone already has a leave on file for this
                board on a date AFTER the current round — the ลา zone only
                shows the current round. Hidden in screenshot mode — this is
                a heads-up for whoever's organizing, not something to
                broadcast. */}
            {!screenshotMode && board.upcomingLeaves.length > 0 && (
              <div className="flex flex-wrap items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-200">
                <span className="mt-0.5 shrink-0 font-medium">⚠ Upcoming leave on file:</span>
                <div className="flex flex-1 flex-wrap gap-1.5">
                  {board.upcomingLeaves.map((l) => (
                    <span
                      key={`${l.memberId}-${l.date}`}
                      className="rounded-full bg-amber-500/15 px-2 py-0.5 ring-1 ring-inset ring-amber-500/30"
                    >
                      {l.name} — {fmtLeaveDate(l.date)}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {!screenshotMode && <ClassHighlightBar board={board} value={highlightClass} onChange={setHighlightClass} />}

            <div className={screenshotMode ? "flex flex-col gap-4" : "grid gap-4 xl:grid-cols-[minmax(0,1fr)_290px] xl:items-start"}>
            <div className="flex min-w-0 flex-col gap-4">
            {/* Group tabs */}
            <div className="flex flex-wrap items-center gap-1 border-b border-zinc-800">
              {board.groups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setActiveGroupId(g.id)}
                  className={`-mb-px rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium transition ${
                    g.id === activeGroupId
                      ? "border-amber-500 text-amber-300"
                      : "border-transparent text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {g.name} <span className="ml-1 text-xs text-zinc-500">{g.parties.length} parties</span>
                </button>
              ))}
              {effectiveAdmin && (
                <button
                  type="button"
                  onClick={handleCreateGroup}
                  className="mb-1 rounded-lg border border-dashed border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 transition hover:border-amber-500 hover:text-amber-300"
                >
                  + New Group
                </button>
              )}
            </div>

            {board.groups.length === 0 && (
              <div className="rounded-xl border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-500">
                No groups on this board yet{effectiveAdmin ? " — click \"+ New Group\" above" : ""}
              </div>
            )}

            {activeGroup && (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {effectiveAdmin ? (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleRenameGroup(activeGroup.id, activeGroup.name)}
                        className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 transition hover:bg-zinc-800"
                        title="Rename group"
                      >
                        ✎ {activeGroup.name}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCreateParty(activeGroup.id)}
                        className="rounded-lg border border-dashed border-zinc-700 px-2.5 py-1 text-xs text-zinc-400 transition hover:border-amber-500 hover:text-amber-300"
                      >
                        + New Party
                      </button>
                      <button
                        type="button"
                        onClick={handleAutoBalance}
                        title="Evens out CP between this group's full parties by swapping members who play the same class — compositions don't change, on-leave members never move. Undo-able."
                        className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 transition hover:bg-zinc-800"
                      >
                        ⚖ Auto-balance
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteGroup(activeGroup.id, activeGroup.name)}
                        className="rounded-lg border border-rose-900/60 px-2.5 py-1 text-xs text-rose-400 transition hover:bg-rose-950/40"
                      >
                        Delete This Group
                      </button>
                    </div>
                  ) : (
                    <span className="text-sm font-medium text-zinc-300">{activeGroup.name}</span>
                  )}
                </div>

                {activeGroup.parties.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-500">
                    This group has no parties yet{effectiveAdmin ? " — click \"+ New Party\" above" : ""}
                  </div>
                ) : (
                  <div
                    className={
                      screenshotMode
                        ? // Screenshot mode is for posting to Discord — the guild is used to
                          // reading it as a fixed 8-per-row table (their old spreadsheet
                          // layout), so force exactly 8 columns here regardless of viewport
                          // width, instead of the width-driven auto-fill used for editing.
                          "grid grid-cols-8 gap-2"
                        : "grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3"
                    }
                  >
                    {activeGroup.parties.map((party) => (
                      <PartyCard
                        key={party.id}
                        party={party}
                        isAdmin={effectiveAdmin}
                        pickableMembers={board.unassigned}
                        onClassChange={handleClassChange}
                        onPlayingAsChange={handlePlayingAsChange}
                        onClear={handleClearSlot}
                        onAssign={handleAssignToSlot}
                        onSendBusy={handleSendBusy}
                        onReturn={handleReturnFromSlot}
                        onDelete={handleDeleteParty}
                        stacked={screenshotMode}
                        selectedMember={selectedMember}
                        onSelectMember={effectiveAdmin ? handleToggleSelect : undefined}
                        onPlaceSelected={
                          effectiveAdmin
                            ? (partyId, slotIndex) => handlePlaceSelected({ type: "slot", partyId, slotIndex })
                            : undefined
                        }
                        showExtras={!screenshotMode}
                        recipe={board.recipe}
                        groupAvg={activeGroupAvg}
                        highlightClass={highlightClass}
                        onFindSub={openFindSub}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            </div>

            {!screenshotMode && (
              <aside className="order-first flex min-w-0 flex-col gap-3 xl:sticky xl:top-4 xl:order-none xl:max-h-[calc(100dvh-2rem)] xl:overflow-y-auto">
                <NeedsSubCard board={board} isAdmin={effectiveAdmin} onFindSub={openFindSub} />
                <SideCard
                  title="🪑 Waiting to join"
                  count={filteredUnassigned.length !== board.unassigned.length ? `${filteredUnassigned.length} / ${board.unassigned.length}` : board.unassigned.length}
                >
                  <div className="mb-2 flex items-center gap-1.5">
                    <input
                      type="text"
                      value={poolQuery}
                      onChange={(e) => setPoolQuery(e.target.value)}
                      placeholder="Search name..."
                      className="w-0 min-w-0 flex-1 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none"
                    />
                    <select
                      value={poolClassFilter}
                      onChange={(e) => setPoolClassFilter(e.target.value)}
                      className="max-w-[45%] rounded-md border border-zinc-800 bg-zinc-900 px-1.5 py-1 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none"
                    >
                      <option value="">All Classes</option>
                      {classOptions.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <DroppableZone
                    id="unassigned"
                    label="Waiting to join"
                    maxHeightClass="max-h-[45vh]"
                    layout="list"
                    tapTarget={effectiveAdmin && !!selectedMember}
                    onBackgroundClick={effectiveAdmin && selectedMember ? () => handlePlaceSelected({ type: "unassigned" }) : undefined}
                  >
                    {filteredUnassigned.length === 0 && (
                      <span className="px-1 py-1 text-xs text-zinc-600">
                        {board.unassigned.length === 0 ? "No one is waiting to join" : "No names match the filter"}
                      </span>
                    )}
                    {filteredUnassigned.map((member) => (
                      <MemberChip
                        key={member.id}
                        member={member}
                        cp={member.cp}
                        draggable={effectiveAdmin}
                        selected={selectedMember?.id === member.id}
                        onSelect={effectiveAdmin ? () => handleToggleSelect(member) : undefined}
                      />
                    ))}
                  </DroppableZone>
                  {effectiveAdmin && <p className="mt-1.5 text-[11px] text-zinc-600">ลากชื่อ หรือคลิกชื่อแล้วคลิกช่องในปาร์ตี้เพื่อวาง</p>}
                </SideCard>
                {activeGroup && (
                  <div className="hidden xl:block">
                    <PartyPowerCard group={activeGroup} recipe={board.recipe} />
                  </div>
                )}
                {effectiveAdmin && (
                  <div className="hidden xl:block">
                    <ChangesCard log={log} />
                  </div>
                )}
              </aside>
            )}
            </div>

            {/* Busy/leave list — kept at the very bottom, out of the way of
                the party grid. In screenshot mode this switches to a plain
                read-only name list (no drag/picker/remove controls) instead
                of hiding entirely — the summary bar above only shows a
                count, so without this, anyone reading the posted screenshot
                has no way to tell WHO is busy/on leave vs. just missing. */}
            <section>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-medium text-zinc-300">
                  ลา {fmtLeaveDate(board.occurrenceDate)} ({board.busy.length})
                  <span className="ml-2 font-normal text-zinc-500">same list as ห้องลา / /checkin / /calendar</span>
                </h2>
                {effectiveAdmin && (
                  <MemberPicker
                    members={board.unassigned}
                    onSelect={handleAssignBusy}
                    emptyLabel="No one is open anymore"
                    align="right"
                    trigger={
                      <span className="cursor-pointer select-none rounded-lg border border-dashed border-zinc-700 px-2 py-1 text-xs text-zinc-400 transition hover:border-amber-500 hover:text-amber-300">
                        + Mark on leave
                      </span>
                    }
                  />
                )}
              </div>
              {screenshotMode ? (
                <div className="flex flex-wrap gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900/40 p-2">
                  {board.busy.length === 0 ? (
                    <span className="px-1 py-1 text-xs text-zinc-600">No one on leave this round</span>
                  ) : (
                    board.busy.map((member) => (
                      <MemberChip key={member.id} member={member} draggable={false} compact showClassBadge />
                    ))
                  )}
                </div>
              ) : (
                <DroppableZone
                  id="busy"
                  label="On leave this round"
                  tapTarget={effectiveAdmin && !!selectedMember}
                  onBackgroundClick={
                    effectiveAdmin && selectedMember ? () => handlePlaceSelected({ type: "busy" }) : undefined
                  }
                >
                  {board.busy.length === 0 && (
                    <span className="px-1 py-1 text-xs text-zinc-600">
                      Drag a name here, or click &quot;+ Mark on leave&quot; to mark someone on leave for this round —
                      they keep their party slot (shown faded). Drag them back out to cancel the leave.
                    </span>
                  )}
                  {board.busy.map((member) => (
                    <div key={member.id} className="flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-800/80 py-1 pl-1.5 pr-1">
                      <MemberChip
                        member={member}
                        draggable={effectiveAdmin}
                        dragContext="busy"
                        compact
                        showClassBadge={!effectiveAdmin}
                        selected={selectedMember?.id === member.id}
                        onSelect={effectiveAdmin ? () => handleToggleSelect(member, true) : undefined}
                      />
                      {effectiveAdmin && (
                        <>
                          <select
                            value={member.className ?? ""}
                            onChange={(e) => handleClassChange(member.id, e.target.value)}
                            className="rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-[10px] text-zinc-300 focus:border-amber-500 focus:outline-none"
                          >
                            <option value="">- Class -</option>
                            {classOptions.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => handleBusyRemove(member.id)}
                            title="Cancel this round's leave"
                            className="rounded px-1 text-xs text-zinc-500 transition hover:text-rose-400"
                          >
                            ✕
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                </DroppableZone>
              )}
            </section>
          </>
        )}
      </div>

      {board && subTarget && effectiveAdmin && (
        <SubFinderPopover board={board} target={subTarget} onPick={handlePickSub} onClose={closeSubFinder} />
      )}
      {board && recipeOpen && effectiveAdmin && (
        <RecipeEditor initial={board.recipe} onSave={handleSaveRecipe} onClose={() => setRecipeOpen(false)} />
      )}
      {toast && !screenshotMode && (
        <UndoToast
          text={toast.text}
          lifted={effectiveAdmin && !!selectedMember}
          onUndo={
            toast.undoable && history.length
              ? () => {
                  setToast(null);
                  handleUndo();
                }
              : undefined
          }
        />
      )}

      <DragOverlay>
        {activeMember ? <MemberChip member={activeMember} draggable={false} showClassBadge={false} /> : null}
      </DragOverlay>

      {/* Tap-to-move status bar — the whole point is that it's obvious a
          selection is pending and how to get out of it, since nothing else
          on the page announces this the way a held drag naturally does. */}
      {effectiveAdmin && selectedMember && (
        <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
          <div className="flex items-center gap-3 rounded-full border border-amber-500/40 bg-zinc-900 py-2 pl-3 pr-2 text-sm shadow-xl shadow-black/40">
            <span className="text-zinc-400">
              Moving <span className="font-medium text-amber-300">{selectedMember.displayName}</span> — tap the target slot
            </span>
            <button
              type="button"
              onClick={() => setSelectedMember(null)}
              className="shrink-0 rounded-full border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 transition hover:bg-zinc-800"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </DndContext>
  );
}
