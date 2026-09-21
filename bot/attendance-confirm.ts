import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "../src/db";
import { members, membershipEvents, partyBoards, partyBusyEntries } from "../src/db/schema";
import { getCheckinEvent, nextOccurrenceEnd } from "../src/lib/checkin-events";
import { MONTHLY_LEAVE_LIMIT } from "../src/lib/leave-quota";
import { adminNotifyConfigured, notifyAdmins } from "./admin-notify";

// Fallback for a board with no linked CHECKIN_EVENTS entry (partyBoards.
// checkinEventKey is null or points at an unknown key) — such a board has no
// known "event end time" to gate on, so it keeps the flat-delay behavior this
// whole file used to use for every board before the per-event gating below
// was added.
const FALLBACK_CONFIRM_AFTER_MS = 30 * 60 * 1000;

/** "YYYY-MM-DD" for now in Thailand's local time — local copy, see
 * bot/leave-schedule.ts's own copy for why every file keeps its own. */
function thaiDateString(d: Date = new Date()): string {
  const thai = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return thai.toISOString().slice(0, 10);
}

/**
 * The back half of "ยังไม่ล็อก..." in notifyAdminsOfLeave's DM below —
 * mirrors confirmTimingLabel in bot/reactions.ts (kept as its own local copy
 * rather than an import — reactions.ts already imports notifyAdminsOfLeave
 * FROM this file, so importing back would create a cycle; same reasoning as
 * every other small helper duplicated across these bot files).
 *
 * This used to be hardcoded as "จนกว่ากิจกรรมจะจบ" (won't lock until the
 * event ends) unconditionally — true for a board linked to a CHECKIN_EVENTS
 * entry, but for a board with none (checkinEventKey null, see the comment on
 * FALLBACK_CONFIRM_AFTER_MS above), there's no event to "end": that leave
 * actually locks in on a flat 30-minute timer instead, so the admin DM was
 * telling admins the wrong thing for any board not wired up to GL/WOE.
 */
function lockInTimingPhrase(checkinEventKey: string | null): string {
  const event = checkinEventKey ? getCheckinEvent(checkinEventKey) : undefined;
  if (!event) {
    const minutes = Math.round(FALLBACK_CONFIRM_AFTER_MS / 60_000);
    return `อีกประมาณ ${minutes} นาที (กระดานนี้ไม่ได้ผูกกับกิจกรรมไหน)`;
  }
  const now = new Date();
  const end = nextOccurrenceEnd(event, now);
  const timeLabel = end.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });
  if (thaiDateString(end) === thaiDateString(now)) return `จนกว่ากิจกรรมจะจบ (${timeLabel} น.)`;
  const dateLabel = end.toLocaleDateString("th-TH", { day: "numeric", month: "short", timeZone: "Asia/Bangkok" });
  return `จนกว่ากิจกรรมจะจบวันที่ ${dateLabel} (${timeLabel} น.)`;
}

/**
 * Best-effort DM to every configured admin the moment a member is marked
 * "ลา" — from a live reaction (reactions.ts's handleReactionAdd) or an
 * advance /leave request auto-applying (leave-schedule.ts's
 * applyTodaysScheduledLeaves) — so admins can rework the party board well
 * ahead of the event.
 *
 * Previously this only fired once confirmDueLeaves below flipped
 * confirmedAt — which, now that confirmation itself waits for the event's
 * own end time (see this file's header comment), meant the admin DM arrived
 * only AFTER the event was already over: useless for "go rework the party",
 * the entire point of notifying them. Firing immediately at mark-time
 * instead (matching how the party board's own Busy/ลา list and
 * getLeaveMemberIds already treat a leave as live right away, not just once
 * confirmed) trades that off against maybe pinging admins about a leave that
 * gets cancelled a few minutes later — worth it, since a late-but-guaranteed
 * notification is not actually useful for this purpose.
 */
