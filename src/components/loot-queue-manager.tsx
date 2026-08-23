"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { MemberAvatar } from "@/components/member-avatar";
import { MemberPicker } from "@/components/party/member-picker";
import { listDiscordChannels } from "@/app/actions/bot-messages";
import {
  addToLootQueue,
  createLootCategory,
  deleteLootCategory,
  deleteLootRoundHistory,
  moveLootCategory,
  moveLootQueueEntry,
  postLootRoundMessage,
  removeFromLootQueue,
  renameLootCategory,
  runLootRound,
  undoLootRound,
  type RunRoundResult,
} from "@/app/actions/loot-queue";
import type { DiscordChannel } from "@/lib/discord";
import type { LootCategoryView, LootQueueMemberRef, LootRoundView } from "@/lib/loot-queue-data";

function fmtTime(d: Date) {
  return formatDistanceToNow(d, { addSuffix: true });
}

/** Builds the "1 name 2 name 3 name" announcement text the guild already
 * posts by hand in Discord — the Discord-post modal starts from this and
 * lets the admin edit before sending. */
function buildAnnouncementText(categoryName: string, label: string, served: LootQueueMemberRef[]): string {
  const header = [label.trim(), categoryName].filter(Boolean).join(" ");
  const body = served.map((m, i) => `${i + 1} ${m.displayName}`).join(" ");
  return `${header}\n${body}`;
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
        setError(res.error ?? "ดึงรายชื่อ channel ไม่สำเร็จ");
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
      setError(res.error ?? "โพสต์ไม่สำเร็จ");
      return;
    }
    setPosted(true);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-16">
      <div className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-100">โพสต์ผลรอบนี้ลง Discord</h2>
          <button type="button" onClick={onClose} className="rounded px-2 py-1 text-xs text-zinc-500 hover:text-zinc-200">
            ปิด ✕
          </button>
        </div>

        {loading && <p className="py-6 text-center text-sm text-zinc-500">กำลังโหลด...</p>}

        {!loading && !posted && (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-zinc-500">แก้ข้อความก่อนโพสต์ได้ตามต้องการ (เช่น เติม @Rooc เอง)</p>
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
                {posting ? "กำลังโพสต์..." : "โพสต์ข้อความ"}
              </button>
            </div>
          </div>
        )}

        {posted && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <p className="text-sm text-emerald-300">โพสต์เรียบร้อย ✓</p>
            <button type="button" onClick={onClose} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition hover:bg-zinc-800">
              ปิดหน้าต่างนี้
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Run-round panel ---------------------------------------------------

function RunRoundPanel({ category }: { category: LootCategoryView }) {
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
        setError(res.error ?? "รันรอบไม่สำเร็จ");
        return;
      }
      setResult(res);
      router.refresh();
    });
  }

  if (result?.served) {
    const text = buildAnnouncementText(category.name, label, result.served);
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-emerald-900/60 bg-emerald-950/20 p-3">
        <p className="text-sm text-emerald-300">
          รอบนี้ได้ {result.served.length} คน{result.short ? " (คิวมีไม่พอตามจำนวนที่ขอ เลยเสิร์ฟให้ครบเท่าที่มี)" : ""}
        </p>
        <p className="whitespace-pre-wrap text-xs text-zinc-300">{text}</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(text)}
            className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 transition hover:bg-zinc-800"
          >
            คัดลอกข้อความ
          </button>
          <button
            type="button"
            onClick={() => setShowPost(true)}
            className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 transition hover:bg-zinc-800"
          >
            โพสต์ลง Discord
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
            รันรอบใหม่อีก
          </button>
        </div>
        {showPost && <PostToDiscordModal initialText={text} onClose={() => setShowPost(false)} />}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
      <p className="text-sm font-medium text-zinc-300">รันรอบใหม่</p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="number"
          min={1}
          value={count}
          onChange={(e) => setCount(e.target.value)}
          placeholder="จำนวนคน"
          className="w-28 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none"
        />
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="หัวข้อรอบ เช่น GL 25/8 (ไม่บังคับ)"
          className="min-w-40 flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none"
        />
        <button
          type="button"
          disabled={!n || n <= 0 || pending || category.queue.length === 0}
          onClick={handleRun}
          className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "กำลังรัน..." : "รัน"}
        </button>
      </div>
      {error && <p className="text-xs text-rose-400">{error}</p>}
      {category.queue.length === 0 && <p className="text-xs text-zinc-500">คิวหมวดนี้ยังไม่มีสมาชิก — เพิ่มสมาชิกเข้าคิวก่อน</p>}
      {preview.length > 0 && (
        <div className="rounded-lg border border-dashed border-zinc-700 bg-zinc-950/60 p-2">
          <p className="mb-1 text-xs text-zinc-500">ตัวอย่างคนที่จะได้ ({preview.length}{n > category.queue.length ? ` — คิวมีแค่ ${category.queue.length}` : ""} คน):</p>
          <p className="text-xs text-zinc-300">{preview.map((m) => m.displayName).join(", ")}</p>
        </div>
      )}
    </div>
  );
}

// --- Queue list ----------------------------------------------------------

