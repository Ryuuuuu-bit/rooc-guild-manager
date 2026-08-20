"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addManualLeave } from "@/app/actions/attendance";

/**
 * Admin-only form for logging a "ลา" a member reported outside Discord
 * (DM, in person, etc.) — never went through the reaction flow, so
 * without this there's no way to reflect it in /attendance stats.
 */
export function LogManualLeaveForm({ memberId, todayStr }: { memberId: string; todayStr: string }) {
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
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none"
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
