"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { MemberAvatar } from "@/components/member-avatar";
import { listDiscordChannels } from "@/app/actions/bot-messages";
import {
  addToLootQueue,
  createLootCategory,
  deleteLootCategory,
  deleteLootRoundHistory,
  moveLootCategory,
  moveLootQueueEntry,
  moveLootQueueEntryToPosition,
  postLootRoundMessage,
  removeFromLootQueue,
  renameLootCategory,
  runLootRound,
  setLootCategoryNumberingBase,
  undoLootRound,
  type RunRoundResult,
} from "@/app/actions/loot-queue";
import type { DiscordChannel } from "@/lib/discord";
import type { LootCategoryView, LootQueueMemberRef, LootRoundView } from "@/lib/loot-queue-data";

function fmtTime(d: Date) {
  return formatDistanceToNow(d, { addSuffix: true });
}

/** Builds the announcement text for the Discord-post modal / copy button —
 * one numbered name per line ("1.name", "2.name", ...) so it's easy to read
 * and to paste around. The header is bolded (Discord markdown) and set off
 * from the list by a blank line — without that gap, when several rounds'
 * texts get posted or pasted back-to-back (e.g. running multiple
 * categories in one session), one round's last name runs straight into the
 * next round's header with nothing to tell them apart.
 * `startNumber` is normally 1, but a category linked to continue another
 * category's numbering (see the "เลขต่อจาก" control below the queue) starts
 * counting from wherever that other category's latest round left off. */
function buildAnnouncementText(categoryName: string, label: string, served: LootQueueMemberRef[], startNumber: number): string {
  const header = [label.trim(), categoryName].filter(Boolean).join(" ");
  const body = served.map((m, i) => `${startNumber + i}.${m.displayName}`).join("\n");
  return `**${header}**\n\n${body}`;
}

// --- Discord post modal ----------------------------------------------------

