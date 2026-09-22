// One-time data repair for advance /leave requests that got applied a day
// LATE — the "same-day /leave sat until the next midnight" bug fixed in
// bot/interactions.ts (scheduleLeavesAndReply) and bot/leave-schedule.ts
// (applyTodaysScheduledLeaves' late-apply branch). Before those fixes, a
// member filing /leave on the morning of an event had their row applied at
// the FOLLOWING midnight: an ATTENDANCE_LEAVE stamped e.g. Mon 00:00 for
// Sunday's WOE, a busy row that the next nightly reset then cleared, and a
// still-pending leave that confirmDueLeaves will eventually DISCARD (no
// longer busy) — so the member's real, properly-requested leave never counts
// toward /attendance or the monthly quota. Seen live on 2026-09-20/21 (six
// WOE leaves).
//
// This script finds every still-pending ATTENDANCE_LEAVE that
//   - came from the scheduled-leave path (actor "bot:leave-schedule"),
//   - sits on a board linked to a check-in event,
//   - has NO live busy row anymore (i.e. is on track to be discarded), and
//   - was created within 24h AFTER an occurrence of that event ended
// and re-stamps it as a confirmed leave for THAT occurrence (createdAt and
// confirmedAt both = the occurrence's window end) — exactly what the
// late-apply branch now writes for this case going forward.
//
// Safe to re-run: a repaired row is confirmed, so it no longer matches.
//
//   npm run db:repair-late-leaves               # dry run (default) — reports only
//   npm run db:repair-late-leaves -- --apply     # actually re-stamps the rows
//
import "dotenv/config";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { members, membershipEvents, partyBoards, partyBusyEntries } from "../src/db/schema";
import { getCheckinEvent, lastOccurrenceEnd } from "../src/lib/checkin-events";

const LATE_WINDOW_MS = 24 * 60 * 60 * 1000;

async function main() {
  const apply = process.argv.includes("--apply");

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client, { schema });

  const pending = await db
    .select()
    .from(membershipEvents)
    .where(
      and(
        eq(membershipEvents.type, "ATTENDANCE_LEAVE"),
        isNull(membershipEvents.confirmedAt),
        eq(membershipEvents.actor, "bot:leave-schedule")
      )
    );

  let matched = 0;
  let repaired = 0;
  const report: string[] = [];

  for (const row of pending) {
    if (!row.boardId) continue;
    const board = await db.query.partyBoards.findFirst({ where: eq(partyBoards.id, row.boardId) });
    const event = board?.checkinEventKey ? getCheckinEvent(board.checkinEventKey) : undefined;
    if (!event) continue;

    const stillBusy = await db.query.partyBusyEntries.findFirst({
      where: and(eq(partyBusyEntries.boardId, row.boardId), eq(partyBusyEntries.memberId, row.memberId)),
    });
    if (stillBusy) continue; // a live leave — not this bug

    const endedAt = lastOccurrenceEnd(event, row.createdAt);
    if (!endedAt) continue;
    const lag = row.createdAt.getTime() - endedAt.getTime();
    if (lag < 0 || lag > LATE_WINDOW_MS) continue;

    matched++;
    const member = await db.query.members.findFirst({ where: eq(members.id, row.memberId) });
    const memberLabel = member ? member.discordNickname || member.discordGlobalName || member.discordUsername : row.memberId;
    report.push(
      `  ${memberLabel} — board "${board?.name}" — applied ${row.createdAt.toISOString()}, belongs to occurrence ending ${endedAt.toISOString()}`
    );

    if (apply) {
      await db
        .update(membershipEvents)
        .set({
          createdAt: endedAt,
          confirmedAt: endedAt,
          detail: `${row.detail ?? ""} (ซ่อมข้อมูล: ย้ายไปรอบที่ถูกต้อง)`,
        })
        .where(eq(membershipEvents.id, row.id));
      repaired++;
    }
  }

  console.log(`Scanned ${pending.length} pending scheduled-leave row(s).`);
  console.log(`Found ${matched} applied late for an occurrence that had already ended:`);
  console.log(report.length ? report.join("\n") : "  (none)");
  if (!apply) console.log("\nDry run — no changes written. Re-run with --apply to re-stamp them as confirmed leaves for the right occurrence.");
  else console.log(`\nRepaired ${repaired} row(s).`);

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
