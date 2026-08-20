import { and, eq } from "drizzle-orm";
import type { MessageReaction, PartialMessageReaction, User, PartialUser } from "discord.js";
import { db } from "../src/db";
import {
  botReactionMessages,
  members,
  membershipEvents,
  partyBoards,
  partyBusyEntries,
  partyGroupParties,
  partyGroups,
  partySlots,
} from "../src/db/schema";
import { ATTENDANCE_EMOJI } from "../src/lib/class-emoji";
import { getEmojiToClassMap } from "./job-classes";

/** Ensures both the reaction and its parent message are fully loaded (both can arrive as partials). */
async function resolve(reaction: MessageReaction | PartialMessageReaction): Promise<MessageReaction> {
  const full = reaction.partial ? await reaction.fetch() : (reaction as MessageReaction);
  if (full.message.partial) await full.message.fetch();
  return full;
}

async function findTrackedMessage(messageId: string) {
  return db.query.botReactionMessages.findFirst({ where: eq(botReactionMessages.messageId, messageId) });
}

async function logEvent(memberId: string, type: (typeof membershipEvents.$inferInsert)["type"], detail: string) {
  await db.insert(membershipEvents).values({ memberId, type, detail, actor: "bot:reactions" });
}

/** Clears a member's slot on ONE specific board (unlike sync.ts's clearPartyAssignments, which clears every board). */
async function clearMemberSlotOnBoard(memberId: string, boardId: string) {
  const rows = await db
    .select({ slotId: partySlots.id })
    .from(partySlots)
    .innerJoin(partyGroupParties, eq(partySlots.partyId, partyGroupParties.id))
    .innerJoin(partyGroups, eq(partyGroupParties.groupId, partyGroups.id))
    .where(and(eq(partySlots.memberId, memberId), eq(partyGroups.boardId, boardId)));

  for (const row of rows) {
    await db.update(partySlots).set({ memberId: null, updatedAt: new Date() }).where(eq(partySlots.id, row.slotId));
  }
}

/**
 * A member reacted to a tracked message. Two kinds:
 * - CLASS_SELECT (global): sets members.characterClass to the class matching
 *   the emoji they clicked, and (best-effort, needs "Manage Messages") strips
 *   any of their other class-emoji reactions off the same message so only
 *   their latest pick sticks.
 * - ATTENDANCE (per board): marks the member Busy/ลา on that one board —
 *   removing them from any slot they hold there — everyone else on the
 *   board is unaffected (default = still attending).
 *
 * Reactions from non-tracked members (not in the roster, or the emoji isn't
 * one we recognize) are stripped back off so the message stays a clean,
 * accurate reflection of real picks.
 */
export async function handleReactionAdd(
  rawReaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser
) {
  if (user.bot) return;
  const reaction = await resolve(rawReaction);
  const row = await findTrackedMessage(reaction.message.id);
  if (!row) return;

  const emojiName = reaction.emoji.name ?? "";
  const member = await db.query.members.findFirst({ where: eq(members.discordId, user.id) });

  if (!member || member.status !== "ACTIVE") {
    await reaction.users.remove(user.id).catch(() => {});
    return;
  }

  if (row.kind === "CLASS_SELECT") {
    const emojiToClass = await getEmojiToClassMap();
    const className = emojiToClass[emojiName];
    if (!className) {
      await reaction.users.remove(user.id).catch(() => {});
      return;
    }

    await db
      .update(members)
      .set({ characterClass: className, updatedAt: new Date() })
      .where(eq(members.id, member.id));
    await logEvent(member.id, "CLASS_CHANGE", `เปลี่ยนอาชีพเป็น ${className} ผ่าน Discord reaction`);

    // Enforce single choice — strip the user's reaction from every other
    // class emoji on this message so only their latest click remains.
    for (const [, other] of reaction.message.reactions.cache) {
      if (other.emoji.name === emojiName) continue;
      if (!emojiToClass[other.emoji.name ?? ""]) continue;
      try {
        await other.users.remove(user.id);
      } catch {
        // Missing "Manage Messages" permission, or nothing to remove —
        // non-fatal either way, the class is already updated above.
      }
    }
    return;
  }

  if (row.kind === "ATTENDANCE" && row.boardId) {
    if (emojiName !== ATTENDANCE_EMOJI) {
      await reaction.users.remove(user.id).catch(() => {});
      return;
    }
    if (member.benched) {
      // Benched members are already excluded from every board's roster —
      // nothing meaningful to mark, leave their reaction as-is.
      return;
    }

    const boardId = row.boardId;
    await db
      .delete(partyBusyEntries)
      .where(and(eq(partyBusyEntries.boardId, boardId), eq(partyBusyEntries.memberId, member.id)));
    await db.insert(partyBusyEntries).values({ boardId, memberId: member.id, sortOrder: 0 });
    await clearMemberSlotOnBoard(member.id, boardId);

    const board = await db.query.partyBoards.findFirst({ where: eq(partyBoards.id, boardId) });
    await logEvent(
      member.id,
      "ATTENDANCE_LEAVE",
      `ลาในกระดาน "${board?.name ?? boardId}" ผ่าน Discord reaction`
    );
  }
}

/** Un-reacting the ATTENDANCE emoji brings a member back off the Busy/ลา list for that board (they don't auto-return to a slot). */
export async function handleReactionRemove(
  rawReaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser
) {
  if (user.bot) return;
  const reaction = await resolve(rawReaction);
  const row = await findTrackedMessage(reaction.message.id);
  if (!row || row.kind !== "ATTENDANCE" || !row.boardId) return;

  const emojiName = reaction.emoji.name ?? "";
  if (emojiName !== ATTENDANCE_EMOJI) return;

  const member = await db.query.members.findFirst({ where: eq(members.discordId, user.id) });
  if (!member) return;

  const deleted = await db
    .delete(partyBusyEntries)
    .where(and(eq(partyBusyEntries.boardId, row.boardId), eq(partyBusyEntries.memberId, member.id)))
    .returning({ id: partyBusyEntries.id });
  if (deleted.length === 0) return; // wasn't actually marked ลา on this board — nothing to log

  const board = await db.query.partyBoards.findFirst({ where: eq(partyBoards.id, row.boardId) });
  await logEvent(
    member.id,
    "ATTENDANCE_RETURN",
    `ยกเลิกลาในกระดาน "${board?.name ?? row.boardId}" ผ่าน Discord reaction`
  );
}
