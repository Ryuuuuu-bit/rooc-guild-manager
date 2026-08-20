"use client";

import { useDroppable } from "@dnd-kit/core";
import { MemberChip } from "./member-chip";
import { MemberPicker } from "./member-picker";
import { CLASS_OPTIONS } from "@/lib/classes";
import type { PartyBoardMemberRef } from "@/lib/party-data";

interface PartySlotProps {
  id: string;
  member: PartyBoardMemberRef | null;
  isAdmin: boolean;
  onClassChange: (value: string) => void;
  onClear: () => void;
  /** Unassigned members offered in the "pick a member" popover shown on an empty slot. */
  pickableMembers?: PartyBoardMemberRef[];
  onAssign?: (memberId: string) => void;
}

export function PartySlot({
  id,
  member,
  isAdmin,
  onClassChange,
  onClear,
  pickableMembers = [],
  onAssign,
}: PartySlotProps) {
  const { isOver, setNodeRef } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-[32px] items-center gap-1 rounded-md border border-dashed px-1 py-1 transition ${
        isOver ? "border-indigo-400 bg-indigo-500/10" : "border-zinc-800"
      }`}
    >
      {member ? (
        <div className="flex w-full flex-col gap-1">
          <MemberChip member={member} draggable={isAdmin} compact showClassBadge={!isAdmin} />
          {isAdmin && (
            <div className="flex items-center gap-1">
              <select
                value={member.className ?? ""}
                onChange={(e) => onClassChange(e.target.value)}
                className="w-0 min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-900 px-1 py-1 text-[10px] text-zinc-300 focus:border-indigo-500 focus:outline-none"
              >
                <option value="">- class -</option>
                {CLASS_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={onClear}
                title="เอาออกจากปาตี้"
                className="shrink-0 rounded px-1.5 py-1 text-[10px] text-zinc-500 transition hover:text-rose-400"
              >
                ✕
              </button>
            </div>
          )}
        </div>
      ) : isAdmin && onAssign ? (
        <MemberPicker
          members={pickableMembers}
          onSelect={onAssign}
          emptyLabel="ไม่มีคนว่างแล้ว"
          trigger={
            <span className="block w-full cursor-pointer select-none rounded px-1 py-1 text-center text-[10px] text-zinc-600 transition hover:text-indigo-300">
              + เลือกสมาชิก
            </span>
          }
        />
      ) : (
        <span className="w-full select-none text-center text-[10px] text-zinc-700">ว่าง</span>
      )}
    </div>
  );
}