function PostToDiscordModal({ initialText, onClose }: { initialText: string; onClose: () => void }) {
  const [channels, setChannels] = useState<DiscordChannel[] | null>(null);
  const [channelId, setChannelId] = useState("");
  const [text, setText] = useState(initialText);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState(false);

  useState(() => {
    listDiscordChannels().then((res) => {
      setLoading(false);
      if (!res.ok || !res.channels) {
        setError(res.error ?? "Failed to fetch channels");
        return;
      }
      setChannels(res.channels);
      setChannelId(res.channels[0]?.id ?? "");
    });
  });

  async function handlePost() {
    if (!channelId) return;
    setPosting(true);
    setError(null);
    const res = await postLootRoundMessage(channelId, text);
    setPosting(false);
    if (!res.ok) {
      setError(res.error ?? "Failed to post");
      return;
    }
    setPosted(true);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-16">
      <div className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-100">Post Round Results to Discord</h2>
          <button type="button" onClick={onClose} className="rounded px-2 py-1 text-xs text-zinc-500 hover:text-zinc-200">
            Close ✕
          </button>
        </div>

        {loading && <p className="py-6 text-center text-sm text-zinc-500">Loading...</p>}

        {!loading && !posted && (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-zinc-500">You can edit the message before posting (e.g. add @Rooc yourself)</p>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500 focus:outline-none"
            />
            {error && <p className="rounded-lg border border-rose-900/60 bg-rose-950/30 p-2 text-xs text-rose-300">{error}</p>}
            <select
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
              className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500 focus:outline-none"
            >
              {(channels ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  #{c.name}
                </option>
              ))}
            </select>
            <div className="flex justify-end">
              <button
                type="button"
                disabled={!channelId || posting || !text.trim()}
                onClick={handlePost}
                className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {posting ? "Posting..." : "Post Message"}
              </button>
            </div>
          </div>
        )}

        {posted && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <p className="text-sm text-emerald-300">Posted ✓</p>
            <button type="button" onClick={onClose} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition hover:bg-zinc-800">
              Close this window
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Run-round panel ---------------------------------------------------

/** "เลขเริ่มต่อจาก" — lets an admin link this category's round numbering to
 * continue from another category's latest round instead of always
 * starting at 1 (e.g. "ขนนกหลากสี" continuing on from "ขนนกขาว"). See
 * computeNumberingStart in loot-queue-data.ts for how the actual offset is
 * worked out at run time. */
function NumberingBaseControl({ category, categories }: { category: LootCategoryView; categories: LootCategoryView[] }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const options = categories.filter((c) => c.id !== category.id);

  function handleChange(value: string) {
    setSaving(true);
    setLootCategoryNumberingBase(category.id, value || null).then((res) => {
      setSaving(false);
      if (!res.ok) alert(res.error ?? "Failed to save setting");
      router.refresh();
    });
  }

  if (options.length === 0) return null;

  return (
    <label className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
      Numbering starts from:
      <select
        value={category.numberingBaseCategoryId ?? ""}
        disabled={saving}
        onChange={(e) => handleChange(e.target.value)}
        className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-300 focus:border-amber-500 focus:outline-none disabled:opacity-50"
      >
        <option value="">— Always start at 1 —</option>
        {options.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function RunRoundPanel({ category, categories }: { category: LootCategoryView; categories: LootCategoryView[] }) {
  const router = useRouter();
  const [count, setCount] = useState("");
  const [label, setLabel] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RunRoundResult | null>(null);
  const [showPost, setShowPost] = useState(false);

  const n = Number(count);
  const preview = n > 0 ? category.queue.slice(0, n) : [];

  function handleRun() {
    if (!n || n <= 0) return;
    setError(null);
    startTransition(async () => {
      const res = await runLootRound(category.id, n, label);
      if (!res.ok) {
        setError(res.error ?? "Failed to run round");
        return;
      }
      setResult(res);
      router.refresh();
    });
  }

  if (result?.served) {
    const text = buildAnnouncementText(category.name, label, result.served, result.startNumber ?? 1);
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-emerald-900/60 bg-emerald-950/20 p-3">
        <p className="text-sm text-emerald-300">
          This round: {result.served.length} people{result.short ? " (queue did not have enough for the requested amount, so everyone available was served)" : ""}
        </p>
        <p className="whitespace-pre-wrap break-words text-xs text-zinc-300">{text}</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(text)}
            className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 transition hover:bg-zinc-800"
          >
            Copy Message
          </button>
          <button
            type="button"
            onClick={() => setShowPost(true)}
            className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 transition hover:bg-zinc-800"
          >
            Post to Discord
          </button>
          <button
            type="button"
            onClick={() => {
              setResult(null);
              setCount("");
              setLabel("");
            }}
            className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 transition hover:bg-zinc-800"
          >
            Run Another Round
          </button>
        </div>
        {showPost && <PostToDiscordModal initialText={text} onClose={() => setShowPost(false)} />}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
      <p className="text-sm font-medium text-zinc-300">Run New Round</p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="number"
          min={1}
          value={count}
          onChange={(e) => setCount(e.target.value)}
          placeholder="Number of people"
          className="w-28 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none"
        />
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Round label, e.g. GL 25/8 (optional)"
          className="min-w-40 flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none"
        />
        <button
          type="button"
          disabled={!n || n <= 0 || pending || category.queue.length === 0}
          onClick={handleRun}
          title="Pull the entered number of people from the front of the queue and move them to the back"
          className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Running..." : "Run New Round"}
        </button>
      </div>
      <NumberingBaseControl category={category} categories={categories} />
      {error && <p className="text-xs text-rose-400">{error}</p>}
      {category.queue.length === 0 && <p className="text-xs text-zinc-500">This category&apos;s queue has no members yet — add members to the queue first</p>}
      {preview.length > 0 && (
        <div className="rounded-lg border border-dashed border-zinc-700 bg-zinc-950/60 p-2">
          <p className="mb-1 text-xs text-zinc-500">Preview of who will be served ({preview.length}{n > category.queue.length ? ` — queue only has ${category.queue.length}` : ""} people):</p>
          <p className="break-words text-xs text-zinc-300">{preview.map((m) => m.displayName).join(", ")}</p>
        </div>
      )}
    </div>
  );
}

// --- Queue list ----------------------------------------------------------

/** Click the rank number to type a target rank directly — jumps the member
 * straight there in one save instead of walking ▲▼ one swap at a time,
 * which gets painfully slow on long queues (60+ people). */
function QueuePositionInput({
  categoryId,
  memberId,
  rank,
  total,
}: {
  categoryId: string;
  memberId: string;
  rank: number;
  total: number;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(rank));
  const [saving, setSaving] = useState(false);

  function commit() {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1) {
      setEditing(false);
      return;
    }
    if (n === rank) {
      setEditing(false);
      return;
    }
    setSaving(true);
    moveLootQueueEntryToPosition(categoryId, memberId, n).then((res) => {
      setSaving(false);
      setEditing(false);
      if (!res.ok) alert(res.error ?? "Failed to move position");
      router.refresh();
    });
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
          if (e.key === "Escape") {
            setValue(String(rank));
            setEditing(false);
          }
        }}
        className="w-9 shrink-0 rounded border border-amber-500 bg-zinc-900 px-1 py-0.5 text-center text-xs text-zinc-100 focus:outline-none"
      />
    );
  }

  return (
    <button
      type="button"
      disabled={saving}
      onClick={() => {
        setValue(String(rank));
        setEditing(true);
      }}
      title="Type a position to jump there immediately"
      className="w-7 shrink-0 rounded text-center text-xs text-zinc-500 transition hover:bg-zinc-800 hover:text-amber-300 disabled:opacity-40"
    >
      {saving ? "…" : rank}
    </button>
  );
}

