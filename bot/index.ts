import "dotenv/config";
import { Events } from "discord.js";
import { createBotClient } from "./discord-client";
import {
  runFullSync,
  normalizeMember,
  upsertMemberFromGateway,
  markMemberLeftFromGateway,
  syncRolesFromGateway,
} from "./sync";

const GUILD_ID = process.env.DISCORD_GUILD_ID;
const FULL_SYNC_INTERVAL_MS = 30 * 60 * 1000; // safety-net re-sync every 30 minutes

if (!process.env.DISCORD_BOT_TOKEN) {
  throw new Error("DISCORD_BOT_TOKEN is not set");
}
if (!GUILD_ID) {
  throw new Error("DISCORD_GUILD_ID is not set");
}

const client = createBotClient();

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`[bot] logged in as ${readyClient.user.tag}`);

  const guild = await readyClient.guilds.fetch(GUILD_ID!);
  console.log(`[bot] watching guild: ${guild.name} (${guild.id})`);

  const runSync = async (reason: string) => {
    try {
      console.log(`[bot] running full sync (${reason})...`);
      const result = await runFullSync(guild);
      console.log(
        `[bot] sync complete: ${result.total} members seen, ${result.joined} new, ${result.reactivated} reactivated, ${result.left} left`
      );
    } catch (err) {
      console.error("[bot] full sync failed", err);
    }
  };

  await runSync("startup");
  setInterval(() => runSync("periodic safety-net"), FULL_SYNC_INTERVAL_MS);
});

client.on(Events.GuildMemberAdd, async (member) => {
  if (member.guild.id !== GUILD_ID || member.user.bot) return;
  try {
    await upsertMemberFromGateway(normalizeMember(member));
    console.log(`[bot] join: ${member.user.username} (${member.id})`);
  } catch (err) {
    console.error("[bot] failed to handle guildMemberAdd", err);
  }
});

client.on(Events.GuildMemberRemove, async (member) => {
  if (member.guild.id !== GUILD_ID || member.user.bot) return;
  try {
    await markMemberLeftFromGateway(member.id);
    console.log(`[bot] leave: ${member.user.username} (${member.id})`);
  } catch (err) {
    console.error("[bot] failed to handle guildMemberRemove", err);
  }
});

client.on(Events.GuildMemberUpdate, async (_old, newMember) => {
  if (newMember.guild.id !== GUILD_ID || newMember.user.bot) return;
  try {
    await syncRolesFromGateway(normalizeMember(newMember));
  } catch (err) {
    console.error("[bot] failed to handle guildMemberUpdate", err);
  }
});

client.on(Events.Error, (err) => {
  console.error("[bot] client error", err);
});

async function shutdown(signal: string) {
  console.log(`[bot] received ${signal}, shutting down...`);
  client.destroy();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

client.login(process.env.DISCORD_BOT_TOKEN);
