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
import { sendDirectMessage } from "../src/lib/discord";
import { getEmojiToClassMap } from "./job-classes";
import { getCheckinEvent, nextOccurrenceEnd } from "../src/lib/checkin-events";
import { notifyAdminsOfLeave } from "./attendance-confirm";

/** "YYYY-MM-DD" for now in Thailand's local time — local copy, see
 * bot/leave-schedule.ts's own copy for why every file keeps its own. */
function thaiDateString(d: Date = new Date()): string {
  const thai = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return thai.toISOString().slice(0, 10);
}

/**
 * When a "ลา" on this board actually locks in, as human-readable Thai text —
 * matches confirmDueLeaves' own event-end gating in attendance-confirm.ts
 * (a leave only counts once the matching event's NEXT NOT-YET-ENDED
 * occurrence actually ends — see nextOccurrenceEnd in checkin-events.ts, not
 * necessarily today's window), so this message never promises a timing the
 * backend doesn't enforce. Takes the board's checkinEventKey (schema.ts)
 * rather than its name — falls back to generic wording when it's null/
 * doesn't match a configured event, where confirmDueLeaves instead uses a
 * flat delay. Spells out the date too when the relevant occurrence isn't
 * today — e.g. reacting on a Monday for GL (Tue/Thu only) locks in Tuesday,
 * not "later today".
 */
function confirmTimingLabel(checkinEventKey: string | null): string {
  const event = checkinEventKey ? getCheckinEvent(checkinEventKey) : undefined;
  if (!event) return "อีกสักครู่";
  const now = new Date();
  const end = nextOccurrenceEnd(event, now);
  const timeLabel = end.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });
  if (thaiDateString(end) === thaiDateString(now)) return `ตอนกิจกรรมจบ (${timeLabel} น.)`;
  const dateLabel = end.toLocaleDateString("th-TH", { day: "numeric", month: "short", timeZone: "Asia/Bangkok" });
  return `ตอนกิจกรรมจบวันที่ ${dateLabel} (${timeLabel} น.)`;
}

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

/**
 * How many ATTENDANCE_LEAVE events (confirmed or still-pending) this member
 * has logged so far this calendar month on this specific board, including
 * one just inserted. Scoped per board (not per member overall) — GL and WOE
 * are separate boards with separate quotas, per the guild admin, so a leave
 * on one shouldn't count against the other's 0/2.
 */
export async function countLeavesThisMonth(memberId: string, boardId: string): Promise<number> {
  const rows = await db
    .select({ id: membershipEvents.id })
    .from(membershipEvents)
    .where(
      and(
        eq(membershipEvents.memberId, memberId),
        eq(membershipEvents.type, "ATTENDANCE_LEAVE"),
        eq(membershipEvents.boardId, boardId),
        gte(membershipEvents.createdAt, startOfThaiMonth())
      )
    );
  return rows.length;
}

// Was 30s — a member reported reacting "ลา" and seeing no confirmation at
// all: they simply weren't still looking at the channel by the time this
// self-deleted (and their DM either failed silently or is off, see
// dmMemberLeaveStatus below — Discord gives no way to force a DM through).
// The channel post is the only confirmation surface this best-effort path
// can guarantee, so it needs to survive long enough to actually be seen —
// 5 minutes gives a much wider window while still clearing out on its own.
const LEAVE_CONFIRMATION_LIFETIME_MS = 5 * 60_000; // how long the temp confirmation message itself stays up

