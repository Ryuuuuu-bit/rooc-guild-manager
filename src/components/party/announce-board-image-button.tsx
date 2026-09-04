"use client";

import { useState } from "react";
import { listDiscordChannels } from "@/app/actions/bot-messages";
import { announcePartyBoardImage } from "@/app/actions/party";
import type { DiscordChannel } from "@/lib/discord";

/**
 * Admin tool: renders the board's CURRENT layout as one PNG (every group,
 * every party — see renderPartyBoardImage) and posts it to a Discord
 * channel picked from a live dropdown. Replaces the old manual workflow of
 * flipping on "โหมดแคปภาพ" and screenshotting the page by hand — this does
 * the same job (a clean picture with no admin chrome in it, since the
 * image is drawn from scratch rather than captured from the DOM) in one
 * click, straight from the current saved state.
 */
export function AnnounceBoardImageButton({
  boardId,
  boardName,
  lastChannelId,
}: {
  boardId: string;
  boardName: string;
  /** Channel this board was last announced to — pre-selected in the
   * dropdown below so an admin doesn't have to re-pick the same channel
   * every time, while still being free to change it. */
  lastChannelId?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [channels, setChannels] = useState<DiscordChannel[] | null>(null);
  const [channelId, setChannelId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [posted, setPosted] = useState(false);

  async function handleOpen() {
    setOpen(true);
    setLoading(true);
    setError(null);
    setPosted(false);
    const res = await listDiscordChannels();
    setLoading(false);
    if (!res.ok || !res.channels) {
      setError(res.error ?? "Failed to fetch channel list.");
      return;
    }
    setChannels(res.channels);
    const remembered = lastChannelId && res.channels.some((c) => c.id === lastChannelId) ? lastChannelId : null;
    setChannelId(remembered ?? res.channels[0]?.id ?? "");
  }

  async function handlePost() {
    if (!channelId) return;
    setPosting(true);
    setError(null);
    const res = await announcePartyBoardImage(boardId, channelId);
    setPosting(false);
    if (!res.ok) {
      setError(res.error ?? "Failed to post.");
      return;
    }
    setPosted(true);
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 transition hover:bg-zinc-800"
      >
        Announce as Image
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-16">
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-100">Announce Party Board as Image — {boardName}</h2>
              <button type="button" onClick={() => setOpen(false)} className="rounded px-2 py-1 text-xs text-zinc-500 hover:text-zinc-200">
                Close ✕
              </button>
            </div>

            {loading && <p className="py-6 text-center text-sm text-zinc-500">Loading...</p>}

            {!loading && (
              <div className="flex flex-col gap-3">
                <p className="text-xs text-zinc-500">
                  Generates an image from the current layout (every group, every party + the Busy/Leave list) and
                  posts it immediately to the selected channel — people not yet placed are excluded (the bot needs
                  &quot;Send Messages&quot; and &quot;Attach Files&quot; permissions in the selected channel).
                </p>

                {posted && (
                  <p className="rounded-lg border border-emerald-900/60 bg-emerald-950/30 p-2 text-xs text-emerald-300">
                    Posted successfully ✅
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
                    {posting ? "Generating image..." : "Post Party Board Image"}
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
