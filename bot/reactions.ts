import { and, desc, eq, gte, isNull } from "drizzle-orm";
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

async function logEvent(
  memberId: string,
  type: (typeof membershipEvents.$inferInsert)["type"],
  detail: string,
  extra?: { boardId?: string | null; confirmedAt?: Date | null }
) {
  await db.insert(membershipEvents).values({ memberId, type, detail, actor: "bot:reactions", ...extra });
}

// Purely informational display hint next to the temporary leave
// confirmation below — NOT enforced anywhere (nothing blocks a member from
// leaving more than this). Guild rule is roughly 2/month per the admin as
// of Aug 2026; bump this if that changes.
const MONTHLY_LEAVE_LIMIT = 2;

/** Start of the current calendar month at Thai-local midnight, as a UTC instant (mirrors the noon-Thailand pin used for manual leave entries). */
function startOfThaiMonth(): Date {
  const nowThai = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const year = nowThai.getUTCFullYear();
  const month = nowThai.getUTCMonth();
  return new Date(Date.UTC(year, month, 1, 0, 0, 0) - 7 * 60 * 60 * 1000);
}

/** How many ATTENDANCE_LEAVE events (confirmed or still-pending) this member has logged so far this calendar month, including one just inserted. */
async function countLeavesThisMonth(memberId: string): Promise<number> {
  const rows = await db
    .select({ id: membershipEvents.id })
    .from(membershipEvents)
    .where(
      and(
        eq(membershipEvents.memberId, memberId),
        eq(membershipEvents.type, "ATTENDANCE_LEAVE"),
        gte(membershipEvents.createdAt, startOfThaiMonth())
      )
    );
  return rows.length;
}

/**
 * Posts a short-lived confirmation in the same channel so a member (and
 * anyone else watching) can see the exact date they just logged a leave on,
 * plus a rough running count against the guild's monthly-leave guideline.
 * Auto-deletes itself after a bit so it doesn't clutter the channel
 * long-term. Best-effort — a missing "Send Messages"/"Manage Messages"
 * permission just means no confirmation shows up, nothing else breaks.
 */
async function sendTempLeaveConfirmation(
  reaction: MessageReaction,
  displayName: string,
  boardName: string,
  leaveCount: number
) {
  const channel = reaction.message.channel;
  if (!channel.isTextBased() || !("send" in channel)) return;
  try {
    const dateStr = new Date().toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
    const sent = await channel.send(
      `🗓️ **${displayName}** ลาในกระดาน "${boardName}" — บันทึกวันที่ ${dateStr} (ครั้งที่ ${leaveCount}/${MONTHLY_LEAVE_LIMIT} ของเดือนนี้)`
    );
    setTimeout(() => {
      sent.delete().catch(() => {});
    }, 30_000);
  } catch {
    // Non-fatal — the leave itself is already logged regardless.
  }
}

/**
 * Posts a short-lived confirmation stating exactly which class just got
 * saved — members clicking several class emoji in a row (unsure which one
 * "took") was a real reported source of confusion, and this states the
 * outcome unambiguously regardless of whether the bot managed to strip the
 * member's other reactions off the message (see stripFailed above). Mirrors
 * sendTempLeaveConfirmation; best-effort/non-fatal, auto-deletes itself.
 */
async function sendTempClassConfirmation(
  reaction: MessageReaction,
  displayName: string,
  className: string,
  stripFailed: boolean
) {
  const channel = reaction.message.channel;
  if (!channel.isTextBased() || !("send" in channel)) return;
  try {
    const hint = stripFailed
      ? " (ถ้ายังเห็น reaction อาชีพเก่าค้างอยู่ ไม่ต้องตกใจ ระบบยึดอันนี้เป็นหลักแล้ว)"
      : "";
    const sent = await channel.send(`✅ **${displayName}** เลือกอาชีพ: ${className}${hint}`);
    setTimeout(() => {
      sent.delete().catch(() => {});
    }, 20_000);
  } catch {
    // Non-fatal — the class itself is already saved regardless.
  }
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
    let stripFailed = false;
    for (const [, other] of reaction.message.reactions.cache) {
      if (other.emoji.name === emojiName) continue;
      if (!emojiToClass[other.emoji.name ?? ""]) continue;
      try {
        await other.users.remove(user.id);
      } catch (err) {
        // Most commonly a missing "Manage Messages" permission (that other
        // reaction is left behind, visually stacking up if this keeps
        // happening) — non-fatal either way, the class itself is already
        // updated above and the confirmation below states it unambiguously
        // regardless of what's left stuck on the message. Logged (not
        // silently swallowed) so a permission problem shows up in Railway
        // logs rather than only ever surfacing as vague member confusion.
        stripFailed = true;
        console.error(`[bot] failed to strip old class reaction for ${user.id}`, err);
      }
    }

    const displayName = member.discordNickname || member.discordGlobalName || member.discordUsername;
    // Members clicking several class emoji in a row and not being sure
    // which one "stuck" was a real reported source of confusion — this
    // states the outcome explicitly regardless of whatever's visually left
    // on the message's reactions.
    void sendTempClassConfirmation(reaction, displayName, className, stripFailed);
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
    // Logged right away so it shows in the activity feed immediately, but
    // left unconfirmed (confirmedAt: null) — the /attendance stats page
    // only counts it once it survives 30 minutes without being un-reacted
    // (see confirmDueLeaves in attendance-confirm.ts). Un-reacting before
    // then discards this row entirely, see handleReactionRemove below.
    await logEvent(
      member.id,
      "ATTENDANCE_LEAVE",
      `ลาในกระดาน "${board?.name ?? boardId}" ผ่าน Discord reaction`,
      { boardId, confirmedAt: null }
    );

    const displayName = member.discordNickname || member.discordGlobalName || member.discordUsername;
    const leaveCount = await countLeavesThisMonth(member.id);
    // Fire-and-forget — don't hold up the reaction handler on a channel post.
    void sendTempLeaveConfirmation(reaction, displayName, board?.name ?? boardId, leaveCount);
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

  // If the leave that put them on this board hasn't been confirmed yet
  // (< 30 min since they reacted), it never became a real, counted leave —
  // discard it outright instead of logging a return, so a quick
  // click-then-undo (e.g. someone testing the button) leaves no trace.
  const [pendingLeave] = await db
    .select({ id: membershipEvents.id })
    .from(membershipEvents)
    .where(
      and(
        eq(membershipEvents.memberId, member.id),
        eq(membershipEvents.boardId, row.boardId),
        eq(membershipEvents.type, "ATTENDANCE_LEAVE"),
        isNull(membershipEvents.confirmedAt)
      )
    )
    .orderBy(desc(membershipEvents.createdAt))
    .limit(1);

  if (pendingLeave) {
    await db.delete(membershipEvents).where(eq(membershipEvents.id, pendingLeave.id));
    return;
  }

  const board = await db.query.partyBoards.findFirst({ where: eq(partyBoards.id, row.boardId) });
  await logEvent(
    member.id,
    "ATTENDANCE_RETURN",
    `ยกเลิกลาในกระดาน "${board?.name ?? row.boardId}" ผ่าน Discord reaction`
  );
}