/**
 * Posts a short-lived confirmation in the same channel so a member (and
 * anyone else watching) can see the exact date they just logged a leave on,
 * a rough running count against the guild's monthly-leave guideline, and —
 * since this wasn't obvious before and members asked about it — when the
 * leave actually becomes official (see confirmTimingLabel above, which
 * mirrors confirmDueLeaves' own event-end gating in attendance-confirm.ts).
 * Auto-deletes itself after LEAVE_CONFIRMATION_LIFETIME_MS so it
 * doesn't clutter the channel long-term — states that lifetime in the
 * message too, so its disappearance doesn't read as the bot glitching or
 * someone deleting it. Best-effort — a missing "Send Messages"/"Manage
 * Messages" permission just means no confirmation shows up, nothing else
 * breaks — but that failure is now logged (see catch below) instead of
 * disappearing silently, since a member getting NO confirmation at all
 * (channel post AND DM both failing/missed) was reported with nothing in
 * the logs to explain why.
 */
async function sendTempLeaveConfirmation(
  reaction: MessageReaction,
  displayName: string,
  boardName: string,
  leaveCount: number,
  emoji: string,
  checkinEventKey: string | null
) {
  const channel = reaction.message.channel;
  if (!channel.isTextBased() || !("send" in channel)) {
    console.error(`[bot] can't post leave confirmation — channel ${reaction.message.channelId} isn't sendable`);
    return;
  }
  try {
    // Explicit timeZone — without it, toLocaleString uses the SERVER's own
    // timezone for the actual clock time (only "th-TH" itself just picks
    // the Thai calendar/number formatting, not the offset), and this bot
    // runs on Railway in UTC, so the displayed time was consistently 7
    // hours behind real Thailand time — reported by a guild admin who
    // noticed the message text said 07:09 right under Discord's own
    // "14:09" timestamp on the same message.
    const dateStr = new Date().toLocaleString("th-TH", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Bangkok",
    });
    const lifetimeMinutes = Math.round(LEAVE_CONFIRMATION_LIFETIME_MS / 60_000);
    const sent = await channel.send(
      `🗓️ **${displayName}** ลาในกระดาน "${boardName}" — บันทึกวันที่ ${dateStr}\n` +
        `ครั้งที่ ${leaveCount}/${MONTHLY_LEAVE_LIMIT} ของเดือนนี้ (เฉพาะกระดานนี้) · จะนับอย่างเป็นทางการ${confirmTimingLabel(checkinEventKey)} (เอา ${emoji} ออก หรือใช้ /leave ยกเลิกก่อนเวลานี้ ไม่นับเป็นการลา)\n` +
        `_ข้อความนี้จะลบเองใน ${lifetimeMinutes} นาที_`
    );
    setTimeout(() => {
      sent.delete().catch(() => {});
    }, LEAVE_CONFIRMATION_LIFETIME_MS);
  } catch (err) {
    console.error(`[bot] failed to post leave confirmation in channel ${reaction.message.channelId}`, err);
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

/**
 * DMs the member privately with the same information as
 * sendTempLeaveConfirmation's ephemeral channel post — a durable copy they
 * can refer back to (the channel version auto-deletes itself in seconds),
 * and one that reaches them even if they don't happen to be watching the
 * channel right when they click. Best-effort/non-fatal: a member with DMs
 * off just doesn't get this, the leave itself is already logged regardless.
 *
 * Also called from leave-schedule.ts's applyTodaysScheduledLeaves (origin
 * "schedule") — an advance /leave request auto-applying used to send NO
 * notification of any kind, so a member had no way to know their scheduled
 * leave had gone into effect and was cancellable, short of opening /leave
 * themselves to check. That gap is exactly what let a leave like this sit
 * unnoticed until it locked in with no one realizing there was still time to
 * undo it. `origin` only changes the wording (there's no reaction to remove
 * for a leave that auto-applied from a schedule).
 */
export async function dmMemberLeaveStatus(
  discordId: string,
  boardName: string,
  leaveCount: number,
  origin: "reaction" | "schedule" = "reaction",
  checkinEventKey: string | null = null
) {
  const intro =
    origin === "reaction"
      ? `🗓️ บันทึกคำขอลาในกระดาน "${boardName}" แล้ว`
      : `🗓️ คำขอลาล่วงหน้าที่แจ้งไว้ในกระดาน "${boardName}" มีผลแล้ววันนี้`;
  const cancelHint =
    origin === "reaction"
      ? "ถ้าเปลี่ยนใจให้เอารีแอคชั่นออก หรือใช้ /leave เลือก \"ยกเลิกลาที่มีผลอยู่ตอนนี้\" ก่อนเวลานี้ ไม่นับเป็นการลา"
      : "ถ้าเปลี่ยนใจให้เปิด /leave แล้วเลือก \"ยกเลิกลาที่มีผลอยู่ตอนนี้\" ก่อนเวลานี้ ไม่นับเป็นการลา";
  try {
    await sendDirectMessage(
      discordId,
      `${intro} (ครั้งที่ ${leaveCount}/${MONTHLY_LEAVE_LIMIT} เดือนนี้ เฉพาะกระดานนี้)\n` +
        `จะยืนยันอย่างเป็นทางการ${confirmTimingLabel(checkinEventKey)} ${cancelHint}`
    );
  } catch (err) {
    console.error(`[bot] failed to DM member ${discordId} about pending leave`, err);
  }
}

/** Clears a member's slot on ONE specific board (unlike sync.ts's clearPartyAssignments, which clears every board). Exported for reuse by bot/leave-schedule.ts's applyTodaysScheduledLeaves — same "remove from any slot when marked ลา" behavior, just triggered by a scheduled date arriving instead of a live reaction. */
export async function clearMemberSlotOnBoard(memberId: string, boardId: string) {
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
    // Legacy fallback: the CLASS_SELECT message no longer seeds emoji
    // reactions itself (see postClassSelectMessage) — the primary flow is
    // now its "เลือกอาชีพ" button + dropdown (handleClassSelectButton/
    // handleClassSelectChoose in bot/interactions.ts). This still runs
    // harmlessly if a member manually reacts with a matching emoji anyway.
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
    const boardId = row.boardId;
    const board = await db.query.partyBoards.findFirst({ where: eq(partyBoards.id, boardId) });
    // Each board can have its own reaction emoji (set when the "ลา" message
    // was posted — see postAttendanceMessage) so GL/WOE/etc. read distinctly
    // in Discord; fall back to the app-wide default for boards that never
    // customized it.
    const expectedEmoji = board?.emoji || ATTENDANCE_EMOJI;
    if (emojiName !== expectedEmoji) {
      await reaction.users.remove(user.id).catch(() => {});
      return;
    }
    if (member.benched) {
      // Benched members are already excluded from every board's roster —
      // nothing meaningful to mark, leave their reaction as-is.
      return;
    }

    await db
      .delete(partyBusyEntries)
      .where(and(eq(partyBusyEntries.boardId, boardId), eq(partyBusyEntries.memberId, member.id)));
    await db.insert(partyBusyEntries).values({ boardId, memberId: member.id, sortOrder: 0 });
    await clearMemberSlotOnBoard(member.id, boardId);

    // Logged right away so it shows in the activity feed immediately, but
    // left unconfirmed (confirmedAt: null) — the /attendance stats page only
    // counts it once the matching event's window actually ends (see
    // confirmDueLeaves in attendance-confirm.ts). Un-reacting before then
    // discards this row entirely, see handleReactionRemove below.
    await logEvent(
      member.id,
      "ATTENDANCE_LEAVE",
      `ลาในกระดาน "${board?.name ?? boardId}" ผ่าน Discord reaction`,
      { boardId, confirmedAt: null }
    );

    const displayName = member.discordNickname || member.discordGlobalName || member.discordUsername;
    const leaveCount = await countLeavesThisMonth(member.id, boardId);
    const checkinEventKey = board?.checkinEventKey ?? null;
    // Fire-and-forget — don't hold up the reaction handler on a channel post/DM.
    void sendTempLeaveConfirmation(reaction, displayName, board?.name ?? boardId, leaveCount, expectedEmoji, checkinEventKey);
    void dmMemberLeaveStatus(member.discordId, board?.name ?? boardId, leaveCount, "reaction", checkinEventKey);
    void notifyAdminsOfLeave(member.id, boardId);
  }
}

