import { Client, GatewayIntentBits, Partials } from "discord.js";

export function createBotClient() {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      // Privileged intent — must be enabled for the bot application in the
      // Discord Developer Portal under Bot > Privileged Gateway Intents.
      GatewayIntentBits.GuildMembers,
      // Needed to receive reaction events (class-select + attendance "ลา"
      // messages, see bot/reactions.ts) and to fetch/manage the messages
      // themselves.
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions,
    ],
    // Message/Reaction/Channel partials so events on messages the bot
    // hasn't cached (e.g. posted before a restart) still come through and
    // can be `.fetch()`ed before use.
    partials: [Partials.GuildMember, Partials.User, Partials.Message, Partials.Reaction, Partials.Channel],
  });
}