/** Thai "ศ. 20 ก.ย." style label for a "YYYY-MM-DD" date — same
 * weekday+day+month shape as formatThaiDateLabel in bot/leave-schedule.ts
 * (kept as its own local copy for the same cross-file-cycle reason as
 * lockInTimingPhrase above, rather than importing that one). */
function formatLeaveDateLabel(dateStr: string): string {
  return new Date(`${dateStr}T12:00:00+07:00`).toLocaleDateString("th-TH", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Asia/Bangkok",
  });
}

export async function notifyAdminsOfLeave(memberId: string, boardId: string, date?: string) {
  await notifyAdminsOfLeaves([{ memberId, boardId, date }]);
}

export interface AdminLeaveNotice {
  memberId: string;
  boardId: string;
  /** "YYYY-MM-DD" the leave is for, when known — see the comment inside. */
  date?: string;
}

/**
 * Batched form of notifyAdminsOfLeave — ONE DM per admin covering every
 * leave in `items`, instead of one DM per leave. Needed because
 * applyTodaysScheduledLeaves (leave-schedule.ts) applies every leave due
 * that day in one pass at midnight, and firing a separate DM per leave per
 * admin all at once tripped Discord's "You are opening direct messages too
 * fast" limit (code 40003) — seen live with just 4 leaves × 2 admins, so
 * admins silently got NO notification at all for most of that night's
 * leaves. Each sendDirectMessage opens a DM channel first, and that open is
 * what's rate-limited; batching means one open per admin per pass.
 */
export async function notifyAdminsOfLeaves(items: AdminLeaveNotice[]) {
  if (!adminNotifyConfigured() || items.length === 0) return;

  const lines: string[] = [];
  let overQuota = 0;
  for (const item of items) {
    const member = await db.query.members.findFirst({ where: eq(members.id, item.memberId) });
    if (!member) continue;
    const board = await db.query.partyBoards.findFirst({ where: eq(partyBoards.id, item.boardId) });
    const displayName = member.discordNickname || member.discordGlobalName || member.discordUsername;
    // Which occurrence this leave is actually FOR, not just when it was
    // marked — a member reacting today for a board whose next occurrence
    // isn't until later (e.g. reacting Monday for GL, which only runs
    // Tue/Thu) used to leave admins to guess the date themselves from the
    // board name alone. Callers resolve this themselves (the live-reaction
    // path in reactions.ts computes it from the linked event's next
    // occurrence; the advance-/leave path in leave-schedule.ts already has
    // the exact requested date on hand) — omitted entirely for a board with
    // no linked event, where there's no specific occurrence to name.
    const dateClause = item.date ? ` วันที่ ${formatLeaveDateLabel(item.date)}` : "";
    // Monthly count on this board (confirmed + still-pending, same as the
    // member's own DM shows them) — flagged inline when it's past the guild
    // rule so an admin sees a repeat offender without opening /attendance.
    const monthCount = await countLeavesThisMonth(item.memberId, item.boardId);
    const quotaClause =
      monthCount > MONTHLY_LEAVE_LIMIT ? ` ⚠️ **เกินโควต้า — ครั้งที่ ${monthCount}/${MONTHLY_LEAVE_LIMIT} เดือนนี้**` : ` (ครั้งที่ ${monthCount}/${MONTHLY_LEAVE_LIMIT} เดือนนี้)`;
    if (monthCount > MONTHLY_LEAVE_LIMIT) overQuota++;
    lines.push(
      `• ${displayName} ลาในกระดาน "${board?.name ?? item.boardId}"${dateClause}${quotaClause} ` +
        `— ยังไม่ล็อก${lockInTimingPhrase(board?.checkinEventKey ?? null)}`
    );
  }
  if (lines.length === 0) return;

  const header = lines.length === 1 ? "📋 แจ้งลา:" : `📋 แจ้งลา ${lines.length} รายการ:`;
  const quotaFooter = overQuota > 0 ? `\n⚠️ มี ${overQuota} คนที่ลาเกินโควต้าเดือนนี้ — ดูรายละเอียดที่หน้า /attendance` : "";
  const text =
    `${header}\n${lines.join("\n")}\n` +
    "อาจถูกยกเลิกได้ก่อนล็อก — เช็ค /party ก่อนเริ่มงานอีกทีถ้าจะย้ายคนแทนที่\n" +
    "เตรียมจัดปาร์ตี้ทดแทนได้เลยครับ" +
    quotaFooter;

  await notifyAdmins(text);
}

