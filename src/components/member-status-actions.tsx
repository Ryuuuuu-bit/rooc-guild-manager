"use client";

import { useActionState } from "react";
import type { Member } from "@/db/schema";
import {
  markMemberKicked,
  restoreMemberStatus,
  setMemberBenched,
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

  const boundBench = setMemberBenched.bind(null, member.id, !member.benched);
  const [, benchAction, benchPending] = useActionState(
    async () => boundBench(),
    initialState
  );

  return (
    <div className="flex flex-col gap-4">
      {member.status === "ACTIVE" ? (
        <form
          action={kickAction}
          onSubmit={(e) => {
            if (!confirm(`เตะ ${member.discordUsername} ออกจากกิลด์ (และออกจาก Discord server จริงด้วย)? การกระทำนี้ย้อนกลับไม่ได้ — ต้องเชิญเข้าเซิร์ฟเวอร์ใหม่เอง`)) {
              e.preventDefault();
            }
          }}
          className="flex flex-col gap-2"
        >
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-400">เหตุผลที่เตะออก (ไม่บังคับ — จะโชว์ใน Discord audit log ด้วย)</span>
            <input
              name="reason"
              className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-rose-500 focus:outline-none"
              placeholder="เช่น ไม่ทำกิจกรรมกิลด์เกิน 30 วัน"
            />
          </label>
          <p className="text-xs text-zinc-500">
            เตะปุ่มนี้จะเตะออกจาก Discord server จริงด้วย (ไม่ใช่แค่ทำเครื่องหมายในระบบ)
          </p>
          {!kickState.ok && kickState.error && (
            <p className="text-xs text-rose-400">{kickState.error}</p>
          )}
          {kickState.ok && kickState.warning && (
            <p className="text-xs text-amber-400">{kickState.warning}</p>
          )}
          <button
            type="submit"
            disabled={kickPending}
            className="self-start rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-300 transition hover:bg-rose-500/20 disabled:opacity-60"
          >
            {kickPending ? "กำลังดำเนินการ..." : "เตะออกจากกิลด์ (Discord ด้วย)"}
          </button>
        </form>
      ) : (
        <form action={restoreAction}>
          <button
            type="submit"
            disabled={restorePending}
            className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-60"
          >
            {restorePending ? "กำลังดำเนินการ..." : "เปลี่ยนสถานะกลับเป็น Active"}
          </button>
        </form>
      )}

      <form action={benchAction} className="flex flex-col gap-1 border-t border-zinc-800 pt-4">
        <p className="text-xs text-zinc-500">
          {member.benched
            ? "สมาชิกคนนี้ยังมี role Rooc อยู่ แต่ถูกพักไม่นับในระบบจัดปาตี้"
            : "สำหรับคนที่ยังมี role Rooc แต่ไม่ได้เล่นแล้ว — พักไว้เพื่อไม่ให้ขึ้นในระบบจัดปาตี้"}
        </p>
        <button
          type="submit"
          disabled={benchPending}
          className={`self-start rounded-lg border px-3 py-1.5 text-xs font-medium transition disabled:opacity-60 ${
            member.benched
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
              : "border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
          }`}
        >
          {benchPending ? "กำลังดำเนินการ..." : member.benched ? "เลิกพักการเล่น" : "พักการเล่น (ไม่รวมในระบบจัดปาตี้)"}
        </button>
      </form>
    </div>
  );
}
