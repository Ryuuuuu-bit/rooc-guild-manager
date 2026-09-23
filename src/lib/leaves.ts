// Leave v2 — the ONE place that reads and writes the `leaves` table.
//
// Relative imports only (no "@/" alias) on purpose: the bot worker runs
// under tsx, which can't resolve "@/", and it imports this same file as
// "../src/lib/leaves" while the web app imports it as "@/lib/leaves". One
// implementation, two module specifiers, no drift (unlike the old
// bot/party-data.ts mirror-copy pattern).
//
// Model in one sentence: a leave is (member, board, occurrenceDate) with an
// ACTIVE/CANCELLED status; "confirmed" is not stored — it is
// `status = ACTIVE && roundEnd(board, occurrenceDate) <= now`. Every page
// asks the same question against the same table, so they cannot disagree,
// and no timed job ever mutates rows (nothing for a restart to race).
import { and, asc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { db } from "../db";
import { leaves, members, membershipEvents, partyBoards, type Leave, type Member } from "../db/schema";
import { CHECKIN_EVENTS, getCheckinEvent, nextOccurrenceDate, windowFor } from "./checkin-events";

/** Either the module-level `db`, or the `tx` handed to a `db.transaction`
 * callback. */
export type DbOrTx = typeof db | Parameters<Parameters<(typeof db)["transaction"]>[0]>[0];

export type LeaveBoardRef = { id: string; name: string; checkinEventKey: string | null };

// ---------------------------------------------------------------------------
// Thai-calendar helpers (UTC+7, no DST — a fixed offset is exact)
// ---------------------------------------------------------------------------

/** "YYYY-MM-DD" for the instant in Thailand's local time. */
export function thaiDateString(d: Date = new Date()): string {
  return new Date(d.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00+07:00`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function weekdayOf(dateStr: string): number {
  return new Date(`${dateStr}T12:00:00+07:00`).getUTCDay();
}

/** Thai "อ. 22 ก.ย." style label for a "YYYY-MM-DD" date. */
export function formatThaiDateLabel(dateStr: string): string {
  return new Date(`${dateStr}T12:00:00+07:00`).toLocaleDateString("th-TH", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Asia/Bangkok",
  });
}

/** First and last "YYYY-MM-DD" of the Thai calendar month containing `now`. */
export function thaiMonthRange(now: Date = new Date()): { from: string; to: string } {
  const thai = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const y = thai.getUTCFullYear();
  const m = thai.getUTCMonth();
  const from = `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const to = `${y}-${String(m + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { from, to };
}

// ---------------------------------------------------------------------------
// Round math — the only place that knows what "the round for this date" is
// ---------------------------------------------------------------------------

/** When the round a leave is FOR ends: the linked event's window end on that
 * date, or end of that Thai day for a board with no linked event. */
export function roundEnd(board: { checkinEventKey: string | null }, occurrenceDate: string): Date {
  const event = board.checkinEventKey ? getCheckinEvent(board.checkinEventKey) : undefined;
  if (event) return windowFor(event, occurrenceDate).end;
  return new Date(`${occurrenceDate}T23:59:59+07:00`);
}

/** When that round starts (for "starts at 19:55" messaging only). */
export function roundStart(board: { checkinEventKey: string | null }, occurrenceDate: string): Date | null {
  const event = board.checkinEventKey ? getCheckinEvent(board.checkinEventKey) : undefined;
  return event ? windowFor(event, occurrenceDate).start : null;
}

export function isRoundOver(board: { checkinEventKey: string | null }, occurrenceDate: string, now: Date = new Date()): boolean {
  return roundEnd(board, occurrenceDate) <= now;
}

/** A leave counts (stats, quota) once its round is over and it wasn't cancelled. */
export function isConfirmed(
  leave: { status: Leave["status"]; occurrenceDate: string },
  board: { checkinEventKey: string | null },
  now: Date = new Date()
): boolean {
  return leave.status === "ACTIVE" && isRoundOver(board, leave.occurrenceDate, now);
}

/** The occurrence a board's Busy/ลา list refers to right now: the linked
 * event's next not-yet-ended occurrence, or today for an unlinked board. */
export function currentOccurrenceDate(board: { checkinEventKey: string | null }, now: Date = new Date()): string {
  const event = board.checkinEventKey ? getCheckinEvent(board.checkinEventKey) : undefined;
  return event ? nextOccurrenceDate(event, now) : thaiDateString(now);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Member ids on leave for one board + occurrence date. */
export async function activeLeaveMemberIds(boardId: string, occurrenceDate: string, dbOrTx: DbOrTx = db): Promise<Set<string>> {
  const rows = await dbOrTx
    .select({ memberId: leaves.memberId })
    .from(leaves)
    .where(and(eq(leaves.boardId, boardId), eq(leaves.occurrenceDate, occurrenceDate), eq(leaves.status, "ACTIVE")));
  return new Set(rows.map((r) => r.memberId));
}

/** Member ids on leave for the board linked to `eventKey` on `date` — what
 * /checkin and /calendar ask. Empty when no board is linked to the event. */
export async function leaveMemberIdsForEvent(eventKey: string, date: string): Promise<Set<string>> {
  const board = await db.query.partyBoards.findFirst({ where: eq(partyBoards.checkinEventKey, eventKey) });
  if (!board) return new Set();
  return activeLeaveMemberIds(board.id, date);
}

export type LeaveWithMember = Leave & { member: Member };

/** Active leaves on a board for a date range (inclusive), with member rows. */
export async function listActiveLeavesForBoard(
  boardId: string,
  fromDate: string,
  toDate?: string,
  dbOrTx: DbOrTx = db
): Promise<LeaveWithMember[]> {
  const conditions = [eq(leaves.boardId, boardId), eq(leaves.status, "ACTIVE"), gte(leaves.occurrenceDate, fromDate)];
  if (toDate) conditions.push(lte(leaves.occurrenceDate, toDate));
  const rows = await dbOrTx
    .select({ leave: leaves, member: members })
    .from(leaves)
    .innerJoin(members, eq(leaves.memberId, members.id))
    .where(and(...conditions))
    .orderBy(asc(leaves.occurrenceDate));
  return rows.map((r) => ({ ...r.leave, member: r.member }));
}

/** Active leaves across ALL boards for a date range — the calendar month view. */
export async function listActiveLeavesBetween(fromDate: string, toDate: string): Promise<(Leave & { member: Member; board: LeaveBoardRef | null })[]> {
  const rows = await db
    .select({ leave: leaves, member: members, board: partyBoards })
    .from(leaves)
    .innerJoin(members, eq(leaves.memberId, members.id))
    .leftJoin(partyBoards, eq(leaves.boardId, partyBoards.id))
    .where(and(eq(leaves.status, "ACTIVE"), gte(leaves.occurrenceDate, fromDate), lte(leaves.occurrenceDate, toDate)))
    .orderBy(asc(leaves.occurrenceDate));
  return rows.map((r) => ({
    ...r.leave,
    member: r.member,
    board: r.board ? { id: r.board.id, name: r.board.name, checkinEventKey: r.board.checkinEventKey } : null,
  }));
}

export type MemberOpenLeave = Leave & { board: LeaveBoardRef };

/** This member's ACTIVE leaves whose round hasn't ended yet — what the
 * /leave picker offers to cancel, soonest first. */
export async function listMemberOpenLeaves(memberId: string, now: Date = new Date(), dbOrTx: DbOrTx = db): Promise<MemberOpenLeave[]> {
  const rows = await dbOrTx
    .select({ leave: leaves, board: partyBoards })
    .from(leaves)
    .innerJoin(partyBoards, eq(leaves.boardId, partyBoards.id))
    .where(and(eq(leaves.memberId, memberId), eq(leaves.status, "ACTIVE"), gte(leaves.occurrenceDate, addDays(thaiDateString(now), -1))))
    .orderBy(asc(leaves.occurrenceDate));
  return rows
    .map((r) => ({ ...r.leave, board: { id: r.board.id, name: r.board.name, checkinEventKey: r.board.checkinEventKey } }))
    .filter((l) => !isRoundOver(l.board, l.occurrenceDate, now));
}

/** ACTIVE leaves (past or future) this member has on this board in the Thai
 * calendar month of `now` — the "ครั้งที่ N/2" figure. Counts every active
 * row, including future ones, so a member sees where they stand the moment
 * they file, and the admin flag fires on the 3rd request, not after it. */
export async function countLeavesThisMonth(memberId: string, boardId: string | null, now: Date = new Date(), dbOrTx: DbOrTx = db): Promise<number> {
  const { from, to } = thaiMonthRange(now);
  const conditions = [
    eq(leaves.memberId, memberId),
    eq(leaves.status, "ACTIVE"),
    gte(leaves.occurrenceDate, from),
    lte(leaves.occurrenceDate, to),
  ];
  if (boardId) conditions.push(eq(leaves.boardId, boardId));
  const rows = await dbOrTx.select({ id: leaves.id }).from(leaves).where(and(...conditions));
  return rows.length;
}

// ---------------------------------------------------------------------------
// Picker options
// ---------------------------------------------------------------------------

export interface LeaveOption {
  boardId: string;
  boardName: string;
  date: string;
  eventKey: string;
  eventLabel: string;
}

/** Every upcoming occurrence (today's included while its window hasn't
 * ended) of every check-in event that has a linked board, within
 * `lookaheadDays` — what the ห้องลา picker is built from. */
export async function listUpcomingLeaveOptions(now: Date = new Date(), lookaheadDays = 28): Promise<LeaveOption[]> {
  const today = thaiDateString(now);
  const options: LeaveOption[] = [];
  for (const event of CHECKIN_EVENTS) {
    const board = await db.query.partyBoards.findFirst({ where: eq(partyBoards.checkinEventKey, event.key) });
    if (!board) continue;
    for (let i = 0; i <= lookaheadDays; i++) {
      const date = addDays(today, i);
      if (!event.weekdays.includes(weekdayOf(date))) continue;
      if (windowFor(event, date).end <= now) continue;
      options.push({ boardId: board.id, boardName: board.name, date, eventKey: event.key, eventLabel: event.label });
    }
  }
  return options.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Writes — every one also drops a line in membershipEvents (audit only)
// ---------------------------------------------------------------------------

export interface RequestLeaveParams {
  memberId: string;
  boardId: string | null;
  occurrenceDate: string;
  source: "MEMBER" | "ADMIN";
  /** Discord user id (member) or admin username. */
  actor: string;
  note?: string | null;
  /** Shown in the activity log line, e.g. "ผ่านห้องลา" / "โดยแอดมิน X". */
  detailSuffix?: string;
}

export type RequestLeaveOutcome = "created" | "reactivated" | "unchanged";

/** Files (or re-files) a leave. Idempotent: an already-active leave for the
 * same round is left alone ("unchanged"); a cancelled one is flipped back. */
export async function requestLeave(params: RequestLeaveParams, dbOrTx: DbOrTx = db): Promise<{ outcome: RequestLeaveOutcome; leave: Leave }> {
  const run = async (tx: DbOrTx): Promise<{ outcome: RequestLeaveOutcome; leave: Leave }> => {
    // Board-less rows aren't covered by the unique index (NULL is distinct
    // in Postgres), so they're deduped here explicitly.
    const [existing] = await tx
      .select()
      .from(leaves)
      .where(
        and(
          eq(leaves.memberId, params.memberId),
          params.boardId ? eq(leaves.boardId, params.boardId) : isNull(leaves.boardId),
          eq(leaves.occurrenceDate, params.occurrenceDate)
        )
      )
      .limit(1);

    if (existing && existing.status === "ACTIVE") return { outcome: "unchanged", leave: existing };

    let leave: Leave;
    if (existing) {
      [leave] = await tx
        .update(leaves)
        .set({ status: "ACTIVE", cancelledAt: null, source: params.source, actor: params.actor, note: params.note ?? existing.note })
        .where(eq(leaves.id, existing.id))
        .returning();
    } else {
      // Two writers can race here (an admin dragging to ลา while the member
      // clicks ห้องลา for the same round). The unique index guarantees one
      // row; the loser's insert is a no-op and it simply reports the
      // winner's row as "unchanged" instead of surfacing a 23505 error.
      const inserted = await tx
        .insert(leaves)
        .values({
          memberId: params.memberId,
          boardId: params.boardId,
          occurrenceDate: params.occurrenceDate,
          source: params.source,
          actor: params.actor,
          note: params.note ?? null,
        })
        .onConflictDoNothing()
        .returning();
      if (inserted.length === 0) {
        const [winner] = await tx
          .select()
          .from(leaves)
          .where(
            and(
              eq(leaves.memberId, params.memberId),
              params.boardId ? eq(leaves.boardId, params.boardId) : isNull(leaves.boardId),
              eq(leaves.occurrenceDate, params.occurrenceDate)
            )
          )
          .limit(1);
        return { outcome: "unchanged", leave: winner };
      }
      [leave] = inserted;
    }

    const board = params.boardId ? await tx.query.partyBoards.findFirst({ where: eq(partyBoards.id, params.boardId) }) : null;
    await tx.insert(membershipEvents).values({
      memberId: params.memberId,
      type: "ATTENDANCE_LEAVE",
      detail:
        `ลา${board ? `กระดาน "${board.name}"` : ""} ${formatThaiDateLabel(params.occurrenceDate)}` +
        (params.detailSuffix ? ` ${params.detailSuffix}` : "") +
        (params.note ? ` — ${params.note}` : ""),
      actor: params.source === "MEMBER" ? "bot:leave" : params.actor,
      boardId: params.boardId,
    });
    return { outcome: existing ? "reactivated" : "created", leave };
  };

  // Callers already inside a transaction pass their tx; otherwise open one
  // so the row and its audit line land together.
  return dbOrTx === db ? db.transaction((tx) => run(tx)) : run(dbOrTx);
}

export interface CancelLeaveParams {
  memberId: string;
  boardId: string;
  occurrenceDate: string;
  actor: string;
  detailSuffix?: string;
}

/** Cancels one active leave. Returns false if there was nothing active. */
export async function cancelLeave(params: CancelLeaveParams, dbOrTx: DbOrTx = db): Promise<boolean> {
  const run = async (tx: DbOrTx): Promise<boolean> => {
    const updated = await tx
      .update(leaves)
      .set({ status: "CANCELLED", cancelledAt: new Date() })
      .where(
        and(
          eq(leaves.memberId, params.memberId),
          eq(leaves.boardId, params.boardId),
          eq(leaves.occurrenceDate, params.occurrenceDate),
          eq(leaves.status, "ACTIVE")
        )
      )
      .returning({ id: leaves.id, source: leaves.source });
    if (updated.length === 0) return false;

    const board = await tx.query.partyBoards.findFirst({ where: eq(partyBoards.id, params.boardId) });
    await tx.insert(membershipEvents).values({
      memberId: params.memberId,
      type: "ATTENDANCE_RETURN",
      detail: `ยกเลิกลากระดาน "${board?.name ?? params.boardId}" ${formatThaiDateLabel(params.occurrenceDate)}` + (params.detailSuffix ? ` ${params.detailSuffix}` : ""),
      actor: params.actor,
      boardId: params.boardId,
    });
    return true;
  };
  return dbOrTx === db ? db.transaction((tx) => run(tx)) : run(dbOrTx);
}

/** Cancels every ACTIVE leave of a member whose round hasn't ended — for a
 * member who left the guild, got kicked, or was benched. Past (already
 * counted) leaves are left alone. Returns how many were cancelled. */
export async function cancelMemberOpenLeaves(memberId: string, actor: string, detailSuffix: string, now: Date = new Date(), dbOrTx: DbOrTx = db): Promise<number> {
  const open = await listMemberOpenLeaves(memberId, now, dbOrTx);
  let n = 0;
  for (const l of open) {
    if (await cancelLeave({ memberId, boardId: l.board.id, occurrenceDate: l.occurrenceDate, actor, detailSuffix }, dbOrTx)) n++;
  }
  return n;
}

/** Cancels every ACTIVE, not-yet-ended leave on one board — "Clear This
 * Board". Returns how many were cancelled. */
export async function cancelBoardOpenLeaves(boardId: string, actor: string, detailSuffix: string, now: Date = new Date(), dbOrTx: DbOrTx = db): Promise<number> {
  const board = await dbOrTx.query.partyBoards.findFirst({ where: eq(partyBoards.id, boardId) });
  if (!board) return 0;
  const rows = await dbOrTx
    .select({ memberId: leaves.memberId, occurrenceDate: leaves.occurrenceDate })
    .from(leaves)
    .where(and(eq(leaves.boardId, boardId), eq(leaves.status, "ACTIVE"), gte(leaves.occurrenceDate, addDays(thaiDateString(now), -1))));
  let n = 0;
  for (const r of rows) {
    if (isRoundOver(board, r.occurrenceDate, now)) continue;
    if (await cancelLeave({ memberId: r.memberId, boardId, occurrenceDate: r.occurrenceDate, actor, detailSuffix }, dbOrTx)) n++;
  }
  return n;
}

export interface CancelRangeParams {
  /** Restrict to one board, or null for every board (board-less rows included). */
  boardId: string | null;
  /** Inclusive "YYYY-MM-DD" bounds on occurrenceDate. */
  from: string;
  to: string;
  actor: string;
  detailSuffix: string;
}

/** Cancels every ACTIVE leave dated in the range — past (already counted)
 * rounds included. For "the game was on break, nobody's leave that week
 * counts". Returns how many rows were cancelled. */
export async function cancelLeavesInRange(params: CancelRangeParams, dbOrTx: DbOrTx = db): Promise<number> {
  const conditions = [eq(leaves.status, "ACTIVE"), gte(leaves.occurrenceDate, params.from), lte(leaves.occurrenceDate, params.to)];
  if (params.boardId) conditions.push(eq(leaves.boardId, params.boardId));
  const rows = await dbOrTx.select({ id: leaves.id, memberId: leaves.memberId, boardId: leaves.boardId, occurrenceDate: leaves.occurrenceDate }).from(leaves).where(and(...conditions));
  if (rows.length === 0) return 0;

  const run = async (tx: DbOrTx) => {
    const boardNames = new Map<string, string>();
    for (const r of rows) {
      await tx.update(leaves).set({ status: "CANCELLED", cancelledAt: new Date() }).where(eq(leaves.id, r.id));
      let boardName = "(ไม่ระบุกระดาน)";
      if (r.boardId) {
        if (!boardNames.has(r.boardId)) {
          const b = await tx.query.partyBoards.findFirst({ where: eq(partyBoards.id, r.boardId) });
          boardNames.set(r.boardId, b?.name ?? r.boardId);
        }
        boardName = boardNames.get(r.boardId)!;
      }
      await tx.insert(membershipEvents).values({
        memberId: r.memberId,
        type: "ATTENDANCE_RETURN",
        detail: `ยกเลิกลากระดาน "${boardName}" ${formatThaiDateLabel(r.occurrenceDate)} ${params.detailSuffix}`,
        actor: params.actor,
        boardId: r.boardId,
      });
    }
    return rows.length;
  };
  return dbOrTx === db ? db.transaction((tx) => run(tx)) : run(dbOrTx);
}

/** Boards with a linked event, keyed by event key. */
export async function boardsByEventKey(): Promise<Map<string, LeaveBoardRef>> {
  const keys = CHECKIN_EVENTS.map((e) => e.key);
  const rows = keys.length ? await db.select().from(partyBoards).where(inArray(partyBoards.checkinEventKey, keys)) : [];
  const map = new Map<string, LeaveBoardRef>();
  for (const b of rows) if (b.checkinEventKey) map.set(b.checkinEventKey, { id: b.id, name: b.name, checkinEventKey: b.checkinEventKey });
  return map;
}