/** Start of the current calendar month at Thai-local midnight, as a UTC
 * instant — local copy of the same helper in bot/reactions.ts (which
 * imports this file, so importing back would create a cycle). */
function startOfThaiMonth(): Date {
  const nowThai = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return new Date(Date.UTC(nowThai.getUTCFullYear(), nowThai.getUTCMonth(), 1, 0, 0, 0) - 7 * 60 * 60 * 1000);
}

/** ATTENDANCE_LEAVE rows (confirmed or still-pending) for this member on
 * this board since the start of the current Thai month — same definition
 * bot/reactions.ts's countLeavesThisMonth uses for the member-facing DM,
 * duplicated here for the cycle reason above. */
export async function countLeavesThisMonth(memberId: string, boardId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(membershipEvents)
    .where(
      and(
        eq(membershipEvents.memberId, memberId),
        eq(membershipEvents.boardId, boardId),
        eq(membershipEvents.type, "ATTENDANCE_LEAVE"),
        gte(membershipEvents.createdAt, startOfThaiMonth())
      )
    );
  return row?.count ?? 0;
}

/**
 * Promotes pending ATTENDANCE_LEAVE events (a member marked ลา — via a live
 * reaction, or an advance /leave request that already auto-applied — not yet
 * confirmed) to confirmed once the MATCHING EVENT'S NEXT NOT-YET-ENDED
 * OCCURRENCE actually ends — only confirmed leaves count toward the
 * /attendance stats page (see getAttendanceStats in src/lib/data.ts) and the
 * monthly leave quota. This is what keeps a member free to change their mind
 * any time before the event happens: cancelling before then (un-reacting, or
 * the self-service option in /leave — see cancelCurrentLeave in
 * reactions.ts) discards the event entirely instead of logging it, no matter
 * how long ago it was originally marked.
 *
 * Previously this gated on a flat 30-minute timer from when the member
 * reacted, regardless of the actual event — which is what let an advance
 * /leave request (applied hours or days before the event, see
 * leave-schedule.ts's applyTodaysScheduledLeaves) lock in almost instantly,
 * leaving no way for the member to undo it themselves afterward (the
 * scheduledLeaves-cancel flow only ever touches not-yet-applied requests).
 * Gating on the event's real end time instead treats every origin the same
 * and keeps the door open for exactly as long as it should be.
 *
 * Uses nextOccurrenceEnd (checkin-events.ts) rather than just checking
 * whether TODAY matches the event's weekday — an earlier version did that,
 * on the assumption that a live "ลา" reaction always happens same-day as the
 * event it's for. In practice the "ลา" message is a standing, never-reposted
 * board message a member can click on ANY day (see postAttendanceMessage in
 * src/app/actions/bot-messages.ts), so that assumption doesn't hold: reacting
 * on a day the event doesn't run, or reacting after that day's own window had
 * already closed, both used to fall back to FALLBACK_CONFIRM_AFTER_MS below —
 * locking the leave in within half an hour regardless of how far away the
 * actual event still was, reintroducing the exact "confirmed long before the
 * event, no real way to undo it" problem this whole redesign exists to fix.
 * nextOccurrenceEnd always finds the true next not-yet-ended occurrence
 * instead, so reacting early behaves the same as scheduling that date via
 * /leave. A board with no linked CHECKIN_EVENTS entry at all (see
 * partyBoards.checkinEventKey in schema.ts) still falls back to the flat
 * FALLBACK_CONFIRM_AFTER_MS delay this file used for every board before
 * per-event gating existed — there's no event schedule to gate on there.
 *
 * Checked against our own partyBusyEntries state (already kept in sync by
 * reactions.ts on every add/remove) rather than re-fetching the Discord
 * message, and driven by comparing timestamps rather than an in-memory
 * timer — so it survives bot restarts/redeploys cleanly. Anything overdue
 * just gets caught on the next sweep, including right at startup.
 *
 * Legacy rows from before this feature existed have no boardId recorded
 * (the column didn't exist yet) — those are auto-confirmed rather than
 * discarded, so historical /attendance stats don't silently disappear.
 *
 * Does NOT notify admins itself (see notifyAdminsOfLeave above) — that fires
 * immediately at mark-time now, from reactions.ts/leave-schedule.ts, instead
 * of waiting for this sweep to confirm (which, gated on the event's own end
 * time, would mean the notification arrived only after the event was already
 * over — too late to be useful for "go rework the party").
 */
