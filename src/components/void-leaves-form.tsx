"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { voidLeavesInRange } from "@/app/actions/attendance";

/**
 * Admin-only: void every leave dated in a period (one board or all) — for
 * weeks the game itself was on break, when nobody's absence should count
 * toward stats or the monthly quota. Voided rows stay in the log as
 * "ยกเลิกลา … (ยกเลิกทั้งช่วงโดยแอดมิน)" so it's always clear why a count dropped.
 */
export function VoidLeavesForm({ boards }: { boards: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    setDone(null);
    const from = String(formData.get("from") ?? "");
    const to = String(formData.get("to") ?? "");
    const boardName = boards.find((b) => b.id === formData.get("boardId"))?.name ?? "ALL boards";
    if (!confirm(`Void every leave on ${boardName} dated ${from} → ${to}? They will stop counting in stats and the monthly quota. This can't be undone in bulk.`)) return;
    startTransition(async () => {
      try {
        const res = await voidLeavesInRange(formData);
        if (!res.ok) {
          setError(res.error ?? "Failed");
          return;
        }
        setDone(res.cancelled ?? 0);
        formRef.current?.reset();
        router.refresh();
      } catch (err) {
        console.error("Failed to void leaves", err);
        setError("Failed. Please try again.");
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 transition hover:bg-zinc-800"
      >
        Void leaves for a period…
      </button>
    );
  }

  return (
    <form ref={formRef} action={handleSubmit} className="flex flex-col gap-2 rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
      <p className="text-xs text-zinc-400">
        Void every leave in a period (e.g. the game&apos;s scoring break) so it stops counting — one board or all.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-zinc-500">Board</label>
          <select name="boardId" className="rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none">
            <option value="">All boards</option>
            {boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-zinc-500">From</label>
          <input type="date" name="from" required className="[color-scheme:dark] rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-zinc-500">To</label>
          <input type="date" name="to" required className="[color-scheme:dark] rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none" />
        </div>
        <div className="flex min-w-40 flex-1 flex-col gap-1">
          <label className="text-[10px] text-zinc-500">Reason (shown in activity log)</label>
          <input
            type="text"
            name="reason"
            required
            maxLength={300}
            placeholder="e.g. พักการแข่งเก็บคะแนน"
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-rose-700 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-rose-600 disabled:opacity-50"
        >
          {pending ? "Voiding…" : "Void leaves"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-2 py-1.5 text-xs text-zinc-500 hover:text-zinc-200">
          Close
        </button>
      </div>
      {error && <p className="text-xs text-rose-400">{error}</p>}
      {done !== null && <p className="text-xs text-emerald-400">Voided {done} leave{done === 1 ? "" : "s"}.</p>}
    </form>
  );
}
