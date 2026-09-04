"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
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
import { PostAttendanceButton } from "./post-attendance-button";
import { AnnounceBoardImageButton } from "./announce-board-image-button";
import { PartyTemplatePanel } from "./party-template-panel";
import { useJobClasses } from "@/components/job-classes-provider";
import {
  createBoard,
  createGroup,
  createParty,
  deleteBoard,
  deleteGroup,
  deleteParty,
  moveMember,
  renameBoard,
  renameGroup,
  resetPartyBoard,
  setMemberClass,
  type PartyDestination,
} from "@/app/actions/party";
import type { PartyBoardDetail, PartyBoardListItem, PartyBoardMemberRef, PartyGroupView } from "@/lib/party-data";

export function parseDestination(id: string): PartyDestination | null {
  if (id === "busy") return { type: "busy" };
  if (id === "unassigned") return { type: "unassigned" };
  const match = id.match(/^slot:(.+):(\d+)$/);
  if (match) return { type: "slot", partyId: match[1], slotIndex: Number(match[2]) };
  return null;
}

/** Moves a member (in local optimistic state) to a new place on the board. */
function computeNext(prev: PartyBoardDetail, member: PartyBoardMemberRef, destination: PartyDestination): PartyBoardDetail {
  let groups = prev.groups.map((g) => ({
    ...g,
    parties: g.parties.map((p) => ({
      ...p,
      slots: p.slots.map((s) => (s.member?.id === member.id ? { ...s, member: null } : s)),
    })),
  }));

  let busy = prev.busy.filter((b) => b.id !== member.id);
  let unassigned = prev.unassigned.filter((u) => u.id !== member.id);

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
            return { slotIndex: s.slotIndex, member };
          }),
        };
      }),
    }));
    if (bumpedOccupant) unassigned = [...unassigned, bumpedOccupant];
  } else if (destination.type === "busy") {
    busy = [...busy, member];
  } else {
    unassigned = [...unassigned, member];
  }

  return { ...prev, groups, busy, unassigned };
}

/** Patches a member's className everywhere they currently appear on the board (optimistic update). */
function patchMemberClass(prev: PartyBoardDetail, memberId: string, className: string | null): PartyBoardDetail {
  const patch = (m: PartyBoardMemberRef) => (m.id === memberId ? { ...m, className } : m);
  return {
    ...prev,
    groups: prev.groups.map((g) => ({
      ...g,
      parties: g.parties.map((p) => ({
        ...p,
        slots: p.slots.map((s) => (s.member ? { ...s, member: patch(s.member) } : s)),
      })),
    })),
    busy: prev.busy.map(patch),
    unassigned: prev.unassigned.map(patch),
  };
}

