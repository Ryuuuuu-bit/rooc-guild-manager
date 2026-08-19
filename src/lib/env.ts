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
};
