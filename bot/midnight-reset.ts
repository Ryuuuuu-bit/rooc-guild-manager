import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import { botReactionMessages, members, membershipEvents, partyBoards, partyBusyEntries } from "../src/db/schema";
import { ATTENDANCE_EMOJI } from "../src/lib/class-emoji";
import { getCheckinEvent, lastOccurrenceEnd } from "../src/lib/checkin-events";
import { DiscordApiError, addMessageReaction, removeAllReactionsForEmoji, removeMemberReaction } from "../src/lib/discord";
import { applyTodaysScheduledLeaves } from "./leave-schedule";
import { confirmDueLeaves } from "./attendance-confirm";
import { notifyAdmins } from "./admin-notify";

/**
 * "YYYY-MM-DD" for the given instant in Thailand's local time (UTC+7),
 * computed without relying on the host machine's own timezone — same trick
 * used for the noon-Thailand date pin in the manual leave-entry action.
 */
export function thaiDateString(d: Date = new Date()): string {
  const thai = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return thai.toISOString().slice(0, 10);
}

/**
 * Clears every board's "Busy / ลา" list back to empty — EXCEPT, on a board
 * linked to a check-in event, members whose ลา was marked for the event's
 * NEXT occurrence (see the per-row logic inside) — and best-effort pulls the
 * cleared members' attendance emoji off the board's tracked message, so
 * everyone else starts the new day available again without having to
 * manually un-react. Scheduled to run once per Thai calendar day — see the
 * midnight-check loop in index.ts.
 *
 * ALSO logs an ATTENDANCE_RETURN for each member cleared this way (see
 * below) — a previous version of this function deliberately skipped that to
 * avoid activity-feed noise, but that left a confirmed ATTENDANCE_LEAVE as
 * each such member's most recent event on that board FOREVER (nothing ever
 * closed it out), which made /checkin's "On Leave" lookup and /attendance's
 * leave stats (both driven by "what's the last LEAVE/RETURN logged for this
 * member+board" — see getLeaveMemberIds in src/lib/checkin-data.ts) keep
 * showing that member as on leave for every future round, even ones days or
 * weeks later, until someone happened to toggle them in/out of Busy/Leave
 * again — with nothing on the (now-empty-looking) party board itself to
 * suggest anything was wrong. Logging the return here keeps that history
 * honest: a small "Leave cancelled / returned" line for whoever was
 * actually on the list, once per board per night, in exchange for /checkin
 * and /attendance no longer permanently misattributing a stale leave.
 */