function DroppableZone({
  id,
  children,
  label,
  maxHeightClass = "max-h-36",
  tapTarget = false,
  onBackgroundClick,
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
}) {
  const { isOver, setNodeRef } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      onClick={onBackgroundClick}
      className={`flex ${maxHeightClass} min-h-[52px] flex-wrap content-start gap-1.5 overflow-y-auto rounded-xl border p-2 transition ${
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
  onClear: (partyId: string, slotIndex: number) => void;
  onAssign: (partyId: string, slotIndex: number, memberId: string) => void;
  onSendBusy: (partyId: string, slotIndex: number) => void;
  onDelete: (partyId: string, label: string) => void;
  /** Passed through to each slot's MemberChip — see MemberChip's `stacked` prop. */
  stacked?: boolean;
  /** Tap-to-move: the currently selected member (if any), and the two
   * actions a slot needs — select the member sitting in it, or complete a
   * pending move onto it. See PartyBoardView for the selection state itself. */
  selectedMember?: PartyBoardMemberRef | null;
  onSelectMember?: (member: PartyBoardMemberRef) => void;
  onPlaceSelected?: (partyId: string, slotIndex: number) => void;
}

/** One party as a self-contained card (header + 5 slot rows) so cards can wrap freely regardless of party count. */
function PartyCard({
  party,
  isAdmin,
  pickableMembers,
  onClassChange,
  onClear,
  onAssign,
  onSendBusy,
  onDelete,
  stacked = false,
  selectedMember = null,
  onSelectMember,
  onPlaceSelected,
}: PartyCardProps) {
  // Which empty slot's "pick a member" popover is open. Controlled here (rather
  // than left uncontrolled inside each PartySlot) so a successful pick can
  // auto-advance straight to the next empty slot for fast sequential filling.
  const [openSlotIndex, setOpenSlotIndex] = useState<number | null>(null);
  const filledCount = party.slots.filter((s) => s.member).length;

  function handleAssign(slotIndex: number, memberId: string) {
    onAssign(party.id, slotIndex, memberId);
    const next = [0, 1, 2, 3, 4].find(
      (i) => i > slotIndex && !party.slots.find((s) => s.slotIndex === i)?.member
    );
    setOpenSlotIndex(next ?? null);
  }

  return (
    <div className="flex flex-col rounded-lg border border-zinc-800 bg-zinc-950">
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
      <div className="flex flex-col gap-1.5 p-1.5">
        {[0, 1, 2, 3, 4].map((slotIndex) => {
          const slot = party.slots.find((s) => s.slotIndex === slotIndex) ?? { slotIndex, member: null };
          const memberId = slot.member?.id;
          return (
            <PartySlot
              key={slotIndex}
              id={`slot:${party.id}:${slotIndex}`}
              member={slot.member}
              isAdmin={isAdmin}
              onClassChange={(value) => memberId && onClassChange(memberId, value)}
              onClear={() => onClear(party.id, slotIndex)}
              onSendBusy={memberId ? () => onSendBusy(party.id, slotIndex) : undefined}
              pickableMembers={pickableMembers}
              onAssign={(selectedMemberId) => handleAssign(slotIndex, selectedMemberId)}
              pickerOpen={openSlotIndex === slotIndex}
              onPickerOpenChange={(open) => setOpenSlotIndex(open ? slotIndex : null)}
              stacked={stacked}
              selectedMember={selectedMember}
              onSelectMember={onSelectMember}
              onPlaceSelected={onPlaceSelected ? () => onPlaceSelected(party.id, slotIndex) : undefined}
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
}

export function PartyBoardView({ boards, selectedBoardId, initialBoard, isAdmin }: PartyBoardViewProps) {
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
    if (!selectedBoardId) return;
    // Tried animating this move with the View Transitions API (smooth glide
    // between old/new position) — reverted per user feedback: with several
    // chips potentially moving/reflowing across a busy board at once, the
    // motion read as disorienting/nauseating in real use, not smooth. Back
    // to a plain instant update. The actual "page jumps" bug this was meant
    // to layer polish on top of is still fixed via the slot's min-h-[77px]
    // (party-slot.tsx) — that's what stops the real layout shift.
    setBoard((prev) => (prev ? computeNext(prev, member, destination) : prev));
    startTransition(async () => {
      const result = await moveMember(selectedBoardId, member.id, destination);
      if (!result.ok) {
        alert(result.error ?? "Failed to move member. Please try again.");
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

    const data = active.data.current as { member: PartyBoardMemberRef } | undefined;
    if (!data) return;
    const destination = parseDestination(String(over.id));
    if (!destination) return;

    placeMember(data.member, destination);
  }

  function handleToggleSelect(member: PartyBoardMemberRef) {
    setSelectedMember((prev) => (prev?.id === member.id ? null : member));
  }

  function handlePlaceSelected(destination: PartyDestination) {
    if (!selectedMember) return;
    placeMember(selectedMember, destination);
    setSelectedMember(null);
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
      await setMemberClass(memberId, className);
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
    placeMember(member, { type: "unassigned" });
  }

  async function handleReset() {
    if (!selectedBoardId) return;
    if (!confirm("Clear this entire board back to empty? This cannot be undone.")) return;
    const result = await resetPartyBoard(selectedBoardId);
    if (result.ok) router.refresh();
  }

  async function handleCreateBoard() {
    const name = window.prompt("New board name (e.g. GVG, Normal, Special Event):");
    if (!name) return;
    const result = await createBoard(name);
    if (result.ok && result.id) {
      router.push(`/party?board=${result.id}`);
      router.refresh();
    } else if (result.error) {
      alert(result.error);
    }
  }

  async function handleRenameBoard() {
    if (!board || !selectedBoardId) return;
    const name = window.prompt("Rename board:", board.name);
    if (!name) return;
    const result = await renameBoard(selectedBoardId, name);
    if (result.ok) router.refresh();
    else if (result.error) alert(result.error);
  }

  async function handleDeleteBoard() {
    if (!board || !selectedBoardId) return;
    if (!confirm(`Delete the entire "${board.name}" board? This cannot be undone.`)) return;
    const result = await deleteBoard(selectedBoardId);
    if (result.ok) {
      const remaining = boards.filter((b) => b.id !== selectedBoardId);
      router.push(remaining[0] ? `/party?board=${remaining[0].id}` : "/party");
      router.refresh();
    }
  }

  async function handleCreateGroup() {
    if (!selectedBoardId) return;
    const name = window.prompt("New group name (e.g. Main Stage, Party A, team leader's name):");
    if (!name) return;
    const result = await createGroup(selectedBoardId, name);
    if (result.ok) router.refresh();
    else if (result.error) alert(result.error);
  }

  async function handleRenameGroup(groupId: string, currentName: string) {
    const name = window.prompt("Rename group:", currentName);
    if (!name) return;
    const result = await renameGroup(groupId, name);
    if (result.ok) router.refresh();
    else if (result.error) alert(result.error);
  }

  async function handleDeleteGroup(groupId: string, name: string) {
    if (!confirm(`Delete the entire "${name}" group (including every party inside it)? This cannot be undone.`)) return;
    const result = await deleteGroup(groupId);
    if (result.ok) router.refresh();
  }

  async function handleCreateParty(groupId: string) {
    const result = await createParty(groupId);
    if (result.ok) router.refresh();
    else if (result.error) alert(result.error);
  }

  async function handleDeleteParty(partyId: string, label: string) {
    if (!confirm(`Delete ${label}?`)) return;
    const result = await deleteParty(partyId);
    if (result.ok) router.refresh();
  }

  const placedCount = useMemo(() => {
    if (!board) return 0;
    return board.groups.reduce(
      (sum, g) => sum + g.parties.reduce((s, p) => s + p.slots.filter((sl) => sl.member).length, 0),
      0
    );
  }, [board]);

  const filteredUnassigned = useMemo(() => {
    if (!board) return [];
    const q = poolQuery.trim().toLowerCase();
    return board.unassigned.filter((m) => {
      if (poolClassFilter && m.className !== poolClassFilter) return false;
      if (q && !m.displayName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [board, poolQuery, poolClassFilter]);

  const activeGroup = board?.groups.find((g) => g.id === activeGroupId) ?? null;

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
          {effectiveAdmin && (
            <>
              <button
                type="button"
                onClick={handleCreateBoard}
                className="rounded-lg border border-dashed border-zinc-700 px-3 py-1.5 text-sm text-zinc-400 transition hover:border-amber-500 hover:text-amber-300"
              >
                + New Board
              </button>
            </>
          )}
        </div>

        {!board ? (
          <div className="rounded-xl border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-500">
            No boards yet{effectiveAdmin ? " — click \"+ New Board\" above to create one" : ""}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 text-xs text-zinc-400">
              <span>
                Board <span className="font-medium text-zinc-200">{board.name}</span> · {placedCount} placed
                {" "}· {board.unassigned.length} open · Busy / Leave {board.busy.length}
              </span>
              {isAdmin && (
                <div className="flex items-center gap-2">
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
                      <PostAttendanceButton boardId={selectedBoardId} boardName={board.name} />
                      <AnnounceBoardImageButton
                        boardId={selectedBoardId}
                        boardName={board.name}
                        lastChannelId={board.lastImageAnnounceChannelId}
                      />
                      <PartyTemplatePanel
                        boardId={selectedBoardId}
                        boardName={board.name}
                        onApplied={() => router.refresh()}
                      />
                      <button
                        type="button"
                        onClick={handleRenameBoard}
                        className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 transition hover:bg-zinc-800"
                      >
                        Rename Board
                      </button>
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

            {/* Unassigned pool — kept above the party grid (the "who's
                waiting" list, at a glance) so it's easy to drag/pick from
                while filling parties. Horizontal/compact with a generous
                but bounded height (most rosters fit with no scroll at all;
                a big one scrolls internally rather than shoving the party
                grid down). Hidden entirely in screenshot mode. */}
            {!screenshotMode && (
              <section>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-medium text-zinc-300">
                    Waiting to Join ({filteredUnassigned.length}
                    {filteredUnassigned.length !== board.unassigned.length ? ` / ${board.unassigned.length}` : ""})
                  </h2>
                  <input
                    type="text"
                    value={poolQuery}
                    onChange={(e) => setPoolQuery(e.target.value)}
                    placeholder="Search name..."
                    className="w-32 flex-1 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none sm:max-w-40"
                  />
                  <select
                    value={poolClassFilter}
                    onChange={(e) => setPoolClassFilter(e.target.value)}
                    className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none"
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
                  maxHeightClass="max-h-[420px]"
                  tapTarget={effectiveAdmin && !!selectedMember}
                  onBackgroundClick={
                    effectiveAdmin && selectedMember ? () => handlePlaceSelected({ type: "unassigned" }) : undefined
                  }
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
                      draggable={effectiveAdmin}
                      selected={selectedMember?.id === member.id}
                      onSelect={effectiveAdmin ? () => handleToggleSelect(member) : undefined}
                    />
                  ))}
                </DroppableZone>
              </section>
            )}

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
                        : "grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3"
                    }
                  >
                    {activeGroup.parties.map((party) => (
                      <PartyCard
                        key={party.id}
                        party={party}
                        isAdmin={effectiveAdmin}
                        pickableMembers={board.unassigned}
                        onClassChange={handleClassChange}
                        onClear={handleClearSlot}
                        onAssign={handleAssignToSlot}
                        onSendBusy={handleSendBusy}
                        onDelete={handleDeleteParty}
                        stacked={screenshotMode}
                        selectedMember={selectedMember}
                        onSelectMember={effectiveAdmin ? handleToggleSelect : undefined}
                        onPlaceSelected={
                          effectiveAdmin
                            ? (partyId, slotIndex) => handlePlaceSelected({ type: "slot", partyId, slotIndex })
                            : undefined
                        }
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Busy/leave list — kept at the very bottom, out of the way of
                the party grid. In screenshot mode this switches to a plain
                read-only name list (no drag/picker/remove controls) instead
                of hiding entirely — the summary bar above only shows a
                count, so without this, anyone reading the posted screenshot
                has no way to tell WHO is busy/on leave vs. just missing. */}
            <section>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-medium text-zinc-300">Busy / Leave ({board.busy.length})</h2>
                {effectiveAdmin && (
                  <MemberPicker
                    members={board.unassigned}
                    onSelect={handleAssignBusy}
                    emptyLabel="No one is open anymore"
                    align="right"
                    trigger={
                      <span className="cursor-pointer select-none rounded-lg border border-dashed border-zinc-700 px-2 py-1 text-xs text-zinc-400 transition hover:border-amber-500 hover:text-amber-300">
                        + Add to Busy/Leave
                      </span>
                    }
                  />
                )}
              </div>
              {screenshotMode ? (
                <div className="flex flex-wrap gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900/40 p-2">
                  {board.busy.length === 0 ? (
                    <span className="px-1 py-1 text-xs text-zinc-600">No one is Busy/Leave this round</span>
                  ) : (
                    board.busy.map((member) => (
                      <MemberChip key={member.id} member={member} draggable={false} compact showClassBadge />
                    ))
                  )}
                </div>
              ) : (
                <DroppableZone
                  id="busy"
                  label="Busy / Leave"
                  tapTarget={effectiveAdmin && !!selectedMember}
                  onBackgroundClick={
                    effectiveAdmin && selectedMember ? () => handlePlaceSelected({ type: "busy" }) : undefined
                  }
                >
                  {board.busy.length === 0 && (
                    <span className="px-1 py-1 text-xs text-zinc-600">
                      Drag a name here, or click &quot;+ Add to Busy/Leave&quot; to mark someone unavailable/on leave
                      this round (or tap a name, then tap here)
                    </span>
                  )}
                  {board.busy.map((member) => (
                    <div key={member.id} className="flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-800/80 py-1 pl-1.5 pr-1">
                      <MemberChip
                        member={member}
                        draggable={effectiveAdmin}
                        compact
                        showClassBadge={!effectiveAdmin}
                        selected={selectedMember?.id === member.id}
                        onSelect={effectiveAdmin ? () => handleToggleSelect(member) : undefined}
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
                            title="Remove from Busy/Leave list"
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
