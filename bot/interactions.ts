import {
  ActionRowBuilder,
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextDisplayBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type Interaction,
  type StringSelectMenuInteraction,
} from "discord.js";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { members } from "../src/db/schema";
import { getPartyBoardDetail, listPartyBoards, type PartyBoardMemberRef } from "./party-data";
import {
  cancelScheduledLeave,
  formatThaiDateLabel,
  listMemberScheduledLeaves,
  listUpcomingLeaveOptions,
  scheduleLeave,
} from "./leave-schedule";

const LEAVE_ADD_SELECT_ID = "leave_add_select";
const LEAVE_CANCEL_SELECT_ID = "leave_cancel_select";

// Matches the web app's amber accent (see Tailwind's amber-500) so the
// Components V2 card reads as the same product, not a generic bot embed.
const PARTY_ACCENT_COLOR = 0xf59e0b;

// Compact by design — one line per PARTY, not one per member. The class
// emoji alone carries the job (no "— WizMeteo" suffix); with 5-6+ parties
// per group this is the difference between a card that fits on one screen
// and one that takes several screens of scrolling in Discord's mobile app
// (the original one-line-per-member layout did the latter — reported by a
// guild admin after trying it live).
function formatMemberInline(member: PartyBoardMemberRef): string {
  const emoji = member.classEmoji ?? "❔";
  return `${emoji} ${member.displayName}`;
}

function formatNameList(members: PartyBoardMemberRef[]): string {
  return members.map((m) => m.displayName).join(", ");
}

async function handlePartyAutocomplete(interaction: AutocompleteInteraction) {
  const focused = interaction.options.getFocused().trim().toLowerCase();
  const boards = await listPartyBoards();
  const choices = boards
    .filter((b) => b.name.toLowerCase().includes(focused))
    .slice(0, 25)
    .map((b) => ({ name: b.name, value: b.id }));
  await interaction.respond(choices);
}

