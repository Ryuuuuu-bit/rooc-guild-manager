"use client";

import type { CSSProperties } from "react";
import { useDraggable } from "@dnd-kit/core";
import { useJobClasses } from "@/components/job-classes-provider";
import { ClassIcon } from "@/components/class-icon";
import { MemberAvatar } from "@/components/member-avatar";
import type { PartyBoardMemberRef } from "@/lib/party-data";

interface MemberChipProps {
  member: PartyBoardMemberRef;
  draggable?: boolean;
  compact?: boolean;
  showClassBadge?: boolean;
  /** Set false for the DragOverlay's ghost clone — it's a second, ephemeral
   * instance of this member that briefly exists on screen at the same time
   * as the "real" chip while a drag is in progress. If both carried the same
   * viewTransitionName, the browser sees two elements claiming one identity
   * and aborts the transition outright (confirmed via testing: logs
   * "Unexpected duplicate view-transition-name" and falls back to an instant
   * snap) — on every real pointer-drag, not just the click-based add/remove
   * paths. Only the persistent chip (pool/slot/busy list) should carry the
   * name; the overlay clone doesn't need one since it's discarded on drop
   * anyway, never part of the "before/after" board state being animated. */
  enableViewTransition?: boolean;
}

/** A draggable chip representing one member, used in the pool, busy list, and party slots. */
export function MemberChip({
  member,
  draggable = true,
  compact = false,
  showClassBadge = true,
  enableViewTransition = true,
}: MemberChipProps) {
  const { colorClassOf } = useJobClasses();
  const className = member.className;
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `member-${member.id}`,
    data: { member },
    disabled: !draggable,
  });

  const style: CSSProperties = {
    // Named so the View Transition triggered around each board update (see
    // placeMember in party-board.tsx) can match "this same member" across
    // their old and new DOM position and animate a smooth glide/morph
    // between them, instead of an instant snap. See enableViewTransition
    // above for why this must be omitted on the DragOverlay clone.
    ...(enableViewTransition ? { viewTransitionName: `member-${member.id}` } : {}),
    ...(transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : {}),
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(draggable ? listeners : {})}
      {...(draggable ? attributes : {})}
      className={`flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800/80 px-2 py-1.5 text-xs ${
        isDragging ? "z-50 opacity-40" : ""
      } ${draggable ? "touch-none cursor-grab select-none active:cursor-grabbing" : ""}`}
    >
      <span
        className={`relative inline-block shrink-0 overflow-hidden rounded-full ring-1 ring-zinc-700 ${
          compact ? "h-[18px] w-[18px]" : "h-[22px] w-[22px]"
        }`}
        style={{ minWidth: compact ? 18 : 22, minHeight: compact ? 18 : 22 }}
      >
        <MemberAvatar
          src={member.discordAvatar}
          alt={member.displayName}
          fill
          sizes={compact ? "18px" : "22px"}
          className="object-cover"
        />
      </span>
      <span className="min-w-0 flex-1 truncate font-medium text-zinc-100">{member.displayName}</span>
      {showClassBadge && className && (
        <span
          className={`inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-medium ${colorClassOf(className)}`}
        >
          <ClassIcon job={className} size={10} />
          {className}
        </span>
      )}
    </div>
  );
}