export async function resetDailyBusyLists(): Promise<{ boardsReset: number; scheduledLeavesApplied: number }> {
  // Lock in anything whose event has already ended BEFORE deciding what to
  // clear. This runs on every bot startup as well as at midnight, and the
  // regular 5-minute confirm sweep can lag the event's end by a few seconds
  // to minutes — a restart landing in that gap (sweep saw "not due yet" at
  // 20:19:59, this reset then saw "occurrence ended" at 20:20:01) used to
  // clear the busy row first, after which the next sweep found the leave
  // "no longer busy" and DISCARDED it, so a perfectly real leave never
  // counted. Confirming first makes the order irrelevant.
  try {
    await confirmDueLeaves();
  } catch (err) {
    console.error("[bot] pre-reset ลา confirm sweep failed", err);
  }

  const boards = await db
    .select({ id: partyBoards.id, name: partyBoards.name, emoji: partyBoards.emoji, checkinEventKey: partyBoards.checkinEventKey })
    .from(partyBoards);
  let boardsReset = 0;
  const missingMessageBoards: string[] = [];

  for (const board of boards) {
    // The busy-clear and its per-member ATTENDANCE_RETURN log below now
    // commit together as one transaction. Before this they were separate
    // statements, and the bot process CAN be torn down mid-request by a
    // routine Railway redeploy — a crash between clearing a member's busy
    // row and writing the RETURN that closes it out used to be able to
    // leave their most recent event on this board stuck as an unclosed
    // ATTENDANCE_LEAVE, which is exactly the "permanently misattributed as
    // on leave" failure this function's RETURN-logging exists to prevent in
    // the first place (see this function's header comment above) — just
    // reached through a different door than the one that comment describes.
    // For a board linked to a check-in event, a member marked ลา AFTER the
    // most recent occurrence ended is on leave for the NEXT occurrence —
    // e.g. reacting Saturday for Sunday's WOE, or Monday for Tuesday's GL.
    // The clear below used to wipe those too (every busy row, every
    // midnight), so an early ลา silently evaporated at 00:00 of the event
    // day: the member was back in their party slot as "attending", the
    // still-pending leave got discarded by confirmDueLeaves as "no longer
    // busy", and nothing was ever counted — despite the member's DM and the
    // admin notification both having said the leave would hold until the
    // event ended. Only rows whose latest ลา predates that last ended
    // occurrence (i.e. were FOR it, or older) are cleared now; a row with no
    // ลา event at all (an admin dragged them to Busy by hand) keeps the
    // original once-a-day reset semantics. Boards with no linked event
    // still clear everything, as before.
    const event = board.checkinEventKey ? getCheckinEvent(board.checkinEventKey) : undefined;
    const lastEnd = event ? lastOccurrenceEnd(event, new Date()) : null;

    const cleared = await db.transaction(async (tx) => {
      const busyRows = await tx
        .select({ memberId: partyBusyEntries.memberId })
        .from(partyBusyEntries)
        .where(eq(partyBusyEntries.boardId, board.id));

      const toClear: string[] = [];
      for (const { memberId } of busyRows) {
        if (!event) {
          toClear.push(memberId);
          continue;
        }
        const [latestLeave] = await tx
          .select({ createdAt: membershipEvents.createdAt, actor: membershipEvents.actor })
          .from(membershipEvents)
          .where(
            and(
              eq(membershipEvents.memberId, memberId),
              eq(membershipEvents.boardId, board.id),
              eq(membershipEvents.type, "ATTENDANCE_LEAVE")
            )
          )
          .orderBy(desc(membershipEvents.createdAt))
          .limit(1);
        // Only a ลา the MEMBER marked themselves (a live reaction or an
        // advance /leave — actor "bot:…") carries the "marked after the last
        // occurrence ⇒ it's for the next one" meaning: those members were
        // explicitly told so in their DM (confirmTimingLabel in
        // reactions.ts). An admin dragging someone to Busy/ลา on the web
        // (src/app/actions/party.ts's moveMember — actor is the admin's
        // username, and it logs the leave already confirmed) is a same-day
        // roster note with no such promise, so it keeps the original
        // once-a-day clear — otherwise an admin marking a no-show right
        // after Tuesday's GL would leave that member shown as on leave for
        // Thursday's too. No ลา event at all behind the row → daily clear.
        // A member-marked ลา before the last ended occurrence → it was for
        // that (or an older) occurrence → clear; after it → keep.
        const memberMarked = latestLeave?.actor?.startsWith("bot:") ?? false;
        if (!latestLeave || !memberMarked || lastEnd === null || latestLeave.createdAt <= lastEnd) toClear.push(memberId);
      }

      const clearedRows = toClear.length
        ? await tx
            .delete(partyBusyEntries)
            .where(and(eq(partyBusyEntries.boardId, board.id), inArray(partyBusyEntries.memberId, toClear)))
            .returning({ memberId: partyBusyEntries.memberId })
        : [];

      // Being in partyBusyEntries always means this member's most recent
      // ATTENDANCE_LEAVE/RETURN event on this board was a LEAVE not yet
      // followed by a RETURN (reactions.ts and party.ts's moveMember both
      // keep the two in sync on every add/remove) — including one still
      // pending confirmation. Logging the return unconditionally is safe
      // either way: for an already-confirmed leave, this is exactly the
      // missing close-out described above; for a still-pending one (reacted
      // in the last 30 minutes before rollover), the pending row itself gets
      // discarded shortly after by confirmDueLeaves (it's no longer "still
      // busy" once this clears it), so this return is a harmless no-op next
      // to a leave that was never going to count anyway.
      for (const { memberId } of clearedRows) {
        await tx.insert(membershipEvents).values({
          memberId,
          type: "ATTENDANCE_RETURN",
          detail: `ยกเลิกลาในกระดาน "${board.name}" อัตโนมัติ (รีเซ็ตประจำวัน)`,
          actor: "bot:midnight-reset",
          boardId: board.id,
        });
      }

      return { clearedRows, keptCount: busyRows.length - clearedRows.length };
    });
    if (cleared.clearedRows.length === 0) continue; // nothing to clear on this board — no-op
    boardsReset++;

    const tracked = await db.query.botReactionMessages.findFirst({
      where: and(eq(botReactionMessages.kind, "ATTENDANCE"), eq(botReactionMessages.boardId, board.id)),
    });
    if (tracked) {
      // Per-board emoji (see partyBoards.emoji) — falls back to the app-wide
      // default for boards that never customized theirs.
      const emoji = board.emoji || ATTENDANCE_EMOJI;

      if (cleared.keptCount > 0) {
        // Some members stay on leave (marked early for the next occurrence,
        // see above) — their emoji has to stay on the message too, or
        // Discord would treat their next click as a fresh ADD (re-marking a
        // leave they already have) instead of the cancel they meant. So
        // strip only the cleared members' reactions, one by one. The bot's
        // own seed reaction is untouched on this path, so no re-seed needed.
        const clearedIds = cleared.clearedRows.map((r) => r.memberId);
        const clearedMembers = await db
          .select({ discordId: members.discordId })
          .from(members)
          .where(inArray(members.id, clearedIds));
        for (const { discordId } of clearedMembers) {
          await removeMemberReaction(tracked.channelId, tracked.messageId, emoji, discordId).catch(() => {});
        }
        continue;
      }

      await removeAllReactionsForEmoji(tracked.channelId, tracked.messageId, emoji);
      // removeAllReactionsForEmoji wipes EVERY reaction for that emoji off
      // the message, including the bot's own seed reaction from when the
      // message was first posted — without re-adding it, the message is
      // left with zero reactions of that emoji. For a role-restricted custom
      // emoji, Discord only lets a member without that role react by
      // clicking an *existing* reaction already on the message — they can't
      // add a brand-new one themselves — so once the seed reaction is gone,
      // those members silently lose the ability to react ลา at all until an
      // admin reposts the message. Re-seed it right after clearing so the
      // one-click option (and that piggyback path) survives every night's
      // reset. Best-effort — same as the seeding in postAttendanceMessage.
      // Logged (not silently swallowed) — a missing "Add Reactions"
      // permission or a deleted tracked message used to fail this every
      // single night with zero trace in Railway logs, so a role-restricted
      // member losing the one-click ลา option indefinitely only ever
      // surfaced as vague confusion with nothing pointing an admin at why.
      await addMessageReaction(tracked.channelId, tracked.messageId, emoji).catch((err) => {
        console.error(`[bot] failed to re-seed ลา reaction on board "${board.name}" after nightly reset`, err);
        // A 404 here means the tracked "ลา" message itself is gone (someone
        // deleted it in Discord) — from this moment on nobody can react ลา
        // on this board at all, and the only trace used to be this log line
        // that no admin ever reads (seen live: the WOE message was deleted
        // and members lost the reaction path for a whole event day with no
        // one the wiser). Tell the admins where to go to fix it.
        if (err instanceof DiscordApiError && err.status === 404) {
          missingMessageBoards.push(board.name);
        }
      });
    }
  }

  if (missingMessageBoards.length > 0) {
    const names = missingMessageBoards.map((n) => `"${n}"`).join(", ");
    void notifyAdmins(
      `⚠️ ข้อความ "ลา" ของกระดาน ${names} ใน Discord หายไปแล้ว (ถูกลบ) — ตอนนี้สมาชิกกด reaction ลาบนกระดานนี้ไม่ได้\n` +
        `แก้โดยเข้าเว็บ → /party → เลือกกระดาน → กด "Post Leave in Discord" เพื่อโพสต์ข้อความใหม่ (ระบบจะผูก message ใหม่ให้เอง)`
    );
  }

  // Run AFTER the clear loop above, not before — applying a leave scheduled
  // for today does its own delete-then-insert on partyBusyEntries (see
  // applyTodaysScheduledLeaves), so if this ran first the clear loop would
  // immediately wipe out what it just inserted.
  const { applied: scheduledLeavesApplied } = await applyTodaysScheduledLeaves();

  return { boardsReset, scheduledLeavesApplied };
}