async function handlePartyCommand(interaction: ChatInputCommandInteraction) {
  const boardId = interaction.options.getString("board", true);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const board = await getPartyBoardDetail(boardId);
  if (!board) {
    await interaction.editReply({
      content:
        "ไม่พบกระดานนี้ — อาจถูกลบหรือเปลี่ยนไปแล้ว ลองพิมพ์ /party ใหม่แล้วเลือกจากรายการที่ขึ้นมาอีกครั้ง",
    });
    return;
  }

  const container = new ContainerBuilder().setAccentColor(PARTY_ACCENT_COLOR);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## 📋 ${board.name}`));

  const hasAnyParty = board.groups.some((g) => g.parties.length > 0);
  if (!hasAnyParty) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent("_ยังไม่มีผังปาร์ตี้ในกระดานนี้_"));
  }

  for (const group of board.groups) {
    if (group.parties.length === 0) continue;
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${group.name}`));
    for (const party of group.parties) {
      const filled = party.slots.filter((s) => s.member).length;
      const inline = party.slots.map((s) => (s.member ? formatMemberInline(s.member) : "🔸 ว่าง")).join(" · ");
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`**${party.label}** (${filled}/${party.slots.length})\n${inline}`)
      );
    }
  }

  if (board.busy.length > 0) {
    container.addSeparatorComponents(new SeparatorBuilder());
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`**ลา / ไม่สะดวก (${board.busy.length})**\n${formatNameList(board.busy)}`)
    );
  }

  if (board.unassigned.length > 0) {
    container.addSeparatorComponents(new SeparatorBuilder());
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`**รอลงปาร์ตี้ (${board.unassigned.length})**\n${formatNameList(board.unassigned)}`)
    );
  }

  await interaction.editReply({
    components: [container],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
  });
}

/**
 * /leave — shows the requesting member an ephemeral picker: a multi-select
 * dropdown of upcoming event dates they haven't already scheduled a leave
 * for (see listUpcomingLeaveOptions), plus, if they have any pending
 * requests, a second dropdown to cancel them. Pure click — no typing.
 */
async function handleLeaveCommand(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const member = await db.query.members.findFirst({ where: eq(members.discordId, interaction.user.id) });
  if (!member || member.status !== "ACTIVE") {
    await interaction.editReply({
      content: "ไม่พบข้อมูลสมาชิกของคุณในระบบ — ลองใหม่อีกครั้งหลังบอทซิงค์ข้อมูล หรือติดต่อแอดมิน",
    });
    return;
  }
  if (member.benched) {
    await interaction.editReply({
      content: "บัญชีของคุณถูกตั้งเป็น Benched อยู่ — ไม่ได้อยู่ในผังปาร์ตี้ จึงไม่ต้องแจ้งลาล่วงหน้า",
    });
    return;
  }

  const [allOptions, mine] = await Promise.all([listUpcomingLeaveOptions(), listMemberScheduledLeaves(member.id)]);
  const mineKeys = new Set(mine.map((m) => `${m.boardId}|${m.date}`));
  const addable = allOptions.filter((o) => !mineKeys.has(`${o.boardId}|${o.date}`)).slice(0, 25);

  const rows: ActionRowBuilder<StringSelectMenuBuilder>[] = [];
  const lines: string[] = ["**แจ้งลาล่วงหน้า**"];

  if (addable.length > 0) {
    const addSelect = new StringSelectMenuBuilder()
      .setCustomId(LEAVE_ADD_SELECT_ID)
      .setPlaceholder("เลือกวันที่ต้องการลา (เลือกได้หลายวัน)")
      .setMinValues(1)
      .setMaxValues(addable.length)
      .addOptions(
        addable.map((o) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(`${formatThaiDateLabel(o.date)} — ${o.eventLabel}`)
            .setValue(`${o.boardId}|${o.date}|${o.eventKey}`)
        )
      );
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(addSelect));
    lines.push("เลือกวันที่ด้านล่างเพื่อแจ้งลา — ระบบจะลาให้อัตโนมัติเมื่อถึงวันนั้น");
  } else {
    lines.push("ไม่มีวันกิจกรรมที่ยังไม่ได้แจ้งลาในช่วงนี้");
  }

  if (mine.length > 0) {
    const cancelSelect = new StringSelectMenuBuilder()
      .setCustomId(LEAVE_CANCEL_SELECT_ID)
      .setPlaceholder("ยกเลิกวันที่แจ้งลาไว้แล้ว")
      .setMinValues(1)
      .setMaxValues(Math.min(mine.length, 25))
      .addOptions(
        mine
          .slice(0, 25)
          .map((m) => new StringSelectMenuOptionBuilder().setLabel(formatThaiDateLabel(m.date)).setValue(m.id))
      );
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(cancelSelect));
    lines.push(`คุณแจ้งลาไว้ล่วงหน้า ${mine.length} วัน — เลือกด้านล่างเพื่อยกเลิก`);
  }

  await interaction.editReply({ content: lines.join("\n"), components: rows });
}

/** Member picked one or more dates on the add-select — schedules each, then replaces the picker with a confirmation summary. */
async function handleLeaveAddSelect(interaction: StringSelectMenuInteraction) {
  const member = await db.query.members.findFirst({ where: eq(members.discordId, interaction.user.id) });
  if (!member) {
    await interaction.update({ content: "ไม่พบข้อมูลสมาชิกของคุณ", components: [] });
    return;
  }

  const dates: string[] = [];
  for (const value of interaction.values) {
    const [boardId, date, eventKey] = value.split("|");
    await scheduleLeave(member.id, boardId, date, eventKey);
    dates.push(date);
  }

  const labels = dates.map((d) => formatThaiDateLabel(d)).join(", ");
  await interaction.update({
    content: `✅ แจ้งลาล่วงหน้าแล้ว: ${labels}\nพิมพ์ /leave อีกครั้งเพื่อดูหรือยกเลิก`,
    components: [],
  });
}

/** Member picked one or more entries on the cancel-select — cancels each, then replaces the picker with a confirmation summary. */
async function handleLeaveCancelSelect(interaction: StringSelectMenuInteraction) {
  const member = await db.query.members.findFirst({ where: eq(members.discordId, interaction.user.id) });
  if (!member) {
    await interaction.update({ content: "ไม่พบข้อมูลสมาชิกของคุณ", components: [] });
    return;
  }

  for (const id of interaction.values) {
    await cancelScheduledLeave(member.id, id);
  }

  await interaction.update({
    content: `✅ ยกเลิกการแจ้งลาล่วงหน้าแล้ว ${interaction.values.length} รายการ`,
    components: [],
  });
}

/** Routes every interaction the bot receives — /party, /leave, and the /leave picker's two select menus. Extend this switch as more slash commands are added. */
export async function handleInteractionCreate(interaction: Interaction) {
  if (interaction.isAutocomplete() && interaction.commandName === "party") {
    try {
      await handlePartyAutocomplete(interaction);
    } catch (err) {
      console.error("[bot] /party autocomplete failed", err);
    }
    return;
  }

  if (interaction.isChatInputCommand() && interaction.commandName === "party") {
    try {
      await handlePartyCommand(interaction);
    } catch (err) {
      console.error("[bot] /party command failed", err);
      const content = "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง";
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content }).catch(() => {});
      } else {
        await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    }
    return;
  }

  if (interaction.isChatInputCommand() && interaction.commandName === "leave") {
    try {
      await handleLeaveCommand(interaction);
    } catch (err) {
      console.error("[bot] /leave command failed", err);
      const content = "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง";
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content }).catch(() => {});
      } else {
        await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    }
    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === LEAVE_ADD_SELECT_ID) {
    try {
      await handleLeaveAddSelect(interaction);
    } catch (err) {
      console.error("[bot] /leave add-select failed", err);
      await interaction.update({ content: "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง", components: [] }).catch(() => {});
    }
    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === LEAVE_CANCEL_SELECT_ID) {
    try {
      await handleLeaveCancelSelect(interaction);
    } catch (err) {
      console.error("[bot] /leave cancel-select failed", err);
      await interaction.update({ content: "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง", components: [] }).catch(() => {});
    }
  }
}
