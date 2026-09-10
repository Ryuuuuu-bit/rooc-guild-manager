"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  members,
  partyBoards,
  partyBusyEntries,
  partyGroupParties,
  partyGroups,
  partySlots,
  partyTemplates,
  type PartyTemplateData,
} from "@/db/schema";
import { requireAdmin } from "@/lib/authz";
import { getPartyBoardDetail } from "@/lib/party-data";
import { memberDisplayName } from "@/lib/ui";
import type { ActionResult, ActionResultWithId } from "@/app/actions/party";

export interface PartyTemplateListItem {
  id: string;
  name: string;
  createdByUsername: string | null;
  createdAt: Date;
  groupCount: number;
  partyCount: number;
  filledSlotCount: number;
}

/** Saved templates, newest first, with just enough of a summary (party/slot
 * counts) to tell them apart at a glance without opening each one. */
export async function listPartyTemplates(): Promise<PartyTemplateListItem[]> {
  const rows = await db.select().from(partyTemplates).orderBy(desc(partyTemplates.createdAt));
  return rows.map((row) => {
    const data = row.data as PartyTemplateData;
    const partyCount = data.groups.reduce((sum, g) => sum + g.parties.length, 0);
    const filledSlotCount = data.groups.reduce(
      (sum, g) => sum + g.parties.reduce((s, p) => s + p.slots.filter((m) => m !== null).length, 0),
      0
    );
    return {
      id: row.id,
      name: row.name,
      createdByUsername: row.createdByUsername,
      createdAt: row.createdAt,
      groupCount: data.groups.length,
      partyCount,
      filledSlotCount,
    };
  });
}

/**
 * Snapshots a board's current groups/parties/slot assignments (by member
 * id) as a reusable template — not tied to the board it came from, so it
 * can be applied to any board later (e.g. re-running the same event's
 * composition on a fresh week's board). Doesn't capture the busy/ลา list
 * or the unassigned pool — a template is a party LAYOUT, not a full
 * roster snapshot.
 */
export async function saveBoardAsTemplate(boardId: string, name: string): Promise<ActionResultWithId> {
  const session = await requireAdmin();
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Please enter a template name" };

  const board = await getPartyBoardDetail(boardId);
  if (!board) return { ok: false, error: "Board not found" };

  const data: PartyTemplateData = {
    groups: board.groups.map((g) => ({
      name: g.name,
      parties: g.parties.map((p) => ({
        label: p.label,
        slots: p.slots
          .slice()
          .sort((a, b) => a.slotIndex - b.slotIndex)
          .map((s) => s.member?.id ?? null),
      })),
    })),
  };

  if (data.groups.every((g) => g.parties.length === 0)) {
    return { ok: false, error: "This board has no parties to save yet" };
  }

  const [inserted] = await db
    .insert(partyTemplates)
    .values({ name: trimmed, createdByUsername: session.user.username, data })
    .returning({ id: partyTemplates.id });

  revalidatePath("/party");
  return { ok: true, id: inserted.id };
}

export async function deletePartyTemplate(templateId: string): Promise<ActionResult> {
  await requireAdmin();
  await db.delete(partyTemplates).where(eq(partyTemplates.id, templateId));
  revalidatePath("/party");
  return { ok: true };
}

/**
 * Replaces a board's entire group/party/slot structure with a saved
 * template's — the board's own groups are deleted first (cascades to their
 * parties and slots via the FKs in schema.ts) and rebuilt from the
 * template, in order. A member currently marked Busy/ลา on THIS board is
 * deliberately left out of their template slot (which comes back empty)
 * instead of being pulled back in — a saved template has no idea today's ลา
 * list even exists (it might be a completely different day/event from
 * whenever it was saved), so silently un-ลาing someone by loading an old
 * layout would be a real footgun for whoever's arranging parties. Their
 * busy entry itself is left untouched either way. A memberId the template
 * names who no longer resolves to an active, non-benched member (left the
 * guild, got benched, etc.) is likewise skipped. Runs as one transaction so
 * a failure partway through can't leave the board half-rebuilt.
 */
export async function applyPartyTemplate(boardId: string, templateId: string): Promise<ActionResult> {
  await requireAdmin();

  const [board, template] = await Promise.all([
    db.query.partyBoards.findFirst({ where: eq(partyBoards.id, boardId) }),
    db.query.partyTemplates.findFirst({ where: eq(partyTemplates.id, templateId) }),
  ]);
  if (!board) return { ok: false, error: "Board not found" };
  if (!template) return { ok: false, error: "Template not found" };

  const data = template.data as PartyTemplateData;
  const templateMemberIds = new Set(
    data.groups.flatMap((g) => g.parties.flatMap((p) => p.slots.filter((m): m is string => m !== null)))
  );

  const eligibleMembers = templateMemberIds.size
    ? await db.query.members.findMany({
        where: and(eq(members.status, "ACTIVE"), eq(members.benched, false)),
      })
    : [];
  const eligibleIds = new Set(eligibleMembers.filter((m) => templateMemberIds.has(m.id)).map((m) => m.id));
  const eligibleById = new Map(eligibleMembers.map((m) => [m.id, m]));

  const skippedForLeave = new Set<string>();

  await db.transaction(async (tx) => {
    // Members currently marked Busy/ลา on THIS board — checked so the slot
    // loop below can leave their template slot empty instead of placing
    // them (see the doc comment above for why).
    const busyRows = await tx
      .select({ memberId: partyBusyEntries.memberId })
      .from(partyBusyEntries)
      .where(eq(partyBusyEntries.boardId, boardId));
    const busyMemberIds = new Set(busyRows.map((b) => b.memberId));

    // Wipe the board's current structure — cascades to parties and slots.
    await tx.delete(partyGroups).where(eq(partyGroups.boardId, boardId));

    const placedMemberIds = new Set<string>();
    for (let gi = 0; gi < data.groups.length; gi++) {
      const group = data.groups[gi];
      const [insertedGroup] = await tx
        .insert(partyGroups)
        .values({ boardId, name: group.name, sortOrder: gi })
        .returning({ id: partyGroups.id });

      for (let pi = 0; pi < group.parties.length; pi++) {
        const party = group.parties[pi];
        const [insertedParty] = await tx
          .insert(partyGroupParties)
          .values({ groupId: insertedGroup.id, label: party.label, sortOrder: pi })
          .returning({ id: partyGroupParties.id });

        for (let slotIndex = 0; slotIndex < party.slots.length; slotIndex++) {
          const memberId = party.slots[slotIndex];
          if (!memberId || !eligibleIds.has(memberId) || placedMemberIds.has(memberId)) continue;
          if (busyMemberIds.has(memberId)) {
            skippedForLeave.add(memberId);
            continue;
          }
          placedMemberIds.add(memberId);
          await tx.insert(partySlots).values({ partyId: insertedParty.id, slotIndex, memberId });
        }
      }
    }
  });

  revalidatePath("/party");
  if (skippedForLeave.size > 0) {
    const names = [...skippedForLeave]
      .map((id) => eligibleById.get(id))
      .filter((m): m is NonNullable<typeof m> => m !== undefined)
      .map((m) => memberDisplayName(m))
      .join(", ");
    return {
      ok: true,
      error: `โหลด template สำเร็จ — เว้นว่าง ${skippedForLeave.size} ช่องเพราะคนละลาอยู่ตอนนี้: ${names}`,
    };
  }
  return { ok: true };
}
