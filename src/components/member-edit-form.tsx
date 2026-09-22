"use client";

import { useActionState } from "react";
import type { Member } from "@/db/schema";
import { updateMemberProfile, type UpdateMemberResult } from "@/app/actions/members";
import { useJobClasses } from "@/components/job-classes-provider";
import { MAX_ALT_CLASSES } from "@/lib/alt-classes";

interface Props {
  member: Member;
}

const initialState: UpdateMemberResult = { ok: true };

export function MemberEditForm({ member }: Props) {
  const { options: classOptions } = useJobClasses();
  const boundAction = updateMemberProfile.bind(null, member.id);
  const [state, formAction, pending] = useActionState(
    async (_prev: UpdateMemberResult, formData: FormData) => boundAction(formData),
    initialState
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-400">In-game Name (ROOC)</span>
          <input
            name="inGameName"
            defaultValue={member.inGameName ?? ""}
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-zinc-100 focus:border-amber-500 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-400">Class</span>
          <select
            name="characterClass"
            defaultValue={member.characterClass ?? ""}
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-zinc-100 focus:border-amber-500 focus:outline-none"
          >
            <option value="">- Not set -</option>
            {classOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <span className="text-xs text-zinc-500">
            Can be edited here or from the party board — the same value is used everywhere
          </span>
        </label>
      </div>

      <fieldset className="flex flex-col gap-1 text-sm">
        <legend className="text-zinc-400">Secondary classes (can also play — up to {MAX_ALT_CLASSES})</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-1">
          {classOptions.map((c) => (
            <label key={c} className="flex items-center gap-1.5 text-xs text-zinc-300">
              <input type="checkbox" name="altClasses" value={c} defaultChecked={member.altClasses.includes(c)} className="accent-amber-500" />
              {c}
            </label>
          ))}
        </div>
        <span className="text-xs text-zinc-500">
          Shown as tags on the party board and used for substitute suggestions. Members set these themselves from the
          Discord &quot;เลือกอาชีพ&quot; button too.
        </span>
      </fieldset>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-zinc-400">Internal Note (admins only)</span>
        <textarea
          name="notes"
          rows={3}
          defaultValue={member.notes ?? ""}
          className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-zinc-100 focus:border-amber-500 focus:outline-none"
        />
      </label>

      {!state.ok && state.error && (
        <p className="text-sm text-rose-400">{state.error}</p>
      )}

      <div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </form>
  );
}
