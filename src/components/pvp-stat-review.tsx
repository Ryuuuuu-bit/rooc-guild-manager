"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { reviewPvpStat } from "@/app/actions/pvp-stats";
import {
  REVIEW_STATUSES,
  isReviewStatus,
  reviewStatusColors,
  reviewStatusLabels,
  type ReviewStatus,
} from "@/lib/pvp-stat-review";

/** Small pill shown next to every submission — "รอตรวจ" (muted) until an admin reviews it, then ผ่าน/ไม่ผ่าน in the matching color. Read-only; everyone sees this, only admins get the button below to change it. */
export function PvpReviewBadge({ status }: { status: string | null }) {
  if (!isReviewStatus(status)) {
    return (
      <span className="inline-flex items-center rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400 ring-1 ring-inset ring-zinc-700">
        รอตรวจ
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${reviewStatusColors[status]}`}>
      {reviewStatusLabels[status]}
    </span>
  );
}

/** Admin-only control: opens a small modal to set PASS/FAIL (or clear it back to null) plus an optional note on what needs adjusting. One button per submission — review is per-row, not per-member, since a member who fails one week and fixes it the next gets a fresh row. */
export function PvpReviewButton({
  entryId,
  currentStatus,
  currentNote,
}: {
  entryId: string;
  currentStatus: string | null;
  currentNote: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<ReviewStatus | null>(isReviewStatus(currentStatus) ? currentStatus : null);
  const [note, setNote] = useState(currentNote ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    const result = await reviewPvpStat(entryId, status, note.trim() || null);
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md px-1.5 py-0.5 text-xs text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
      >
        ตรวจ
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-5"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-zinc-100">ตรวจสถิตินี้</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded px-1.5 py-0.5 text-zinc-500 transition hover:text-zinc-300"
              >
                ✕
              </button>
            </div>

            <div className="flex gap-2">
              {REVIEW_STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus((cur) => (cur === s ? null : s))}
                  className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium ring-1 ring-inset transition ${
                    status === s
                      ? reviewStatusColors[s]
                      : "bg-zinc-950 text-zinc-400 ring-zinc-800 hover:text-zinc-200"
                  }`}
                >
                  {reviewStatusLabels[s]}
                </button>
              ))}
            </div>

            <label className="flex flex-col gap-1 text-xs text-zinc-400">
              หมายเหตุ (ถ้ามี — ต้องปรับอะไรเพิ่มเติม)
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                placeholder="เช่น ใส่ CP มาให้ตรงกับในเกม"
                className="resize-none rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-sm text-zinc-100 focus:border-amber-500 focus:outline-none"
              />
            </label>

            {error && <p className="text-sm text-rose-400">{error}</p>}

            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  setStatus(null);
                  setNote("");
                }}
                className="text-xs text-zinc-500 transition hover:text-zinc-300"
              >
                ล้างค่า
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="rounded-lg bg-amber-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-amber-500 disabled:opacity-50"
              >
                {saving ? "กำลังบันทึก..." : "บันทึก"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
