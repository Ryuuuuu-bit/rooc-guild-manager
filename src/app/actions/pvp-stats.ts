"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { members, pvpStatEntries } from "@/db/schema";
import { requireUser } from "@/lib/authz";
import { PVP_ROLES, type PvpRole } from "@/lib/pvp-roles";
import type { ActionResult } from "@/app/actions/party";

// Every numeric field is optional — a member filling this in on their phone
// mid-event shouldn't be blocked from saving because they don't have one
// stat handy. `null` means "leave this one blank", not "clear the group's
// last value" — each submission is its own independent snapshot row (see
// pvpStatEntries in schema.ts), never an edit of a previous one.
export interface PvpStatInput {
  role: PvpRole | null;
  cp: number | null;
  pDef: number | null;
  mDef: number | null;
  pvpBonus: number | null;
  pvpReduction: number | null;
  pDmgReductionPct: number | null;
  mDmgReductionPct: number | null;
  atk: number | null;
  matk: number | null;
  ignorePDef: number | null;
  ignoreMDef: number | null;
  pDmgBonusPct: number | null;
  mDmgBonusPct: number | null;
  bossCards: string | null;
}

function cleanNumber(n: number | null): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/**
 * Any signed-in member submits their OWN stats — no admin gate, this is
 * self-reported data the same trust level as picking your own class via
 * Discord reaction. Always INSERTs a new row rather than updating the
 * member's last one, since the guild wants a running weekly history, not
 * just a current snapshot.
 */
export async function submitPvpStat(input: PvpStatInput): Promise<ActionResult> {
  const session = await requireUser();
  const member = await db.query.members.findFirst({ where: eq(members.discordId, session.user.discordId) });
  if (!member) return { ok: false, error: "ไม่พบข้อมูลสมาชิกของคุณในระบบ" };

  const role = input.role && (PVP_ROLES as readonly string[]).includes(input.role) ? input.role : null;
  const bossCards = input.bossCards?.trim() || null;

  await db.insert(pvpStatEntries).values({
    memberId: member.id,
    role,
    cp: cleanNumber(input.cp),
    pDef: cleanNumber(input.pDef),
    mDef: cleanNumber(input.mDef),
    pvpBonus: cleanNumber(input.pvpBonus),
    pvpReduction: cleanNumber(input.pvpReduction),
    pDmgReductionPct: cleanNumber(input.pDmgReductionPct),
    mDmgReductionPct: cleanNumber(input.mDmgReductionPct),
    atk: cleanNumber(input.atk),
    matk: cleanNumber(input.matk),
    ignorePDef: cleanNumber(input.ignorePDef),
    ignoreMDef: cleanNumber(input.ignoreMDef),
    pDmgBonusPct: cleanNumber(input.pDmgBonusPct),
    mDmgBonusPct: cleanNumber(input.mDmgBonusPct),
    bossCards,
  });

  revalidatePath("/pvp-stats");
  return { ok: true };
}
