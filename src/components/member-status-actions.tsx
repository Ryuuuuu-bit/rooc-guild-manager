"use client";

import { useActionState } from "react";
import type { Member } from "@/db/schema";
import {
  markMemberKicked,
  restoreMemberStatus,
  type UpdateMemberResult,
} from "@/app/actions/members";

const initialState: UpdateMemberResult = { ok: true };

export function MemberStatusActions({ member }: { member: Member }) {
  const boundKick = markMemberKicked.bind(null, member.id);
  const [kickState, kickAction, kickPending] = useActionState(
    async (_prev: UpdateMemberResult, formData: FormData) =>
      boundKick((formData.get("reason") as string) ?? ""),
    initialState
  );

  const boundRestore = restoreMemberStatus.bind(null, member.id);
  const [, restoreAction, restorePending] = useActionState(
    async () => boundRestore(),
    initialState
  );

  if (member.status === "ACTIVE") {
    return (
      <form action={kickAction} className="flex flex-col gap-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-400">เหตุผลที่เตะออก (ไม่บังคับ)</span>
          <input
            name="reason"
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-rose-500 focus:outline-none"
            placeholder="เช่น ไม่ทำกิจกรรมกิลด์เกิน 30 วัน"
          />
        </label>
        {!kickState.ok && kickState.error && (
          <p className="text-xs text-rose-400">{kickState.error}</p>
        )}
        <button
          type="submit"
          disabled={kickPending}
          className="self-start rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-300 transition hover:bg-rose-500/20 disabled:opacity-60"
        >
          {kickPending ? "กำลังดำเนินการ..." : "ทำเครื่องหมายว่าถูกเตะออก"}
        </button>
      </form>
    );
  }

  return (
    <form action={restoreAction}>
      <button
        type="submit"
        disabled={restorePending}
        className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-60"
      >
        {restorePending ? "กำลังดำเนินการ..." : "เปลี่ยนสถานะกลับเป็น Active"}
      </button>
    </form>
  );
}
