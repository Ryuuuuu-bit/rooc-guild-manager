"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { botReactionMessages, partyBoards } from "@/db/schema";
import { requireAdmin } from "@/lib/authz";
import { env } from "@/lib/env";
import {
  addMessageReaction,
  createChannelMessage,
  deleteChannelMessage,
  listGuildTextChannels,
  type DiscordChannel,
} from "@/lib/discord";
import { CLASS_OPTIONS } from "@/lib/classes";
import { ATTENDANCE_EMOJI, CLASS_EMOJI } from "@/lib/class-emoji";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Text channels the admin can pick from when posting a reaction message — populates a <select>, no hard-coded channel. */
export async function listDiscordChannels(): Promise<{ ok: boolean; channels?: DiscordChannel[]; error?: string }> {
  await requireAdmin();
  try {
    const channels = await listGuildTextChannels(env.discordGuildId);
    return { ok: true, channels };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "ดึงรายชื่อ channel ไม่สำเร็จ" };
  }
}

export interface BotMessageStatus {
  channelId: string;
  messageId: string;
  createdAt: string;
  /** Direct "jump to message" link — built server-side since the guild ID is a server-only env var. */
  jumpUrl: string;
}

async function getCurrentMessage(kind: "CLASS_SELECT" | "ATTENDANCE", boardId: string | null) {
  return db.query.botReactionMessages.findFirst({
    where: and(
      eq(botReactionMessages.kind, kind),
      boardId ? eq(botReactionMessages.boardId, boardId) : isNull(botReactionMessages.boardId)
    ),
  });
}

function toStatus(row: { channelId: string; messageId: string; createdAt: Date } | undefined): BotMessageStatus | null {
  if (!row) return null;
  return {
    channelId: row.channelId,
    messageId: row.messageId,
    createdAt: row.createdAt.toISOString(),
    jumpUrl: `https://discord.com/channels/${env.discordGuildId}/${row.channelId}/${row.messageId}`,
  };
}

export async function getClassSelectStatus(): Promise<BotMessageStatus | null> {
  await requireAdmin();
  return toStatus(await getCurrentMessage("CLASS_SELECT", null));
}

export async function getAttendanceStatus(boardId: string): Promise<BotMessageStatus | null> {
  await requireAdmin();
  return toStatus(await getCurrentMessage("ATTENDANCE", boardId));
}

/**
 * Posts (or reposts, replacing the old one) the guild-wide "เลือกอาชีพ"
 * message: one line per class with its emoji, seeded with the bot's own
 * reactions so members just click theirs. The bot worker listens for
 * reactions on this message (`bot/reactions.ts`) and updates
 * `members.characterClass` directly — no admin review step, since it's the
 * member's own class self-report, same trust level as editing their own
 * profile.
 */
