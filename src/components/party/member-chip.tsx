"use client";

import { useDraggable } from "@dnd-kit/core";
import { useJobClasses } from "@/components/job-classes-provider";
import { ClassIcon } from "@/components/class-icon";
import { MemberAvatar } from "@/components/member-avatar";
import type { PartyBoardMemberRef } from "@/lib/party-data";
import { fmtCp } from "./party-board-logic";

interface MemberChipProps {
  member: PartyBoardMemberRef;
  draggable?: boolean;
  compact?: boolean;
  showClassBadge?: boolean;
  /** Puts the class badge on its own row below the name instead of beside it.
   * Used in screenshot mode, where the board is forced to a fixed 8-column
   * grid — at that width, avatar + name + badge side-by-side left almost no
   * room for the name (it's the only flexible element, so it absorbed the
   * squeeze and truncated to 1-2 characters). Stacking trades a bit of
   * vertical space, which the card has plenty of, for the name staying
   * readable, which is the whole point of the screenshot. */
  stacked?: boolean;
  /** Tap-to-move alternative to dragging (see PartyBoardView's selection
   * state) — a separate onClick alongside dnd-kit's pointer listeners, not
   * a replacement for drag. dnd-kit only wires up pointer/keyboard
   * listeners, never onClick, so the two never fight over the same event. */
  selected?: boolean;
  onSelect?: () => void;
  /** Leave v2: the member is on leave for this round. Rendered faded with
   * the name struck through; in a party slot they keep their place. */
  onLeave?: boolean;
  /** Distinguishes two draggables for the SAME member on one board (an
   * on-leave member sits in their slot AND in the ลา zone) — dnd-kit needs
   * unique ids. Also carried in the drag data so the drop handler knows a
   * drag came out of the ลา zone (= cancel the leave). */
  dragContext?: "busy";
  /** Shows their latest PVP CP ("412k") after the name — hidden when undefined. */
  cp?: number | null;
}

/** A draggable chip representing one member, used in the pool, busy list, and party slots. */
export function MemberChip({
  member,
  draggable = true,
  compact = false,
  showClassBadge = true,
  stacked = false,
  selected = false,
  onSelect,
  onLeave = false,
  dragContext,
  cp,
}: MemberChipProps) {
  const { colorClassOf } = useJobClasses();
  const className = member.className;
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: dragContext ? `member-${member.id}-${dragContext}` : `member-${member.id}`,
    data: { member, fromBusy: dragContext === "busy" },
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
      onClick={
        onSelect
          ? (e) => {
              e.stopPropagation();
              onSelect();
            }
          : undefined
      }
      className={`flex rounded-lg border px-2 py-1.5 text-xs ${
        selected ? "border-amber-400 bg-amber-500/15 ring-1 ring-amber-400" : "border-zinc-700 bg-zinc-800/80"
      } ${stacked ? "flex-col gap-1" : "items-center gap-1.5"} ${isDragging ? "z-50 opacity-40" : ""} ${
        draggable ? "touch-none cursor-grab select-none active:cursor-grabbing" : ""
      } ${onLeave && !isDragging ? "opacity-45" : ""}`}
      title={
        onLeave
          ? `${member.displayName} — ลารอบนี้`
          : member.altClasses.length
            ? `${member.displayName} — รอง: ${member.altClasses.join(", ")}`
            : undefined
      }
    >
      {/* `contents` keeps the avatar+name acting as direct flex children when
       * not stacked (unchanged layout); when stacked they form their own row. */}
      <div className={stacked ? "flex min-w-0 items-center gap-1.5" : "contents"}>
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
        <span className={`min-w-0 flex-1 truncate font-medium text-zinc-100 ${onLeave ? "line-through decoration-amber-400/70" : ""}`}>
          {member.displayName}
        </span>
      </div>
      {cp !== undefined && !stacked && (
        <span className="shrink-0 text-[10px] tabular-nums text-zinc-500" title={cp == null ? "No PVP stats on file" : `CP ${cp.toLocaleString("en-US")}`}>
          {fmtCp(cp)}
        </span>
      )}
      {showClassBadge && className && (
        <span
          className={`inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-medium ${colorClassOf(className)} ${
            stacked ? "w-fit" : "shrink-0"
          }`}
        >
          <ClassIcon job={className} size={10} />
          {className}
        </span>
      )}
      {/* Secondary classes as emoji-only dots — fixed ~14px each, so two of
          them never push a 210px slot card or a wrapped pool chip out of
          shape; names live in the tooltip. Hidden in screenshot (stacked)
          mode, where only the main class matters. */}
      {!stacked && member.altClasses.length > 0 && (
        <span
          className="inline-flex shrink-0 items-center gap-px rounded-full bg-zinc-900/80 px-1 py-px ring-1 ring-inset ring-zinc-700/60"
          title={`เล่นได้ด้วย: ${member.altClasses.join(", ")}`}
          aria-label={`secondary classes: ${member.altClasses.join(", ")}`}
        >
          {member.altClasses.map((c) => (
            <ClassIcon key={c} job={c} size={compact ? 9 : 10} />
          ))}
        </span>
      )}
    </div>
  );
}
