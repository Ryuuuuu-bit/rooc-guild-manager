// Relative import (not "@/") — see class-emoji.ts's note: this file is
// imported directly by the bot worker, which runs via `tsx` and doesn't
// resolve the Next.js tsconfig path alias. Classes are admin-managed in the
// `job_classes` DB table (see src/lib/job-classes.ts for the web app's
// equivalent) — the bot re-queries it fresh on every reaction event rather
// than caching, since a guild bot's reaction volume is low and this keeps
// it trivially correct whenever an admin edits the class list.
import { asc } from "drizzle-orm";
import { db } from "../src/db";
import { jobClasses } from "../src/db/schema";

/** Maps each class's Discord reaction emoji -> class name, e.g. "🧪" -> "Bio". */
export async function getEmojiToClassMap(): Promise<Record<string, string>> {
  const rows = await db.select().from(jobClasses).orderBy(asc(jobClasses.sortOrder));
  const map: Record<string, string> = {};
  for (const r of rows) map[r.emoji] = r.name;
  return map;
}
