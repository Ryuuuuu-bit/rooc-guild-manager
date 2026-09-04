"use client";

import { useState } from "react";
import {
  getClassSelectStatus,
  listDiscordChannels,
  postClassSelectMessage,
  type BotMessageStatus,
} from "@/app/actions/bot-messages";
import type { DiscordChannel } from "@/lib/discord";

/**
 * Admin tool: posts (or reposts) the guild-wide "Select Class" reaction
 * message in a Discord channel the admin picks from a live dropdown (no
 * hard-coded channel — see `listDiscordChannels`). Members react with the
 * class emoji that matches their in-game job and the bot updates their
 * profile automatically.
 */
export function ClassSelectBroadcastPanel() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [channels, setChannels] = useState<DiscordChannel[] | null>(null);
  const [status, setStatus] = useState<BotMessageStatus | null>(null);
  const [channelId, setChannelId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);

  async function handleOpen() {
    setOpen(true);
    setLoading(true);
    setError(null);
    const [chRes, currentStatus] = await Promise.all([listDiscordChannels(), getClassSelectStatus()]);
    setLoading(false);
    if (!chRes.ok || !chRes.channels) {
      setError(chRes.error ?? "Failed to fetch channel list.");
      return;
    }
    setChannels(chRes.channels);
    setStatus(currentStatus);
    setChannelId(currentStatus?.channelId ?? chRes.channels[0]?.id ?? "");
  }

  async function handlePost() {
    if (!channelId) return;
    setPosting(true);
    setError(null);
    const res = await postClassSelectMessage(channelId);
    setPosting(false);
    if (!res.ok) {
      setError(res.error ?? "Failed to post.");
      return;
    }
    // ok can still carry a warning (e.g. some emojis failed to seed) —
    // surface it rather than silently discarding it.
    if (res.error) setError(res.error);
    const fresh = await getClassSelectStatus();
    setStatus(fresh);
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="rounded-lg border border-dashed border-zinc-700 px-3 py-2 text-sm text-zinc-400 transition hover:border-amber-500 hover:text-amber-300"
      >
        Post Class Select in Discord
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-16">
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-100">Post Class Select Message</h2>
              <button type="button" onClick={() => setOpen(false)} className="rounded px-2 py-1 text-xs text-zinc-500 hover:text-zinc-200">
                Close ✕
              </button>
            </div>

            {loading && <p className="py-6 text-center text-sm text-zinc-500">Loading...</p>}

            {!loading && (
              <div className="flex flex-col gap-3">
                <p className="text-xs text-zinc-500">
                  The bot will post a message asking members to react with their own class — the system updates
                  their class automatically when they react (the bot needs &quot;Send Messages&quot;, &quot;Add Reactions&quot;, and
                  &quot;Manage Messages&quot; permission in the selected channel).
                </p>

                {status && (
                  <p className="rounded-lg border border-emerald-900/60 bg-emerald-950/30 p-2 text-xs text-emerald-300">
                    A message is already posted.{" "}
                    <a href={status.jumpUrl} target="_blank" rel="noreferrer" className="underline">
                      Open in Discord
                    </a>
                    {" "}— clicking &quot;Update&quot; edits the existing message (e.g. to add a new class) without removing
                    reactions members have already made. Choosing a different channel posts a new message instead.
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
                    {posting ? "Posting..." : status ? "Update Existing Message" : "Post Message"}
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
