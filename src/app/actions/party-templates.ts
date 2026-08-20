"use server";

import { revalidatePath } from "next/cache";
import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { partyBoards, partyGroupParties, partyGroups, partyTemplates } from "@/db/schema";
import { requireAdmin } from "@/lib/authz";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export interface ActionResultWithId extends ActionResult {
  id?: string;
}

export interface TemplateGroupShape {
  name: string;
  partyCount: number;
}

export interface PartyTemplateItem {
  id: string;
  name: string;
  structure: TemplateGroupShape[];
  createdAt: string;
}

/** Best-effort validation of the jsonb `structure` column's shape at read time. */
function parseStructure(raw: unknown): TemplateGroupShape[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (g): g is TemplateGroupShape =>
        typeof g === "object" && g !== null && typeof (g as TemplateGroupShape).name === "string" && typeof (g as TemplateGroupShape).partyCount === "number"
    )
    .map((g) => ({ name: g.name, partyCount: Math.max(0, Math.min(20, Math.round(g.partyCount))) }));
}

export async function listPartyTemplates(): Promise<PartyTemplateItem[]> {
  const rows = await db.select().from(partyTemplates).orderBy(desc(partyTemplates.createdAt));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    structure: parseStructure(r.structure),
    createdAt: r.createdAt.toISOString(),
  }));
}

/**
 * Saves an existing board's shape (group names + how many parties each
 * holds) as a reusable template — deliberately NOT the member assignments,
 * since a template is a skeleton for quickly setting up a new board, not a
 * saved roster.
 */
export async function saveBoardAsTemplate(boardId: string, templateName: string): Promise<ActionResultWithId> {
  await requireAdmin();
  const trimmed = templateName.trim();
  if (!trimmed) return { ok: false, error: "กรุณาใส่ชื่อ Template" };

  const groups = await db
    .select()
    .from(partyGroups)
    .where(eq(partyGroups.boardId, boardId))
    .orderBy(asc(partyGroups.sortOrder));
  if (groups.length === 0) return { ok: false, error: "กระดานนี้ยังไม่มีกลุ่มให้บันทึกเป็น Template" };

  const structure: TemplateGroupShape[] = [];
  for (const g of groups) {
    const [{ count } = { count: 0 }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(partyGroupParties)
      .where(eq(partyGroupParties.groupId, g.id));
    structure.push({ name: g.name, partyCount: count });
  }

  const [inserted] = await db
    .insert(partyTemplates)
    .values({ name: trimmed, structure })
    .returning({ id: partyTemplates.id });

  return { ok: true, id: inserted.id };
}

export async function deletePartyTemplate(templateId: string): Promise<ActionResult> {
  await requireAdmin();
  await db.delete(partyTemplates).where(eq(partyTemplates.id, templateId));
  return { ok: true };
}

/** Creates a new board and instantiates a template's groups/parties on it (empty slots — no member assignments). */
export async function createBoardFromTemplate(boardName: string, templateId: string): Promise<ActionResultWithId> {
  await requireAdmin();
  const trimmed = boardName.trim();
  if (!trimmed) return { ok: false, error: "กรุณาใส่ชื่อกระดาน" };

  const template = await db.query.partyTemplates.findFirst({ where: eq(partyTemplates.id, templateId) });
  if (!template) return { ok: false, error: "ไม่พบ Template นี้" };
  const structure = parseStructure(template.structure);
  if (structure.length === 0) return { ok: false, error: "Template นี้ไม่มีข้อมูลกลุ่ม" };

  const [{ maxOrder } = { maxOrder: -1 }] = await db
    .select({ maxOrder: sql<number>`coalesce(max(${partyBoards.sortOrder}), -1)::int` })
    .from(partyBoards);

  const [board] = await db
    .insert(partyBoards)
    .values({ name: trimmed, sortOrder: maxOrder + 1 })
    .returning({ id: partyBoards.id });

  for (let gi = 0; gi < structure.length; gi++) {
    const groupShape = structure[gi];
    const [group] = await db
      .insert(partyGroups)
      .values({ boardId: board.id, name: groupShape.name, sortOrder: gi })
      .returning({ id: partyGroups.id });

    for (let pi = 0; pi < groupShape.partyCount; pi++) {
      await db.insert(partyGroupParties).values({ groupId: group.id, label: `Party ${pi + 1}`, sortOrder: pi });
    }
  }

  revalidatePath("/party");
  return { ok: true, id: board.id };
}
