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
            if (!confirm(`Kick ${member.discordUsername} from the guild (and remove them from the Discord server too)? This cannot be undone — they'd need to be re-invited.`)) {
              e.preventDefault();
            }
          }}
          className="flex flex-col gap-2"
        >
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-400">Reason for kick (optional — also shown in the Discord audit log)</span>
            <input
              name="reason"
              className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-rose-500 focus:outline-none"
              placeholder="e.g. inactive in guild activities for over 30 days"
            />
          </label>
          <p className="text-xs text-zinc-500">
            This button will also remove them from the Discord server (not just mark them in the system).
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
            {kickPending ? "Processing..." : "Kick from Guild (Discord too)"}
          </button>
        </form>
      ) : (
        <form action={restoreAction}>
          <button
            type="submit"
            disabled={restorePending}
            className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-60"
          >
            {restorePending ? "Processing..." : "Restore to Active"}
          </button>
        </form>
      )}

      <form action={benchAction} className="flex flex-col gap-1 border-t border-zinc-800 pt-4">
        <p className="text-xs text-zinc-500">
          {member.benched
            ? "This member still has the Rooc role, but is benched and excluded from the party system."
            : "For members who still have the Rooc role but are no longer playing — bench them to exclude from the party system."}
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
          {benchPending ? "Processing..." : member.benched ? "Unbench" : "Bench (exclude from party system)"}
        </button>
      </form>
    </div>
  );
}
