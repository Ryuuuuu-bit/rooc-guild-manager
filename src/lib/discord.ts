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

/** Bot-token authenticated request (server-to-server, used by the bot worker). */
export async function discordBotFetch(path: string, init: RequestInit = {}) {
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

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new DiscordApiError(
      `Discord API ${path} failed: ${res.status} ${body}`,
      res.status
    );
  }

  return res.json();
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
