// One-time data migration into the Leave v2 `leaves` table (migration
// 0034_add_leaves_v2 must have run first: `npm run db:migrate`).
//
// Old model: leave state was reconstructed from three unsynchronised
// sources — membershipEvents ATTENDANCE_LEAVE/RETURN (history, confirmed
// via confirmedAt), scheduledLeaves (advance requests, deleted on apply)
// and partyBusyEntries (the live board list, no date). New model: one row
// per (member, board, occurrenceDate) with ACTIVE/CANCELLED; "counted" is
// computed at read time (round ended). This script folds all three old
// sources into that table:
//
//   1. every ATTENDANCE_LEAVE row → the round it was FOR:
//        - linked event + confirmed at the round end (bot sweep)
//              → the occurrence that ended at confirmedAt
//        - linked event + confirmed immediately (admin) or still pending
//              → the next not-yet-ended occurrence as of createdAt
//        - no linked event / no board → the Thai date of createdAt
//      ACTIVE, unless a later ATTENDANCE_RETURN for the same member+board
//      landed BEFORE that round ended (= cancelled in the old flow), or the
//      row is still pending for a round that already ended with no live
//      busy row (= the old sweep would have discarded it);
//   2. every scheduledLeaves row → ACTIVE (MEMBER) for its date;
//   3. every partyBusyEntries row → ACTIVE (ADMIN) for the board's current
//      round, if nothing above already covers it.
//
// Idempotent: existing (member, board, date) rows are never touched, so it
// can be re-run safely; with --apply it inserts, otherwise it only reports.
// The old tables are left in place (drop them in a later migration once
// the new numbers look right).
//
//   npm run db:migrate-leaves-v2              # dry run — prints what it would insert + monthly counts old vs new
//   npm run db:migrate-leaves-v2 -- --apply   # writes the rows
//
import "dotenv/config";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { leaves, members, membershipEvents, partyBoards, partyBusyEntries, scheduledLeaves } from "../src/db/schema";
import { getCheckinEvent, lastOccurrenceEnd, nextOccurrenceDate, windowFor } from "../src/lib/checkin-events";

const THAI_OFFSET_MS = 7 * 60 * 60 * 1000;

function thaiDateString(d: Date): string {
  return new Date(d.getTime() + THAI_OFFSET_MS).toISOString().slice(0, 10);
}