function QueueList({ category, isAdmin, pickable }: { category: LootCategoryView; isAdmin: boolean; pickable: LootQueueMemberRef[] }) {
  const router = useRouter();
  const [movingId, setMovingId] = useState<string | null>(null);

  function handleMove(memberId: string, direction: "up" | "down") {
    setMovingId(memberId);
    moveLootQueueEntry(category.id, memberId, direction).then(() => {
      setMovingId(null);
      router.refresh();
    });
  }

  function handleRemove(memberId: string, name: string) {
    if (!confirm(`เอา ${name} ออกจากคิวหมวดนี้?`)) return;
    removeFromLootQueue(category.id, memberId).then(() => router.refresh());
  }

  function handleAdd(memberId: string) {
    addToLootQueue(category.id, memberId).then((res) => {
      if (!res.ok) alert(res.error ?? "เพิ่มไม่สำเร็จ");
      router.refresh();
    });
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/50">
      <ul className="divide-y divide-zinc-800">
        {category.queue.length === 0 && (
          <li className="px-5 py-8 text-center text-sm text-zinc-500">คิวหมวดนี้ยังไม่มีสมาชิก</li>
        )}
        {category.queue.map((m, i) => (
          <li key={m.id} className="flex items-center gap-3 px-4 py-2.5">
            <span className="w-7 shrink-0 text-center text-xs text-zinc-500">{i + 1}</span>
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
                title="เอาออกจากคิว"
                className="shrink-0 rounded px-1.5 py-1 text-xs text-zinc-600 transition hover:text-rose-400"
              >
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>
      {isAdmin && (
        <div className="border-t border-zinc-800 p-2">
          <MemberPicker
            members={pickable.map((m) => ({ id: m.id, displayName: m.displayName, discordAvatar: m.discordAvatar, className: null }))}
            onSelect={handleAdd}
            emptyLabel="ไม่มีสมาชิกให้เพิ่มแล้ว (อยู่ในคิวครบทุกคน)"
            trigger={
              <span className="inline-block cursor-pointer select-none rounded-lg border border-dashed border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-400 transition hover:border-amber-500 hover:text-amber-300">
                + เพิ่มสมาชิกเข้าคิว
              </span>
            }
          />
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
    if (!confirm("ย้อนกลับรอบนี้? คนที่ได้ของรอบนี้จะกลับไปอยู่ตำแหน่งเดิมในคิว")) return;
    setBusyId(id);
    undoLootRound(id).then((res) => {
      setBusyId(null);
      if (!res.ok) alert(res.error ?? "ย้อนกลับไม่สำเร็จ");
      router.refresh();
    });
  }

  function handleDelete(id: string) {
    if (!confirm("ลบประวัติรอบนี้? (ไม่กระทบตำแหน่งคิวปัจจุบัน)")) return;
    setBusyId(id);
    deleteLootRoundHistory(id).then(() => {
      setBusyId(null);
      router.refresh();
    });
  }

  if (rounds.length === 0) return <p className="text-xs text-zinc-600">ยังไม่มีประวัติการรันรอบของหมวดนี้</p>;

  return (
    <ul className="flex flex-col gap-2">
      {rounds.map((r, i) => (
        <li key={r.id} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2.5 text-xs">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-zinc-300">
                {r.label && <span className="font-medium text-amber-300">{r.label} — </span>}
                ได้ {r.members.length} คน
              </p>
              <p className="mt-0.5 truncate text-zinc-500">{r.members.map((m) => m.displayName).join(", ")}</p>
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
                    ย้อนกลับ
                  </button>
                )}
                <button
                  type="button"
                  disabled={busyId === r.id}
                  onClick={() => handleDelete(r.id)}
                  className="text-rose-400 transition hover:text-rose-300 disabled:opacity-40"
                >
                  ลบประวัติ
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
        setError(res.error ?? "เพิ่มไม่สำเร็จ");
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
        setError(res.error ?? "แก้ไม่สำเร็จ");
        return;
      }
      setRenamingId(null);
      setError(null);
      router.refresh();
    });
  }

  function handleDelete(id: string, name: string) {
    if (!confirm(`ลบหมวดหมู่ "${name}" ทั้งคิวและประวัติ? การกระทำนี้ย้อนกลับไม่ได้`)) return;
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
                    title="เปลี่ยนชื่อหมวดหมู่"
                  >
                    ✎
                  </button>
                  <button type="button" onClick={() => handleDelete(c.id, c.name)} className="hover:text-rose-400" title="ลบหมวดหมู่">
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
                placeholder="ชื่อหมวดหมู่ใหม่"
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
              + หมวดหมู่ใหม่
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
  isAdmin,
}: {
  categories: LootCategoryView[];
  selectedCategoryId: string | null;
  initialRounds: LootRoundView[];
  allMembers: LootQueueMemberRef[];
  isAdmin: boolean;
}) {
  const selected = categories.find((c) => c.id === selectedCategoryId) ?? null;

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
          ยังไม่มีหมวดหมู่{isAdmin ? ' — กด "+ หมวดหมู่ใหม่" ด้านบนเพื่อเริ่มสร้าง' : ""}
        </div>
      )}

      {selected && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr_1fr]">
          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-medium text-zinc-300">คิว — {selected.name}</h2>
            <QueueList category={selected} isAdmin={isAdmin} pickable={pickable} />
          </div>
          <div className="flex flex-col gap-4">
            {isAdmin && <RunRoundPanel category={selected} />}
            <div className="flex flex-col gap-2">
              <h2 className="text-sm font-medium text-zinc-300">ประวัติล่าสุด</h2>
              <RoundHistory rounds={initialRounds} isAdmin={isAdmin} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
