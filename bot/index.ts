import "dotenv/config";
import { Events } from "discord.js";
import { createBotClient } from "./discord-client";
import {
  runFullSync,
  normalizeMember,
  upsertMemberFromGateway,
  markMemberLeftFromGateway,
  upsertRole,
  removeRole,
} from "./sync";
import { handleReactionAdd, handleReactionRemove } from "./reactions";
import { confirmDueLeaves } from "./attendance-confirm";

const GUILD_ID = process.env.DISCORD_GUILD_ID;
const FULL_SYNC_INTERVAL_MS = 30 * 60 * 1000; // safety-net re-sync every 30 minutes
const LEAVE_CONFIRM_INTERVAL_MS = 5 * 60 * 1000; // sweep for ลา events due to confirm/discard

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

  const runLeaveConfirmSweep = async () => {
    try {
      const { confirmed, discarded } = await confirmDueLeaves();
      if (confirmed || discarded) {
        console.log(`[bot] ลา confirm sweep: ${confirmed} confirmed, ${discarded} discarded`);
      }
    } catch (err) {
      console.error("[bot] ลา confirm sweep failed", err);
    }
  };

  await runLeaveConfirmSweep();
  setInterval(runLeaveConfirmSweep, LEAVE_CONFIRM_INTERVAL_MS);
});

client.on(Events.GuildMemberAdd, async (member) => {
  if (member.guild.id !== GUILD_ID || member.user.bot) return;
  try {
    const normalized = normalizeMember(member);
    // Only add them to the roster if they already carry the tracked role
    // (e.g. auto-role bots that assign it on join). Otherwise wait — they'll
    // be picked up by guildMemberUpdate if/when the role is granted.
    if (normalized.hasTrackedRole) {
      await upsertMemberFromGateway(normalized);
      console.log(`[bot] join: ${member.user.username} (${member.id})`);
    }
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
    const normalized = normalizeMember(newMember);
    if (normalized.hasTrackedRole) {
      // Covers: gaining the tracked role for the first time, reactivation,
      // and routine profile/role-list refreshes for someone already tracked.
      await upsertMemberFromGateway(normalized);
    } else {
      // No-op if they were never tracked to begin with.
      await markMemberLeftFromGateway(normalized.discordId);
    }
  } catch (err) {
    console.error("[bot] failed to handle guildMemberUpdate", err);
  }
});

client.on(Events.GuildRoleCreate, async (role) => {
  if (role.guild.id !== GUILD_ID) return;
  try {
    await upsertRole(role);
  } catch (err) {
    console.error("[bot] failed to handle guildRoleCreate", err);
  }
});

client.on(Events.GuildRoleUpdate, async (_old, newRole) => {
  if (newRole.guild.id !== GUILD_ID) return;
  try {
    await upsertRole(newRole);
  } catch (err) {
    console.error("[bot] failed to handle guildRoleUpdate", err);
  }
});

client.on(Events.GuildRoleDelete, async (role) => {
  if (role.guild.id !== GUILD_ID) return;
  try {
    await removeRole(role.id);
  } catch (err) {
    console.error("[bot] failed to handle guildRoleDelete", err);
  }
});

// Class-select + attendance ("ลา") emoji reactions — see bot/reactions.ts.
// Ignores anything on a message the bot isn't tracking (looked up inside the
// handlers), so this is safe to leave on even in channels used for other things.
client.on(Events.MessageReactionAdd, async (reaction, user) => {
  try {
    await handleReactionAdd(reaction, user);
  } catch (err) {
    console.error("[bot] failed to handle messageReactionAdd", err);
  }
});

client.on(Events.MessageReactionRemove, async (reaction, user) => {
  try {
    await handleReactionRemove(reaction, user);
  } catch (err) {
    console.error("[bot] failed to handle messageReactionRemove", err);
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