function thaiMonthRange(now: Date): { from: string; to: string; fromInstant: Date } {
  const thai = new Date(now.getTime() + THAI_OFFSET_MS);
  const y = thai.getUTCFullYear();
  const m = thai.getUTCMonth();
  const mm = String(m + 1).padStart(2, "0");
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(lastDay).padStart(2, "0")}`, fromInstant: new Date(Date.UTC(y, m, 1) - THAI_OFFSET_MS) };
}

type BoardRef = { id: string; name: string; checkinEventKey: string | null };

function roundEnd(board: BoardRef | null, occurrenceDate: string): Date {
  const event = board?.checkinEventKey ? getCheckinEvent(board.checkinEventKey) : undefined;
  return event ? windowFor(event, occurrenceDate).end : new Date(`${occurrenceDate}T23:59:59+07:00`);
}

interface Candidate {
  memberId: string;
  boardId: string | null;
  occurrenceDate: string;
  status: "ACTIVE" | "CANCELLED";
  source: "MEMBER" | "ADMIN";
  actor: string;
  note: string | null;
  createdAt: Date;
  cancelledAt: Date | null;
  why: string;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const now = new Date();

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client, { schema });

  const boards = await db.select().from(partyBoards);
  const boardById = new Map<string, BoardRef>(boards.map((b) => [b.id, { id: b.id, name: b.name, checkinEventKey: b.checkinEventKey }]));
  const memberRows = await db.select().from(members);
  const memberLabel = (id: string) => {
    const m = memberRows.find((r) => r.id === id);
    return m ? m.discordNickname || m.discordGlobalName || m.discordUsername : id;
  };

  const busyRows = await db.select().from(partyBusyEntries);
  const busyKeys = new Set(busyRows.map((b) => `${b.memberId}|${b.boardId}`));

  const events = await db
    .select()
    .from(membershipEvents)
    .where(sql`${membershipEvents.type} in ('ATTENDANCE_LEAVE', 'ATTENDANCE_RETURN')`)
    .orderBy(asc(membershipEvents.createdAt));
  const returns = events.filter((e) => e.type === "ATTENDANCE_RETURN");

  // key = member|board|date → latest decision wins (processed in time order)
  const candidates = new Map<string, Candidate>();
  const keyOf = (c: Pick<Candidate, "memberId" | "boardId" | "occurrenceDate">) => `${c.memberId}|${c.boardId ?? "-"}|${c.occurrenceDate}`;

  // 1. history
  for (const e of events) {
    if (e.type !== "ATTENDANCE_LEAVE") continue;
    const board = e.boardId ? (boardById.get(e.boardId) ?? null) : null;
    const event = board?.checkinEventKey ? getCheckinEvent(board.checkinEventKey) : undefined;

    let occurrenceDate: string;
    let why: string;
    // A row stamped exactly at a round's end (the repaired late-apply rows,
    // createdAt = confirmedAt = window end) belongs to THAT round, not the
    // next one nextOccurrenceDate would pick.
    const atEnd = event ? lastOccurrenceEnd(event, new Date(e.createdAt.getTime() + 60_000)) : null;
    if (event && atEnd && Math.abs(atEnd.getTime() - e.createdAt.getTime()) <= 60_000) {
      occurrenceDate = thaiDateString(atEnd);
      why = "stamped at round end";
    } else if (event && e.confirmedAt && e.confirmedAt.getTime() - e.createdAt.getTime() > 60_000) {
      // Confirmed by the sweep at (or just after) a round end → that round.
      const end = lastOccurrenceEnd(event, new Date(e.confirmedAt.getTime() + 60_000));
      occurrenceDate = end ? thaiDateString(end) : nextOccurrenceDate(event, e.createdAt);
      why = "confirmed at round end";
    } else if (event) {
      occurrenceDate = nextOccurrenceDate(event, e.createdAt);
      why = e.confirmedAt ? "confirmed immediately (admin)" : "pending";
    } else {
      occurrenceDate = thaiDateString(e.createdAt);
      why = board ? "board has no linked event" : "no board";
    }

    const end = roundEnd(board, occurrenceDate);
    let status: Candidate["status"] = "ACTIVE";
    let cancelledAt: Date | null = null;
    // A RETURN for the same member+board between the leave and the round's
    // end = cancelled in the old flow.
    const cancelling = returns.find(
      (r) => r.memberId === e.memberId && r.boardId === e.boardId && r.createdAt > e.createdAt && r.createdAt < end
    );
    if (cancelling) {
      status = "CANCELLED";
      cancelledAt = cancelling.createdAt;
      why += ", cancelled before round end";
    } else if (!e.confirmedAt && end <= now && !(e.boardId && busyKeys.has(`${e.memberId}|${e.boardId}`))) {
      // Still pending for a round that already ended, and no live busy row:
      // the old sweep would have discarded it.
      status = "CANCELLED";
      cancelledAt = end;
      why += ", pending past round end with no busy row (old sweep would discard)";
    }

    const isMember = (e.actor ?? "").startsWith("bot:");
    const c: Candidate = {
      memberId: e.memberId,
      boardId: e.boardId,
      occurrenceDate,
      status,
      source: isMember ? "MEMBER" : "ADMIN",
      actor: e.actor ?? "migration",
      note: null,
      createdAt: e.createdAt,
      cancelledAt,
      why,
    };
    candidates.set(keyOf(c), c);
  }

  // 2. advance requests still on file
  const scheduled = await db.select().from(scheduledLeaves);
  for (const s of scheduled) {
    const c: Candidate = {
      memberId: s.memberId,
      boardId: s.boardId,
      occurrenceDate: s.date,
      status: "ACTIVE",
      source: "MEMBER",
      actor: "bot:leave-schedule",
      note: null,
      createdAt: s.createdAt,
      cancelledAt: null,
      why: "scheduledLeaves row",
    };
    const key = keyOf(c);
    const existing = candidates.get(key);
    if (!existing || existing.status === "CANCELLED") candidates.set(key, c);
  }

  // 3. live busy rows not already represented for the board's current round
  for (const b of busyRows) {
    const board = boardById.get(b.boardId);
    if (!board) continue;
    const event = board.checkinEventKey ? getCheckinEvent(board.checkinEventKey) : undefined;
    const occurrenceDate = event ? nextOccurrenceDate(event, now) : thaiDateString(now);
    const c: Candidate = {
      memberId: b.memberId,
      boardId: b.boardId,
      occurrenceDate,
      status: "ACTIVE",
      source: "ADMIN",
      actor: "migration:busy",
      note: null,
      createdAt: b.createdAt,
      cancelledAt: null,
      why: "live partyBusyEntries row with no matching leave",
    };
    const key = keyOf(c);
    const existing = candidates.get(key);
    if (!existing) candidates.set(key, c);
    else if (existing.status === "CANCELLED") candidates.set(key, { ...existing, status: "ACTIVE", cancelledAt: null, why: `${existing.why}; re-activated by live busy row` });
  }

  // Skip anything already in `leaves` (re-run safety).
  const existingRows = await db.select({ memberId: leaves.memberId, boardId: leaves.boardId, occurrenceDate: leaves.occurrenceDate }).from(leaves);
  const existingKeys = new Set(existingRows.map((r) => keyOf(r)));
  const toInsert = [...candidates.values()].filter((c) => !existingKeys.has(keyOf(c)));

  console.log(`Old sources: ${events.filter((e) => e.type === "ATTENDANCE_LEAVE").length} ATTENDANCE_LEAVE, ${returns.length} ATTENDANCE_RETURN, ${scheduled.length} scheduledLeaves, ${busyRows.length} partyBusyEntries`);
  console.log(`Already in leaves: ${existingRows.length}. To insert: ${toInsert.length} (${toInsert.filter((c) => c.status === "ACTIVE").length} ACTIVE, ${toInsert.filter((c) => c.status === "CANCELLED").length} CANCELLED)\n`);
  for (const c of toInsert.sort((a, b) => a.occurrenceDate.localeCompare(b.occurrenceDate))) {
    const board = c.boardId ? boardById.get(c.boardId) : null;
    console.log(`  ${c.occurrenceDate}  ${c.status.padEnd(9)} ${memberLabel(c.memberId)} — ${board?.name ?? "(no board)"} [${c.source}] ${c.why}`);
  }

  // Monthly counts, old vs new, for a sanity check.
  const { from, to, fromInstant } = thaiMonthRange(now);
  const oldCounts = new Map<string, number>();
  for (const e of events) {
    if (e.type !== "ATTENDANCE_LEAVE" || !e.confirmedAt || e.createdAt < fromInstant) continue;
    const k = `${e.memberId}|${e.boardId ?? "-"}`;
    oldCounts.set(k, (oldCounts.get(k) ?? 0) + 1);
  }
  const newCounts = new Map<string, number>();
  const all = [...existingRows.map((r) => ({ ...r, status: "ACTIVE" as const })), ...toInsert];
  for (const c of all) {
    if (c.status !== "ACTIVE" || c.occurrenceDate < from || c.occurrenceDate > to) continue;
    const board = c.boardId ? (boardById.get(c.boardId) ?? null) : null;
    if (roundEnd(board, c.occurrenceDate) > now) continue;
    const k = `${c.memberId}|${c.boardId ?? "-"}`;
    newCounts.set(k, (newCounts.get(k) ?? 0) + 1);
  }
  const keys = new Set([...oldCounts.keys(), ...newCounts.keys()]);
  console.log(`\nCounted leaves this month (${from} → ${to}), old (confirmed, by createdAt) vs new (ACTIVE, round ended):`);
  let diffs = 0;
  for (const k of [...keys].sort()) {
    const [memberId, boardId] = k.split("|");
    const o = oldCounts.get(k) ?? 0;
    const n = newCounts.get(k) ?? 0;
    if (o !== n) diffs++;
    console.log(`  ${o === n ? " " : "!"} ${memberLabel(memberId)} — ${boardId === "-" ? "(no board)" : (boardById.get(boardId)?.name ?? boardId)}: old ${o}, new ${n}`);
  }
  console.log(diffs ? `\n${diffs} member/board pair(s) differ — expected when a leave was confirmed on a different calendar day than its round (e.g. late-applied rows).` : "\nAll monthly counts match.");

  if (!apply) {
    console.log("\nDry run — nothing written. Re-run with --apply to insert.");
  } else if (toInsert.length > 0) {
    await db.transaction(async (tx) => {
      for (const c of toInsert) {
        await tx
          .insert(leaves)
          .values({
            memberId: c.memberId,
            boardId: c.boardId,
            occurrenceDate: c.occurrenceDate,
            status: c.status,
            source: c.source,
            actor: c.actor,
            note: c.note,
            createdAt: c.createdAt,
            cancelledAt: c.cancelledAt,
          })
          .onConflictDoNothing();
      }
    });
    console.log(`\nInserted ${toInsert.length} row(s).`);
  } else {
    console.log("\nNothing to insert.");
  }

  // Also a quick sanity read-back the way the app will count.
  const active = await db.select({ n: sql<number>`count(*)::int` }).from(leaves).where(and(eq(leaves.status, "ACTIVE"), gte(leaves.occurrenceDate, from), lte(leaves.occurrenceDate, to)));
  console.log(`leaves ACTIVE this month (any round): ${active[0]?.n ?? 0}`);

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
