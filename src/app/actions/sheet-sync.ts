"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { members, membershipEvents } from "@/db/schema";
import { requireAdmin } from "@/lib/authz";
import { memberDisplayName } from "@/lib/ui";
import {
  buildClassSyncProposals,
  fetchSheetRows,
  isValidClassOption,
  type ClassSyncResult,
} from "@/lib/sheet-sync";

export interface FetchClassSyncResult {
  ok: boolean;
  data?: ClassSyncResult;
  error?: string;
}

/** Fetches the sheet + computes proposed class changes. Read-only — writes nothing. */
export async function fetchClassSyncProposals(): Promise<FetchClassSyncResult> {
  await requireAdmin();

  try {
    const [sheetRows, activeMembers] = await Promise.all([
      fetchSheetRows(),
      db.query.members.findMany({ where: eq(members.status, "ACTIVE") }),
    ]);

    const forSync = activeMembers.map((m) => ({
      id: m.id,
      inGameName: m.inGameName,
      characterClass: m.characterClass,
      sheetClassRaw: m.sheetClassRaw,
      displayName: memberDisplayName(m),
    }));

    return { ok: true, data: buildClassSyncProposals(forSync, sheetRows) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "ซิงค์จาก Sheet ไม่สำเร็จ" };
  }
}

export interface ClassSyncSelection {
  memberId: string;
  className: string;
  /** The raw sheet Class value this choice was made for — stored so a
   * future sync can tell this member's sheet cell hasn't changed and skip
   * re-asking. */
  sheetClassRaw: string;
}

export interface ApplyClassSyncResult {
  ok: boolean;
  error?: string;
  appliedCount?: number;
}

/** Applies admin-confirmed class changes from a sheet sync review. */
export async function applyClassSync(selections: ClassSyncSelection[]): Promise<ApplyClassSyncResult> {
  const session = await requireAdmin();
  if (selections.length === 0) return { ok: true, appliedCount: 0 };

  for (const sel of selections) {
    if (!isValidClassOption(sel.className)) {
      return { ok: false, error: `Class ไม่ถูกต้อง: ${sel.className}` };
    }
  }

  await Promise.all(
    selections.map((sel) =>
      db
        .update(members)
        .set({ characterClass: sel.className, sheetClassRaw: sel.sheetClassRaw, updatedAt: new Date() })
        .where(eq(members.id, sel.memberId))
    )
  );

  // Every selection here already represents an actual change — the review
  // panel only proposes rows where the sheet's class differs from what's
  // currently stored — so these all get logged unconditionally.
  await db.insert(membershipEvents).values(
    selections.map((sel) => ({
      memberId: sel.memberId,
      type: "CLASS_CHANGE" as const,
      detail: `เปลี่ยนอาชีพเป็น ${sel.className} ผ่านการซิงค์จาก Google Sheet โดยแอดมิน ${session.user.username}`,
      actor: session.user.username,
    }))
  );

  revalidatePath("/members");
  revalidatePath("/party");
  revalidatePath("/");

  return { ok: true, appliedCount: selections.length };
}
