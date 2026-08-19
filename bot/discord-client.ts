import { Client, GatewayIntentBits, Partials } from "discord.js";

export function createBotClient() {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      // Privileged intent — must be enabled for the bot application in the
      // Discord Developer Portal under Bot > Privileged Gateway Intents.
      GatewayIntentBits.GuildMembers,
    ],
    partials: [Partials.GuildMember, Partials.User],
  });
}
