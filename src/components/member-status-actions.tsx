"use client";

import { useActionState, useState } from "react";
import type { Member } from "@/db/schema";
import {
  banMemberFromAuction,
  markMemberKicked,
  restoreMemberStatus,
  setMemberBenched,
  unbanMemberFromAuction,
  type UpdateMemberResult,
} from "@/app/actions/members";

const initialState: UpdateMemberResult = { ok: true };

const BAN_PRESETS = [
  { label: "1 day", days: 1 },
  { label: "1 week", days: 7 },
  { label: "2 weeks", days: 14 },
  { label: "1 month", days: 30 },
];

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

  // Currently banned = a recorded ban date that hasn't passed yet — a PAST
  // auctionBanUntil means a ban exists on record but already lapsed (kept
  // around so the member's most recent ban stays visible, see the column's
  // comment in schema.ts), which should render as "not banned" here.
  const isBanned = Boolean(member.auctionBanUntil && member.auctionBanUntil.getTime() > Date.now());
  const [banDays, setBanDays] = useState(7);

  const [banState, banAction, banPending] = useActionState(
    async (_prev: UpdateMemberResult, formData: FormData) =>
      banMemberFromAuction(member.id, Number(formData.get("days")), (formData.get("reason") as string) ?? ""),
    initialState
  );

  const boundUnban = unbanMemberFromAuction.bind(null, member.id);
  const [unbanState, unbanAction, unbanPending] = useActionState(
    async () => boundUnban(),
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
            : "For members who still have the Rooc role but are no longer playing — bench them to exclude them from the party system."}
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
          {benchPending ? "Processing..." : member.benched ? "Unbench" : "Bench (exclude from the party system)"}
        </button>
      </form>

      <div className="flex flex-col gap-2 border-t border-zinc-800 pt-4">
        <p className="text-xs text-zinc-500">
          {isBanned
            ? "Suspended from the loot auction queue (every category at once) — skipped when rounds are run, but keeps their exact queue position and picks back up automatically once this lapses."
            : "For a member who broke the rules during an auction round — suspends them from every loot category's queue for a set number of days. Their queue position is untouched; they're just skipped over while banned."}
        </p>

        {isBanned && member.auctionBanUntil ? (
          <>
            <p className="text-xs text-amber-300">
              Banned until{" "}
              <span className="font-medium">
                {member.auctionBanUntil.toLocaleString("en-US", {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: "Asia/Bangkok",
                })}
              </span>
              {member.auctionBanReason ? <> — reason: {member.auctionBanReason}</> : null}
            </p>
            {!unbanState.ok && unbanState.error && <p className="text-xs text-rose-400">{unbanState.error}</p>}
            <form action={unbanAction}>
              <button
                type="submit"
                disabled={unbanPending}
                className="self-start rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-60"
              >
                {unbanPending ? "Processing..." : "Lift Ban Early"}
              </button>
            </form>
          </>
        ) : (
          <form action={banAction} className="flex flex-col gap-2">
            {member.auctionBanUntil && (
              <p className="text-xs text-zinc-500">
                Last ban was until{" "}
                {member.auctionBanUntil.toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "Asia/Bangkok" })}
                {member.auctionBanReason ? <> ({member.auctionBanReason})</> : null} — already lapsed.
              </p>
            )}
            <div className="flex flex-wrap gap-1">
              {BAN_PRESETS.map((preset) => (
                <button
                  key={preset.days}
                  type="button"
                  onClick={() => setBanDays(preset.days)}
                  className={`rounded-lg border px-2.5 py-1 text-xs transition ${
                    banDays === preset.days
                      ? "border-amber-500 bg-amber-500/10 text-amber-300"
                      : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-400">Number of days</span>
              <input
                type="number"
                name="days"
                min={1}
                step={1}
                value={banDays}
                onChange={(e) => setBanDays(Number(e.target.value) || 1)}
                className="w-28 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-400">Reason (optional)</span>
              <input
                name="reason"
                className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500 focus:outline-none"
                placeholder="e.g. bid on behalf of a non-member"
              />
            </label>
            {!banState.ok && banState.error && <p className="text-xs text-rose-400">{banState.error}</p>}
            <button
              type="submit"
              disabled={banPending}
              className="self-start rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-300 transition hover:bg-rose-500/20 disabled:opacity-60"
            >
              {banPending ? "Processing..." : "Ban from Auction"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
