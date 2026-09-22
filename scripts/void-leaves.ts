// Voids every ACTIVE leave dated in a period — the same thing the admin
// "Void leaves for a period" form on /attendance does, for running from a
// shell (e.g. as a one-off Railway pre-deploy command).
//
//   npx tsx scripts/void-leaves.ts --board GL --from 2026-09-15 --to 2026-09-18 --reason "พักการแข่ง"          # dry run
//   npx tsx scripts/void-leaves.ts --board GL --from 2026-09-15 --to 2026-09-18 --reason "พักการแข่ง" --apply
//
// --board is the board NAME (omit for all boards).
import "dotenv/config";
import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "../src/db";
import { leaves, members, partyBoards } from "../src/db/schema";
import { cancelLeavesInRange } from "../src/lib/leaves";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const boardName = arg("board");
  const from = arg("from");
  const to = arg("to");
  const reason = arg("reason") ?? "";
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    throw new Error("usage: --from YYYY-MM-DD --to YYYY-MM-DD [--board NAME] [--reason TEXT] [--apply]");
  }
  let boardId: string | null = null;
  if (boardName) {
    const board = await db.query.partyBoards.findFirst({ where: eq(partyBoards.name, boardName) });
    if (!board) throw new Error(`board "${boardName}" not found`);
    boardId = board.id;
  }

  const conditions = [eq(leaves.status, "ACTIVE"), gte(leaves.occurrenceDate, from), lte(leaves.occurrenceDate, to)];
  if (boardId) conditions.push(eq(leaves.boardId, boardId));
  const rows = await db
    .select({ date: leaves.occurrenceDate, member: members })
    .from(leaves)
    .innerJoin(members, eq(leaves.memberId, members.id))
    .where(and(...conditions));
  console.log(`${rows.length} ACTIVE leave(s) on ${boardName ?? "ALL boards"} dated ${from} → ${to}:`);
  for (const r of rows) console.log(`  ${r.date}  ${r.member.discordNickname || r.member.discordGlobalName || r.member.discordUsername}`);

  if (!apply) {
    console.log("Dry run — nothing changed. Add --apply to void them.");
  } else {
    const n = await cancelLeavesInRange({ boardId, from, to, actor: "script:void-leaves", detailSuffix: `(ยกเลิกทั้งช่วงโดยแอดมิน${reason ? ` — ${reason}` : ""})` });
    console.log(`Voided ${n} leave(s).`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
