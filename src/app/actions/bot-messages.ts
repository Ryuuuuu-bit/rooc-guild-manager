"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { botReactionMessages } from "@/db/schema";
import { requireAdmin } from "@/lib/authz";
import { env } from "@/lib/env";
import {
  createChannelMessage,
  deleteChannelMessage,
  listGuildTextChannels,
  type DiscordChannel,
} from "@/lib/discord";
import { listJobClasses } from "@/lib/job-classes";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/** Text channels the admin can pick from when posting a reaction message — populates a <select>, no hard-coded channel. */
export async function listDiscordChannels(): Promise<{ ok: boolean; channels?: DiscordChannel[]; error?: string }> {
  await requireAdmin();
  try {
    const channels = await listGuildTextChannels(env.discordGuildId);
    return { ok: true, channels };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to fetch channel list." };
  }
}

export interface BotMessageStatus {
  channelId: string;
  messageId: string;
  createdAt: string;
  /** Direct "jump to message" link — built server-side since the guild ID is a server-only env var. */
  jumpUrl: string;
}

async function getCurrentMessage(kind: "CLASS_SELECT" | "ATTENDANCE" | "LEAVE_PANEL", boardId: string | null) {
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

export async function getLeavePanelStatus(): Promise<BotMessageStatus | null> {
  await requireAdmin();
  return toStatus(await getCurrentMessage("LEAVE_PANEL", null));
}

/**
 * Posts (or reposts, replacing the old one) the guild-wide "เลือกอาชีพ"
 * panel: a single pinned message with a "เลือกอาชีพ" button — members click
 * it, then pick their class from an ephemeral dropdown (see
 * handleClassSelectButton/handleClassSelectChoose in bot/interactions.ts),
 * no emoji-reacting required. Unconditional delete-then-recreate on repost,
 * same as postAttendanceMessage/postLeavePanelMessage — there's no
 * per-member reaction state to preserve in place anymore now that this
 * isn't reaction-driven.
 */
export async function postClassSelectMessage(channelId: string): Promise<ActionResult> {
  await requireAdmin();
  if (!channelId) return { ok: false, error: "Please select a channel" };

  const jobClassesList = await listJobClasses();
  if (jobClassesList.length === 0) {
    return { ok: false, error: "No job classes configured yet — add some in /classes first" };
  }

  // Post the new panel FIRST, then retire the old one — a failed post used
  // to leave the guild with no class-select panel at all.
  const previous = await getCurrentMessage("CLASS_SELECT", null);

  let messageId: string;
  try {
    messageId = await createChannelMessage(channelId, "", {
      embed: {
        title: "🎮 เลือกอาชีพของคุณ",
        description:
          "กดปุ่มด้านล่างเพื่อเลือก **อาชีพหลัก** ในเกม และ **อาชีพรอง** ที่เล่นแทนได้ (ไม่บังคับ ไม่เกิน 2) — เปลี่ยนใหม่ได้ทุกเมื่อ ระบบจะอัปเดตให้อัตโนมัติ คนจัดปาร์ตี้จะเห็นว่าใครเล่นอะไรได้บ้าง\n\n" +
          "📝 **ถ้าเปลี่ยนชื่อในเกม** อย่าลืมเปลี่ยนชื่อเล่นใน Discord (nickname) ให้ตรงกับชื่อในเกมด้วย — คลิกขวาที่ชื่อตัวเองใน Discord server นี้ > Edit Server Profile",
      },
      buttons: [{ customId: "class_select_open", label: "เลือกอาชีพ", emoji: "🎮" }],
    });
  } catch (err) {
    return {
      ok: false,
      error: `Failed to post message — check whether the bot has "Send Messages" permission in this channel (${err instanceof Error ? err.message : "unknown error"})`,
    };
  }

  if (previous) {
    await deleteChannelMessage(previous.channelId, previous.messageId).catch(() => {});
    await db.delete(botReactionMessages).where(eq(botReactionMessages.id, previous.id));
  }
  await db.insert(botReactionMessages).values({ kind: "CLASS_SELECT", boardId: null, channelId, messageId });
  revalidatePath("/members");
  return { ok: true };
}

/**
 * Posts (or reposts) the guild-wide "ห้องลา" panel: a single pinned message
 * with a "🗓️ แจ้งลาล่วงหน้า" button, so members can open the /leave picker
 * (see handleLeavePanelButton in bot/interactions.ts, which shares its
 * picker-building logic with the /leave slash command itself) by clicking
 * in one fixed channel instead of typing a command every time — no reaction
 * seeding needed here, unlike CLASS_SELECT, since a button isn't a
 * reaction. Unconditional delete-then-recreate on repost (there's no
 * per-member state on this message worth preserving in place, unlike
 * CLASS_SELECT's reactions).
 */
export async function postLeavePanelMessage(channelId: string): Promise<ActionResult> {
  await requireAdmin();
  if (!channelId) return { ok: false, error: "Please select a channel" };

  const previous = await getCurrentMessage("LEAVE_PANEL", null);
  if (previous) {
    await deleteChannelMessage(previous.channelId, previous.messageId);
    await db.delete(botReactionMessages).where(eq(botReactionMessages.id, previous.id));
  }

  let messageId: string;
  try {
    messageId = await createChannelMessage(channelId, "", {
      embed: {
        title: "🗓️ แจ้งลาล่วงหน้า",
        description:
          "กดปุ่มด้านล่างเพื่อเลือกวันกิจกรรมที่จะถึงที่คุณจะลา (เลือกได้หลายวันในครั้งเดียว)\n\n" +
          "ระบบจะลาให้อัตโนมัติเมื่อถึงวันนั้น ไม่ต้องพิมพ์คำสั่งเอง",
      },
      buttons: [{ customId: "leave_panel_open", label: "แจ้งลาล่วงหน้า", emoji: "🗓️" }],
    });
  } catch (err) {
    return {
      ok: false,
      error: `Failed to post message — check whether the bot has "Send Messages" permission in this channel (${err instanceof Error ? err.message : "unknown error"})`,
    };
  }

  await db.insert(botReactionMessages).values({ kind: "LEAVE_PANEL", boardId: null, channelId, messageId });
  revalidatePath("/party");
  return { ok: true };
}