/**
 * Takes a member off a board's Busy/ลา list right now, regardless of how
 * they got on it (a live "ลา" reaction, or an advance /leave request that
 * already auto-applied) — shared by handleReactionRemove below and
 * bot/interactions.ts's self-service "cancel my leave now" picker option, so
 * both paths behave identically instead of only live reactions being
 * cancelable.
 *
 * If the leave hasn't event-confirmed yet (confirmDueLeaves in
 * attendance-confirm.ts only flips confirmedAt once the event's own end time
 * passes — see that file), it never became a real, counted leave — discard
 * it outright instead of logging a return, so cancelling before the event
 * ends leaves no trace and doesn't touch the monthly leave count. Once
 * confirmed (event already over), this instead logs a normal
 * ATTENDANCE_RETURN — the leave itself still counts, this just clears them
 * for next time, same as an admin dragging them back into a party slot.
 *
 * Returns "none" if they weren't actually marked ลา on this board (nothing
 * to do), "discarded" if a still-pending leave was wiped with no trace, or
 * "returned" if an already-confirmed leave was closed out normally.
 */
export async function cancelCurrentLeave(
  memberId: string,
  boardId: string,
  actorSuffix: string
): Promise<"none" | "discarded" | "returned"> {
  const deleted = await db
    .delete(partyBusyEntries)
    .where(and(eq(partyBusyEntries.boardId, boardId), eq(partyBusyEntries.memberId, memberId)))
    .returning({ id: partyBusyEntries.id });
  if (deleted.length === 0) return "none";

  const [pendingLeave] = await db
    .select({ id: membershipEvents.id })
    .from(membershipEvents)
    .where(
      and(
        eq(membershipEvents.memberId, memberId),
        eq(membershipEvents.boardId, boardId),
        eq(membershipEvents.type, "ATTENDANCE_LEAVE"),
        isNull(membershipEvents.confirmedAt)
      )
    )
    .orderBy(desc(membershipEvents.createdAt))
    .limit(1);

  if (pendingLeave) {
    await db.delete(membershipEvents).where(eq(membershipEvents.id, pendingLeave.id));
    return "discarded";
  }

  // boardId included here too (not just on the LEAVE side above) — without
  // it this return's audit-log row can't be attributed to a board, which
  // silently broke both /attendance's per-board breakdown and /checkin's
  // "who's on leave" lookup for the LEAVE half of the same pair (found via
  // a real member showing up in /attendance's "ไม่ระบุกระดาน" bucket).
  const board = await db.query.partyBoards.findFirst({ where: eq(partyBoards.id, boardId) });
  await logEvent(memberId, "ATTENDANCE_RETURN", `ยกเลิกลาในกระดาน "${board?.name ?? boardId}"${actorSuffix}`, {
    boardId,
  });
  return "returned";
}

/** Un-reacting the ATTENDANCE emoji brings a member back off the Busy/ลา list for that board (they don't auto-return to a slot) — see cancelCurrentLeave above for the shared discard-vs-return logic. */
export async function handleReactionRemove(
  rawReaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser
) {
  if (user.bot) return;
  const reaction = await resolve(rawReaction);
  const row = await findTrackedMessage(reaction.message.id);
  if (!row || row.kind !== "ATTENDANCE" || !row.boardId) return;

  const board = await db.query.partyBoards.findFirst({ where: eq(partyBoards.id, row.boardId) });
  const emojiName = reaction.emoji.name ?? "";
  if (emojiName !== (board?.emoji || ATTENDANCE_EMOJI)) return;

  const member = await db.query.members.findFirst({ where: eq(members.discordId, user.id) });
  if (!member) return;

  await cancelCurrentLeave(member.id, row.boardId, " ผ่าน Discord reaction");
}
