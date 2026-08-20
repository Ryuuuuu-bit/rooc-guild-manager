// Server-only data access for the admin-managed job class list (replaces
// what used to be the hard-coded CLASS_OPTIONS/classColors constants in
// src/lib/classes.ts, deleted in favor of this). Imports "@/db", so this
// file must never be imported from a Client Component — see
// job-class-colors.ts for the client-safe color palette, and
// job-classes-provider.tsx for how the list reaches Client Components
// (fetched once in the (app) layout, passed down via React Context).
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { jobClasses } from "@/db/schema";
import { colorClassFor } from "./job-class-colors";

export interface JobClass {
  id: string;
  name: string;
  emoji: string;
  colorKey: string;
  colorClass: string;
  sortOrder: number;
}

export async function listJobClasses(): Promise<JobClass[]> {
  const rows = await db.select().from(jobClasses).orderBy(asc(jobClasses.sortOrder));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    emoji: r.emoji,
    colorKey: r.colorKey,
    colorClass: colorClassFor(r.colorKey),
    sortOrder: r.sortOrder,
  }));
}

export async function isValidJobClassName(name: string | null | undefined): Promise<boolean> {
  if (!name) return false;
  const row = await db.query.jobClasses.findFirst({ where: eq(jobClasses.name, name) });
  return Boolean(row);
}

export { COLOR_PALETTE, COLOR_KEYS, colorClassFor, type ColorKey } from "./job-class-colors";
