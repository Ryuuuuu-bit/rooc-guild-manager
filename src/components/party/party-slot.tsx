"use client";

import { useDroppable } from "@dnd-kit/core";
import { MemberChip } from "./member-chip";
import { MemberPicker } from "./member-picker";
import { useJobClasses } from "@/components/job-classes-provider";
import type { PartyBoardMemberRef } from "@/lib/party-data";

interface PartySlotProps {
  id: string;
  member: PartyBoardMemberRef | null;
  isAdmin: boolean;
  onClassChange: (value: string) => void;
  onClear: () => void;
  /** Sends the currently-assigned member straight to the Busy/ลา list (skips "unassigned"). */
  onSendBusy?: () => void;
  /** Unassigned members offered in the "pick a member" popover shown on an empty slot. */
  pickableMembers?: PartyBoardMemberRef[];
  onAssign?: (memberId: string) => void;
  /** Controlled open state for the empty-slot member picker — lets the parent auto-advance to the next empty slot. */
  pickerOpen?: boolean;
  onPickerOpenChange?: (open: boolean) => void;
  /** Screenshot mode's forced 8-column grid is much narrower — stack the
   * member chip's class badge below the name instead of beside it so the
   * name stays readable. See MemberChip's `stacked` prop. */
  stacked?: boolean;
  /** Tap-to-move (see PartyBoardView): the pending selection, if any; a way
   * to select the member sitting in this slot; and a way to drop the
   * pending selection onto this slot (works whether it's empty or occupied
   * — occupied bumps the current occupant back to unassigned, same as
   * dragging one member onto another's slot already does). */
  selectedMember?: PartyBoardMemberRef | null;
  onSelectMember?: (member: PartyBoardMemberRef) => void;
  onPlaceSelected?: () => void;
}

export function PartySlot({
  id,
  member,
  isAdmin,
  onClassChange,
  onClear,
  onSendBusy,
  pickableMembers = [],
  onAssign,
  pickerOpen,
  onPickerOpenChange,
  stacked = false,
  selectedMember = null,
  onSelectMember,
  onPlaceSelected,
}: PartySlotProps) {
  const { isOver, setNodeRef } = useDroppable({ id });
  const { options: classOptions } = useJobClasses();

  // A pending selection makes every OTHER slot look tappable — the same
  // affordance drag gives via isOver, just driven by tap state instead.
  const isTapTarget = isAdmin && !!selectedMember && selectedMember.id !== member?.id;

  return (
    <div
      ref={setNodeRef}
      // min-h matches the occupied-slot state's natural height (member chip
      // + class-select/ลา/✕ row) — an empty slot reserves the same space
      // instead of being visibly shorter. Without this, clearing/filling a
      // slot changes that party card's height, which (when it's the
      // tallest card in its grid row) shrinks/grows the whole row and
      // shoves everything below it up or down with no scroll compensation
      // — reported as the page "jumping" when clicking ✕.
      className={`flex min-h-[77px] items-center gap-1 rounded-md border border-dashed px-1.5 py-1.5 transition ${
        isOver || isTapTarget ? "border-amber-400 bg-amber-500/10" : "border-zinc-800"
      }`}
    >
      {member ? (
        <div className="flex w-full flex-col gap-1">
          <MemberChip
            member={member}
            draggable={isAdmin}
            compact
            showClassBadge={!isAdmin}
            stacked={stacked}
            selected={selectedMember?.id === member.id}
            onSelect={
              isAdmin && onSelectMember
                ? () => (isTapTarget && onPlaceSelected ? onPlaceSelected() : onSelectMember(member))
                : undefined
            }
          />
          {isAdmin && (
            <div className="flex items-center gap-1">
              <select
                value={member.className ?? ""}
                onChange={(e) => onClassChange(e.target.value)}
                className="w-0 min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-900 px-1 py-1.5 text-[10px] text-zinc-300 focus:border-amber-500 focus:outline-none"
              >
                <option value="">- อาชีพ -</option>
                {classOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              {onSendBusy && (
                <button
                  type="button"
                  onClick={onSendBusy}
                  title="ย้ายไปรายชื่อลา/ไม่ว่าง"
                  className="shrink-0 rounded px-1.5 py-1.5 text-[10px] text-zinc-500 transition hover:text-amber-400"
                >
                  ลา
                </button>
              )}
              <button
                type="button"
                onClick={onClear}
                title="เอาออกจากปาร์ตี้"
                className="shrink-0 rounded px-1.5 py-1.5 text-[10px] text-zinc-500 transition hover:text-rose-400"
              >
                ✕
              </button>
            </div>
          )}
        </div>
      ) : isAdmin && isTapTarget && onPlaceSelected ? (
        // A selection is already pending (tapped elsewhere) — skip the
        // search picker below and place them here in one tap.
        <button
          type="button"
          onClick={onPlaceSelected}
          className="block w-full rounded px-1 py-1.5 text-center text-[10px] font-medium text-amber-300 transition hover:text-amber-200"
        >
          วางที่นี่
        </button>
      ) : isAdmin && onAssign ? (
        <MemberPicker
          members={pickableMembers}
          onSelect={onAssign}
          emptyLabel="ไม่มีคนว่างแล้ว"
          open={pickerOpen}
          onOpenChange={onPickerOpenChange}
          trigger={
            <span className="block w-full cursor-pointer select-none rounded px-1 py-1.5 text-center text-[10px] text-zinc-600 transition hover:text-amber-300">
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
