"use client";

import { useMemo, useState, useTransition } from "react";
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
import { moveMember, setLeaderName, setMemberClass, resetPartyBoard, type PartyDestination } from "@/app/actions/party";
import type { PartyBoard, PartyBoardMemberRef } from "@/lib/party-data";

interface SlotState {
  member: PartyBoardMemberRef | null;
  className: string | null;
}

interface BoardState {
  slots: Record<string, SlotState>;
  busy: { member: PartyBoardMemberRef; className: string | null }[];
  unassigned: PartyBoardMemberRef[];
}

const MAIN_PARTIES = [1, 2, 3, 4, 5, 6, 7, 8];
const SUB_GROUPS = [
  { leaderGroup: 1, parties: [1, 2, 3, 4] },
  { leaderGroup: 2, parties: [5, 6, 7, 8] },
];
const SLOT_INDEXES = [0, 1, 2, 3, 4];

function slotKey(section: "MAIN" | "SUB", partyNumber: number, slotIndex: number) {
  return `${section}:${partyNumber}:${slotIndex}`;
}

function boardFromProp(initial: PartyBoard): BoardState {
  const slots: Record<string, SlotState> = {};
  for (const party of initial.mainParties) {
    for (const slot of party.slots) {
      slots[slotKey("MAIN", party.partyNumber, slot.slotIndex)] = {
        member: slot.member,
        className: slot.className,
      };
    }
  }
  for (const group of initial.subGroups) {
    for (const party of group.parties) {
      for (const slot of party.slots) {
        slots[slotKey("SUB", party.partyNumber, slot.slotIndex)] = {
          member: slot.member,
          className: slot.className,
        };
      }
    }
  }
  return { slots, busy: initial.busy, unassigned: initial.unassigned };
}

function parseDestination(id: string): PartyDestination | null {
  if (id === "busy") return { type: "busy" };
  if (id === "unassigned") return { type: "unassigned" };
  const match = id.match(/^slot:(MAIN|SUB):(\d+):(\d+)$/);
  if (match) {
    return {
      type: "slot",
      section: match[1] as "MAIN" | "SUB",
      partyNumber: Number(match[2]),
      slotIndex: Number(match[3]),
    };
  }
  return null;
}

