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
import { listJobClasses } from "@/lib/job-classes";
import { ATTENDANCE_EMOJI } from "@/lib/class-emoji";

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

export async function getAttendanceStatus(boardId: string): Promise<BotMessageStatus | null> {
  await requireAdmin();
  return toStatus(await getCurrentMessage("ATTENDANCE", boardId));
}

export async function getLeavePanelStatus(): Promise<BotMessageStatus | null> {
  await requireAdmin();
  return toStatus(await getCurrentMessage("LEAVE_PANEL", null));
}

/** The emoji currently configured for this board's "ลา" message — falls back to the app-wide default if the board hasn't customized it. */
export async function getBoardEmoji(boardId: string): Promise<string> {
  await requireAdmin();
  const board = await db.query.partyBoards.findFirst({ where: eq(partyBoards.id, boardId) });
  return board?.emoji || ATTENDANCE_EMOJI;
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

  const previous = await getCurrentMessage("CLASS_SELECT", null);
  if (previous) {
    await deleteChannelMessage(previous.channelId, previous.messageId);
    await db.delete(botReactionMessages).where(eq(botReactionMessages.id, previous.id));
  }

  let messageId: string;
  try {
    messageId = await createChannelMessage(channelId, "", {
      embed: {
        title: "🎮 เลือกอาชีพของคุณ",
        description:
          "กดปุ่มด้านล่างเพื่อเลือกอาชีพในเกม (เปลี่ยนใหม่ได้ทุกเมื่อ ระบบจะอัปเดตให้อัตโนมัติ)\n\n" +
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

  await db.insert(botReactionMessages).values({ kind: "CLASS_SELECT", boardId: null, channelId, messageId });
  revalidatePath("/members");
  return { ok: true };
}

/**
 * Posts (or reposts) a board-scoped "ลา" (opt-out) message: everyone is
 * assumed attending by default, reacting marks them Busy/ลา on THIS board
 * only, removing the reaction returns them to the pool. Reposting replaces
 * the previous message so there's only ever one live message the bot
 * listens to per board.
 *
 * `emoji` is saved onto the board (partyBoards.emoji) as a side effect, so
 * every board can use a visually distinct reaction — e.g. 🙋 for a "GL"
 * board and 🏰 for a "WOE" board — which the bot's reaction handlers
 * (bot/reactions.ts, bot/midnight-reset.ts) then read per-board instead of
 * assuming one emoji for the whole app. Falls back to the app-wide default
 * (ATTENDANCE_EMOJI) if left blank.
 */
/** Expands well-known board-name abbreviations in the posted "ลา" message —
 * members kept mixing up which board a reaction was for (reported: GL vs
 * WOE misclicks), so spelling the full event name out next to the short
 * name removes the ambiguity. Falls back to the bare name for anything not
 * in this list (a future board with some other name), so this never blocks
 * posting — it's just a nicety for the two names it currently recognizes. */
const BOARD_NAME_EXPANSIONS: Record<string, string> = {
  GL: "Guild League",
  WOE: "War of Emperium",
};

function expandBoardName(name: string): string {
  const expansion = BOARD_NAME_EXPANSIONS[name.trim().toUpperCase()];
  return expansion ? `${name} (${expansion})` : name;
}

export async function postAttendanceMessage(boardId: string, channelId: string, emoji?: string): Promise<ActionResult> {
  await requireAdmin();
  if (!channelId) return { ok: false, error: "Please select a channel" };

  const board = await db.query.partyBoards.findFirst({ where: eq(partyBoards.id, boardId) });
  if (!board) return { ok: false, error: "Board not found" };

  const resolvedEmoji = emoji?.trim() || ATTENDANCE_EMOJI;
  await db.update(partyBoards).set({ emoji: resolvedEmoji, updatedAt: new Date() }).where(eq(partyBoards.id, boardId));

  const previous = await getCurrentMessage("ATTENDANCE", boardId);
  if (previous) {
    await deleteChannelMessage(previous.channelId, previous.messageId);
    await db.delete(botReactionMessages).where(eq(botReactionMessages.id, previous.id));
  }

  const content = `📋 **${expandBoardName(board.name)}** — ถ้า**ลา/ไม่สะดวก**รอบนี้ กด ${resolvedEmoji} (ไม่กด = เข้าร่วมตามปกติ) เอาอิโมจิออกได้ถ้ากลับมาเข้าร่วม`;

  let messageId: string;
  try {
    messageId = await createChannelMessage(channelId, content);
  } catch (err) {
    return {
      ok: false,
      error: `Failed to post message — check whether the bot has "Send Messages" permission in this channel (${err instanceof Error ? err.message : "unknown error"})`,
    };
  }

  // Track before seeding the reaction — same reasoning as postClassSelectMessage above.
  await db.insert(botReactionMessages).values({ kind: "ATTENDANCE", boardId, channelId, messageId });

  revalidatePath("/party");
  try {
    await addMessageReaction(channelId, messageId, resolvedEmoji);
  } catch {
    return {
      ok: true,
      error: `Message posted successfully, but the emoji reaction failed — check whether the emoji you entered is valid, then try clicking "Post Again" to fix it`,
    };
  }
  return { ok: true };
}

/**
 * Posts (or reposts) the guild-wide "ห้องลา" panel: a single pinned message
 * with a "🗓️ แจ้งลาล่วงหน้า" button, so members can open the /leave picker
 * (see handleLeavePanelButton in bot/interactions.ts, which shares its
 * picker-building logic with the /leave slash command itself) by clicking
 * in one fixed channel instead of typing a command every time — no reaction
 * seeding needed here, unlike CLASS_SELECT/ATTENDANCE, since a button isn't
 * a reaction. Unconditional delete-then-recreate on repost, same as
 * postAttendanceMessage (there's no per-member state on this message worth
 * preserving in place, unlike CLASS_SELECT's reactions).
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
