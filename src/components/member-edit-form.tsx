"use client";

import { useActionState } from "react";
import type { Member } from "@/db/schema";
import { updateMemberProfile, type UpdateMemberResult } from "@/app/actions/members";
import { CLASS_OPTIONS } from "@/lib/classes";

interface Props {
  member: Member;
}

const initialState: UpdateMemberResult = { ok: true };

export function MemberEditForm({ member }: Props) {
  const boundAction = updateMemberProfile.bind(null, member.id);
  const [state, formAction, pending] = useActionState(
    async (_prev: UpdateMemberResult, formData: FormData) => boundAction(formData),
    initialState
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-400">ชื่อในเกม (ROOC)</span>
          <input
            name="inGameName"
            defaultValue={member.inGameName ?? ""}
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-zinc-100 focus:border-indigo-500 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-400">คลาส</span>
          <select
            name="characterClass"
            defaultValue={member.characterClass ?? ""}
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-zinc-100 focus:border-indigo-500 focus:outline-none"
          >
            <option value="">- ไม่ระบุ -</option>
            {CLASS_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <span className="text-xs text-zinc-500">
            แก้จากหน้านี้หรือจากหน้าจัดปาตี้ก็ได้ ค่าเดียวกันใช้ทุกกระดาน
          </span>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-400">เลเวล</span>
          <input
            type="number"
            min={0}
            name="level"
            defaultValue={member.level ?? ""}
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-zinc-100 focus:border-indigo-500 focus:outline-none"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-zinc-400">โน้ตภายใน (แอดมินเท่านั้นที่เห็น)</span>
        <textarea
          name="notes"
          rows={3}
          defaultValue={member.notes ?? ""}
          className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-zinc-100 focus:border-indigo-500 focus:outline-none"
        />
      </label>

      {!state.ok && state.error && (
        <p className="text-sm text-rose-400">{state.error}</p>
      )}

      <div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "กำลังบันทึก..." : "บันทึกการเปลี่ยนแปลง"}
        </button>
      </div>
    </form>
  );
}