/** A clickable member chip for the "add to queue" pool — same visual
 * language as the party board's MemberChip, but plain-button/click instead
 * of drag-and-drop (this pool has no drop target, just "add"). `online`
 * only adds a small dot — never hides anyone — so the picker always shows
 * the full roster (same principle as the party board's pool) while still
 * surfacing who's in voice right now as a quick visual cue. */
function AddMemberChip({ member, online, onClick }: { member: LootQueueMemberRef; online: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Add ${member.displayName} to queue${online ? " (online)" : ""}`}
      className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800/80 px-2 py-1.5 text-xs transition hover:border-amber-500 hover:bg-zinc-800"
    >
      <span className="relative shrink-0">
        <MemberAvatar src={member.discordAvatar} alt={member.displayName} width={20} height={20} className="h-5 w-5 rounded-full ring-1 ring-zinc-700" />
        {online && (
          <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-400 ring-1 ring-zinc-900" />
        )}
      </span>
      <span className="min-w-0 max-w-[9rem] truncate font-medium text-zinc-100">{member.displayName}</span>
    </button>
  );
}

function QueueList({
  category,
  isAdmin,
  pickable,
  onlineMemberIds,
}: {
  category: LootCategoryView;
  isAdmin: boolean;
  pickable: LootQueueMemberRef[];
  onlineMemberIds: Set<string>;
}) {
  const router = useRouter();
  const [movingId, setMovingId] = useState<string | null>(null);
  const [addQuery, setAddQuery] = useState("");

  // Same principle as the party board's "รอลงปาร์ตี้" pool: always show the
  // full roster, filtered only by what's typed — nothing gets hidden by an
  // online/offline toggle (that caused real confusion: someone active but
  // not in voice looked "missing"). Online status is still surfaced, just
  // as a dot on the chip (see AddMemberChip) rather than a filter.
  const trimmedQuery = addQuery.trim().toLowerCase();
  const visiblePickable = trimmedQuery
    ? pickable.filter((m) => m.displayName.toLowerCase().includes(trimmedQuery))
    : pickable;

  function handleMove(memberId: string, direction: "up" | "down") {
    setMovingId(memberId);
    moveLootQueueEntry(category.id, memberId, direction).then(() => {
      setMovingId(null);
      router.refresh();
    });
  }

  function handleRemove(memberId: string, name: string) {
    if (!confirm(`Remove ${name} from this category's queue?`)) return;
    removeFromLootQueue(category.id, memberId).then(() => router.refresh());
  }

  function handleAdd(memberId: string) {
    addToLootQueue(category.id, memberId).then((res) => {
      if (!res.ok) alert(res.error ?? "Failed to add");
      router.refresh();
    });
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/50">
      <ul className="divide-y divide-zinc-800">
        {category.queue.length === 0 && (
          <li className="px-5 py-8 text-center text-sm text-zinc-500">This category&apos;s queue has no members</li>
        )}
        {category.queue.map((m, i) => (
          <li key={m.id} className="flex items-center gap-3 px-4 py-2.5">
            {isAdmin ? (
              <QueuePositionInput categoryId={category.id} memberId={m.id} rank={i + 1} total={category.queue.length} />
            ) : (
              <span className="w-7 shrink-0 text-center text-xs text-zinc-500">{i + 1}</span>
            )}
            {isAdmin && (
              <div className="flex shrink-0 flex-col items-center gap-0.5">
                <button
                  type="button"
                  disabled={i === 0 || movingId === m.id}
                  onClick={() => handleMove(m.id, "up")}
                  className="text-[10px] leading-none text-zinc-500 transition hover:text-zinc-200 disabled:opacity-20"
                >
                  ▲
                </button>
                <button
                  type="button"
                  disabled={i === category.queue.length - 1 || movingId === m.id}
                  onClick={() => handleMove(m.id, "down")}
                  className="text-[10px] leading-none text-zinc-500 transition hover:text-zinc-200 disabled:opacity-20"
                >
                  ▼
                </button>
              </div>
            )}
            <MemberAvatar src={m.discordAvatar} alt={m.displayName} width={28} height={28} className="h-7 w-7 shrink-0 rounded-full ring-1 ring-zinc-700" />
            <span className="min-w-0 flex-1 truncate text-sm text-zinc-100">{m.displayName}</span>
            {isAdmin && (
              <button
                type="button"
                onClick={() => handleRemove(m.id, m.displayName)}
                title="Remove from queue"
                className="shrink-0 rounded px-1.5 py-1 text-xs text-zinc-600 transition hover:text-rose-400"
              >
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>
      {isAdmin && (
        <div className="border-t border-zinc-800 p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h3 className="text-xs font-medium text-zinc-400">
              Add to Queue ({visiblePickable.length}
              {visiblePickable.length !== pickable.length ? ` / ${pickable.length}` : ""})
            </h3>
            <input
              type="text"
              value={addQuery}
              onChange={(e) => setAddQuery(e.target.value)}
              placeholder="Search name..."
              className="w-32 flex-1 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none sm:max-w-40"
            />
            <span className="flex select-none items-center gap-1 text-[10px] text-zinc-500">
              <span className="h-2 w-2 rounded-full bg-emerald-400" /> = currently in voice
            </span>
          </div>
          <div className="flex max-h-56 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-dashed border-zinc-800 p-2">
            {visiblePickable.length === 0 && (
              <span className="px-1 py-1 text-xs text-zinc-600">
                {pickable.length === 0
                  ? "No members left to add (everyone is already in the queue)"
                  : "No name matches your search"}
              </span>
            )}
            {visiblePickable.map((m) => (
              <AddMemberChip key={m.id} member={m} online={onlineMemberIds.has(m.id)} onClick={() => handleAdd(m.id)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// --- History ---------------------------------------------------------------

function RoundHistory({ rounds, isAdmin }: { rounds: LootRoundView[]; isAdmin: boolean }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);

  function handleUndo(id: string) {
    if (!confirm("Undo this round? People served in this round will return to their previous positions in the queue")) return;
    setBusyId(id);
    undoLootRound(id).then((res) => {
      setBusyId(null);
      if (!res.ok) alert(res.error ?? "Failed to undo");
      router.refresh();
    });
  }

  function handleDelete(id: string) {
    if (!confirm("Delete this round's history? (This will not affect current queue positions)")) return;
    setBusyId(id);
    deleteLootRoundHistory(id).then(() => {
      setBusyId(null);
      router.refresh();
    });
  }

  if (rounds.length === 0) return <p className="text-xs text-zinc-600">No round history for this category yet</p>;

  return (
    <ul className="flex flex-col gap-2">
      {rounds.map((r, i) => (
        <li key={r.id} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2.5 text-xs">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-zinc-300">
                {r.label && <span className="font-medium text-amber-300">{r.label} — </span>}
                Served {r.members.length} people
              </p>
              <p className="mt-0.5 break-words text-zinc-500">{r.members.map((m) => m.displayName).join(", ")}</p>
              <p className="mt-0.5 text-[10px] text-zinc-600">
                {r.actor ?? "—"} · {fmtTime(r.createdAt)}
              </p>
            </div>
            {isAdmin && (
              <div className="flex shrink-0 gap-2">
                {i === 0 && (
                  <button
                    type="button"
                    disabled={busyId === r.id}
                    onClick={() => handleUndo(r.id)}
                    className="text-amber-400 transition hover:text-amber-300 disabled:opacity-40"
                  >
                    Undo
                  </button>
                )}
                <button
                  type="button"
                  disabled={busyId === r.id}
                  onClick={() => handleDelete(r.id)}
                  className="text-rose-400 transition hover:text-rose-300 disabled:opacity-40"
                >
                  Delete History
                </button>
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

// --- Category tabs / management ------------------------------------------

function CategoryTabs({
  categories,
  selectedId,
  isAdmin,
}: {
  categories: LootCategoryView[];
  selectedId: string | null;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleAdd() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    startTransition(async () => {
      const res = await createLootCategory(trimmed);
      if (!res.ok) {
        setError(res.error ?? "Failed to add");
        return;
      }
      setNewName("");
      setAdding(false);
      setError(null);
      router.refresh();
    });
  }

  function handleRename(id: string) {
    const trimmed = renameValue.trim();
    if (!trimmed) return;
    startTransition(async () => {
      const res = await renameLootCategory(id, trimmed);
      if (!res.ok) {
        setError(res.error ?? "Failed to edit");
        return;
      }
      setRenamingId(null);
      setError(null);
      router.refresh();
    });
  }

  function handleDelete(id: string, name: string) {
    if (!confirm(`Delete category "${name}" along with its queue and history? This action cannot be undone`)) return;
    deleteLootCategory(id).then(() => {
      router.push("/loot-queue");
      router.refresh();
    });
  }

  function handleMove(id: string, direction: "up" | "down") {
    moveLootCategory(id, direction).then(() => router.refresh());
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1 rounded-xl border border-zinc-800 bg-zinc-900/50 p-1.5">
        {categories.map((c, i) =>
          renamingId === c.id ? (
            <span key={c.id} className="flex items-center gap-1 px-1">
              <input
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleRename(c.id)}
                className="w-32 rounded-md border border-amber-500 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 focus:outline-none"
              />
              <button type="button" onClick={() => handleRename(c.id)} className="text-xs text-emerald-400 hover:text-emerald-300">
                ✓
              </button>
              <button type="button" onClick={() => setRenamingId(null)} className="text-xs text-zinc-500 hover:text-zinc-300">
                ✕
              </button>
            </span>
          ) : (
            <span key={c.id} className="group relative flex items-center">
              <button
                type="button"
                onClick={() => router.push(`/loot-queue?category=${c.id}`)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  c.id === selectedId ? "bg-amber-600 text-white" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                }`}
              >
                {c.name} <span className="ml-1 text-xs opacity-70">({c.queue.length})</span>
              </button>
              {isAdmin && c.id === selectedId && (
                <span className="ml-1 flex items-center gap-0.5 text-[10px] text-zinc-500">
                  <button type="button" disabled={i === 0} onClick={() => handleMove(c.id, "up")} className="hover:text-zinc-200 disabled:opacity-20">
                    ◀
                  </button>
                  <button
                    type="button"
                    disabled={i === categories.length - 1}
                    onClick={() => handleMove(c.id, "down")}
                    className="hover:text-zinc-200 disabled:opacity-20"
                  >
                    ▶
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRenamingId(c.id);
                      setRenameValue(c.name);
                    }}
                    className="ml-1 hover:text-amber-300"
                    title="Rename category"
                  >
                    ✎
                  </button>
                  <button type="button" onClick={() => handleDelete(c.id, c.name)} className="hover:text-rose-400" title="Delete category">
                    🗑
                  </button>
                </span>
              )}
            </span>
          )
        )}
        {isAdmin &&
          (adding ? (
            <span className="flex items-center gap-1 px-1">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                placeholder="New category name"
                className="w-36 rounded-md border border-amber-500 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
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
              className="rounded-lg border border-dashed border-zinc-700 px-3 py-1.5 text-sm text-zinc-400 transition hover:border-amber-500 hover:text-amber-300"
            >
              + New Category
            </button>
          ))}
      </div>
      {error && <p className="text-xs text-rose-400">{error}</p>}
    </div>
  );
}

// --- Root -------------------------------------------------------------

export function LootQueueManager({
  categories,
  selectedCategoryId,
  initialRounds,
  allMembers,
  onlineMemberIds,
  isAdmin,
}: {
  categories: LootCategoryView[];
  selectedCategoryId: string | null;
  initialRounds: LootRoundView[];
  allMembers: LootQueueMemberRef[];
  onlineMemberIds: string[];
  isAdmin: boolean;
}) {
  const selected = categories.find((c) => c.id === selectedCategoryId) ?? null;
  const onlineSet = useMemo(() => new Set(onlineMemberIds), [onlineMemberIds]);

  const pickable = useMemo(() => {
    if (!selected) return [];
    const queuedIds = new Set(selected.queue.map((m) => m.id));
    return allMembers.filter((m) => !queuedIds.has(m.id));
  }, [allMembers, selected]);

  return (
    <div className="flex flex-col gap-4">
      <CategoryTabs categories={categories} selectedId={selectedCategoryId} isAdmin={isAdmin} />

      {categories.length === 0 && (
        <div className="rounded-xl border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-500">
          No categories yet{isAdmin ? ' — click "+ New Category" above to create one' : ""}
        </div>
      )}

      {selected && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr_1fr]">
          {/* min-w-0 on both tracks: without it, a CSS grid item's default
           * min-width is its content's intrinsic min-width — a long
           * unbroken run of Thai text (no spaces for the browser to wrap
           * at, unlike Latin) inside the round result / history text can
           * exceed the track's fr-share width and force the whole grid
           * (and page) wider than the viewport. break-words on that text
           * (see RunRoundPanel/RoundHistory) covers the same failure mode
           * from the other side — belt and suspenders. */}
          <div className="flex min-w-0 flex-col gap-3">
            <h2 className="text-sm font-medium text-zinc-300">Queue — {selected.name}</h2>
            {/* Same key={selected.id} reasoning as RunRoundPanel below —
             * resets the add-picker's search text and online-only
             * scroll position when switching categories. */}
            <QueueList key={selected.id} category={selected} isAdmin={isAdmin} pickable={pickable} onlineMemberIds={onlineSet} />
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            {/* key={selected.id}: forces a fresh RunRoundPanel instance per
             * category — without it, React reuses the same component across
             * a tab switch (same position in the tree, only props change),
             * so its local `result` state from the PREVIOUS category's just-
             * run round kept showing in the green result box even after
             * switching to a category that's never been run. */}
            {isAdmin && <RunRoundPanel key={selected.id} category={selected} categories={categories} />}
            <div className="flex flex-col gap-2">
              <h2 className="text-sm font-medium text-zinc-300">Recent History</h2>
              <RoundHistory rounds={initialRounds} isAdmin={isAdmin} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
