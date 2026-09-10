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

/** Maps each class's Discord reaction emoji -> class name, e.g. "🧪" -> "Bio". Kept for the legacy emoji-reaction fallback in bot/reactions.ts — the primary flow is now the "เลือกอาชีพ" button/dropdown, see listJobClasses below. */
export async function getEmojiToClassMap(): Promise<Record<string, string>> {
  const rows = await db.select().from(jobClasses).orderBy(asc(jobClasses.sortOrder));
  const map: Record<string, string> = {};
  for (const r of rows) map[r.emoji] = r.name;
  return map;
}

/** Admin-managed class list (name + emoji), display order — what the "เลือกอาชีพ" button's select-menu dropdown is built from (see handleClassSelectButton in bot/interactions.ts). */
export async function listJobClasses(): Promise<{ name: string; emoji: string }[]> {
  return db
    .select({ name: jobClasses.name, emoji: jobClasses.emoji })
    .from(jobClasses)
    .orderBy(asc(jobClasses.sortOrder));
}
