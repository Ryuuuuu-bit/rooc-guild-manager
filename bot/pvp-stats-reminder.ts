import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import { members, pvpStatEntries } from "../src/db/schema";
import { sendDirectMessage } from "../src/lib/discord";

const STALE_AFTER_MS = 21 * 24 * 60 * 60 * 1000; // 3 weeks

/** Base URL of this deployment — same fallback chain as
 * src/app/actions/pvp-stats.ts's appBaseUrl (duplicated rather than
 * imported: that file is a "use server" actions module, and bot/ + src/
 * don't share code across deploy targets — see the AGENTS.md-style gotcha
 * at the top of sync.ts). */
function appBaseUrl(): string {
  const fromAuth = process.env.AUTH_URL?.replace(/\/+$/, "");
  if (fromAuth) return fromAuth;
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  return "https://web-production-32c2a1.up.railway.app";
}

/**
 * DMs every ACTIVE, non-benched member whose PVP-stat submission is 3+
 * weeks stale — "stale" measured from their most recent submission's
 * createdAt, or from joinedDiscordAt (falling back to the member row's own
 * createdAt) if they've never submitted at all, so a member who's simply
 * never filled the form in doesn't slip through unreminded.
 *
 * Reminds at most ONCE per stale streak: after a DM goes out,
 * `lastPvpStatsReminderAt` is stamped to now, and this member is skipped on
 * every later sweep until their reference date moves past that stamp — i.e.
 * they actually submitted something new — and they go stale again from
 * there. Without this, a member who stays stale for months would get
 * re-DMed on every single sweep forever.
 *
 * Best-effort per member — a DM failure (DMs off, left the server since the
 * roster was read) is logged and the reminder is still marked sent, so one
 * member with DMs closed doesn't get retried every sweep indefinitely.
 */
export async function sendPvpStatsReminders(): Promise<{ reminded: number }> {
  const now = new Date();
  const staleCutoff = new Date(now.getTime() - STALE_AFTER_MS);

  const activeMembers = await db
    .select()
    .from(members)
    .where(and(eq(members.status, "ACTIVE"), eq(members.benched, false)));
  if (activeMembers.length === 0) return { reminded: 0 };

  const memberIds = activeMembers.map((m) => m.id);
  const entries = await db
    .select({ memberId: pvpStatEntries.memberId, createdAt: pvpStatEntries.createdAt })
    .from(pvpStatEntries)
    .where(inArray(pvpStatEntries.memberId, memberIds))
    .orderBy(desc(pvpStatEntries.createdAt));

  // First entry seen per member wins — entries is already newest-first.
  const latestByMember = new Map<string, Date>();
  for (const e of entries) {
    if (!latestByMember.has(e.memberId)) latestByMember.set(e.memberId, e.createdAt);
  }

  let reminded = 0;
  for (const member of activeMembers) {
    const everSubmitted = latestByMember.has(member.id);
    const referenceDate = latestByMember.get(member.id) ?? member.joinedDiscordAt ?? member.createdAt;
    if (referenceDate > staleCutoff) continue; // not stale yet

    // Already reminded for THIS streak — their reference date hasn't moved
    // past the last reminder, meaning nothing new was submitted since.
    if (member.lastPvpStatsReminderAt && member.lastPvpStatsReminderAt >= referenceDate) continue;

    const daysStale = Math.floor((now.getTime() - referenceDate.getTime()) / (24 * 60 * 60 * 1000));
    const lines = [
      everSubmitted
        ? `⏰ สถิติ PVP ของคุณไม่ได้อัปเดตมา ${daysStale} วันแล้ว`
        : `⏰ ยังไม่เห็นคุณกรอกสถิติ PVP เลยนะ (เข้ากิลด์มา ${daysStale} วันแล้ว)`,
      "อัปเดตได้ที่ลิงก์นี้เลย:",
      `${appBaseUrl()}/pvp-stats`,
    ];

    try {
      await sendDirectMessage(member.discordId, lines.join("\n"));
    } catch (err) {
      console.error(`[bot] failed to DM ${member.discordId} a PVP-stats reminder`, err);
    }
    // Stamped regardless of DM success — see the doc comment above.
    await db.update(members).set({ lastPvpStatsReminderAt: now }).where(eq(members.id, member.id));
    reminded++;
  }

  return { reminded };
}
