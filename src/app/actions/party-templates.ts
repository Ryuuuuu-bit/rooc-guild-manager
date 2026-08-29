"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  members,
  membershipEvents,
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
  if (!trimmed) return { ok: false, error: "กรุณาใส่ชื่อ template" };

  const board = await getPartyBoardDetail(boardId);
  if (!board) return { ok: false, error: "ไม่พบกระดาน" };

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
    return { ok: false, error: "กระดานนี้ยังไม่มีปาร์ตี้ให้บันทึก" };
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
 * template, in order. A member the template placed in a slot is pulled out
 * of that board's busy/ลา list if they were sitting there (mirrors
 * moveMember's own "busy → placed" rule, including logging
 * ATTENDANCE_RETURN, so /attendance's history stays accurate rather than
 * silently leaving a stale ลา on record for someone the template just
 * placed into an active slot). A memberId the template names who no longer
 * resolves to an active, non-benched member (left the guild, got benched,
 * etc.) is skipped — that slot comes back empty rather than failing the
 * whole apply. Runs as one transaction so a failure partway through can't
 * leave the board half-rebuilt.
 */
export async function applyPartyTemplate(boardId: string, templateId: string): Promise<ActionResult> {
  const session = await requireAdmin();

  const [board, template] = await Promise.all([
    db.query.partyBoards.findFirst({ where: eq(partyBoards.id, boardId) }),
    db.query.partyTemplates.findFirst({ where: eq(partyTemplates.id, templateId) }),
  ]);
  if (!board) return { ok: false, error: "ไม่พบกระดาน" };
  if (!template) return { ok: false, error: "ไม่พบ template" };

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

  await db.transaction(async (tx) => {
    // Pull anyone the template is about to place out of THIS board's busy
    // list first — same "busy -> placed" transition moveMember logs, kept
    // consistent so /attendance and /checkin's ลา lookup don't go stale.
    const busyToClear = await tx
      .select({ memberId: partyBusyEntries.memberId })
      .from(partyBusyEntries)
      .where(eq(partyBusyEntries.boardId, boardId));
    const toClear = busyToClear.filter((b) => eligibleIds.has(b.memberId));
    for (const { memberId } of toClear) {
      await tx
        .delete(partyBusyEntries)
        .where(and(eq(partyBusyEntries.boardId, boardId), eq(partyBusyEntries.memberId, memberId)));
      await tx.insert(membershipEvents).values({
        memberId,
        type: "ATTENDANCE_RETURN",
        detail: `ยกเลิกลาในกระดาน "${board.name}" โดยแอดมิน ${session.user.username} (โหลด template)`,
        actor: session.user.username,
        boardId,
      });
    }

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
          placedMemberIds.add(memberId);
          await tx.insert(partySlots).values({ partyId: insertedParty.id, slotIndex, memberId });
        }
      }
    }
  });

  revalidatePath("/party");
  return { ok: true };
}
