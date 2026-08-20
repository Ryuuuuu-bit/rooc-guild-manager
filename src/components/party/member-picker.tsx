"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { classColors } from "@/lib/classes";
import { ClassIcon } from "@/components/class-icon";
import type { PartyBoardMemberRef } from "@/lib/party-data";

interface MemberPickerProps {
  members: PartyBoardMemberRef[];
  onSelect: (memberId: string) => void;
  trigger: React.ReactNode;
  align?: "left" | "right";
  emptyLabel?: string;
}

/**
 * A small searchable popover for picking a member directly (as an
 * alternative to dragging) — used for assigning an empty party slot or
 * adding someone to the busy/leave list. Filters by name or class.
 */
export function MemberPicker({ members, onSelect, trigger, align = "left", emptyLabel = "ไม่มีรายชื่อ" }: MemberPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  function toggleOpen() {
    const next = !open;
    setOpen(next);
    if (next) setQuery("");
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q
      ? members.filter(
          (m) => m.displayName.toLowerCase().includes(q) || (m.className ?? "").toLowerCase().includes(q)
        )
      : members;
    return pool.slice(0, 50);
  }, [members, query]);

  return (
    <div ref={containerRef} className="relative inline-block">
      <span onClick={toggleOpen}>{trigger}</span>
      {open && (
        <div
          className={`absolute z-50 mt-1 w-60 rounded-lg border border-zinc-700 bg-zinc-900 p-1.5 shadow-xl ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ค้นหาชื่อ / class..."
            className="mb-1.5 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none"
          />
          <div className="max-h-56 overflow-auto">
            {filtered.length === 0 && <p className="px-2 py-2 text-xs text-zinc-500">{emptyLabel}</p>}
            {filtered.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  onSelect(m.id);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs text-zinc-200 transition hover:bg-zinc-800"
              >
                <span className="relative h-4 w-4 shrink-0 overflow-hidden rounded-full ring-1 ring-zinc-700">
                  <Image
                    src={m.discordAvatar ?? "https://cdn.discordapp.com/embed/avatars/0.png"}
                    alt={m.displayName}
                    fill
                    unoptimized
                    sizes="16px"
                    className="object-cover"
                  />
                </span>
                <span className="min-w-0 flex-1 truncate">{m.displayName}</span>
                {m.className && (
                  <span
                    className={`inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-medium ${
                      classColors[m.className] ?? "bg-zinc-700 text-zinc-300"
                    }`}
                  >
                    <ClassIcon job={m.className} size={9} />
                    {m.className}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
