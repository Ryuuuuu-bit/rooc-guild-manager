// Small helper around the Discord REST API. Used by both the Next.js app
// (OAuth membership/role checks) and the bot worker (initial roster sync).

const API_BASE = "https://discord.com/api/v10";

export class DiscordApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = "DiscordApiError";
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Bot-token authenticated request (server-to-server, used by the bot worker).
 * Discord's reaction endpoints in particular have a tight per-route rate
 * limit (roughly 1 request/0.25s) — posting several reactions back-to-back
 * (e.g. seeding all class emojis on a fresh message) reliably triggers a 429.
 * On 429 we back off for the server-provided `retry_after` (falling back to
 * a small default) and retry, up to a few attempts, rather than surfacing a
 * transient rate-limit as a hard failure to the admin.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- callers rely on this being untyped JSON, same as before this helper gained retry logic.
export async function discordBotFetch(path: string, init: RequestInit = {}, retriesLeft = 5): Promise<any> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error("DISCORD_BOT_TOKEN is not set");

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  if (res.status === 429 && retriesLeft > 0) {
    const body = await res.text().catch(() => "");
    let retryAfterSeconds = 0.5;
    try {
      const parsed = body ? JSON.parse(body) : null;
      if (typeof parsed?.retry_after === "number") retryAfterSeconds = parsed.retry_after;
    } catch {
      // Non-JSON body — fall back to the default backoff above.
    }
    await sleep(Math.ceil(retryAfterSeconds * 1000) + 50);
    return discordBotFetch(path, init, retriesLeft - 1);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new DiscordApiError(
      `Discord API ${path} failed: ${res.status} ${body}`,
      res.status
    );
  }

  // DELETE/PUT reaction endpoints (and some others) return 204 No Content —
  // no body to parse.
  if (res.status === 204) return undefined;
  const text = await res.text();
  return text ? JSON.parse(text) : undefined;
}

/** OAuth access-token authenticated request (used during user sign-in). */
export async function discordUserFetch(path: string, accessToken: string) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new DiscordApiError(
      `Discord API ${path} failed: ${res.status} ${body}`,
      res.status
    );
  }

  return res.json();
}

/**
 * Kicks a member from the guild via the bot's REST credentials — an actual
 * Discord removal, not just an in-app status flag. Requires the bot to have
 * the "Kick Members" permission and a role positioned above the target
 * member's highest role (Discord's normal kick-permission rules), otherwise
 * this throws a DiscordApiError with status 403.
 */
export async function kickGuildMember(guildId: string, userId: string, reason?: string): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error("DISCORD_BOT_TOKEN is not set");

  const res = await fetch(`${API_BASE}/guilds/${guildId}/members/${userId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bot ${token}`,
      // Shows up as the kick reason in Discord's own audit log.
      ...(reason ? { "X-Audit-Log-Reason": encodeURIComponent(reason).slice(0, 500) } : {}),
    },
  });

  // Kick succeeds with 204 No Content (no body to parse). Treat "already
  // not a member" as success too — the end state we want is already true.
  if (res.status === 204 || res.status === 404) return;

  const body = await res.text().catch(() => "");
  throw new DiscordApiError(`Discord API kick failed: ${res.status} ${body}`, res.status);
}

export interface DiscordChannel {
  id: string;
  name: string;
  type: number;
  position: number;
  parent_id: string | null;
}

// Discord channel type values relevant here (full enum has many more).
const GUILD_TEXT = 0;
const GUILD_ANNOUNCEMENT = 5;

/**
 * Lists the guild's regular text channels the bot can post reaction messages
 * in (excludes voice/category/forum/etc). Used to populate a channel-picker
 * in the admin UI rather than hard-coding a channel ID — the bot only needs
 * "View Channel" + "Send Messages" + "Add Reactions" (+ "Manage Messages" to
 * enforce single-choice on the class-select message) in whichever channel
 * gets picked.
 */
export async function listGuildTextChannels(guildId: string): Promise<DiscordChannel[]> {
  const channels: DiscordChannel[] = await discordBotFetch(`/guilds/${guildId}/channels`);
  return channels
    .filter((c) => c.type === GUILD_TEXT || c.type === GUILD_ANNOUNCEMENT)
    .sort((a, b) => a.position - b.position);
}

/**
 * Edits a message's content in place (bots can always edit their own
 * messages, no extra permission needed). Used to update a reaction message
 * — e.g. adding a newly-introduced class — without deleting/recreating it,
 * which would wipe every member's existing reaction and force everyone to
 * re-click, not just members affected by the change.
 */
export async function editChannelMessage(channelId: string, messageId: string, content: string): Promise<void> {
  await discordBotFetch(`/channels/${channelId}/messages/${messageId}`, {
    method: "PATCH",
    body: JSON.stringify({ content }),
  });
}

/** Posts a plain-text message to a channel via the bot, returning the created message's id. */
export async function createChannelMessage(channelId: string, content: string): Promise<string> {
  const message = await discordBotFetch(`/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
  return message.id as string;
}

/** Adds the bot's own reaction to a message — used to seed the emoji options members then click. */
export async function addMessageReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
  await discordBotFetch(`/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`, {
    method: "PUT",
  });
}

/** Best-effort delete of a previously-posted reaction message (e.g. when replacing it with a fresh one). */
export async function deleteChannelMessage(channelId: string, messageId: string): Promise<void> {
  try {
    await discordBotFetch(`/channels/${channelId}/messages/${messageId}`, { method: "DELETE" });
  } catch {
    // Already deleted / channel gone / bot lost access — fine, we're
    // replacing the tracked row either way.
  }
}

export interface DiscordGuildMember {
  user?: {
    id: string;
    username: string;
    global_name: string | null;
    avatar: string | null;
  };
  roles: string[];
  joined_at: string;
  nick: string | null;
}

/** Fetch every member of the configured guild, paginating through the REST API. */
export async function fetchAllGuildMembers(
  guildId: string
): Promise<DiscordGuildMember[]> {
  const members: DiscordGuildMember[] = [];
  let after = "0";

  while (true) {
    const batch: DiscordGuildMember[] = await discordBotFetch(
      `/guilds/${guildId}/members?limit=1000&after=${after}`
    );
    if (batch.length === 0) break;

    members.push(...batch);
    after = batch[batch.length - 1].user!.id;

    if (batch.length < 1000) break;
  }

  return members;
}

/** Build a CDN URL for a member's avatar, falling back to Discord's default avatar. */
export function discordAvatarUrl(
  discordId: string,
  avatarHash: string | null | undefined,
  discriminatorFallback = 0
): string {
  if (avatarHash) {
    const ext = avatarHash.startsWith("a_") ? "gif" : "png";
    return `https://cdn.discordapp.com/avatars/${discordId}/${avatarHash}.${ext}?size=128`;
  }
  // Modern default-avatar index derived from the user's snowflake ID.
  const index =
    Number((BigInt(discordId) >> BigInt(22)) % BigInt(6)) ||
    discriminatorFallback % 5;
  return `https://cdn.discordapp.com/embed/avatars/${index % 6}.png`;
}
