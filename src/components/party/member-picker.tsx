"use client";

import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useJobClasses } from "@/components/job-classes-provider";
import { ClassIcon } from "@/components/class-icon";
import { MemberAvatar } from "@/components/member-avatar";
import type { PartyBoardMemberRef } from "@/lib/party-data";

const POPOVER_WIDTH = 240;

interface MemberPickerProps {
  members: PartyBoardMemberRef[];
  onSelect: (memberId: string) => void;
  trigger: React.ReactNode;
  align?: "left" | "right";
  emptyLabel?: string;
  /** Controlled open state — omit to let the picker manage its own open/closed state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * A small searchable popover for picking a member directly (as an
 * alternative to dragging) — used for assigning an empty party slot or
 * adding someone to the busy/leave list. Filters by name or class; Enter
 * picks the top match for fast keyboard-only filling.
 *
 * Renders the dropdown into a portal at document.body, positioned with
 * `position: fixed` computed from the trigger's bounding rect. This lets it
 * escape any scrollable/overflow-hidden ancestor (party cards, the party
 * grid) instead of being clipped or hidden behind neighboring cards.
 */
export function MemberPicker({
  members,
  onSelect,
  trigger,
  align = "left",
  emptyLabel = "ไม่มีรายชื่อ",
  open: controlledOpen,
  onOpenChange,
}: MemberPickerProps) {
  const { colorClassOf } = useJobClasses();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;

  const [query, setQuery] = useState("");
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function updatePosition() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    let left = align === "right" ? rect.right - POPOVER_WIDTH : rect.left;
    left = Math.min(Math.max(left, 8), window.innerWidth - POPOVER_WIDTH - 8);
    const top = Math.min(rect.bottom + 4, window.innerHeight - 8);
    setPosition({ top, left });
  }

  useLayoutEffect(() => {
    if (open) updatePosition();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    window.addEventListener("resize", updatePosition);
    // capture:true so scrolling ANY ancestor (e.g. the party grid) repositions it
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Reset the search query as soon as the popover opens. Adjusting state
  // during render (rather than in an effect) avoids the setState-in-effect
  // cascading-render lint warning; the focus side effect below stays in a
  // real effect since it touches the DOM, not React state.
  const [syncedOpen, setSyncedOpen] = useState(open);
  if (open !== syncedOpen) {
    setSyncedOpen(open);
    if (open) setQuery("");
  }

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q
      ? members.filter(
          (m) => m.displayName.toLowerCase().includes(q) || (m.className ?? "").toLowerCase().includes(q)
        )
      : members;
    return pool.slice(0, 50);
  }, [members, query]);

  function select(memberId: string) {
    onSelect(memberId);
    setOpen(false);
  }

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && filtered.length > 0) {
      e.preventDefault();
      select(filtered[0].id);
    }
  }

  return (
    <>
      <span ref={triggerRef} onClick={() => setOpen(!open)}>
        {trigger}
      </span>
      {open &&
        position &&
        createPortal(
          <div
            ref={popoverRef}
            style={{ position: "fixed", top: position.top, left: position.left, width: POPOVER_WIDTH }}
            className="z-50 rounded-lg border border-zinc-700 bg-zinc-900 p-1.5 shadow-xl"
          >
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder="ค้นหาชื่อ / class... (Enter = เลือกคนแรก)"
              className="mb-1.5 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none"
            />
            <div className="max-h-56 overflow-auto">
              {filtered.length === 0 && <p className="px-2 py-2 text-xs text-zinc-500">{emptyLabel}</p>}
              {filtered.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => select(m.id)}
                  className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs text-zinc-200 transition hover:bg-zinc-800"
                >
                  <span className="relative h-4 w-4 shrink-0 overflow-hidden rounded-full ring-1 ring-zinc-700">
                    <MemberAvatar
                      src={m.discordAvatar}
                      alt={m.displayName}
                      fill
                      sizes="16px"
                      className="object-cover"
                    />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{m.displayName}</span>
                  {m.className && (
                    <span
                      className={`inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-medium ${colorClassOf(m.className)}`}
                    >
                      <ClassIcon job={m.className} size={9} />
                      {m.className}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
