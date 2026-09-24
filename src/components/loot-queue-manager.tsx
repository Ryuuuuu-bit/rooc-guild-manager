"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { MemberAvatar } from "@/components/member-avatar";
import {
  addManyToLootQueue,
  addToLootQueue,
  createLootCategory,
  deleteLootCategory,
  deleteLootRoundHistory,
  moveLootCategory,
  moveLootQueueEntryToPosition,
  removeFromLootQueue,
  renameLootCategory,
  runLootRound,
  setLootCategoryNumberingBase,
  undoLootRound,
  type RunRoundResult,
} from "@/app/actions/loot-queue";
import type { LootCategoryView, LootQueueMemberRef, LootRoundView } from "@/lib/loot-queue-data";
import { uiAlert, uiConfirm } from "@/components/feedback";

// --- helpers -----------------------------------------------------------------

function fmtAgo(d: Date | string) {
  return formatDistanceToNow(new Date(d), { addSuffix: true });
}

/** "24/9" in Thai time — built by hand so server and browser render the same text. */
function fmtDayMonth(iso: Date | string): string {
  const d = new Date(new Date(iso).getTime() + 7 * 3600_000);
  return `${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
}

/** Passed over in a round but keeps their place — mirrors runLootRound's isBanned. */
const isSkipped = (m: LootQueueMemberRef) => m.isAuctionBanned || m.benched;

/** The next `n` people a round would serve, and anyone skipped on the way (mirrors runLootRound). */
function previewServe(queue: LootQueueMemberRef[], n: number) {
  const served: LootQueueMemberRef[] = [];
  const skipped: LootQueueMemberRef[] = [];
  if (n <= 0) return { served, skipped };
  for (const m of queue) {
    if (served.length >= n) break;
    if (isSkipped(m)) skipped.push(m);
    else served.push(m);
  }
  return { served, skipped };
}

/** Announcement text — one numbered name per line ("1.name"), bold header
 * set off by a blank line so back-to-back posts stay readable. `startNumber`
 * is 1 unless the category continues another category's numbering. */
function buildAnnouncementText(categoryName: string, label: string | null, names: string[], startNumber: number): string {
  const header = [label?.trim(), categoryName].filter(Boolean).join(" ");
  return `**${header}**\n\n${names.map((n, i) => `${startNumber + i}.${n}`).join("\n")}`;
}

function buildNamesText(categoryName: string, label: string | null, names: string[]): string {
  const header = [label?.trim(), categoryName].filter(Boolean).join(" ");
  return `**${header}**\n\n${names.join(", ")}`;
}

function buildMentionsText(categoryName: string, label: string | null, discordIds: string[]): string {
  const header = [label?.trim(), categoryName].filter(Boolean).join(" ");
  return `**${header}** — มารับของครับ\n${discordIds.map((id) => `<@${id}>`).join(" ")}`;
}

/** Clipboard write that reports failure (falls back to execCommand when the Clipboard API is missing). */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

/** Members served since the queue last wrapped: walk history newest → oldest until someone repeats. */
function servedThisLap(rounds: LootRoundView[]): Set<string> {
  const seen = new Set<string>();
  for (const r of rounds) {
    if (r.memberIds.some((id) => seen.has(id))) break;
    for (const id of r.memberIds) seen.add(id);
  }
  return seen;
}

function Avatar({ member, size = 24, online = false }: { member: Pick<LootQueueMemberRef, "discordAvatar" | "displayName">; size?: number; online?: boolean }) {
  return (
    <span className="relative inline-block shrink-0" style={{ width: size, height: size }}>
      <span className="block h-full w-full overflow-hidden rounded-full ring-1 ring-zinc-700">
        <MemberAvatar src={member.discordAvatar} alt="" width={size} height={size} className="h-full w-full object-cover" />
      </span>
      {online && <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-400 ring-2 ring-zinc-900" title="In voice now" />}
    </span>
  );
}

type Toast = { text: string; actionLabel?: string; onAction?: () => void } | null;

// --- Category cards ------------------------------------------------------------

function CategoryCards({ categories, selectedId, isAdmin }: { categories: LootCategoryView[]; selectedId: string | null; isAdmin: boolean }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const selectedIndex = categories.findIndex((c) => c.id === selectedId);
  const selected = categories[selectedIndex];

  function handleAdd() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    startTransition(async () => {
      const res = await createLootCategory(trimmed);
      if (!res.ok) return setError(res.error ?? "Failed to add");
      setNewName("");
      setAdding(false);
      setError(null);
      router.refresh();
    });
  }

  function handleRename() {
    const trimmed = renameValue.trim();
    if (!trimmed || !selected) return;
    startTransition(async () => {
      const res = await renameLootCategory(selected.id, trimmed);
      if (!res.ok) return setError(res.error ?? "Failed to rename");
      setRenaming(false);
      setError(null);
      router.refresh();
    });
  }

  async function handleDelete() {
    if (!selected) return;
    if (!(await uiConfirm({ title: `Delete "${selected.name}"?`, message: "Its queue and round history are deleted too. This cannot be undone.", confirmLabel: "Delete category", danger: true }))) return;
    deleteLootCategory(selected.id).then(() => {
      router.push("/loot-queue");
      router.refresh();
    });
  }

  function handleMove(direction: "up" | "down") {
    if (!selected) return;
    moveLootCategory(selected.id, direction).then((res) => {
      if (!res.ok) uiAlert(res.error ?? "Failed to reorder");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {categories.map((c) => {
          const next = c.queue.find((m) => !isSkipped(m));
          const on = c.id === selectedId;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => router.push(`/loot-queue?category=${c.id}`)}
              className={`min-w-[170px] max-w-[260px] shrink-0 rounded-xl border px-3 py-2 text-left transition ${
                on ? "border-amber-600 bg-gradient-to-b from-amber-600/20 to-amber-600/5" : "border-zinc-800 bg-zinc-900/60 hover:border-zinc-600"
              }`}
            >
              <span className="flex items-center gap-2 text-[13px] font-semibold text-zinc-100">
                <span className="truncate">{c.name}</span>
                <span className="ml-auto shrink-0 text-[11px] font-medium text-zinc-500">{c.queue.length}</span>
              </span>
              <span className="mt-0.5 block truncate text-[11px] text-zinc-500">
                ถัดไป <b className="font-semibold text-amber-300">{next?.displayName ?? "—"}</b>
                {" · "}
                {c.lastRound ? `${c.lastRound.label ?? "round"} ${fmtAgo(c.lastRound.createdAt)}` : "never run"}
              </span>
            </button>
          );
        })}
        {isAdmin &&
          (adding ? (
            <span className="flex shrink-0 items-center gap-1 rounded-xl border border-dashed border-zinc-700 px-2">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAdd();
                  if (e.key === "Escape") setAdding(false);
                }}
                placeholder="New category name"
                className="w-40 rounded-md border border-amber-500 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
              />
              <button type="button" disabled={pending} onClick={handleAdd} className="text-xs text-emerald-400 hover:text-emerald-300">
                ✓
              </button>
              <button type="button" onClick={() => setAdding(false)} className="text-xs text-zinc-500 hover:text-zinc-300">
                ✕
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="shrink-0 rounded-xl border border-dashed border-zinc-700 px-4 text-sm text-zinc-400 transition hover:border-amber-500 hover:text-amber-300"
            >
              + New Category
            </button>
          ))}
      </div>
      {isAdmin && selected && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
          {renaming ? (
            <>
              <input
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRename();
                  if (e.key === "Escape") setRenaming(false);
                }}
                className="w-48 rounded-md border border-amber-500 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 focus:outline-none"
              />
              <button type="button" onClick={handleRename} className="text-emerald-400 hover:text-emerald-300">
                Save
              </button>
              <button type="button" onClick={() => setRenaming(false)} className="hover:text-zinc-300">
                Cancel
              </button>
            </>
          ) : (
            <>
              <span>หมวดนี้:</span>
              <button type="button" disabled={selectedIndex <= 0} onClick={() => handleMove("up")} className="rounded px-1.5 py-0.5 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-30">
                ◀ Move left
              </button>
              <button
                type="button"
                disabled={selectedIndex >= categories.length - 1}
                onClick={() => handleMove("down")}
                className="rounded px-1.5 py-0.5 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-30"
              >
                Move right ▶
              </button>
              <button
                type="button"
                onClick={() => {
                  setRenameValue(selected.name);
                  setRenaming(true);
                }}
                className="rounded px-1.5 py-0.5 hover:bg-zinc-800 hover:text-amber-300"
              >
                ✎ Rename
              </button>
              <button type="button" onClick={handleDelete} className="rounded px-1.5 py-0.5 hover:bg-zinc-800 hover:text-rose-400">
                🗑 Delete
              </button>
            </>
          )}
        </div>
      )}
      {error && <p className="text-xs text-rose-400">{error}</p>}
    </div>
  );
}

// --- KPI strip ---------------------------------------------------------------------

function Kpi({ label, children, hint, tone }: { label: string; children: React.ReactNode; hint?: React.ReactNode; tone?: "warn" }) {
  return (
    <div className={`min-w-0 rounded-xl border bg-zinc-900/60 px-3 py-2.5 ${tone === "warn" ? "border-amber-400/35" : "border-zinc-800"}`}>
      <div className="truncate text-[10.5px] uppercase tracking-wider text-zinc-400">{label}</div>
      <div className="mt-0.5 text-xl font-bold tabular-nums text-zinc-50">{children}</div>
      {hint ? <div className="truncate text-[11px] text-zinc-500">{hint}</div> : null}
    </div>
  );
}

// --- Queue ---------------------------------------------------------------------

function QueuePositionInput({ rank, total, onCommit }: { rank: number; total: number; onCommit: (n: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(rank));

  function commit() {
    const n = Number(value);
    setEditing(false);
    if (Number.isInteger(n) && n >= 1 && n !== rank) onCommit(Math.min(n, total));
  }

  if (editing) {
    return (
      <input
        type="number"
        min={1}
        max={total}
        autoFocus
        value={value}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
        className="w-11 shrink-0 rounded border border-amber-500 bg-zinc-950 px-1 py-0.5 text-right text-xs text-zinc-100 focus:outline-none"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        setValue(String(rank));
        setEditing(true);
      }}
      title="Type a position to jump there"
      className="w-8 shrink-0 rounded px-1 text-right text-xs tabular-nums text-zinc-500 transition hover:bg-zinc-800 hover:text-amber-300"
    >
      {rank}
    </button>
  );
}

interface RowProps {
  member: LootQueueMemberRef;
  rank: number;
  total: number;
  isAdmin: boolean;
  online: boolean;
  /** Announcement number when this row is inside the preview cut, else null. */
  cutNumber: number | null;
  isNext: boolean;
  isMe: boolean;
  lastServedAt: string | undefined;
  searchState: "hit" | "dim" | null;
  onMoveTo: (rank: number) => void;
  onRemove: () => void;
}

function QueueRow({ member: m, rank, total, isAdmin, online, cutNumber, isNext, isMe, lastServedAt, searchState, onMoveTo, onRemove }: RowProps) {
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({ id: `lq-${m.id}`, data: { member: m }, disabled: !isAdmin });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `lq-${m.id}`, disabled: !isAdmin });
  const skipped = isSkipped(m);
  const banTitle = m.isAuctionBanned && m.auctionBanUntil
    ? `Auction-banned until ${m.auctionBanUntil.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" })} — holds their queue position, skipped in rounds`
    : "Benched — holds their queue position, skipped in rounds";
  return (
    <div
      ref={setDropRef}
      data-member-row={m.id}
      className={`group relative flex min-h-[38px] items-center gap-2 rounded-lg border px-2 py-1 transition ${
        cutNumber != null ? "border-amber-500/25 bg-amber-500/10" : "border-transparent bg-zinc-950/60 hover:border-zinc-700"
      } ${skipped ? "bg-[repeating-linear-gradient(135deg,rgba(244,63,94,0.07)_0_6px,transparent_6px_12px)]" : ""} ${
        searchState === "hit" ? "ring-2 ring-inset ring-sky-400" : searchState === "dim" ? "opacity-35" : ""
      } ${isMe ? "ring-1 ring-inset ring-sky-400/60" : ""} ${isOver && !isDragging ? "shadow-[0_-2px_0_#f59e0b]" : ""} ${isDragging ? "opacity-40" : ""}`}
    >
      {isAdmin && (
        <span
          ref={setDragRef}
          {...listeners}
          {...attributes}
          title="Drag to reorder"
          className="shrink-0 cursor-grab touch-none select-none px-0.5 text-xs tracking-[-2px] text-zinc-600 opacity-40 group-hover:opacity-100 active:cursor-grabbing"
        >
          ⋮⋮
        </span>
      )}
      {cutNumber != null ? (
        <span className="w-8 shrink-0 text-right text-xs font-bold tabular-nums text-amber-300" title={`Queue #${rank} — announced as ${cutNumber}.`}>
          {cutNumber}.
        </span>
      ) : isAdmin ? (
        <QueuePositionInput rank={rank} total={total} onCommit={onMoveTo} />
      ) : (
        <span className="w-8 shrink-0 text-right text-xs tabular-nums text-zinc-500">{rank}</span>
      )}
      <Avatar member={m} online={online} />
      <span className={`min-w-0 flex-1 truncate text-[13px] font-semibold ${skipped ? "text-zinc-400" : "text-zinc-100"}`}>{m.displayName}</span>
      {skipped && (
        <span title={banTitle} className="shrink-0 rounded-full bg-rose-500/15 px-1.5 py-px text-[10px] font-semibold text-rose-300">
          {m.isAuctionBanned ? "แบน · ข้าม" : "พัก · ข้าม"}
        </span>
      )}
      {isMe && <span className="shrink-0 rounded-full bg-sky-500/15 px-1.5 py-px text-[10px] font-semibold text-sky-300">คุณ</span>}
      {isNext && <span className="shrink-0 rounded-full bg-amber-500/20 px-1.5 py-px text-[10px] font-semibold text-amber-300">ถัดไป</span>}
      <span className={`shrink-0 text-[10.5px] ${lastServedAt ? "text-zinc-500" : "text-sky-300/80"}`} title={lastServedAt ? `Last served ${new Date(lastServedAt).toLocaleString("en-GB", { timeZone: "Asia/Bangkok" })}` : "Not served in recent history"}>
        {lastServedAt ? `ได้ ${fmtDayMonth(lastServedAt)}` : "ยังไม่เคยได้"}
      </span>
      {isAdmin && (
        <button type="button" onClick={onRemove} title="Remove from queue" className="shrink-0 px-1 text-xs text-zinc-600 opacity-0 transition hover:text-rose-400 group-hover:opacity-100">
          ✕
        </button>
      )}
    </div>
  );
}

function AddMemberChip({ member, online, onClick }: { member: LootQueueMemberRef; online: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Add ${member.displayName} to the back of the queue${online ? " (in voice)" : ""}`}
      className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800/80 px-2 py-1.5 text-xs transition hover:border-amber-500 hover:bg-zinc-800"
    >
      <Avatar member={member} size={20} online={online} />
      <span className="min-w-0 max-w-[9rem] truncate font-medium text-zinc-100">{member.displayName}</span>
    </button>
  );
}

// --- Run panel -------------------------------------------------------------------

function DiscordPreview({ text, empty }: { text: string | null; empty?: string }) {
  return (
    <div className="flex gap-2.5 rounded-lg bg-[#313338] px-3 py-2.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-600 to-violet-600 text-sm">🐉</div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-[#f2f3f5]">
          Divine <span className="ml-1 rounded bg-[#5865f2] px-1 align-[1px] text-[9.5px] font-semibold text-white">APP</span>
        </div>
        {text ? (
          <div className="mt-0.5 max-h-56 overflow-y-auto whitespace-pre-wrap break-words text-[12.5px] text-[#dbdee1]">
            {text.split("\n").map((line, i) =>
              /^\*\*.*\*\*/.test(line) ? (
                <div key={i} className="font-bold text-[#f2f3f5]">
                  {line.replace(/^\*\*(.*?)\*\*/, "$1")}
                </div>
              ) : (
                <div key={i}>{line || " "}</div>
              )
            )}
          </div>
        ) : (
          <div className="mt-0.5 text-[12.5px] text-[#949ba4]">{empty}</div>
        )}
      </div>
    </div>
  );
}

function NumberingSelect({ category, categories }: { category: LootCategoryView; categories: LootCategoryView[] }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const options = categories.filter((c) => c.id !== category.id);
  if (!options.length) return null;
  return (
    <select
      value={category.numberingBaseCategoryId ?? ""}
      disabled={saving}
      title="Continue numbering from another category's latest round (e.g. ขนนกหลากสี after ขนนกขาว)"
      onChange={(e) => {
        setSaving(true);
        setLootCategoryNumberingBase(category.id, e.target.value || null).then((res) => {
          setSaving(false);
          if (!res.ok) uiAlert(res.error ?? "Failed to save setting");
          router.refresh();
        });
      }}
      className="rounded-md border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-[11.5px] text-zinc-300 focus:border-amber-500 focus:outline-none disabled:opacity-50"
    >
      <option value="">เริ่ม 1 ทุกครั้ง</option>
      {options.map((c) => (
        <option key={c.id} value={c.id}>
          ต่อจาก {c.name}
        </option>
      ))}
    </select>
  );
}

interface RunPanelProps {
  category: LootCategoryView;
  categories: LootCategoryView[];
  queue: LootQueueMemberRef[];
  rounds: LootRoundView[];
  count: number;
  setCount: (n: number) => void;
  label: string;
  setLabel: (s: string) => void;
  labelSuggestions: { label: string; hint: "today" | "latest" | "next" }[];
  onToast: (t: Toast) => void;
}

function RunPanel({ category, categories, queue, rounds, count, setCount, label, setLabel, labelSuggestions, onToast }: RunPanelProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<(RunRoundResult & { label: string }) | null>(null);
  const [copied, setCopied] = useState<"idle" | "ok" | "fail">("idle");

  const eligible = queue.filter((m) => !isSkipped(m)).length;
  const { served, skipped } = previewServe(queue, count);
  const start = category.nextStartNumber;
  const previewText = served.length ? buildAnnouncementText(category.name, label, served.map((m) => m.displayName), start) : null;

  const countChips = [...new Set(rounds.map((r) => r.memberIds.length))].slice(0, 4);
  const labelChips = [
    ...labelSuggestions,
    ...rounds.map((r) => ({ label: r.label ?? "", hint: null as null })).filter((x) => x.label),
  ].filter((x, i, a) => a.findIndex((y) => y.label === x.label) === i).slice(0, 4);

  async function copy(text: string) {
    const ok = await copyToClipboard(text);
    setCopied(ok ? "ok" : "fail");
    setTimeout(() => setCopied("idle"), 2000);
  }

  function handleRun() {
    if (!served.length) return;
    setError(null);
    const runLabel = label;
    startTransition(async () => {
      try {
        const res = await runLootRound(category.id, count, runLabel);
        if (!res.ok) {
          setError(res.error ?? "Failed to run round");
          return;
        }
        setResult({ ...res, label: runLabel });
        setCount(0);
        setLabel("");
        const n = res.served?.length ?? 0;
        const s = res.startNumber ?? 1;
        const text = buildAnnouncementText(category.name, runLabel, (res.served ?? []).map((m) => m.displayName), s);
        const ok = await copyToClipboard(text);
        onToast({
          text: `รัน ${runLabel || "round"} — ${n} คน (${s}–${s + n - 1}) ย้ายไปท้ายคิวแล้ว${ok ? " · คัดลอกข้อความแล้ว ✓" : ""}`,
          actionLabel: res.roundId ? "Undo" : undefined,
          onAction: res.roundId ? () => undo(res.roundId!) : undefined,
        });
        router.refresh();
      } catch (err) {
        console.error("Failed to run loot round", err);
        setError("Failed to run round. Please try again.");
      }
    });
  }

  function undo(roundId: string) {
    startTransition(async () => {
      const res = await undoLootRound(roundId);
      if (!res.ok) {
        uiAlert(res.error ?? "Failed to undo");
        return;
      }
      setResult(null);
      onToast({ text: "Undo แล้ว — คืนตำแหน่งเดิมในคิว" });
      router.refresh();
    });
  }

  if (result?.served) {
    const n = result.served.length;
    const s = result.startNumber ?? 1;
    const text = buildAnnouncementText(category.name, result.label, result.served.map((m) => m.displayName), s);
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-emerald-900/60 bg-emerald-950/20 p-3">
        <div className="text-sm font-semibold text-emerald-300">
          ✓ รันแล้ว — {n} คน ({s}–{s + n - 1})
          {result.short && <span className="ml-1 font-normal text-amber-300">· คิวมีคนพร้อมไม่พอ ได้ทุกคนที่มี</span>}
        </div>
        {result.skippedBanned && result.skippedBanned.length > 0 && (
          <p className="text-xs text-rose-300">ข้าม {result.skippedBanned.map((m) => m.displayName).join(", ")} (แบน/พัก — คงตำแหน่งไว้)</p>
        )}
        <DiscordPreview text={text} />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => copy(text)}
            className={`rounded-lg border px-3 py-1.5 text-xs transition ${
              copied === "ok" ? "border-emerald-700 text-emerald-300" : copied === "fail" ? "border-rose-700 text-rose-300" : "border-zinc-700 text-zinc-200 hover:bg-zinc-800"
            }`}
          >
            {copied === "ok" ? "Copied ✓" : copied === "fail" ? "Copy failed — select manually" : "Copy message"}
          </button>
          {result.roundId && (
            <button type="button" disabled={pending} onClick={() => undo(result.roundId!)} className="rounded-lg border border-amber-700/60 px-3 py-1.5 text-xs text-amber-300 transition hover:bg-amber-950/40 disabled:opacity-40">
              ↶ Undo
            </button>
          )}
          <button type="button" onClick={() => setResult(null)} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition hover:bg-zinc-800">
            Run another round
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-semibold text-zinc-100">🎁 Run round</h2>
        <span className="truncate text-xs text-zinc-500">{category.name}</span>
      </div>
      <div>
        <div className="mb-1 text-[10.5px] uppercase tracking-wider text-zinc-400">จำนวนคนที่ได้รอบนี้</div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex shrink-0 items-center overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
            <button type="button" onClick={() => setCount(Math.max(0, count - 1))} className="h-9 w-9 text-lg text-zinc-300 hover:bg-zinc-800">
              −
            </button>
            <input
              type="number"
              min={0}
              value={count || ""}
              placeholder="0"
              onChange={(e) => setCount(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
              className="w-14 bg-transparent text-center text-lg font-bold text-zinc-50 [appearance:textfield] focus:outline-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <button type="button" onClick={() => setCount(count + 1)} className="h-9 w-9 text-lg text-zinc-300 hover:bg-zinc-800">
              +
            </button>
          </div>
          <div className="flex flex-wrap gap-1">
            {countChips.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setCount(n)}
                className={`rounded-full border px-2.5 py-0.5 text-xs ${n === count ? "border-amber-600 bg-amber-600/15 text-amber-200" : "border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-600"}`}
              >
                {n} <span className="text-[10px] text-zinc-500">ล่าสุด</span>
              </button>
            ))}
            {eligible > 0 && (
              <button type="button" onClick={() => setCount(eligible)} className="rounded-full border border-zinc-800 bg-zinc-950 px-2.5 py-0.5 text-xs text-zinc-300 hover:border-zinc-600">
                ทั้งคิว ({eligible})
              </button>
            )}
          </div>
        </div>
      </div>
      <div>
        <div className="mb-1 text-[10.5px] uppercase tracking-wider text-zinc-400">ชื่อรอบ</div>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="เช่น gl 24/9 (optional)"
          className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
        />
        {labelChips.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {labelChips.map((c) => (
              <button
                key={c.label}
                type="button"
                onClick={() => setLabel(c.label)}
                className={`rounded-full border px-2.5 py-0.5 text-xs ${c.label === label ? "border-amber-600 bg-amber-600/15 text-amber-200" : "border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-600"}`}
              >
                {c.label}
                {c.hint && <span className="ml-1 text-[10px] text-zinc-500">{c.hint === "today" ? "วันนี้" : c.hint === "latest" ? "ล่าสุด" : "ถัดไป"}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-zinc-400">
        เลขเริ่มที่ <b className="text-amber-300">{start}</b> · <NumberingSelect category={category} categories={categories} />
      </div>
      <div>
        <div className="mb-1 flex items-center gap-2 text-[10.5px] uppercase tracking-wider text-zinc-400">
          ตัวอย่างข้อความ Discord
          {skipped.length > 0 && <span className="ml-auto normal-case tracking-normal text-rose-300">ข้าม {skipped.map((m) => m.displayName).join(", ")}</span>}
          {count > eligible && eligible > 0 && <span className="ml-auto normal-case tracking-normal text-amber-300">มีคนพร้อมแค่ {eligible}</span>}
        </div>
        <DiscordPreview text={previewText} empty="ใส่จำนวนคนเพื่อดูตัวอย่าง…" />
      </div>
      {error && <p className="text-xs text-rose-400">{error}</p>}
      {queue.length === 0 && <p className="text-xs text-zinc-500">คิวของหมวดนี้ยังว่าง — เพิ่มสมาชิกก่อน</p>}
      <button
        type="button"
        disabled={!served.length || pending}
        onClick={handleRun}
        className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Running…" : served.length ? `Run — ${served.length} คนได้ของ (${start}–${start + served.length - 1})` : "Run round"}
      </button>
    </div>
  );
}

// --- History ------------------------------------------------------------------------

function CopyMenu({ round, categoryName, onCopied }: { round: LootRoundView; categoryName: string; onCopied: (msg: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const numbered = round.startNumber != null;
  const primary = numbered
    ? buildAnnouncementText(categoryName, round.label, round.names, round.startNumber!)
    : buildNamesText(categoryName, round.label, round.names);

  async function copy(text: string, what: string) {
    setOpen(false);
    const ok = await copyToClipboard(text);
    onCopied(ok ? `คัดลอก${what}แล้ว ✓` : "คัดลอกไม่สำเร็จ — ลองอีกครั้ง");
  }

  return (
    <div ref={ref} className="relative flex">
      <button type="button" onClick={() => copy(primary, numbered ? "ข้อความประกาศ" : "รายชื่อ")} className="rounded-l-md px-1.5 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-800" title={numbered ? "Copy the announcement exactly as posted (numbered)" : "Older round — no saved start number, copies the name list"}>
        Copy
      </button>
      <button type="button" onClick={() => setOpen((v) => !v)} className="rounded-r-md px-1 py-0.5 text-[11px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200" aria-label="More copy formats">
        ▾
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-lg border border-zinc-700 bg-zinc-950 p-1 shadow-xl shadow-black/50">
          <button
            type="button"
            disabled={!numbered}
            onClick={() => copy(primary, "ข้อความประกาศ")}
            className="block w-full rounded px-2 py-1.5 text-left text-xs text-zinc-200 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            ข้อความประกาศ (มีเลข)
            <span className="block text-[10.5px] text-zinc-500">{numbered ? `${round.startNumber}.ชื่อ … เหมือนตอนรัน` : "รอบเก่า — ไม่มีเลขที่บันทึกไว้"}</span>
          </button>
          <button type="button" onClick={() => copy(buildNamesText(categoryName, round.label, round.names), "รายชื่อ")} className="block w-full rounded px-2 py-1.5 text-left text-xs text-zinc-200 hover:bg-zinc-800">
            รายชื่อบรรทัดเดียว
            <span className="block text-[10.5px] text-zinc-500">ชื่อ, ชื่อ, ชื่อ …</span>
          </button>
          <button
            type="button"
            onClick={() => copy(buildMentionsText(categoryName, round.label, round.members.map((m) => m.discordId)), "แท็กทุกคน")}
            className="block w-full rounded px-2 py-1.5 text-left text-xs text-zinc-200 hover:bg-zinc-800"
          >
            แท็กทุกคน (@)
            <span className="block text-[10.5px] text-zinc-500">วางใน Discord แล้วเด้งแจ้งเตือนทุกคน</span>
          </button>
        </div>
      )}
    </div>
  );
}

function HistoryItem({ round, index, isAdmin, categoryName, onToast }: { round: LootRoundView; index: number; isAdmin: boolean; categoryName: string; onToast: (t: Toast) => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const n = round.memberIds.length;

  async function handleUndo() {
    if (!(await uiConfirm({ title: "Undo this round?", message: "Everyone served in it goes back to their previous queue position.", confirmLabel: "Undo round" }))) return;
    setBusy(true);
    undoLootRound(round.id).then((res) => {
      setBusy(false);
      if (!res.ok) uiAlert(res.error ?? "Failed to undo");
      else onToast({ text: `Undo ${round.label ?? "round"} แล้ว — คืนตำแหน่งเดิม` });
      router.refresh();
    });
  }

  async function handleDelete() {
    if (!(await uiConfirm({ title: "Delete this round from history?", message: "Queue positions are not affected.", confirmLabel: "Delete", danger: true }))) return;
    setBusy(true);
    deleteLootRoundHistory(round.id).then(() => {
      setBusy(false);
      router.refresh();
    });
  }

  return (
    <li className="border-t border-zinc-800 px-3 py-2.5 first:border-t-0">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded-full bg-amber-500/15 px-2 py-px text-[11.5px] font-semibold text-amber-300">{round.label ?? "round"}</span>
        <span className="text-xs font-semibold text-zinc-200">{n} คน</span>
        {round.startNumber != null && (
          <span className="text-[11px] tabular-nums text-zinc-500">
            #{round.startNumber}–{round.startNumber + n - 1}
          </span>
        )}
        <span className="text-[11px] text-zinc-500">
          {fmtDayMonth(round.createdAt)} · {fmtAgo(round.createdAt)}
        </span>
        <span className="ml-auto flex items-center gap-0.5">
          <CopyMenu round={round} categoryName={categoryName} onCopied={(msg) => onToast({ text: msg })} />
          {isAdmin && index === 0 && (
            <button type="button" disabled={busy} onClick={handleUndo} className="rounded-md px-1.5 py-0.5 text-[11px] text-amber-400 hover:bg-zinc-800 disabled:opacity-40">
              Undo
            </button>
          )}
          {isAdmin && (
            <button type="button" disabled={busy} onClick={handleDelete} className="rounded-md px-1.5 py-0.5 text-[11px] text-rose-400 hover:bg-zinc-800 disabled:opacity-40">
              Delete
            </button>
          )}
        </span>
      </div>
      <button type="button" onClick={() => setOpen((v) => !v)} className="mt-1.5 flex items-center" title="Show names">
        {round.members.slice(0, 14).map((m, i) => (
          <span key={m.id} className={i ? "-ml-1.5" : ""}>
            <Avatar member={m} size={22} />
          </span>
        ))}
        <span className="ml-2 text-[11px] text-zinc-500">
          {n > 14 ? `+${n - 14} · ` : ""}
          {open ? "ซ่อนรายชื่อ ▴" : "ดูรายชื่อ ▾"}
        </span>
      </button>
      {open && (
        <ol className="mt-1.5 columns-2 gap-x-4 text-[11.5px] text-zinc-400">
          {round.names.map((name, i) => (
            <li key={i} className="truncate">
              <span className="mr-1 tabular-nums text-zinc-600">{(round.startNumber ?? 1) + i}.</span>
              {name}
            </li>
          ))}
        </ol>
      )}
      <div className="mt-1 text-[10.5px] text-zinc-600">โดย {round.actor ?? "—"}</div>
    </li>
  );
}

// --- Root --------------------------------------------------------------------------

export function LootQueueManager({
  categories,
  selectedCategoryId,
  initialRounds,
  lastServed,
  allMembers,
  onlineMemberIds,
  isAdmin,
  viewerMemberId,
  labelSuggestions,
}: {
  categories: LootCategoryView[];
  selectedCategoryId: string | null;
  initialRounds: LootRoundView[];
  lastServed: Record<string, string>;
  allMembers: LootQueueMemberRef[];
  onlineMemberIds: string[];
  isAdmin: boolean;
  viewerMemberId: string | null;
  labelSuggestions: { label: string; hint: "today" | "latest" | "next" }[];
}) {
  const router = useRouter();
  const selected = categories.find((c) => c.id === selectedCategoryId) ?? null;
  const onlineSet = useMemo(() => new Set(onlineMemberIds), [onlineMemberIds]);

  // Local (optimistic) queue order, re-synced whenever the server sends a new one.
  const [queue, setQueue] = useState<LootQueueMemberRef[]>(selected?.queue ?? []);
  const [syncedQueue, setSyncedQueue] = useState(selected?.queue);
  if (selected?.queue !== syncedQueue) {
    setSyncedQueue(selected?.queue);
    setQueue(selected?.queue ?? []);
  }

  const [count, setCount] = useState(0);
  const [label, setLabel] = useState("");
  const [search, setSearch] = useState("");
  const [twoCol, setTwoCol] = useState(false);
  const [lookup, setLookup] = useState("");
  const [addQuery, setAddQuery] = useState("");
  const [toast, setToast] = useState<Toast>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dragging, setDragging] = useState<LootQueueMemberRef | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function showToast(t: Toast) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(t);
    toastTimer.current = setTimeout(() => setToast(null), t?.onAction ? 7000 : 3500);
  }
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  // Scroll the first search hit into view (DOM only — no state).
  useEffect(() => {
    if (!search.trim()) return;
    document.querySelector("[data-search-hit]")?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [search]);

  const pickable = useMemo(() => {
    const queued = new Set(queue.map((m) => m.id));
    return allMembers.filter((m) => !queued.has(m.id));
  }, [allMembers, queue]);

  if (!selected) {
    return (
      <div className="flex flex-col gap-4">
        <CategoryCards categories={categories} selectedId={selectedCategoryId} isAdmin={isAdmin} />
        <div className="rounded-xl border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-500">
          No categories yet{isAdmin ? ' — click "+ New Category" above to create one' : ""}
        </div>
      </div>
    );
  }

  // --- derived ---
  const { served, skipped } = previewServe(queue, count);
  const cutNumberOf = new Map(served.map((m, i) => [m.id, selected.nextStartNumber + i]));
  const lastCutIdx = served.length ? queue.findIndex((m) => m.id === served[served.length - 1].id) : -1;
  const lap = servedThisLap(initialRounds);
  const lapInQueue = queue.filter((m) => lap.has(m.id)).length;
  // Everyone from lapStartIdx to the end was served since the queue last wrapped.
  let lapStartIdx = queue.length;
  while (lapStartIdx > 0 && lap.has(queue[lapStartIdx - 1].id)) lapStartIdx--;
  const recent = initialRounds.slice(0, 4);
  const avg = recent.length ? recent.reduce((a, r) => a + r.memberIds.length, 0) / recent.length : 0;
  const nextUp = queue.find((m) => !isSkipped(m));
  const q = search.trim().toLowerCase();
  const lastRound = initialRounds[0];

  // --- actions ---
  function moveTo(memberId: string, rank: number) {
    const from = queue.findIndex((m) => m.id === memberId);
    if (from < 0) return;
    const next = queue.slice();
    const [m] = next.splice(from, 1);
    const to = Math.max(0, Math.min(next.length, rank - 1));
    next.splice(to, 0, m);
    setQueue(next);
    moveLootQueueEntryToPosition(selected!.id, memberId, to + 1)
      .then((res) => {
        if (!res.ok) uiAlert(res.error ?? "Failed to move");
        router.refresh();
      })
      .catch(() => {
        uiAlert("Failed to move. Please try again.");
        router.refresh();
      });
  }

  async function handleRemove(m: LootQueueMemberRef) {
    if (!(await uiConfirm({ title: `Remove ${m.displayName} from this queue?`, confirmLabel: "Remove", danger: true }))) return;
    setQueue((prev) => prev.filter((x) => x.id !== m.id));
    removeFromLootQueue(selected!.id, m.id).then(() => router.refresh());
  }

  function handleAdd(memberId: string) {
    addToLootQueue(selected!.id, memberId).then((res) => {
      if (!res.ok) uiAlert(res.error ?? "Failed to add");
      router.refresh();
    });
  }

  async function handleAddAllMissing() {
    const ids = pickable.map((m) => m.id);
    if (!ids.length) return;
    if (!(await uiConfirm({ title: `Add ${ids.length} member(s) to "${selected!.name}"?`, message: "They're added to the back of the queue.", confirmLabel: "Add all" }))) return;
    addManyToLootQueue(selected!.id, ids).then((res) => {
      if (!res.ok) uiAlert(res.error ?? "Failed to add");
      else showToast({ text: `เพิ่ม ${res.added ?? 0} คนท้ายคิวแล้ว` });
      router.refresh();
    });
  }

  function handleDragStart(e: DragStartEvent) {
    setDragging((e.active.data.current as { member?: LootQueueMemberRef } | undefined)?.member ?? null);
  }
  function handleDragEnd(e: DragEndEvent) {
    setDragging(null);
    const activeId = String(e.active.id).replace(/^lq-/, "");
    const overId = e.over ? String(e.over.id).replace(/^lq-/, "") : null;
    if (!overId || overId === activeId) return;
    const from = queue.findIndex((m) => m.id === activeId);
    const to = queue.findIndex((m) => m.id === overId);
    if (from < 0 || to < 0) return;
    // Dropping on a row places the dragged member where that row is now.
    moveTo(activeId, to + 1);
    showToast({ text: `ย้าย ${queue[from].displayName} ไปลำดับ ${to + 1}` });
  }

  // Lookup across every category.
  const lookupHits = lookup.trim()
    ? (() => {
        const lq = lookup.trim().toLowerCase();
        const pool = new Map<string, LootQueueMemberRef>();
        for (const m of allMembers) pool.set(m.id, m);
        for (const c of categories) for (const m of c.queue) pool.set(m.id, m);
        return [...pool.values()].filter((m) => m.displayName.toLowerCase().includes(lq)).slice(0, 3);
      })()
    : [];

  const viewerInQueue = viewerMemberId ? queue.findIndex((m) => m.id === viewerMemberId) + 1 : 0;

  return (
    <div className="flex flex-col gap-4">
      <CategoryCards categories={categories} selectedId={selectedCategoryId} isAdmin={isAdmin} />

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-[1.4fr_1fr_1fr_1.2fr]">
        <Kpi label="รอบนี้ของคิว (lap)" hint={`อีก ${Math.max(0, queue.length - lapInQueue)} คนจะครบทุกคน 1 รอบ`}>
          {lapInQueue}
          <span className="text-sm font-medium text-zinc-500">/{queue.length}</span>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded bg-zinc-800">
            <i className="block h-full rounded bg-gradient-to-r from-amber-600 to-amber-300" style={{ width: `${queue.length ? (lapInQueue / queue.length) * 100 : 0}%` }} />
          </div>
        </Kpi>
        <Kpi label="รันล่าสุด" hint={lastRound ? `${lastRound.memberIds.length} คน · ${fmtAgo(lastRound.createdAt)} · โดย ${lastRound.actor ?? "—"}` : "ยังไม่เคยรัน"}>
          <span className="text-base">{lastRound?.label ?? "—"}</span>
        </Kpi>
        <Kpi label="เฉลี่ยต่อรอบ" hint={avg ? `≈ ${Math.ceil(queue.length / avg)} รอบถึงจะวนครบคิว` : "ยังไม่มีข้อมูล"}>
          {avg ? Math.round(avg) : "—"}
          <span className="text-sm font-medium text-zinc-500"> คน</span>
        </Kpi>
        <Kpi label="สมาชิกที่ยังไม่อยู่ในคิว" tone={pickable.length ? "warn" : undefined} hint={pickable.length ? "สมาชิก active ที่ไม่มีในหมวดนี้" : "ทุกคนที่ active อยู่ในคิวแล้ว"}>
          <span className={pickable.length ? "text-amber-300" : "text-emerald-400"}>{pickable.length || "ครบ ✓"}</span>
        </Kpi>
      </div>

      {isAdmin && pickable.length > 0 && pickable.length <= 12 && (
        <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-sky-500/25 bg-sky-500/[0.07] px-3 py-2 text-xs text-sky-100">
          <span className="flex">
            {pickable.slice(0, 8).map((m, i) => (
              <span key={m.id} className={i ? "-ml-1.5" : ""}>
                <Avatar member={m} size={20} />
              </span>
            ))}
          </span>
          <span className="min-w-0 flex-1">
            <b>{pickable.length} คน</b>ยังไม่อยู่ในคิว “{selected.name}”: {pickable.map((m) => m.displayName).join(", ")}
          </span>
          <button type="button" onClick={handleAddAllMissing} className="rounded-lg border border-sky-400/40 px-2.5 py-1 text-xs text-sky-200 transition hover:bg-sky-500/10">
            เพิ่มท้ายคิวทั้งหมด
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        {/* Queue */}
        <section className="min-w-0 rounded-xl border border-zinc-800 bg-zinc-900/60">
          <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-3 py-2.5">
            <h2 className="text-sm font-semibold text-zinc-100">Queue — {selected.name}</h2>
            <span className="text-xs text-zinc-500">
              {queue.length} คน · <span className="text-emerald-400">●</span> ในห้องเสียง {queue.filter((m) => onlineSet.has(m.id)).length}
            </span>
            <span className="ml-auto flex items-center gap-2">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ค้นหาชื่อในคิวนี้…"
                className="w-36 rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none sm:w-44"
              />
              <span className="hidden rounded-lg border border-zinc-800 bg-zinc-950 p-0.5 text-[11px] sm:inline-flex">
                <button type="button" onClick={() => setTwoCol(false)} className={`rounded-md px-2 py-0.5 ${!twoCol ? "bg-zinc-800 text-zinc-100" : "text-zinc-500"}`}>
                  1 คอลัมน์
                </button>
                <button type="button" onClick={() => setTwoCol(true)} className={`rounded-md px-2 py-0.5 ${twoCol ? "bg-zinc-800 text-zinc-100" : "text-zinc-500"}`}>
                  2 คอลัมน์
                </button>
              </span>
            </span>
          </div>
          <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => setDragging(null)}>
            <div className={`grid max-h-[calc(100dvh-10rem)] gap-0.5 overflow-y-auto p-1.5 ${twoCol ? "sm:grid-cols-2 sm:gap-x-2" : "grid-cols-1"}`}>
              {queue.length === 0 && <p className="px-3 py-8 text-center text-sm text-zinc-500">คิวของหมวดนี้ยังว่าง</p>}
              {queue.map((m, i) => {
                const hit = q && m.displayName.toLowerCase().includes(q);
                return (
                  <div key={m.id} className="contents">
                    {i === lapStartIdx && lapStartIdx > 0 && lapStartIdx < queue.length && (
                      <div className="col-span-full my-1 flex items-center gap-2 text-[10.5px] text-zinc-600 before:flex-1 before:border-t before:border-zinc-800 after:flex-1 after:border-t after:border-zinc-800">
                        ↓ ได้ไปแล้วในรอบนี้ ({queue.length - lapStartIdx} คน) — จะวนกลับมาใหม่
                      </div>
                    )}
                    <div {...(hit ? { "data-search-hit": true } : {})} className="min-w-0">
                      <QueueRow
                        member={m}
                        rank={i + 1}
                        total={queue.length}
                        isAdmin={isAdmin}
                        online={onlineSet.has(m.id)}
                        cutNumber={cutNumberOf.get(m.id) ?? null}
                        isNext={!count && nextUp?.id === m.id}
                        isMe={m.id === viewerMemberId}
                        lastServedAt={lastServed[m.id]}
                        searchState={q ? (hit ? "hit" : "dim") : null}
                        onMoveTo={(rank) => moveTo(m.id, rank)}
                        onRemove={() => handleRemove(m)}
                      />
                    </div>
                    {i === lastCutIdx && (
                      <div className="col-span-full my-1 flex items-center gap-2 text-[11px] font-semibold text-amber-300 before:flex-1 before:border-t before:border-dashed before:border-amber-400/60 after:flex-1 after:border-t after:border-dashed after:border-amber-400/60">
                        ✂ ตัดที่ {served.length} คน{skipped.length ? ` · ข้าม ${skipped.length} คน` : ""} — ทั้งหมดนี้จะย้ายไปท้ายคิว
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <DragOverlay>
              {dragging ? (
                <div className="flex items-center gap-2 rounded-lg border border-amber-500 bg-zinc-900 px-2 py-1.5 text-[13px] font-semibold text-zinc-100 shadow-xl">
                  <Avatar member={dragging} /> {dragging.displayName}
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
          {isAdmin && (
            <div className="border-t border-zinc-800 p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h3 className="text-xs font-medium text-zinc-400">
                  เพิ่มเข้าคิว ({pickable.length})
                </h3>
                <input
                  value={addQuery}
                  onChange={(e) => setAddQuery(e.target.value)}
                  placeholder="Search name..."
                  className="w-32 flex-1 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none sm:max-w-40"
                />
                {pickable.length > 1 && (
                  <button type="button" onClick={handleAddAllMissing} className="text-[11px] text-sky-300 hover:text-sky-200">
                    + เพิ่มทั้งหมด
                  </button>
                )}
              </div>
              <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto">
                {pickable.length === 0 && <span className="text-xs text-zinc-600">ทุกคนอยู่ในคิวแล้ว</span>}
                {pickable
                  .filter((m) => !addQuery.trim() || m.displayName.toLowerCase().includes(addQuery.trim().toLowerCase()))
                  .map((m) => (
                    <AddMemberChip key={m.id} member={m} online={onlineSet.has(m.id)} onClick={() => handleAdd(m.id)} />
                  ))}
              </div>
            </div>
          )}
        </section>

        {/* Side */}
        <aside className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-4">
          {!isAdmin && viewerInQueue > 0 && (
            <div className="rounded-xl border border-sky-500/30 bg-gradient-to-br from-sky-500/15 to-sky-500/[0.03] p-3">
              <div className="text-[10.5px] uppercase tracking-wider text-sky-300">คิวของคุณ · {selected.name}</div>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-extrabold tabular-nums text-sky-300">#{viewerInQueue}</span>
                <span className="text-xs text-zinc-400">จาก {queue.length} คน</span>
              </div>
              {avg > 0 && (
                <div className="text-xs text-zinc-300">
                  คาดว่าจะได้ใน <b>~{Math.max(1, Math.ceil(viewerInQueue / avg))} รอบ</b> (เฉลี่ย {Math.round(avg)} คน/รอบ)
                </div>
              )}
              <div className="mt-1 text-[11px] text-zinc-500">
                หมวดอื่น:{" "}
                {categories
                  .filter((c) => c.id !== selected.id)
                  .map((c) => {
                    const r = c.queue.findIndex((m) => m.id === viewerMemberId) + 1;
                    return `${c.name} ${r ? `#${r}` : "—"}`;
                  })
                  .join(" · ")}
              </div>
            </div>
          )}

          {isAdmin && (
            <RunPanel
              category={selected}
              categories={categories}
              queue={queue}
              rounds={initialRounds}
              count={count}
              setCount={setCount}
              label={label}
              setLabel={setLabel}
              labelSuggestions={labelSuggestions}
              onToast={showToast}
            />
          )}

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
            <h2 className="mb-2 text-sm font-semibold text-zinc-100">
              🔎 ค้นหาคิวสมาชิก <span className="text-xs font-normal text-zinc-500">ทุกหมวดในครั้งเดียว</span>
            </h2>
            <input
              value={lookup}
              onChange={(e) => setLookup(e.target.value)}
              placeholder="พิมพ์ชื่อ…"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
            />
            {lookup.trim() && lookupHits.length === 0 && <p className="mt-2 text-xs text-zinc-500">ไม่พบชื่อ</p>}
            {lookupHits.map((m) => (
              <div key={m.id} className="mt-2">
                <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-zinc-100">
                  <Avatar member={m} online={onlineSet.has(m.id)} /> {m.displayName}
                </div>
                {categories.map((c) => {
                  const idx = c.queue.findIndex((x) => x.id === m.id);
                  const rs = c.id === selected.id ? recent : [];
                  const cAvg = rs.length ? rs.reduce((a, r) => a + r.memberIds.length, 0) / rs.length : 0;
                  return (
                    <div key={c.id} className="mb-0.5 grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-md bg-zinc-950/60 px-2 py-1 text-xs">
                      <span className="truncate text-zinc-300">{c.name}</span>
                      <span className="font-bold tabular-nums text-zinc-100">{idx >= 0 ? `#${idx + 1}` : "—"}</span>
                      <span className="text-[11px] text-zinc-500">
                        {idx < 0 ? "ไม่อยู่ในคิว" : isSkipped(c.queue[idx]) ? "ข้ามอยู่" : cAvg ? `~${Math.max(1, Math.ceil((idx + 1) / cAvg))} รอบ` : `${c.queue.length} คน`}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60">
            <div className="flex items-baseline gap-2 border-b border-zinc-800 px-3 py-2.5">
              <h2 className="text-sm font-semibold text-zinc-100">🕘 History</h2>
              <span className="text-xs text-zinc-500">{initialRounds.length} รอบล่าสุด</span>
            </div>
            {initialRounds.length === 0 ? (
              <p className="px-3 py-4 text-xs text-zinc-600">ยังไม่มีประวัติ</p>
            ) : (
              <ul>
                {initialRounds.map((r, i) => (
                  <HistoryItem key={r.id} round={r} index={i} isAdmin={isAdmin} categoryName={selected.name} onToast={showToast} />
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>

      {toast && (
        <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
          <div className="flex items-center gap-3 rounded-xl border border-zinc-700 bg-zinc-800 px-3.5 py-2 text-[12.5px] text-zinc-100 shadow-xl shadow-black/50">
            <span>{toast.text}</span>
            {toast.onAction && (
              <button
                type="button"
                onClick={() => {
                  const fn = toast.onAction;
                  setToast(null);
                  fn?.();
                }}
                className="font-semibold text-amber-300 hover:text-amber-200"
              >
                {toast.actionLabel}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
