"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addManualLeave } from "@/app/actions/attendance";

/**
 * Admin-only form for logging a "ลา" a member reported outside Discord
 * (DM, in person, etc.) — never went through the reaction flow, so
 * without this there's no way to reflect it in /attendance stats.
 */
export function LogManualLeaveForm({
  memberId,
  todayStr,
  boards,
}: {
  memberId: string;
  todayStr: string;
  /** For attributing the leave to a specific board (e.g. "GL"/"WOE") on
   * the /attendance breakdown — optional, same as a real reaction. */
  boards: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    setSuccess(false);
    startTransition(async () => {
      const res = await addManualLeave(memberId, formData);
      if (!res.ok) {
        setError(res.error ?? "บันทึกไม่สำเร็จ");
        return;
      }
      setSuccess(true);
      formRef.current?.reset();
      router.refresh();
    });
  }

  return (
    <form ref={formRef} action={handleSubmit} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-zinc-500">วันที่ลา</label>
          <input
            type="date"
            name="date"
            max={todayStr}
            required
            className="[color-scheme:dark] rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none"
          />
        </div>
        <div className="flex min-w-32 flex-1 flex-col gap-1">
          <label className="text-[10px] text-zinc-500">เหตุผล (ถ้ามี)</label>
          <input
            type="text"
            name="reason"
            placeholder="เช่น แจ้งลาส่วนตัวทาง DM"
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
          />
        </div>
        {boards.length > 0 && (
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-zinc-500">ลาของกระดาน (ถ้าระบุได้)</label>
            <select
              name="boardId"
              defaultValue=""
              className="rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none"
            >
              <option value="">ไม่ระบุ</option>
              {boards.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "กำลังบันทึก..." : "บันทึกการลา"}
        </button>
      </div>
      {error && <p className="text-xs text-rose-400">{error}</p>}
      {success && <p className="text-xs text-emerald-400">บันทึกแล้ว — นับในสถิติการลาทันที</p>}
    </form>
  );
}
