import { and, desc, eq } from "drizzle-orm";
import type { Client, VoiceState } from "discord.js";
import { db } from "../src/db";
import { members, voiceAttendanceEvents } from "../src/db/schema";
import { allWatchedChannelIds } from "../src/lib/checkin-events";

// Watched-channel list (which channels, and which check-in event each
// belongs to) lives in ONE place — src/lib/checkin-events.ts — shared with
// the web app's report page. Edit there, not here.
const WATCHED_VOICE_CHANNEL_IDS: readonly string[] = allWatchedChannelIds();
const watchedChannelSet = new Set(WATCHED_VOICE_CHANNEL_IDS);

async function logVoiceEvent(discordId: string, channelId: string, type: "JOIN" | "LEAVE") {
  const member = await db.query.members.findFirst({ where: eq(members.discordId, discordId) });
  // Not a tracked member (no Rooc role, or already marked LEFT/KICKED) —
  // nothing meaningful to attribute this to.
  if (!member) return;
  await db.insert(voiceAttendanceEvents).values({ memberId: member.id, channelId, type });
}

/**
 * Fires on every voice state change in the guild — joins, leaves, and
 * moves between channels (also mute/deafen toggles, filtered out below
 * since channelId doesn't change for those). Only JOIN/LEAVE transitions
 * into or out of a watched channel get logged; moving between two
 * *unwatched* channels, or muting/deafening in place, is a no-op.
 */
export async function handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState) {
  if (newState.member?.user.bot) return;
  const oldChannelId = oldState.channelId;
  const newChannelId = newState.channelId;
  if (oldChannelId === newChannelId) return; // not a channel move (mute/deafen/etc.)

  const discordId = newState.id;
  const wasWatched = oldChannelId ? watchedChannelSet.has(oldChannelId) : false;
  const isWatched = newChannelId ? watchedChannelSet.has(newChannelId) : false;

  // A direct switch between two watched channels (e.g. the GL event's two
  // team rooms) logs a LEAVE then a JOIN back-to-back — deliberate, not a
  // bug: the check-in report treats presence in any of an event's channels
  // identically, and reconstructing sessions from consecutive JOIN/LEAVE
  // pairs (see getCheckinReport) only cares that the two timestamps are
  // adjacent, so this doesn't create a gap in their counted presence.
  if (wasWatched) await logVoiceEvent(discordId, oldChannelId!, "LEAVE");
  if (isWatched) await logVoiceEvent(discordId, newChannelId!, "JOIN");
}

/**
 * Called once on bot startup (see bot/index.ts). Backfills a synthetic JOIN
 * for anyone already sitting in a watched channel at the moment the bot
 * comes online — without this, a redeploy mid-session would silently miss
 * everyone who joined before the restart, since voiceStateUpdate only
 * fires on a *change*, not on the bot simply starting to observe an
 * already-current state. Skips anyone whose most recent logged event for
 * that channel is already an unmatched JOIN, so this is safe to call on
 * every restart without ever double-counting a session that was already
 * open. Known limitation: their counted presence for this session starts
 * at the restart moment, not their real (earlier, unrecorded) join time.
 */
export async function reconcileVoicePresence(client: Client) {
  for (const channelId of WATCHED_VOICE_CHANNEL_IDS) {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isVoiceBased()) continue;

    for (const [, voiceMember] of channel.members) {
      if (voiceMember.user.bot) continue;
      const member = await db.query.members.findFirst({ where: eq(members.discordId, voiceMember.id) });
      if (!member) continue;

      const lastEvent = await db.query.voiceAttendanceEvents.findFirst({
        where: and(eq(voiceAttendanceEvents.memberId, member.id), eq(voiceAttendanceEvents.channelId, channelId)),
        orderBy: desc(voiceAttendanceEvents.createdAt),
      });
      if (lastEvent?.type === "JOIN") continue; // session already open — nothing to backfill

      await db.insert(voiceAttendanceEvents).values({ memberId: member.id, channelId, type: "JOIN" });
    }
  }
}