export async function postClassSelectMessage(channelId: string): Promise<ActionResult> {
  await requireAdmin();
  if (!channelId) return { ok: false, error: "กรุณาเลือก channel" };

  const previous = await getCurrentMessage("CLASS_SELECT", null);
  if (previous) {
    await deleteChannelMessage(previous.channelId, previous.messageId);
    await db.delete(botReactionMessages).where(eq(botReactionMessages.id, previous.id));
  }

  const lines = CLASS_OPTIONS.map((c) => `${CLASS_EMOJI[c]} — ${c}`).join("\n");
  const content = `**เลือกอาชีพของคุณ** — กดอิโมจิที่ตรงกับอาชีพในเกม (กดใหม่ได้ถ้าเปลี่ยนอาชีพ ระบบจะอัปเดตให้อัตโนมัติ)\n\n${lines}\n\n📝 **ถ้าเปลี่ยนชื่อในเกม** อย่าลืมเปลี่ยนชื่อเล่นใน Discord (nickname) ให้ตรงกับชื่อในเกมด้วยนะครับ — คลิกขวาที่ชื่อตัวเองในเซิร์ฟเวอร์นี้ > Edit Server Profile`;

  let messageId: string;
  try {
    messageId = await createChannelMessage(channelId, content);
  } catch (err) {
    return {
      ok: false,
      error: `โพสต์ข้อความไม่สำเร็จ — เช็คว่าบอทมีสิทธิ์ "Send Messages" ใน channel นี้หรือยัง (${err instanceof Error ? err.message : "unknown error"})`,
    };
  }

  // Track the message the moment it exists — even if seeding reactions
  // below partially fails, the message stays trackable so a repost cleanly
  // replaces it instead of leaving an orphaned, untracked message behind
  // in the channel (previously: a reaction failure aborted before this
  // insert ran, so the message could never be found/deleted again).
  await db.insert(botReactionMessages).values({ kind: "CLASS_SELECT", boardId: null, channelId, messageId });

  // Discord's reaction-add endpoint has a tight per-message rate limit —
  // seed reactions one at a time with a small gap between each rather than
  // firing them back-to-back, on top of discordBotFetch's own 429 retry.
  const failedEmojis: string[] = [];
  for (const c of CLASS_OPTIONS) {
    try {
      await addMessageReaction(channelId, messageId, CLASS_EMOJI[c]);
    } catch {
      failedEmojis.push(CLASS_EMOJI[c]);
    }
    await sleep(300);
  }

  revalidatePath("/members");
  if (failedEmojis.length > 0) {
    return {
      ok: true,
      error: `โพสต์ข้อความสำเร็จ แต่ใส่อิโมจิไม่ครบ (ขาด: ${failedEmojis.join(" ")}) — ลองกด "โพสต์ใหม่" อีกครั้งเพื่อแก้`,
    };
  }
  return { ok: true };
}

/**
 * Posts (or reposts) a board-scoped "ลา" (opt-out) message: everyone is
 * assumed attending by default, reacting marks them Busy/ลา on THIS board
 * only, removing the reaction returns them to the pool. Reposting replaces
 * the previous message so there's only ever one live message the bot
 * listens to per board.
 */
export async function postAttendanceMessage(boardId: string, channelId: string): Promise<ActionResult> {
  await requireAdmin();
  if (!channelId) return { ok: false, error: "กรุณาเลือก channel" };

  const board = await db.query.partyBoards.findFirst({ where: eq(partyBoards.id, boardId) });
  if (!board) return { ok: false, error: "ไม่พบกระดาน" };

  const previous = await getCurrentMessage("ATTENDANCE", boardId);
  if (previous) {
    await deleteChannelMessage(previous.channelId, previous.messageId);
    await db.delete(botReactionMessages).where(eq(botReactionMessages.id, previous.id));
  }

  const content = `📋 **${board.name}** — ถ้า**ลา/ไม่สะดวก**รอบนี้ กด ${ATTENDANCE_EMOJI} (ไม่กด = เข้าร่วมตามปกติ) เอาอิโมจิออกได้ถ้ากลับมาเข้าร่วม`;

  let messageId: string;
  try {
    messageId = await createChannelMessage(channelId, content);
  } catch (err) {
    return {
      ok: false,
      error: `โพสต์ข้อความไม่สำเร็จ — เช็คว่าบอทมีสิทธิ์ "Send Messages" ใน channel นี้หรือยัง (${err instanceof Error ? err.message : "unknown error"})`,
    };
  }

  // Track before seeding the reaction — same reasoning as postClassSelectMessage above.
  await db.insert(botReactionMessages).values({ kind: "ATTENDANCE", boardId, channelId, messageId });

  revalidatePath("/party");
  try {
    await addMessageReaction(channelId, messageId, ATTENDANCE_EMOJI);
  } catch {
    return {
      ok: true,
      error: `โพสต์ข้อความสำเร็จ แต่ใส่อิโมจิไม่สำเร็จ — ลองกด "โพสต์ใหม่" อีกครั้งเพื่อแก้`,
    };
  }
  return { ok: true };
}
