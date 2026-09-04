"use server";

import { revalidatePath } from "next/cache";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { members, pvpStatEntries, pvpStatFieldDefs } from "@/db/schema";
import { requireAdmin, requireUser } from "@/lib/authz";
import { PVP_ROLES, type PvpRole } from "@/lib/pvp-roles";
import { isReviewStatus, type ReviewStatus } from "@/lib/pvp-stat-review";
import { sendDirectMessage } from "@/lib/discord";
import type { ActionResult } from "@/app/actions/party";

// Every numeric field is optional — a member filling this in on their phone
// mid-event shouldn't be blocked from saving because they don't have one
// stat handy. `null` means "leave this one blank", not "clear the group's
// last value" — each submission is its own independent snapshot row (see
// pvpStatEntries in schema.ts), never an edit of a previous one (except the
// admin correction path below, which is the deliberate exception).
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
  /** Admin-added stat columns (pvpStatFieldDefs), keyed by field `key`. Any
   * key not currently an active field def is silently dropped — see
   * sanitizeCustomValues — so a field retired between page-load and submit
   * can't sneak a stray value back in. */
  customValues?: Record<string, number | null>;
}

function cleanNumber(n: number | null | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

async function getActiveFieldKeys(): Promise<Set<string>> {
  const rows = await db.select({ key: pvpStatFieldDefs.key }).from(pvpStatFieldDefs).where(eq(pvpStatFieldDefs.active, true));
  return new Set(rows.map((r) => r.key));
}

function sanitizeCustomValues(raw: Record<string, number | null> | undefined, activeKeys: Set<string>): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw) return out;
  for (const [key, value] of Object.entries(raw)) {
    if (!activeKeys.has(key)) continue;
    const n = cleanNumber(value);
    if (n !== null) out[key] = n;
  }
  return out;
}

function buildEntryValues(input: PvpStatInput, customValues: Record<string, number>) {
  const role = input.role && (PVP_ROLES as readonly string[]).includes(input.role) ? input.role : null;
  return {
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
    bossCards: input.bossCards?.trim() || null,
    customValues: Object.keys(customValues).length > 0 ? customValues : null,
  };
}

async function insertPvpStatEntry(memberId: string, input: PvpStatInput): Promise<ActionResult> {
  const activeKeys = await getActiveFieldKeys();
  const customValues = sanitizeCustomValues(input.customValues, activeKeys);

  await db.insert(pvpStatEntries).values({ memberId, ...buildEntryValues(input, customValues) });

  revalidatePath("/pvp-stats");
  revalidatePath(`/pvp-stats/${memberId}`);
  return { ok: true };
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
  if (!member) return { ok: false, error: "Your member record was not found in the system" };
  return insertPvpStatEntry(member.id, input);
}

/**
 * Admin fills in a submission ON BEHALF of a member — e.g. someone who
 * reported their numbers in Discord instead of the form. Same append-only
 * insert as submitPvpStat, just targeting an arbitrary member instead of
 * the caller's own.
 */
export async function adminCreatePvpStatFor(memberId: string, input: PvpStatInput): Promise<ActionResult> {
  await requireAdmin();
  const member = await db.query.members.findFirst({ where: eq(members.id, memberId) });
  if (!member) return { ok: false, error: "Member not found" };
  return insertPvpStatEntry(memberId, input);
}

/**
 * Admin corrects the actual VALUES of an existing submission in place —
 * fixing a typo, not logging a new weekly update. The one sanctioned
 * exception to "every submission is its own row": this UPDATEs the row and
 * stamps updatedAt/editedByUsername, leaving reviewStatus/reviewNote (a
 * separate judgment, see reviewPvpStat) untouched.
 */
export async function adminEditPvpStatEntry(entryId: string, input: PvpStatInput): Promise<ActionResult> {
  const session = await requireAdmin();
  const existing = await db.query.pvpStatEntries.findFirst({ where: eq(pvpStatEntries.id, entryId) });
  if (!existing) return { ok: false, error: "Entry not found" };

  const activeKeys = await getActiveFieldKeys();
  const customValues = sanitizeCustomValues(input.customValues, activeKeys);

  await db
    .update(pvpStatEntries)
    .set({
      ...buildEntryValues(input, customValues),
      updatedAt: new Date(),
      editedByUsername: session.user.username,
    })
    .where(eq(pvpStatEntries.id, entryId));

  revalidatePath("/pvp-stats");
  revalidatePath(`/pvp-stats/${existing.memberId}`);
  return { ok: true };
}

/** Admin permanently removes a bad submission (test entry, duplicate, entered for the wrong member). */
export async function deletePvpStatEntry(entryId: string): Promise<ActionResult> {
  await requireAdmin();
  const [deleted] = await db
    .delete(pvpStatEntries)
    .where(eq(pvpStatEntries.id, entryId))
    .returning({ id: pvpStatEntries.id, memberId: pvpStatEntries.memberId });
  if (!deleted) return { ok: false, error: "Entry not found" };

  revalidatePath("/pvp-stats");
  revalidatePath(`/pvp-stats/${deleted.memberId}`);
  return { ok: true };
}

/**
 * Admin marks ONE specific submission ผ่าน/ไม่ผ่าน with an optional note on
 * what to adjust — mirrors the guild's original Sheet "Status" column.
 * Reviews the submission itself, not the member generally, so a member who
 * fails one week and fixes it the next gets a fresh, separately-reviewable
 * row rather than a status that silently carries over.
 */
