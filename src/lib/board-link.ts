// Keeps partyBoards.checkinEventKey in step with the board's NAME — the
// link is what ห้องลา, /checkin, /calendar and the leave counting use to
// find "the GL board". Relative imports so the bot could reuse it too.
import { and, eq, ne } from "drizzle-orm";
import { db } from "../db";
import { partyBoards } from "../db/schema";
import { eventKeyForBoardName } from "./checkin-events";

type DbOrTx = typeof db | Parameters<Parameters<(typeof db)["transaction"]>[0]>[0];

/**
 * Sets the board's event link from its name: "GL" → gl, "WOE" → woe, any
 * other name → unlinked. If ANOTHER board already holds that event (two
 * boards both named GL) this one stays unlinked rather than stealing it —
 * the unique index would refuse anyway. Returns the key now on the board.
 */
export async function syncBoardEventLink(boardId: string, name: string, dbOrTx: DbOrTx = db): Promise<string | null> {
  let key = eventKeyForBoardName(name);
  if (key) {
    const taken = await dbOrTx.query.partyBoards.findFirst({ where: and(eq(partyBoards.checkinEventKey, key), ne(partyBoards.id, boardId)) });
    if (taken) key = null;
  }
  await dbOrTx.update(partyBoards).set({ checkinEventKey: key, updatedAt: new Date() }).where(eq(partyBoards.id, boardId));
  return key;
}