function computeNext(
  prev: BoardState,
  member: PartyBoardMemberRef,
  carriedClassName: string | null,
  destination: PartyDestination
): BoardState {
  const slots = { ...prev.slots };
  for (const key of Object.keys(slots)) {
    if (slots[key].member?.id === member.id) {
      slots[key] = { member: null, className: null };
    }
  }
  let busy = prev.busy.filter((b) => b.member.id !== member.id);
  let unassigned = prev.unassigned.filter((u) => u.id !== member.id);

  if (destination.type === "slot") {
    const key = slotKey(destination.section, destination.partyNumber, destination.slotIndex);
    const occupant = slots[key]?.member ?? null;
    slots[key] = { member, className: carriedClassName };
    if (occupant && occupant.id !== member.id) {
      unassigned = [...unassigned, occupant];
    }
  } else if (destination.type === "busy") {
    busy = [...busy, { member, className: carriedClassName }];
  } else {
    unassigned = [...unassigned, member];
  }

  return { slots, busy, unassigned };
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

export function PartyBoardView({ initialBoard, isAdmin }: { initialBoard: PartyBoard; isAdmin: boolean }) {
  const [board, setBoard] = useState<BoardState>(() => boardFromProp(initialBoard));
  const [leaderNames, setLeaderNames] = useState<Record<number, string>>({
    1: initialBoard.subGroups.find((g) => g.leaderGroup === 1)?.leaderName ?? "",
    2: initialBoard.subGroups.find((g) => g.leaderGroup === 2)?.leaderName ?? "",
  });
  const [activeMember, setActiveMember] = useState<PartyBoardMemberRef | null>(null);
  const [, startTransition] = useTransition();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  function handleDragStart(event: DragStartEvent) {
    const data = event.active.data.current as { member?: PartyBoardMemberRef } | undefined;
    setActiveMember(data?.member ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveMember(null);
    const { active, over } = event;
    if (!over) return;

    const data = active.data.current as { member: PartyBoardMemberRef; className: string | null } | undefined;
    if (!data) return;
    const destination = parseDestination(String(over.id));
    if (!destination) return;

    setBoard((prev) => computeNext(prev, data.member, data.className, destination));

    startTransition(async () => {
      const result = await moveMember(data.member.id, destination, data.className ?? undefined);
      if (!result.ok) {
        alert(result.error ?? "ย้ายสมาชิกไม่สำเร็จ ลองใหม่อีกครั้ง");
        window.location.reload();
      }
    });
  }

  function handleClassChange(section: "MAIN" | "SUB", partyNumber: number, slotIndex: number, value: string) {
    const key = slotKey(section, partyNumber, slotIndex);
    const member = board.slots[key]?.member;
    if (!member) return;
    setBoard((prev) => ({
      ...prev,
      slots: { ...prev.slots, [key]: { member, className: value || null } },
    }));
    startTransition(async () => {
      await setMemberClass(member.id, value || null);
    });
  }

  function handleClear(section: "MAIN" | "SUB", partyNumber: number, slotIndex: number) {
    const key = slotKey(section, partyNumber, slotIndex);
    const member = board.slots[key]?.member;
    if (!member) return;
    setBoard((prev) => computeNext(prev, member, null, { type: "unassigned" }));
    startTransition(async () => {
      await moveMember(member.id, { type: "unassigned" });
    });
  }

  function handleBusyRemove(memberId: string) {
    const entry = board.busy.find((b) => b.member.id === memberId);
    if (!entry) return;
    setBoard((prev) => computeNext(prev, entry.member, entry.className, { type: "unassigned" }));
    startTransition(async () => {
      await moveMember(memberId, { type: "unassigned" });
    });
  }

  function handleLeaderNameBlur(leaderGroup: 1 | 2, value: string) {
    startTransition(async () => {
      await setLeaderName(leaderGroup, value);
    });
  }

  async function handleReset() {
    if (!confirm("ล้างปาตี้ทั้งหมดกลับเป็นค่าว่าง? การกระทำนี้ย้อนกลับไม่ได้")) return;
    const result = await resetPartyBoard();
    if (result.ok) window.location.reload();
  }

  const placedCount = useMemo(
    () => Object.values(board.slots).filter((s) => s.member).length,
    [board.slots]
  );

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 text-xs text-zinc-400">
          <span>
            ลงปาตี้แล้ว {placedCount} คน · ว่าง {board.unassigned.length} คน · ลา/ไม่ว่าง {board.busy.length} คน
          </span>
          {isAdmin && (
            <button
              type="button"
              onClick={handleReset}
              className="rounded-lg border border-rose-900/60 px-3 py-1.5 text-xs text-rose-400 transition hover:bg-rose-950/40"
            >
              ล้างปาตี้ทั้งหมด
            </button>
          )}
        </div>

        {/* Unassigned pool */}
        <section>
          <h2 className="mb-2 text-sm font-medium text-zinc-300">
            รอลงปาตี้ ({board.unassigned.length})
          </h2>
          <DroppableZone id="unassigned" label="รอลงปาตี้">
            {board.unassigned.length === 0 && (
              <span className="px-1 py-1 text-xs text-zinc-600">ไม่มีใครรอลงปาตี้</span>
            )}
            {board.unassigned.map((member) => (
              <MemberChip key={member.id} member={member} draggable={isAdmin} showClassBadge={false} />
            ))}
          </DroppableZone>
        </section>

        {/* Main Stage */}
        <section>
          <h2 className="mb-2 text-sm font-medium text-zinc-300">Main Stage</h2>
          <div className="overflow-x-auto rounded-xl border border-zinc-800">
            <div className="grid min-w-[1100px] grid-cols-8 gap-px bg-zinc-800">
              {MAIN_PARTIES.map((partyNumber) => (
                <div key={partyNumber} className="bg-sky-500/10 px-2 py-1.5 text-center text-xs font-semibold text-sky-300">
                  Party {partyNumber}
                </div>
              ))}
              {SLOT_INDEXES.map((slotIndex) =>
                MAIN_PARTIES.map((partyNumber) => {
                  const key = slotKey("MAIN", partyNumber, slotIndex);
                  const slot = board.slots[key] ?? { member: null, className: null };
                  return (
                    <div key={key} className="bg-zinc-950 p-1">
                      <PartySlot
                        id={`slot:MAIN:${partyNumber}:${slotIndex}`}
                        member={slot.member}
                        className={slot.className}
                        isAdmin={isAdmin}
                        onClassChange={(value) => handleClassChange("MAIN", partyNumber, slotIndex, value)}
                        onClear={() => handleClear("MAIN", partyNumber, slotIndex)}
                      />
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </section>

        {/* Sub Stage */}
        <section>
          <h2 className="mb-2 text-sm font-medium text-zinc-300">Sub Stage</h2>
          <div className="flex flex-col gap-4">
            {SUB_GROUPS.map((group) => (
              <div key={group.leaderGroup} className="overflow-x-auto rounded-xl border border-zinc-800">
                <div className="flex items-center gap-2 bg-violet-500/10 px-3 py-2 text-xs font-semibold text-violet-300">
                  <span>หัวหน้า:</span>
                  {isAdmin ? (
                    <input
                      type="text"
                      defaultValue={leaderNames[group.leaderGroup] ?? ""}
                      placeholder="ใส่ชื่อหัวหน้าทีม..."
                      onBlur={(e) => {
                        setLeaderNames((prev) => ({ ...prev, [group.leaderGroup]: e.target.value }));
                        handleLeaderNameBlur(group.leaderGroup as 1 | 2, e.target.value);
                      }}
                      className="rounded border border-violet-900/50 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 focus:border-violet-500 focus:outline-none"
                    />
                  ) : (
                    <span className="text-zinc-200">{leaderNames[group.leaderGroup] || "—"}</span>
                  )}
                </div>
                <div className="grid min-w-[600px] grid-cols-4 gap-px bg-zinc-800">
                  {group.parties.map((partyNumber) => (
                    <div key={partyNumber} className="bg-sky-500/10 px-2 py-1.5 text-center text-xs font-semibold text-sky-300">
                      Party {partyNumber}
                    </div>
                  ))}
                  {SLOT_INDEXES.map((slotIndex) =>
                    group.parties.map((partyNumber) => {
                      const key = slotKey("SUB", partyNumber, slotIndex);
                      const slot = board.slots[key] ?? { member: null, className: null };
                      return (
                        <div key={key} className="bg-zinc-950 p-1">
                          <PartySlot
                            id={`slot:SUB:${partyNumber}:${slotIndex}`}
                            member={slot.member}
                            className={slot.className}
                            isAdmin={isAdmin}
                            onClassChange={(value) => handleClassChange("SUB", partyNumber, slotIndex, value)}
                            onClear={() => handleClear("SUB", partyNumber, slotIndex)}
                          />
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Busy / on leave */}
        <section>
          <h2 className="mb-2 text-sm font-medium text-zinc-300">
            Busy / ลา ({board.busy.length})
          </h2>
          <DroppableZone id="busy" label="Busy หรือ ลา">
            {board.busy.length === 0 && (
              <span className="px-1 py-1 text-xs text-zinc-600">ลากรายชื่อมาวางที่นี่เพื่อบอกว่าไม่ว่าง/ลารอบนี้</span>
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

      <DragOverlay>
        {activeMember ? <MemberChip member={activeMember} draggable={false} showClassBadge={false} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
