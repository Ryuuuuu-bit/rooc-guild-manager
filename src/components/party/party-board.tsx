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
import type { PartyBoardDetail, PartyBoardListItem, PartyBoardMemberRef } from "@/lib/party-data";

function parseDestination(id: string): PartyDestination | null {
  if (id === "busy") return { type: "busy" };
  if (id === "unassigned") return { type: "unassigned" };
  const match = id.match(/^slot:(.+):(\d+)$/);
  if (match) return { type: "slot", partyId: match[1], slotIndex: Number(match[2]) };
  return null;
}

function computeNext(
  prev: PartyBoardDetail,
  member: PartyBoardMemberRef,
  carriedClassName: string | null,
  destination: PartyDestination
): PartyBoardDetail {
  let groups = prev.groups.map((g) => ({
    ...g,
    parties: g.parties.map((p) => ({
      ...p,
      slots: p.slots.map((s) => (s.member?.id === member.id ? { ...s, member: null, className: null } : s)),
    })),
  }));

  let busy = prev.busy.filter((b) => b.member.id !== member.id);
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
            return { slotIndex: s.slotIndex, member, className: carriedClassName };
          }),
        };
      }),
    }));
    if (bumpedOccupant) unassigned = [...unassigned, bumpedOccupant];
  } else if (destination.type === "busy") {
    busy = [...busy, { member, className: carriedClassName }];
  } else {
    unassigned = [...unassigned, member];
  }

  return { ...prev, groups, busy, unassigned };
}

