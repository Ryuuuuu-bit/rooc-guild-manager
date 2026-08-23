"use client";

import { useMemo, useState, useTransition } from "react";
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

function parseDestination(id: string): PartyDestination | null {
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
}) {
  const { isOver, setNodeRef } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`flex ${maxHeightClass} min-h-[52px] flex-wrap content-start gap-1.5 overflow-y-auto rounded-xl border p-2 transition ${
        isOver ? "border-amber-400 bg-amber-500/10" : "border-zinc-800 bg-zinc-900/40"
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
}

/** One party as a self-contained card (header + 5 slot rows) so cards can wrap freely regardless of party count. */
function PartyCard({ party, isAdmin, pickableMembers, onClassChange, onClear, onAssign, onSendBusy, onDelete, stacked = false }: PartyCardProps) {
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
              title={`ลบ ${party.label}`}
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
    setActiveGroupId((prev) =>
      initialBoard?.groups.some((g) => g.id === prev) ? prev : initialBoard?.groups[0]?.id ?? null
    );
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

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
        alert(result.error ?? "ย้ายสมาชิกไม่สำเร็จ ลองใหม่อีกครั้ง");
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
    if (!confirm("ล้างกระดานนี้ทั้งหมดกลับเป็นค่าว่าง? การกระทำนี้ย้อนกลับไม่ได้")) return;
    const result = await resetPartyBoard(selectedBoardId);
    if (result.ok) router.refresh();
  }

  async function handleCreateBoard() {
    const name = window.prompt("ชื่อกระดานใหม่ (เช่น GVG, ปกติ, Event พิเศษ):");
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
    const name = window.prompt("เปลี่ยนชื่อกระดาน:", board.name);
    if (!name) return;
    const result = await renameBoard(selectedBoardId, name);
    if (result.ok) router.refresh();
    else if (result.error) alert(result.error);
  }

  async function handleDeleteBoard() {
    if (!board || !selectedBoardId) return;
    if (!confirm(`ลบกระดาน "${board.name}" ทั้งหมด? การกระทำนี้ย้อนกลับไม่ได้`)) return;
    const result = await deleteBoard(selectedBoardId);
    if (result.ok) {
      const remaining = boards.filter((b) => b.id !== selectedBoardId);
      router.push(remaining[0] ? `/party?board=${remaining[0].id}` : "/party");
      router.refresh();
    }
  }

  async function handleCreateGroup() {
    if (!selectedBoardId) return;
    const name = window.prompt("ชื่อกลุ่มใหม่ (เช่น Main Stage, Party A, ชื่อหัวหน้าทีม):");
    if (!name) return;
    const result = await createGroup(selectedBoardId, name);
    if (result.ok) router.refresh();
    else if (result.error) alert(result.error);
  }

  async function handleRenameGroup(groupId: string, currentName: string) {
    const name = window.prompt("เปลี่ยนชื่อกลุ่ม:", currentName);
    if (!name) return;
    const result = await renameGroup(groupId, name);
    if (result.ok) router.refresh();
    else if (result.error) alert(result.error);
  }

  async function handleDeleteGroup(groupId: string, name: string) {
    if (!confirm(`ลบกลุ่ม "${name}" ทั้งหมด (รวมทุก Party ข้างใน)? การกระทำนี้ย้อนกลับไม่ได้`)) return;
    const result = await deleteGroup(groupId);
    if (result.ok) router.refresh();
  }

  async function handleCreateParty(groupId: string) {
    const result = await createParty(groupId);
    if (result.ok) router.refresh();
    else if (result.error) alert(result.error);
  }

  async function handleDeleteParty(partyId: string, label: string) {
    if (!confirm(`ลบ ${label}?`)) return;
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
                + กระดานใหม่
              </button>
            </>
          )}
        </div>

        {!board ? (
          <div className="rounded-xl border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-500">
            ยังไม่มีกระดาน{effectiveAdmin ? " — กด \"+ กระดานใหม่\" ด้านบนเพื่อเริ่มสร้าง" : ""}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 text-xs text-zinc-400">
              <span>
                กระดาน <span className="font-medium text-zinc-200">{board.name}</span> · ลงปาร์ตี้แล้ว{" "}
                {placedCount} คน · ว่าง {board.unassigned.length} คน · Busy / ลา {board.busy.length} คน
              </span>
              {isAdmin && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setScreenshotMode((v) => !v)}
                    title="ซ่อนปุ่มจัดการทั้งหมด เหมาะสำหรับแคปภาพไปประกาศ"
                    className={`rounded-lg border px-2.5 py-1 text-xs transition ${
                      screenshotMode
                        ? "border-amber-500 bg-amber-500/10 text-amber-300"
                        : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                    }`}
                  >
                    {screenshotMode ? "✓ โหมดแคปภาพ" : "โหมดแคปภาพ"}
                  </button>
                  {effectiveAdmin && selectedBoardId && (
                    <>
                      <PostAttendanceButton boardId={selectedBoardId} boardName={board.name} />
                      <button
                        type="button"
                        onClick={handleRenameBoard}
                        className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 transition hover:bg-zinc-800"
                      >
                        เปลี่ยนชื่อกระดาน
                      </button>
                      <button
                        type="button"
                        onClick={handleReset}
                        className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 transition hover:bg-zinc-800"
                      >
                        ล้างกระดานนี้
                      </button>
                      <button
                        type="button"
                        onClick={handleDeleteBoard}
                        className="rounded-lg border border-rose-900/60 px-2.5 py-1 text-xs text-rose-400 transition hover:bg-rose-950/40"
                      >
                        ลบกระดานนี้
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
                    รอลงปาร์ตี้ ({filteredUnassigned.length}
                    {filteredUnassigned.length !== board.unassigned.length ? ` / ${board.unassigned.length}` : ""})
                  </h2>
                  <input
                    type="text"
                    value={poolQuery}
                    onChange={(e) => setPoolQuery(e.target.value)}
                    placeholder="ค้นหาชื่อ..."
                    className="w-32 flex-1 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none sm:max-w-40"
                  />
                  <select
                    value={poolClassFilter}
                    onChange={(e) => setPoolClassFilter(e.target.value)}
                    className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none"
                  >
                    <option value="">ทุกอาชีพ</option>
                    {classOptions.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <DroppableZone id="unassigned" label="รอลงปาร์ตี้" maxHeightClass="max-h-[420px]">
                  {filteredUnassigned.length === 0 && (
                    <span className="px-1 py-1 text-xs text-zinc-600">
                      {board.unassigned.length === 0 ? "ไม่มีใครรอลงปาร์ตี้" : "ไม่พบชื่อที่ตรงกับตัวกรอง"}
                    </span>
                  )}
                  {filteredUnassigned.map((member) => (
                    <MemberChip key={member.id} member={member} draggable={effectiveAdmin} />
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
                  {g.name} <span className="ml-1 text-xs text-zinc-500">{g.parties.length} ปาร์ตี้</span>
                </button>
              ))}
              {effectiveAdmin && (
                <button
                  type="button"
                  onClick={handleCreateGroup}
                  className="mb-1 rounded-lg border border-dashed border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 transition hover:border-amber-500 hover:text-amber-300"
                >
                  + กลุ่มใหม่
                </button>
              )}
            </div>

            {board.groups.length === 0 && (
              <div className="rounded-xl border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-500">
                ยังไม่มีกลุ่มในกระดานนี้{effectiveAdmin ? " — กด \"+ กลุ่มใหม่\" ด้านบน" : ""}
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
                        title="เปลี่ยนชื่อกลุ่ม"
                      >
                        ✎ {activeGroup.name}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCreateParty(activeGroup.id)}
                        className="rounded-lg border border-dashed border-zinc-700 px-2.5 py-1 text-xs text-zinc-400 transition hover:border-amber-500 hover:text-amber-300"
                      >
                        + ปาร์ตี้ใหม่
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteGroup(activeGroup.id, activeGroup.name)}
                        className="rounded-lg border border-rose-900/60 px-2.5 py-1 text-xs text-rose-400 transition hover:bg-rose-950/40"
                      >
                        ลบกลุ่มนี้
                      </button>
                    </div>
                  ) : (
                    <span className="text-sm font-medium text-zinc-300">{activeGroup.name}</span>
                  )}
                </div>

                {activeGroup.parties.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-500">
                    กลุ่มนี้ยังไม่มีปาร์ตี้{effectiveAdmin ? " — กด \"+ ปาร์ตี้ใหม่\" ด้านบน" : ""}
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
                <h2 className="text-sm font-medium text-zinc-300">Busy / ลา ({board.busy.length})</h2>
                {effectiveAdmin && (
                  <MemberPicker
                    members={board.unassigned}
                    onSelect={handleAssignBusy}
                    emptyLabel="ไม่มีคนว่างแล้ว"
                    align="right"
                    trigger={
                      <span className="cursor-pointer select-none rounded-lg border border-dashed border-zinc-700 px-2 py-1 text-xs text-zinc-400 transition hover:border-amber-500 hover:text-amber-300">
                        + เพิ่มคนลา
                      </span>
                    }
                  />
                )}
              </div>
              {screenshotMode ? (
                <div className="flex flex-wrap gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900/40 p-2">
                  {board.busy.length === 0 ? (
                    <span className="px-1 py-1 text-xs text-zinc-600">ไม่มีคน Busy/ลารอบนี้</span>
                  ) : (
                    board.busy.map((member) => (
                      <MemberChip key={member.id} member={member} draggable={false} compact showClassBadge />
                    ))
                  )}
                </div>
              ) : (
                <DroppableZone id="busy" label="Busy / ลา">
                  {board.busy.length === 0 && (
                    <span className="px-1 py-1 text-xs text-zinc-600">
                      ลากรายชื่อมาวางที่นี่ หรือกด &quot;+ เพิ่มคนลา&quot; เพื่อบอกว่าไม่ว่าง/ลารอบนี้
                    </span>
                  )}
                  {board.busy.map((member) => (
                    <div key={member.id} className="flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-800/80 py-1 pl-1.5 pr-1">
                      <MemberChip member={member} draggable={effectiveAdmin} compact showClassBadge={!effectiveAdmin} />
                      {effectiveAdmin && (
                        <>
                          <select
                            value={member.className ?? ""}
                            onChange={(e) => handleClassChange(member.id, e.target.value)}
                            className="rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-[10px] text-zinc-300 focus:border-amber-500 focus:outline-none"
                          >
                            <option value="">- อาชีพ -</option>
                            {classOptions.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => handleBusyRemove(member.id)}
                            title="เอาออกจากรายชื่อลา"
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
    </DndContext>
  );
}
