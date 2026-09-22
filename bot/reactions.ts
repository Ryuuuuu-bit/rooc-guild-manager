import { eq } from "drizzle-orm";
import type { MessageReaction, PartialMessageReaction, User, PartialUser } from "discord.js";
import { db } from "../src/db";
import { botReactionMessages, members, membershipEvents } from "../src/db/schema";
import { getEmojiToClassMap } from "./job-classes";

// Leave v2: the emoji "ลา" reaction flow is gone — every leave goes through
// the ห้องลา button/dropdown (bot/interactions.ts) or an admin web action,
// both writing the `leaves` table via src/lib/leaves.ts. This file only
// keeps the legacy CLASS_SELECT reaction fallback; a reaction on an old
// ATTENDANCE message is simply ignored.

/** Ensures both the reaction and its parent message are fully loaded (both can arrive as partials). */
async function resolve(reaction: MessageReaction | PartialMessageReaction): Promise<MessageReaction> {
  const full = reaction.partial ? await reaction.fetch() : (reaction as MessageReaction);
  if (full.message.partial) await full.message.fetch();
  return full;
}

async function findTrackedMessage(messageId: string) {
  return db.query.botReactionMessages.findFirst({ where: eq(botReactionMessages.messageId, messageId) });
}

/**
 * Posts a short-lived confirmation stating exactly which class just got
 * saved — members clicking several class emoji in a row (unsure which one
 * "took") was a real reported source of confusion, and this states the
 * outcome unambiguously regardless of whether the bot managed to strip the
 * member's other reactions off the message. Best-effort, auto-deletes.
 */
async function sendTempClassConfirmation(reaction: MessageReaction, displayName: string, className: string, stripFailed: boolean) {
  const channel = reaction.message.channel;
  if (!channel.isTextBased() || !("send" in channel)) return;
  try {
    const hint = stripFailed ? " (ถ้ายังเห็น reaction อาชีพเก่าค้างอยู่ ไม่ต้องตกใจ ระบบยึดอันนี้เป็นหลักแล้ว)" : "";
    const sent = await channel.send(`✅ **${displayName}** เลือกอาชีพ: ${className}${hint}`);
    setTimeout(() => {
      sent.delete().catch(() => {});
    }, 20_000);
  } catch {
    // Non-fatal — the class itself is already saved regardless.
  }
}

/**
 * A member reacted to a tracked message. Only CLASS_SELECT is handled now:
 * sets members.characterClass to the class matching the emoji they clicked,
 * and (best-effort, needs "Manage Messages") strips any of their other
 * class-emoji reactions off the same message so only their latest pick
 * sticks. Reactions from non-tracked members or with an unknown emoji are
 * stripped back off so the message stays a clean reflection of real picks.
 */
export async function handleReactionAdd(rawReaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) {
  if (user.bot) return;
  const reaction = await resolve(rawReaction);
  const row = await findTrackedMessage(reaction.message.id);
  if (!row || row.kind !== "CLASS_SELECT") return;

  const emojiName = reaction.emoji.name ?? "";
  const member = await db.query.members.findFirst({ where: eq(members.discordId, user.id) });
  if (!member || member.status !== "ACTIVE") {
    await reaction.users.remove(user.id).catch(() => {});
    return;
  }

  // Legacy fallback: the CLASS_SELECT message no longer seeds emoji
  // reactions itself (see postClassSelectMessage) — the primary flow is
  // now its "เลือกอาชีพ" button + dropdown (bot/interactions.ts). This
  // still runs harmlessly if a member manually reacts with a matching emoji.
  const emojiToClass = await getEmojiToClassMap();
  const className = emojiToClass[emojiName];
  if (!className) {
    await reaction.users.remove(user.id).catch(() => {});
    return;
  }

  // Both writes commit together — a crash between them (a routine Railway
  // redeploy) could otherwise leave the class changed with no audit row.
  await db.transaction(async (tx) => {
    await tx.update(members).set({ characterClass: className, updatedAt: new Date() }).where(eq(members.id, member.id));
    await tx.insert(membershipEvents).values({
      memberId: member.id,
      type: "CLASS_CHANGE",
      detail: `เปลี่ยนอาชีพเป็น ${className} ผ่าน Discord reaction`,
      actor: "bot:reactions",
    });
  });

  // Enforce single choice — strip the user's reaction from every other
  // class emoji on this message so only their latest click remains.
  let stripFailed = false;
  for (const [, other] of reaction.message.reactions.cache) {
    if (other.emoji.name === emojiName) continue;
    if (!emojiToClass[other.emoji.name ?? ""]) continue;
    try {
      await other.users.remove(user.id);
    } catch (err) {
      // Most commonly a missing "Manage Messages" permission — non-fatal,
      // the class itself is already updated; logged so a permission problem
      // shows up in Railway logs rather than only as vague member confusion.
      stripFailed = true;
      console.error(`[bot] failed to strip old class reaction for ${user.id}`, err);
    }
  }

  const displayName = member.discordNickname || member.discordGlobalName || member.discordUsername;
  void sendTempClassConfirmation(reaction, displayName, className, stripFailed);
}