export async function reviewPvpStat(
  entryId: string,
  status: ReviewStatus | null,
  note: string | null
): Promise<ActionResult> {
  const session = await requireAdmin();
  if (status !== null && !isReviewStatus(status)) {
    return { ok: false, error: "Invalid status" };
  }

  const trimmedNote = note?.trim() || null;

  const [updated] = await db
    .update(pvpStatEntries)
    .set({
      reviewStatus: status,
      reviewNote: trimmedNote,
      reviewedByUsername: session.user.username,
      reviewedAt: new Date(),
    })
    .where(eq(pvpStatEntries.id, entryId))
    .returning({ id: pvpStatEntries.id, memberId: pvpStatEntries.memberId });

  if (!updated) return { ok: false, error: "Entry not found" };

  revalidatePath("/pvp-stats");

  // Best-effort — a member with DMs off or who left the server shouldn't
  // block the review itself from saving, so failures here are only logged.
  if (status === "FAIL") {
    try {
      await notifyReviewFail(updated.memberId, trimmedNote);
    } catch (err) {
      console.error("Failed to DM member about a failed PVP stat review", err);
    }
  }

  return { ok: true };
}

/** Base URL of this deployment — prefers AUTH_URL (already configured for
 * Discord OAuth callbacks, so it's guaranteed to be the real public URL),
 * falls back to Railway's own public-domain var, then a hardcoded last
 * resort so a DM link is never just missing if both are absent. */
function appBaseUrl(): string {
  const fromAuth = process.env.AUTH_URL?.replace(/\/+$/, "");
  if (fromAuth) return fromAuth;
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  return "https://web-production-32c2a1.up.railway.app";
}

/** DMs the member whose submission just got marked ไม่ผ่าน, so they find out
 * right away instead of only on their next visit to the site. */
async function notifyReviewFail(memberId: string, note: string | null): Promise<void> {
  const member = await db.query.members.findFirst({ where: eq(members.id, memberId) });
  if (!member) return;

  const lines = [
    "⚠️ สถิติ PVP ล่าสุดของคุณถูกแอดมินตรวจแล้ว: **ไม่ผ่าน**",
    note ? `หมายเหตุ: ${note}` : null,
    "กรุณาปรับตามนี้แล้วอัปเดตใหม่ได้ที่ลิงก์นี้:",
    `${appBaseUrl()}/pvp-stats`,
  ].filter((line): line is string => Boolean(line));

  await sendDirectMessage(member.discordId, lines.join("\n"));
}

function slugifyFieldKey(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9ก-๙]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || "field";
}

/** Admin adds a new stat column that shows up in the form/table/cards immediately — no code change or deploy. */
export async function createPvpStatField(input: {
  label: string;
  groupTitle: string;
  isPercent: boolean;
}): Promise<ActionResult> {
  await requireAdmin();
  const label = input.label.trim();
  if (!label) return { ok: false, error: "Please enter a field name" };
  const groupTitle = input.groupTitle.trim() || "Other";

  const existing = await db.select({ key: pvpStatFieldDefs.key }).from(pvpStatFieldDefs);
  const existingKeys = new Set(existing.map((e) => e.key));
  const base = slugifyFieldKey(label);
  let key = base;
  let suffix = 1;
  while (existingKeys.has(key)) {
    suffix += 1;
    key = `${base}_${suffix}`;
  }

  const [top] = await db.select({ sortOrder: pvpStatFieldDefs.sortOrder }).from(pvpStatFieldDefs).orderBy(desc(pvpStatFieldDefs.sortOrder)).limit(1);
  const sortOrder = (top?.sortOrder ?? 0) + 1;

  await db.insert(pvpStatFieldDefs).values({ key, label, groupTitle, isPercent: input.isPercent, sortOrder });

  revalidatePath("/pvp-stats");
  return { ok: true };
}

/** Toggle a field's visibility on the live form/table without losing the label for old entries that recorded it (soft delete). */
export async function setPvpStatFieldActive(id: string, active: boolean): Promise<ActionResult> {
  await requireAdmin();
  const [updated] = await db
    .update(pvpStatFieldDefs)
    .set({ active })
    .where(eq(pvpStatFieldDefs.id, id))
    .returning({ id: pvpStatFieldDefs.id });
  if (!updated) return { ok: false, error: "Field not found" };

  revalidatePath("/pvp-stats");
  return { ok: true };
}

/**
 * Admin permanently removes a field definition (hard delete, not the
 * "ปิดใช้งาน" soft-delete above). Only the *definition row* is deleted —
 * `customValues` on old pvpStatEntries rows is a plain jsonb blob keyed by
 * `key` with no foreign key back to this table (see the comment on
 * customValues in schema.ts), so any already-submitted values for this field
 * are left in place; they simply have no live column to render against
 * anymore and stop showing up anywhere. This is intentionally irreversible —
 * the confirming UI is in PvpFieldManagerButton.
 */
export async function deletePvpStatField(id: string): Promise<ActionResult> {
  await requireAdmin();
  const [deleted] = await db.delete(pvpStatFieldDefs).where(eq(pvpStatFieldDefs.id, id)).returning({ id: pvpStatFieldDefs.id });
  if (!deleted) return { ok: false, error: "Field not found" };

  revalidatePath("/pvp-stats");
  return { ok: true };
}
