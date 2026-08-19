"use client";

import Image from "next/image";
import { useDraggable } from "@dnd-kit/core";
import { classColors } from "@/lib/classes";
import type { PartyBoardMemberRef } from "@/lib/party-data";

interface MemberChipProps {
  member: PartyBoardMemberRef;
  className?: string | null;
  draggable?: boolean;
  compact?: boolean;
  showClassBadge?: boolean;
}

/** A draggable chip representing one member, used in the pool, busy list, and party slots. */
export function MemberChip({
  member,
  className = null,
  draggable = true,
  compact = false,
  showClassBadge = true,
}: MemberChipProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `member-${member.id}`,
    data: { member, className },
    disabled: !draggable,
  });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

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
        <Image
          src={member.discordAvatar ?? "https://cdn.discordapp.com/embed/avatars/0.png"}
          alt={member.displayName}
          fill
          unoptimized
          sizes={compact ? "18px" : "22px"}
          className="object-cover"
        />
      </span>
      <span className="min-w-0 flex-1 truncate font-medium text-zinc-100">{member.displayName}</span>
      {showClassBadge && className && (
        <span
          className={`shrink-0 rounded px-1 py-0.5 text-[10px] font-medium ${
            classColors[className] ?? "bg-zinc-700 text-zinc-300"
          }`}
        >
          {className}
        </span>
      )}
    </div>
  );
}
