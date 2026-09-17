// One-time data cleanup for the "/calendar On Leave count is higher than the
// live party board" bug (see bot/sync.ts's clearPartyAssignments, fixed
// alongside this script): before that fix, a member who left Discord — or
// lost the tracked role — while marked "ลา" on a board had their
// ATTENDANCE_LEAVE event left open forever, with no matching
// ATTENDANCE_RETURN. getLeaveMemberIds (src/lib/checkin-data.ts) reconstructs
// "who's on leave" by last-write-wins over that event trail with no date
// bound, so every one of those stale rows keeps counting as an active leave
// on every future /checkin and /calendar lookup, even though the live party
// board (ACTIVE + non-benched members only) stopped listing that person ages
// ago.
//
// This script finds every (memberId, boardId) pair whose most recent
// ATTENDANCE_LEAVE/ATTENDANCE_RETURN event is a LEAVE with no matching
// partyBusyEntries row (i.e. the board no longer thinks they're busy/on
// leave at all), and closes each one out with a compensating
// ATTENDANCE_RETURN — exactly the same shape resetDailyBusyLists
// (bot/midnight-reset.ts) already logs every night for its own clears.
//
// Safe to re-run: once a pair has been closed out, its most recent event is
// a RETURN, so it no longer matches and is skipped on the next run.
//
//   npm run db:backfill-stale-leaves               # dry run (default) — reports only
//   npm run db:backfill-stale-leaves -- --apply     # actually writes the RETURN events
//
import "dotenv/config";
import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { members, membershipEvents, partyBoards, partyBusyEntries } from "../src/db/schema";

async function main() {
  const apply = process.argv.includes("--apply");

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client, { schema });

  // Every distinct (member, board) pair that has ever had an
  // ATTENDANCE_LEAVE logged against it — same grouping getLeaveMemberIds
  // scans over. boardId is nullable (the FK is "set null" on board delete);
  // a pair with no board is skipped below since getLeaveMemberIds itself is
  // always scoped to one board's linked event.
  const leavePairs = await db
    .selectDistinct({ memberId: membershipEvents.memberId, boardId: membershipEvents.boardId })
    .from(membershipEvents)
    .where(eq(membershipEvents.type, "ATTENDANCE_LEAVE"));

  let staleFound = 0;
  let closedOut = 0;
  const report: string[] = [];

  for (const { memberId, boardId } of leavePairs) {
    if (!boardId) continue;

    const [lastEvent] = await db
      .select({ id: membershipEvents.id, type: membershipEvents.type, createdAt: membershipEvents.createdAt })
      .from(membershipEvents)
      .where(and(eq(membershipEvents.memberId, memberId), eq(membershipEvents.boardId, boardId)))
      .orderBy(desc(membershipEvents.createdAt))
      .limit(1);

    if (!lastEvent || lastEvent.type !== "ATTENDANCE_LEAVE") continue; // most recent event isn't an open LEAVE — nothing stale here

    const stillBusy = await db.query.partyBusyEntries.findFirst({
      where: and(eq(partyBusyEntries.boardId, boardId), eq(partyBusyEntries.memberId, memberId)),
    });
    if (stillBusy) continue; // genuinely still marked busy/ลา right now — not stale, leave it alone

    staleFound++;
    const member = await db.query.members.findFirst({ where: eq(members.id, memberId) });
    const board = await db.query.partyBoards.findFirst({ where: eq(partyBoards.id, boardId) });
    const memberLabel = member ? member.discordNickname || member.discordGlobalName || member.discordUsername : memberId;
    report.push(`  ${memberLabel} — board "${board?.name ?? boardId}" — stuck LEAVE since ${lastEvent.createdAt.toISOString()}`);

    if (apply) {
      await db.insert(membershipEvents).values({
        memberId,
        type: "ATTENDANCE_RETURN",
        detail: `ยกเลิกลาในกระดาน "${board?.name ?? boardId}" อัตโนมัติ (backfill ข้อมูลเก่าที่ค้าง)`,
        actor: "script:backfill-stale-leaves",
        boardId,
      });
      closedOut++;
    }
  }

  console.log(`Scanned ${leavePairs.length} member+board pair(s) with at least one ATTENDANCE_LEAVE logged.`);
  console.log(`Found ${staleFound} stale open leave(s) with no matching live busy entry:`);
  console.log(report.length ? report.join("\n") : "  (none)");

  if (!apply) {
    console.log("\nDry run — no changes written. Re-run with --apply to insert the compensating ATTENDANCE_RETURN events.");
  } else {
    console.log(`\nClosed out ${closedOut} stale leave(s) with a compensating ATTENDANCE_RETURN event.`);
  }

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