export async function confirmDueLeaves(): Promise<{ confirmed: number; discarded: number }> {
  const now = new Date();

  // Always a small set (one row per currently-pending leave) — no need to
  // pre-filter by time in the query itself now that "due" depends on each
  // row's own event, not a single flat cutoff.
  const pending = await db
    .select({
      id: membershipEvents.id,
      memberId: membershipEvents.memberId,
      boardId: membershipEvents.boardId,
      createdAt: membershipEvents.createdAt,
    })
    .from(membershipEvents)
    .where(and(eq(membershipEvents.type, "ATTENDANCE_LEAVE"), isNull(membershipEvents.confirmedAt)));

  let confirmed = 0;
  let discarded = 0;

  for (const row of pending) {
    if (!row.boardId) {
      await db.update(membershipEvents).set({ confirmedAt: now }).where(eq(membershipEvents.id, row.id));
      confirmed++;
      continue;
    }

    const board = await db.query.partyBoards.findFirst({ where: eq(partyBoards.id, row.boardId) });
    const event = board?.checkinEventKey ? getCheckinEvent(board.checkinEventKey) : undefined;
    // IMPORTANT: nextOccurrenceEnd(event, X) is defined to search forward and
    // return the first occurrence end STRICTLY AFTER X — so passing this
    // sweep's own `now` here would make dueAt > now true by construction on
    // every single run, and the `now < dueAt` check below would never fire
    // for any linked board (a real bug this file shipped with: every
    // GL/WOE-linked leave sat pending forever, never confirmed, silently
    // missing from /attendance stats and the monthly quota). The occurrence
    // being targeted has to be fixed at MARK time instead — same as
    // reactions.ts already computes it (see leaveDate there) — so that this
    // sweep's later `now` can actually cross it once the event ends.
    const dueAt = event
      ? nextOccurrenceEnd(event, row.createdAt)
      : new Date(row.createdAt.getTime() + FALLBACK_CONFIRM_AFTER_MS);
    if (now < dueAt) continue; // event hasn't ended yet (or fallback delay hasn't elapsed) — not due

    const stillBusy = await db.query.partyBusyEntries.findFirst({
      where: and(eq(partyBusyEntries.boardId, row.boardId), eq(partyBusyEntries.memberId, row.memberId)),
    });

    if (stillBusy) {
      await db.update(membershipEvents).set({ confirmedAt: now }).where(eq(membershipEvents.id, row.id));
      confirmed++;
    } else {
      // No longer marked busy on that board (un-reacted through some path
      // that didn't go through the normal remove handler, e.g. the board
      // itself got deleted) — this pending event never became real.
      await db.delete(membershipEvents).where(eq(membershipEvents.id, row.id));
      discarded++;
    }
  }

  return { confirmed, discarded };
}