function DroppableZone({ id, children, label }: { id: string; children: React.ReactNode; label?: string }) {
  const { isOver, setNodeRef } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-[64px] flex-wrap gap-1.5 rounded-xl border p-2 transition ${
        isOver ? "border-indigo-400 bg-indigo-500/10" : "border-zinc-800 bg-zinc-900/40"
      }`}
      aria-label={label}
    >
      {children}
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
  const [board, setBoard] = useState<PartyBoardDetail | null>(initialBoard);
  const [activeMember, setActiveMember] = useState<PartyBoardMemberRef | null>(null);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(initialBoard?.groups[0]?.id ?? null);
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

  function handleDragStart(event: DragStartEvent) {
    const data = event.active.data.current as { member?: PartyBoardMemberRef } | undefined;
    setActiveMember(data?.member ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveMember(null);
    const { active, over } = event;
    if (!over || !board || !selectedBoardId) return;

    const data = active.data.current as { member: PartyBoardMemberRef; className: string | null } | undefined;
    if (!data) return;
    const destination = parseDestination(String(over.id));
    if (!destination) return;

    setBoard((prev) => (prev ? computeNext(prev, data.member, data.className, destination) : prev));

    startTransition(async () => {
      const result = await moveMember(selectedBoardId, data.member.id, destination, data.className ?? undefined);
      if (!result.ok) {
        alert(result.error ?? "ย้ายสมาชิกไม่สำเร็จ ลองใหม่อีกครั้ง");
        router.refresh();
      }
    });
  }

  function handleClassChange(partyId: string, slotIndex: number, value: string) {
    if (!board || !selectedBoardId) return;
    let memberId: string | null = null;
    setBoard((prev) => {
      if (!prev) return prev;
      const groups = prev.groups.map((g) => ({
        ...g,
        parties: g.parties.map((p) => {
          if (p.id !== partyId) return p;
          return {
            ...p,
            slots: p.slots.map((s) => {
              if (s.slotIndex !== slotIndex || !s.member) return s;
              memberId = s.member.id;
              return { ...s, className: value || null };
            }),
          };
        }),
      }));
      return { ...prev, groups };
    });
    if (memberId) {
      const id = memberId as string;
      startTransition(async () => {
        await setMemberClass(selectedBoardId, id, value || null);
      });
    }
  }

  function handleClearSlot(partyId: string, slotIndex: number) {
    if (!board || !selectedBoardId) return;
    let member: PartyBoardMemberRef | null = null;
    for (const g of board.groups) {
      for (const p of g.parties) {
        if (p.id !== partyId) continue;
        const slot = p.slots.find((s) => s.slotIndex === slotIndex);
        if (slot?.member) member = slot.member;
      }
    }
    if (!member) return;
    const m = member;
    setBoard((prev) => (prev ? computeNext(prev, m, null, { type: "unassigned" }) : prev));
    startTransition(async () => {
      await moveMember(selectedBoardId, m.id, { type: "unassigned" });
    });
  }

  function handleBusyRemove(memberId: string) {
    if (!board || !selectedBoardId) return;
    const entry = board.busy.find((b) => b.member.id === memberId);
    if (!entry) return;
    setBoard((prev) => (prev ? computeNext(prev, entry.member, entry.className, { type: "unassigned" }) : prev));
    startTransition(async () => {
      await moveMember(selectedBoardId, memberId, { type: "unassigned" });
    });
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
                  ? "bg-indigo-600 text-white"
                  : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              }`}
            >
              {b.name}
            </button>
          ))}
          {isAdmin && (
            <button
              type="button"
              onClick={handleCreateBoard}
              className="rounded-lg border border-dashed border-zinc-700 px-3 py-1.5 text-sm text-zinc-400 transition hover:border-indigo-500 hover:text-indigo-300"
            >
              + กระดานใหม่
            </button>
          )}
        </div>

        {!board ? (
          <div className="rounded-xl border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-500">
            ยังไม่มีกระดาน{isAdmin ? " — กด \"+ กระดานใหม่\" ด้านบนเพื่อเริ่มสร้าง" : ""}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 text-xs text-zinc-400">
              <span>
                กระดาน <span className="font-medium text-zinc-200">{board.name}</span> · ลงปาตี้แล้ว{" "}
                {placedCount} คน · ว่าง {board.unassigned.length} คน · ลา/ไม่ว่าง {board.busy.length} คน
              </span>
              {isAdmin && (
                <div className="flex items-center gap-2">
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
                </div>
              )}
            </div>

            {/* Unassigned pool + Busy list — always visible, never scroll out of view */}
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <section>
                <h2 className="mb-2 text-sm font-medium text-zinc-300">รอลงปาตี้ ({board.unassigned.length})</h2>
                <DroppableZone id="unassigned" label="รอลงปาตี้">
                  {board.unassigned.length === 0 && (
                    <span className="px-1 py-1 text-xs text-zinc-600">ไม่มีใครรอลงปาตี้</span>
                  )}
                  {board.unassigned.map((member) => (
                    <MemberChip key={member.id} member={member} draggable={isAdmin} showClassBadge={false} />
                  ))}
                </DroppableZone>
              </section>

              <section>
                <h2 className="mb-2 text-sm font-medium text-zinc-300">Busy / ลา ({board.busy.length})</h2>
                <DroppableZone id="busy" label="Busy หรือ ลา">
                  {board.busy.length === 0 && (
                    <span className="px-1 py-1 text-xs text-zinc-600">
                      ลากรายชื่อมาวางที่นี่เพื่อบอกว่าไม่ว่าง/ลารอบนี้
                    </span>
                  )}
                  {board.busy.map(({ member, className }) => (
                    <div key={member.id} className="flex items-center gap-1">
                      <MemberChip member={member} className={className} draggable={isAdmin} />
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => handleBusyRemove(member.id)}
                          title="เอาออกจากรายชื่อลา"
                          className="rounded px-1 text-xs text-zinc-500 transition hover:text-rose-400"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                </DroppableZone>
              </section>
            </div>

            {/* Group tabs */}
            <div className="flex flex-wrap items-center gap-1 border-b border-zinc-800">
              {board.groups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setActiveGroupId(g.id)}
                  className={`-mb-px rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium transition ${
                    g.id === activeGroupId
                      ? "border-indigo-500 text-indigo-300"
                      : "border-transparent text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {g.name} <span className="ml-1 text-xs text-zinc-500">{g.parties.length} party</span>
                </button>
              ))}
              {isAdmin && (
                <button
                  type="button"
                  onClick={handleCreateGroup}
                  className="mb-1 rounded-lg border border-dashed border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 transition hover:border-indigo-500 hover:text-indigo-300"
                >
                  + กลุ่มใหม่
                </button>
              )}
            </div>

            {board.groups.length === 0 && (
              <div className="rounded-xl border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-500">
                ยังไม่มีกลุ่มในกระดานนี้{isAdmin ? " — กด \"+ กลุ่มใหม่\" ด้านบน" : ""}
              </div>
            )}

            {activeGroup && (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {isAdmin ? (
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
                        className="rounded-lg border border-dashed border-zinc-700 px-2.5 py-1 text-xs text-zinc-400 transition hover:border-indigo-500 hover:text-indigo-300"
                      >
                        + เพิ่ม Party
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

                <div className="max-h-[60vh] overflow-auto rounded-xl border border-zinc-800">
                  {activeGroup.parties.length === 0 ? (
                    <div className="p-8 text-center text-sm text-zinc-500">
                      กลุ่มนี้ยังไม่มี party{isAdmin ? " — กด \"+ เพิ่ม Party\" ด้านบน" : ""}
                    </div>
                  ) : (
                    <div
                      className="grid gap-px bg-zinc-800"
                      style={{
                        gridTemplateColumns: `repeat(${activeGroup.parties.length}, minmax(150px, 1fr))`,
                      }}
                    >
                      {activeGroup.parties.map((party) => (
                        <div
                          key={party.id}
                          className="flex items-center justify-center gap-1 bg-sky-500/10 px-2 py-1.5 text-center text-xs font-semibold text-sky-300"
                        >
                          <span>{party.label}</span>
                          {isAdmin && (
                            <button
                              type="button"
                              onClick={() => handleDeleteParty(party.id, party.label)}
                              className="text-sky-400/60 hover:text-rose-400"
                              title={`ลบ ${party.label}`}
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      ))}
                      {[0, 1, 2, 3, 4].map((slotIndex) =>
                        activeGroup.parties.map((party) => {
                          const slot = party.slots.find((s) => s.slotIndex === slotIndex) ?? {
                            slotIndex,
                            member: null,
                            className: null,
                          };
                          return (
                            <div key={`${party.id}:${slotIndex}`} className="bg-zinc-950 p-1">
                              <PartySlot
                                id={`slot:${party.id}:${slotIndex}`}
                                member={slot.member}
                                className={slot.className}
                                isAdmin={isAdmin}
                                onClassChange={(value) => handleClassChange(party.id, slotIndex, value)}
                                onClear={() => handleClearSlot(party.id, slotIndex)}
                              />
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <DragOverlay>
        {activeMember ? <MemberChip member={activeMember} draggable={false} showClassBadge={false} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
