// Centralised, typed access to required environment variables so a missing
// one fails fast with a clear message instead of a confusing runtime error
// somewhere deep in the app.

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. See .env.example.`
    );
  }
  return value;
}

export const env = {
  get databaseUrl() {
    return required("DATABASE_URL");
  },
  get discordClientId() {
    return required("DISCORD_CLIENT_ID");
  },
  get discordClientSecret() {
    return required("DISCORD_CLIENT_SECRET");
  },
  get discordBotToken() {
    return required("DISCORD_BOT_TOKEN");
  },
  get discordGuildId() {
    return required("DISCORD_GUILD_ID");
  },
  get authSecret() {
    return required("AUTH_SECRET");
  },
  /** Comma-separated Discord role IDs that grant admin access in the app. */
  get adminRoleIds(): string[] {
    return (process.env.DISCORD_ADMIN_ROLE_IDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  },
  /** Comma-separated Discord user IDs that grant admin access, regardless of role. */
  get adminUserIds(): string[] {
    return (process.env.DISCORD_ADMIN_USER_IDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  },
  /**
   * Name of the Discord role that gates guild-roster membership. Only
   * members currently holding this role are tracked/shown in the app.
   * Matched case-insensitively. Defaults to "Rooc".
   */
  get trackedRoleName(): string {
    return (process.env.DISCORD_TRACKED_ROLE_NAME ?? "Rooc").trim();
  },
  /**
   * Comma-separated Discord role names to surface in the app's role filter
   * and role badges (case-insensitive). The guild's Discord server is a
   * shared multi-game community with many roles (other games, bots,
   * general community roles) that are just noise for guild management —
   * this keeps the UI scoped to roles that actually matter here. Defaults
   * to the guild-management roles identified when this was set up.
   */
  get managementRoleNames(): string[] {
    return (process.env.DISCORD_MANAGEMENT_ROLE_NAMES ?? "ADMIN,MOD,Rooc,Strategist")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  },
  /**
   * Google Sheet ID + tab (gid) that members' character class can be synced
   * from ("ซิงค์จาก Sheet" button on the Members page). The sheet must be
   * shared as "Anyone with the link can view". Defaults to the guild's
   * "Ragnarok Origin Classic" tracking sheet, "Stats PVP" tab.
   */
  get classSyncSheetId(): string {
    return (process.env.CLASS_SYNC_SHEET_ID ?? "1k180f6caJKSs9O64SM_MXXvZR0sRG5pS_fqC3gQUcv8").trim();
  },
  get classSyncSheetGid(): string {
    return (process.env.CLASS_SYNC_SHEET_GID ?? "537863303").trim();
  },
};
