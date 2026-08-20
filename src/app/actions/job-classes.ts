"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { jobClasses, members } from "@/db/schema";
import { requireAdmin } from "@/lib/authz";
import { COLOR_KEYS, type ColorKey } from "@/lib/job-class-colors";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

function isColorKey(value: string): value is ColorKey {
  return (COLOR_KEYS as string[]).includes(value);
}

/** Revalidates the (app) layout — the job class list is fetched there and handed to every page via context. */
function revalidateEverywhere() {
  revalidatePath("/", "layout");
}

export async function createJobClass(formData: FormData): Promise<ActionResult> {
  await requireAdmin();

  const name = (formData.get("name") as string | null)?.trim();
  const emoji = (formData.get("emoji") as string | null)?.trim();
  const colorKey = (formData.get("colorKey") as string | null)?.trim() ?? "";

  if (!name) return { ok: false, error: "กรุณาใส่ชื่ออาชีพ" };
  if (!emoji) return { ok: false, error: "กรุณาใส่อิโมจิ" };
  if (!isColorKey(colorKey)) return { ok: false, error: "กรุณาเลือกสี" };

  const dup = await db.query.jobClasses.findFirst({ where: eq(jobClasses.name, name) });
  if (dup) return { ok: false, error: "มีอาชีพชื่อนี้อยู่แล้ว" };

  const [{ maxOrder } = { maxOrder: -1 }] = await db
    .select({ maxOrder: sql<number>`coalesce(max(${jobClasses.sortOrder}), -1)::int` })
    .from(jobClasses);

  await db.insert(jobClasses).values({ name, emoji, colorKey, sortOrder: maxOrder + 1 });

  revalidateEverywhere();
  return { ok: true };
}

export async function updateJobClass(id: string, formData: FormData): Promise<ActionResult> {
  await requireAdmin();

  const name = (formData.get("name") as string | null)?.trim();
  const emoji = (formData.get("emoji") as string | null)?.trim();
  const colorKey = (formData.get("colorKey") as string | null)?.trim() ?? "";

  if (!name) return { ok: false, error: "กรุณาใส่ชื่ออาชีพ" };
  if (!emoji) return { ok: false, error: "กรุณาใส่อิโมจิ" };
  if (!isColorKey(colorKey)) return { ok: false, error: "กรุณาเลือกสี" };

  const existing = await db.query.jobClasses.findFirst({ where: eq(jobClasses.id, id) });
  if (!existing) return { ok: false, error: "ไม่พบอาชีพนี้" };

  if (name !== existing.name) {
    const dup = await db.query.jobClasses.findFirst({
      where: and(eq(jobClasses.name, name), ne(jobClasses.id, id)),
    });
    if (dup) return { ok: false, error: "มีอาชีพชื่อนี้อยู่แล้ว" };
  }

  await db.update(jobClasses).set({ name, emoji, colorKey, updatedAt: new Date() }).where(eq(jobClasses.id, id));

  // characterClass is a plain text column (not a foreign key to jobClasses),
  // so a rename has to cascade manually to every member currently holding
  // the old name — otherwise they'd silently end up with an orphaned class
  // name nothing in the admin UI can find or edit anymore.
  if (name !== existing.name) {
    await db
      .update(members)
      .set({ characterClass: name, updatedAt: new Date() })
      .where(eq(members.characterClass, existing.name));
  }

  revalidateEverywhere();
  return { ok: true };
}

export async function deleteJobClass(id: string): Promise<ActionResult> {
  await requireAdmin();

  const existing = await db.query.jobClasses.findFirst({ where: eq(jobClasses.id, id) });
  if (!existing) return { ok: false, error: "ไม่พบอาชีพนี้" };

  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(members)
    .where(eq(members.characterClass, existing.name));
  if (count > 0) {
    return {
      ok: false,
      error: `มีสมาชิก ${count} คนใช้อาชีพนี้อยู่ — เปลี่ยนอาชีพของสมาชิกเหล่านั้นก่อน (หรือเปลี่ยนชื่ออาชีพนี้แทนการลบ) แล้วค่อยลบ`,
    };
  }

  await db.delete(jobClasses).where(eq(jobClasses.id, id));
  revalidateEverywhere();
  return { ok: true };
}

/** Swaps sortOrder with the adjacent class — a no-op at either end of the list. */
export async function moveJobClass(id: string, direction: "up" | "down"): Promise<ActionResult> {
  await requireAdmin();

  const all = await db.select().from(jobClasses).orderBy(asc(jobClasses.sortOrder));
  const idx = all.findIndex((c) => c.id === id);
  if (idx === -1) return { ok: false, error: "ไม่พบอาชีพนี้" };

  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= all.length) return { ok: true };

  const a = all[idx];
  const b = all[swapIdx];
  await db.update(jobClasses).set({ sortOrder: b.sortOrder }).where(eq(jobClasses.id, a.id));
  await db.update(jobClasses).set({ sortOrder: a.sortOrder }).where(eq(jobClasses.id, b.id));

  revalidateEverywhere();
  return { ok: true };
}
