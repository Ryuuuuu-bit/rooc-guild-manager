"use client";

import { useDroppable } from "@dnd-kit/core";
import { MemberChip } from "./member-chip";
import { CLASS_OPTIONS } from "@/lib/classes";
import type { PartyBoardMemberRef } from "@/lib/party-data";

interface PartySlotProps {
  id: string;
  member: PartyBoardMemberRef | null;
  className: string | null;
  isAdmin: boolean;
  onClassChange: (value: string) => void;
  onClear: () => void;
}

export function PartySlot({ id, member, className, isAdmin, onClassChange, onClear }: PartySlotProps) {
  const { isOver, setNodeRef } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-[32px] items-center gap-1 rounded-md border border-dashed px-1 py-1 transition ${
        isOver ? "border-indigo-400 bg-indigo-500/10" : "border-zinc-800"
      }`}
    >
      {member ? (
        <div className="flex w-full items-center gap-1">
          <div className="min-w-0 flex-1">
            <MemberChip member={member} className={className} draggable={isAdmin} compact showClassBadge={!isAdmin} />
          </div>
          {isAdmin && (
            <>
              <select
                value={className ?? ""}
                onChange={(e) => onClassChange(e.target.value)}
                className="w-[68px] shrink-0 rounded border border-zinc-700 bg-zinc-900 px-1 py-1 text-[10px] text-zinc-300 focus:border-indigo-500 focus:outline-none"
              >
                <option value="">-</option>
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
                className="shrink-0 rounded px-1 text-zinc-500 transition hover:text-rose-400"
              >
                ✕
              </button>
            </>
          )}
        </div>
      ) : (
        <span className="w-full select-none text-center text-[10px] text-zinc-700">ว่าง</span>
      )}
    </div>
  );
}
