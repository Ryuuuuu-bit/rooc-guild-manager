import { and, eq, isNull } from "drizzle-orm";
import { db } from "../src/db";
import { botReactionMessages, partyBoards } from "../src/db/schema";
import { sendDirectMessage } from "../src/lib/discord";

/** Base URL of this deployment — same fallback chain as
 * src/app/actions/pvp-stats.ts's appBaseUrl (duplicated rather than
 * imported — bot/ and src/'s server-action modules don't share code across
 * deploy targets, see the gotcha at the top of sync.ts). */
function appBaseUrl(): string {
  const fromAuth = process.env.AUTH_URL?.replace(/\/+$/, "");
  if (fromAuth) return fromAuth;
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  return "https://web-production-32c2a1.up.railway.app";
}

/** Deep link straight to one Discord message — lets the welcome DM point at
 * the actual, current class-select / leave-panel / ลา messages instead of
 * just naming a channel, so a new member can tap through and act on it
 * immediately. */
function messageLink(channelId: string, messageId: string): string {
  return `https://discord.com/channels/${process.env.DISCORD_GUILD_ID}/${channelId}/${messageId}`;
}

/**
 * DMs a brand-new member (first time ever joining, never a rejoin) a short
 * orientation: rename to match their in-game name, where to press the
 * button for class select, where to press the button for advance leave
 * (plus the live per-board reaction as a same-day fallback), and the
 * PVP-stats link — the things new members otherwise had to ask an admin
 * about. Looks up the CURRENTLY live class-select / leave-panel /
 * attendance messages each time (rather than hardcoding channel names) so
 * the links stay correct even after a repost moves them to a different
 * message or channel.
 *
 * Best-effort/non-fatal — a member with DMs off just doesn't get this; call
 * sites should not let a failure here block the join itself.
 */
export async function sendWelcomeMessage(member: { discordId: string }): Promise<void> {
  const classSelect = await db.query.botReactionMessages.findFirst({
    where: and(eq(botReactionMessages.kind, "CLASS_SELECT"), isNull(botReactionMessages.boardId)),
  });

  // The guild-wide "แจ้งลาล่วงหน้า" panel (see postLeavePanelMessage) — the
  // primary way to take leave now: pick upcoming event dates in advance and
  // the system applies the leave itself on the day, no need to remember to
  // react live. Distinct from the per-board ATTENDANCE messages below,
  // which are the same-day/live fallback for a leave decided last-minute.
  const leavePanel = await db.query.botReactionMessages.findFirst({
    where: and(eq(botReactionMessages.kind, "LEAVE_PANEL"), isNull(botReactionMessages.boardId)),
  });

  const attendanceRows = await db
    .select({ channelId: botReactionMessages.channelId, messageId: botReactionMessages.messageId, boardName: partyBoards.name })
    .from(botReactionMessages)
    .innerJoin(partyBoards, eq(botReactionMessages.boardId, partyBoards.id))
    .where(eq(botReactionMessages.kind, "ATTENDANCE"));

  const lines = [
    "👋 ยินดีต้อนรับเข้ากิลด์ครับ! ก่อนเริ่มเล่นมีเรื่องต้องรู้ไว้นิดหน่อย:",
    "",
    "1️⃣ เปลี่ยนนามแฝง (nickname) ใน Discord ให้ตรงกับชื่อตัวละครในเกม จะได้รู้ว่าใครเป็นใครในระบบ",
    "",
    // Class select is now button+dropdown (see postClassSelectMessage /
    // handleClassSelectButton) — no more emoji-reacting, so this copy has
    // to say "press the button", not "react to this message".
    classSelect
      ? `2️⃣ เลือกอาชีพตัวละคร — กดปุ่ม 🎮 เลือกอาชีพ ที่ข้อความนี้เลย: ${messageLink(classSelect.channelId, classSelect.messageId)}`
      : "2️⃣ เลือกอาชีพตัวละคร — ยังไม่พบข้อความเลือกอาชีพตอนนี้ สอบถามแอดมินได้เลยครับ",
    "",
    [
      leavePanel
        ? `3️⃣ ถ้าลา/ไม่สะดวกเข้ากิจกรรมไหน แจ้งล่วงหน้าได้เลย — กดปุ่ม 🗓️ แจ้งลาล่วงหน้า ที่ข้อความนี้: ${messageLink(leavePanel.channelId, leavePanel.messageId)} (เลือกวันที่จะลาไว้ล่วงหน้าได้เลย ระบบลาให้อัตโนมัติเมื่อถึงวันจริง)`
        : "3️⃣ ถ้าลา/ไม่สะดวกเข้ากิจกรรมไหน จะมีปุ่มแจ้งลาล่วงหน้าให้กดแยกต่างหาก สอบถามแอดมินได้เลยครับ",
      attendanceRows.length
        ? `ถ้าลากะทันหันวันนั้นเลย (ไม่ทันแจ้งล่วงหน้า) กดอิโมจิที่ข้อความของกิจกรรมนั้นแทนได้:\n` +
          attendanceRows.map((r) => `• ${r.boardName}: ${messageLink(r.channelId, r.messageId)}`).join("\n")
        : null,
    ]
      .filter(Boolean)
      .join("\n"),
    "",
    `4️⃣ กรอกสถิติ PVP ของตัวเองได้ที่เว็บนี้ (อัปเดตได้เรื่อยๆ ทุกสัปดาห์): ${appBaseUrl()}/pvp-stats`,
  ];

  try {
    await sendDirectMessage(member.discordId, lines.join("\n"));
  } catch (err) {
    console.error(`[bot] failed to DM welcome message to ${member.discordId}`, err);
  }
}
