// One place every "tell the admins something" message in the bot goes
// through. Imports only from src/lib (never from another bot/*.ts file) so
// any bot module can import it without creating a cycle — same rule as the
// other leaf helpers in this folder.
//
// Delivery is CHANNEL ONLY: one post in DISCORD_ADMIN_NOTIFY_CHANNEL_ID.
// Every admin sees the same message at once, it has history, admins can
// thread replies under it, and it never hits Discord's "You are opening
// direct messages too fast" limit (code 40003) — which the old per-admin DM
// path tripped with just 4 leaves × 2 admins in one midnight pass, so
// admins silently got nothing for most of that night's leaves.
//
// There is deliberately NO DM fallback anymore (admin's call: the bot must
// not DM admins at all). With the channel unset, admin notifications are
// simply dropped with one warning in the log per process — the leave
// itself, the party board, /attendance etc. are all unaffected, this is
// only the heads-up. DISCORD_LEAVE_NOTIFY_USER_IDS is no longer read.
//
// Env is read straight off process.env (bot convention — see
// DISCORD_TRACKED_ROLE_NAME in sync.ts) rather than via src/lib/env, which
// throws on missing web-only vars this bot doesn't need.
import { createChannelMessage } from "../src/lib/discord";

function adminChannelId(): string | null {
  const id = (process.env.DISCORD_ADMIN_NOTIFY_CHANNEL_ID ?? "").trim();
  return id || null;
}

let warnedUnconfigured = false;

/** True when a delivery target is configured — lets callers skip the DB
 * work of building a message nobody would receive. */
export function adminNotifyConfigured(): boolean {
  const configured = adminChannelId() !== null;
  if (!configured && !warnedUnconfigured) {
    warnedUnconfigured = true;
    console.warn("[bot] DISCORD_ADMIN_NOTIFY_CHANNEL_ID is not set — admin notifications are disabled (no DM fallback)");
  }
  return configured;
}

/**
 * Best-effort delivery of one admin-facing message. Never throws — a
 * Discord failure is logged and swallowed, since every caller treats this
 * as a side notification, not part of the work being reported on.
 *
 * Discord caps a message at 2000 characters; anything longer is split on
 * line boundaries into consecutive messages rather than truncated, so a
 * long digest never silently loses its tail.
 */
export async function notifyAdmins(text: string): Promise<void> {
  if (!adminNotifyConfigured()) return;
  const channelId = adminChannelId()!;

  for (const chunk of splitForDiscord(text)) {
    try {
      await createChannelMessage(channelId, chunk);
    } catch (err) {
      console.error(`[bot] failed to post admin notification to channel ${channelId}`, err);
      return;
    }
  }
}

const DISCORD_MESSAGE_LIMIT = 2000;

function splitForDiscord(text: string): string[] {
  if (text.length <= DISCORD_MESSAGE_LIMIT) return [text];
  const chunks: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    // A single line longer than the limit is hard-cut — shouldn't happen
    // with the short per-member lines these messages are built from.
    const piece = line.length > DISCORD_MESSAGE_LIMIT ? line.slice(0, DISCORD_MESSAGE_LIMIT) : line;
    if (current.length + piece.length + 1 > DISCORD_MESSAGE_LIMIT) {
      if (current) chunks.push(current);
      current = piece;
    } else {
      current = current ? `${current}\n${piece}` : piece;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
