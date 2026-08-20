"use client";

import { useRef, useState, useTransition } from "react";
import { formatDistanceToNow } from "date-fns";
import type { MemberNote } from "@/db/schema";
import { addMemberNote, deleteMemberNote } from "@/app/actions/members";

/**
 * Admin-only comment log on a member profile (e.g. "AFK ใน GVG 20/8") —
 * an append-only timeline, separate from the public activity feed. Only
 * ever rendered when the page has already confirmed the viewer is an admin.
 */
export function MemberNotes({ memberId, notes }: { memberId: string; notes: MemberNote[] }) {
  const [items, setItems] = useState(notes);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function handleAdd(formData: FormData) {
    const body = (formData.get("body") as string)?.trim();
    if (!body) return;
    setError(null);
    startTransition(async () => {
      const res = await addMemberNote(memberId, body);
      if (!res.ok) {
        setError(res.error ?? "เพิ่มบันทึกไม่สำเร็จ");
        return;
      }
      // Optimistic prepend — good enough for a same-admin single-tab flow;
      // a full refresh will reconcile author/timestamp precision anyway.
      setItems((prev) => [
        { id: `temp-${Date.now()}`, memberId, body, authorUsername: "คุณ", createdAt: new Date() },
        ...prev,
      ]);
      setText("");
      formRef.current?.reset();
    });
  }

  function handleDelete(noteId: string) {
    if (!confirm("ลบบันทึกนี้?")) return;
    setItems((prev) => prev.filter((n) => n.id !== noteId));
    startTransition(async () => {
      await deleteMemberNote(noteId, memberId);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <form ref={formRef} action={handleAdd} className="flex flex-col gap-2">
        <textarea
          name="body"
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="เช่น AFK ใน GVG วันที่ 20/8, พูดคุยแจ้งเตือนแล้ว..."
          className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
        />
        {error && <p className="text-xs text-rose-400">{error}</p>}
        <button
          type="submit"
          disabled={pending || !text.trim()}
          className="self-start rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          เพิ่มบันทึก
        </button>
      </form>

      <ul className="flex flex-col gap-2">
        {items.length === 0 && <li className="text-xs text-zinc-600">ยังไม่มีบันทึก</li>}
        {items.map((note) => (
          <li key={note.id} className="flex items-start justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-2.5">
            <div className="min-w-0">
              <p className="whitespace-pre-wrap text-sm text-zinc-200">{note.body}</p>
              <p className="mt-1 text-[10px] text-zinc-500">
                {note.authorUsername} · {formatDistanceToNow(note.createdAt, { addSuffix: true })}
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleDelete(note.id)}
              className="shrink-0 rounded px-1.5 py-0.5 text-xs text-zinc-600 transition hover:text-rose-400"
              title="ลบบันทึก"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
