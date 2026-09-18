"use client";

import { useState } from "react";
import {
  getAttendanceStatus,
  getBoardCheckinEventKey,
  getBoardEmoji,
  listDiscordChannels,
  postAttendanceMessage,
  setBoardCheckinEventKey,
  type BotMessageStatus,
} from "@/app/actions/bot-messages";
import type { DiscordChannel } from "@/lib/discord";
import { CHECKIN_EVENTS } from "@/lib/checkin-events";

/**
 * Admin tool: posts (or reposts) THIS board's "Leave" reaction message in a
 * Discord channel picked from a live dropdown. Everyone is assumed
 * attending unless they react — reacting puts them in the board's Busy/Leave
 * list, un-reacting brings them back, handled by the bot worker.
 */
export function PostAttendanceButton({ boardId, boardName }: { boardId: string; boardName: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [channels, setChannels] = useState<DiscordChannel[] | null>(null);
  const [status, setStatus] = useState<BotMessageStatus | null>(null);
  const [channelId, setChannelId] = useState("");
  const [emoji, setEmoji] = useState("🙋");
  const [checkinEventKey, setCheckinEventKey] = useState<string | null>(null);
  const [linkSaving, setLinkSaving] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);

  // Every branch below is wrapped in try/catch/finally rather than just
  // reading the ActionResult — a thrown rejection (a dropped DB connection
  // mid-request, a session that expired between opening this panel and
  // clicking Post) would otherwise skip the setLoading/setPosting/
  // setLinkSaving(false) call that follows it, leaving the button stuck
  // showing "Loading..."/"Posting..." forever with no error shown — the
  // finally block is what guarantees that reset happens either way.

  async function handleOpen() {
    setOpen(true);
    setLoading(true);
    setError(null);
    setLinkError(null);
    try {
      const [chRes, currentStatus, currentEmoji, currentEventKey] = await Promise.all([
        listDiscordChannels(),
        getAttendanceStatus(boardId),
        getBoardEmoji(boardId),
        getBoardCheckinEventKey(boardId),
      ]);
      if (!chRes.ok || !chRes.channels) {
        setError(chRes.error ?? "Failed to fetch channel list.");
        return;
      }
      setChannels(chRes.channels);
      setStatus(currentStatus);
      setChannelId(currentStatus?.channelId ?? chRes.channels[0]?.id ?? "");
      setEmoji(currentEmoji);
      setCheckinEventKey(currentEventKey);
    } catch (err) {
      console.error("Failed to load attendance-post panel", err);
      setError("Failed to load. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleLinkChange(nextKey: string) {
    const resolved = nextKey || null;
    setLinkSaving(true);
    setLinkError(null);
    try {
      const res = await setBoardCheckinEventKey(boardId, resolved);
      if (!res.ok) {
        setLinkError(res.error ?? "Failed to update the link.");
        return;
      }
      setCheckinEventKey(resolved);
    } catch (err) {
      console.error("Failed to update check-in event link", err);
      setLinkError("Failed to update the link. Please try again.");
    } finally {
      setLinkSaving(false);
    }
  }

  async function handlePost() {
    if (!channelId) return;
    setPosting(true);
    setError(null);
    try {
      const res = await postAttendanceMessage(boardId, channelId, emoji);
      if (!res.ok) {
        setError(res.error ?? "Failed to post.");
        return;
      }
      if (res.error) setError(res.error);
      const fresh = await getAttendanceStatus(boardId);
      setStatus(fresh);
    } catch (err) {
      console.error("Failed to post attendance message", err);
      setError("Failed to post. Please try again.");
    } finally {
      setPosting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 transition hover:bg-zinc-800"
      >
        Post Leave in Discord
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-16">
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-100">Post Leave Message — {boardName}</h2>
              <button type="button" onClick={() => setOpen(false)} className="rounded px-2 py-1 text-xs text-zinc-500 hover:text-zinc-200">
                Close ✕
              </button>
            </div>

            {loading && <p className="py-6 text-center text-sm text-zinc-500">Loading...</p>}

            {!loading && (
              <div className="flex flex-col gap-3">
                <p className="text-xs text-zinc-500">
                  The bot will post a message asking members to react with the emoji below if they are on leave this
                  round — no reaction = attending as usual. Anyone who reacts is automatically moved to this board&apos;s
                  &quot;Busy / Leave&quot; list (the bot needs &quot;Send Messages&quot; and &quot;Add Reactions&quot; permissions in the selected channel).
                </p>

                <label className="flex flex-col gap-1 text-xs text-zinc-400">
                  Emoji for this board (can be unique per board, e.g. GL uses 🙋 while WOE uses 🏰, so they are clearly distinguishable)
                  <input
                    type="text"
                    value={emoji}
                    onChange={(e) => setEmoji(e.target.value)}
                    maxLength={8}
                    placeholder="🙋"
                    className="w-20 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-center text-lg focus:border-amber-500 focus:outline-none"
                  />
                </label>

                <label className="flex flex-col gap-1 text-xs text-zinc-400">
                  Link to check-in event (controls when a &quot;ลา&quot; on this board actually locks in — waits for the
                  linked event to end instead of a flat timer — and whether it shows up in /checkin and /calendar)
                  <select
                    value={checkinEventKey ?? ""}
                    onChange={(e) => handleLinkChange(e.target.value)}
                    disabled={linkSaving}
                    className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500 focus:outline-none disabled:opacity-50"
                  >
                    <option value="">Not linked</option>
                    {CHECKIN_EVENTS.map((e) => (
                      <option key={e.key} value={e.key}>
                        {e.label}
                      </option>
                    ))}
                  </select>
                </label>
                {linkError && (
                  <p className="rounded-lg border border-rose-900/60 bg-rose-950/30 p-2 text-xs text-rose-300">{linkError}</p>
                )}

                {status && (
                  <p className="rounded-lg border border-emerald-900/60 bg-emerald-950/30 p-2 text-xs text-emerald-300">
                    A message is already posted for this board.{" "}
                    <a href={status.jumpUrl} target="_blank" rel="noreferrer" className="underline">
                      Open in Discord
                    </a>
                    {" "}— posting again will replace it.
                  </p>
                )}

                {error && (
                  <p className="rounded-lg border border-rose-900/60 bg-rose-950/30 p-2 text-xs text-rose-300">{error}</p>
                )}

                <select
                  value={channelId}
                  onChange={(e) => setChannelId(e.target.value)}
                  className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500 focus:outline-none"
                >
                  {(channels ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      #{c.name}
                    </option>
                  ))}
                </select>

                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={!channelId || posting}
                    onClick={handlePost}
                    className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {posting ? "Posting..." : status ? "Post Again (Replace Existing)" : "Post Message"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
