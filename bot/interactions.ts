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
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Interaction,
  type StringSelectMenuInteraction,
} from "discord.js";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { members, membershipEvents } from "../src/db/schema";
import { getPartyBoardDetail, listPartyBoards, type PartyBoardMemberRef } from "./party-data";
import { listJobClasses } from "./job-classes";
import {
  cancelScheduledLeave,
  formatThaiDateLabel,
  listMemberScheduledLeaves,
  listUpcomingLeaveOptions,
  scheduleLeave,
} from "./leave-schedule";

const LEAVE_ADD_SELECT_ID = "leave_add_select";
const LEAVE_CANCEL_SELECT_ID = "leave_cancel_select";
// Custom ID of the button on the "ห้องลา" panel message (see
// postLeavePanelMessage in src/app/actions/bot-messages.ts, which posts it
// via plain REST from the web app — the string here just has to match).
const LEAVE_PANEL_BUTTON_ID = "leave_panel_open";
// Custom IDs for the "เลือกอาชีพ" panel's button + its dropdown (see
// postClassSelectMessage in src/app/actions/bot-messages.ts for the button).
const CLASS_SELECT_BUTTON_ID = "class_select_open";
const CLASS_SELECT_CHOOSE_ID = "class_select_choose";

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

/**
 * Sets a select-option's emoji defensively — discord.js's
 * StringSelectMenuOptionBuilder.setEmoji throws (ValidationError) on an
 * empty string or any malformed value (verified against the installed
 * discord.js build), and since every class option is built inside one
 * `.map()` for the whole dropdown (see handleClassSelectButton below), one
 * bad `job_classes.emoji` value — a legacy row, a bad admin edit that slipped
 * past validation, a direct DB edit — would otherwise throw while building
 * the array and break class selection for EVERY member, not just whoever
 * has that class. Falls back to the option with no emoji instead.
 */
function withSafeEmoji(option: StringSelectMenuOptionBuilder, emoji: string): StringSelectMenuOptionBuilder {
  if (!emoji) return option;
  try {
    return option.setEmoji(emoji);
  } catch {
    return option;
  }
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
 * Builds the ephemeral leave picker's content + components for one member:
 * a multi-select dropdown of upcoming event dates they haven't already
 * scheduled a leave for (see listUpcomingLeaveOptions), plus, if they have
 * any pending requests, a second dropdown to cancel them. Shared by
 * handleLeaveCommand (/leave), handleLeavePanelButton (the "ห้องลา" panel
 * button), and handleLeaveAddSelect/handleLeaveCancelSelect (to redraw a
 * fresh picker in place after an action) — every entry/re-entry point uses
 * the same builder so the member never has to type anything at any step.
 */
async function renderLeavePicker(discordUserId: string): Promise<{ content: string; rows: ActionRowBuilder<StringSelectMenuBuilder>[] }> {
  const member = await db.query.members.findFirst({ where: eq(members.discordId, discordUserId) });
  if (!member || member.status !== "ACTIVE") {
    return {
      content: "ไม่พบข้อมูลสมาชิกของคุณในระบบ — ลองใหม่อีกครั้งหลังบอทซิงค์ข้อมูล หรือติดต่อแอดมิน",
      rows: [],
    };
  }
  if (member.benched) {
    return {
      content: "บัญชีของคุณถูกตั้งเป็น Benched อยู่ — ไม่ได้อยู่ในผังปาร์ตี้ จึงไม่ต้องแจ้งลาล่วงหน้า",
      rows: [],
    };
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
        mine.slice(0, 25).map((m) =>
          new StringSelectMenuOptionBuilder()
            // Includes the event label, same as the add-select — a member
            // can have two boards' leave scheduled for the same calendar
            // date (scheduledLeaves is unique per board+member+date, not
            // per member+date alone), so a date-only label here could show
            // two visually identical options with no way to tell them apart.
            .setLabel(m.eventLabel ? `${formatThaiDateLabel(m.date)} — ${m.eventLabel}` : formatThaiDateLabel(m.date))
            .setValue(m.id)
        )
      );
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(cancelSelect));
    lines.push(`คุณแจ้งลาไว้ล่วงหน้า ${mine.length} วัน — เลือกด้านล่างเพื่อยกเลิก`);
  }

  return { content: lines.join("\n"), rows };
}

/** /leave — types the command, gets the ephemeral picker (see renderLeavePicker). */
async function handleLeaveCommand(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const { content, rows } = await renderLeavePicker(interaction.user.id);
  await interaction.editReply({ content, components: rows });
}

/**
 * Click on the "ห้องลา" panel's button (see postLeavePanelMessage) — same
 * picker as /leave, just reached without typing anything: the panel message
 * itself is public/pinned in one fixed channel, but this reply (and
 * everything the member does after it) is ephemeral, same as the command.
 */
async function handleLeavePanelButton(interaction: ButtonInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const { content, rows } = await renderLeavePicker(interaction.user.id);
  await interaction.editReply({ content, components: rows });
}

/**
 * Member picked one or more dates on the add-select — schedules each, then
 * refreshes the SAME message back into a live picker (not a dead-end
 * confirmation) so add/cancel/add-again all stay reachable by clicking,
 * with no need to ever type /leave again mid-flow.
 */
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
  const { content, rows } = await renderLeavePicker(interaction.user.id);
  await interaction.update({ content: `✅ แจ้งลาล่วงหน้าแล้ว: ${labels}\n\n${content}`, components: rows });
}

/** Member picked one or more entries on the cancel-select — cancels each, then refreshes the same message back into a live picker (see handleLeaveAddSelect). */
async function handleLeaveCancelSelect(interaction: StringSelectMenuInteraction) {
  const member = await db.query.members.findFirst({ where: eq(members.discordId, interaction.user.id) });
  if (!member) {
    await interaction.update({ content: "ไม่พบข้อมูลสมาชิกของคุณ", components: [] });
    return;
  }

  let cancelled = 0;
  for (const id of interaction.values) {
    if (await cancelScheduledLeave(member.id, id)) cancelled++;
  }

  const { content, rows } = await renderLeavePicker(interaction.user.id);
  await interaction.update({ content: `✅ ยกเลิกการแจ้งลาล่วงหน้าแล้ว ${cancelled} รายการ\n\n${content}`, components: rows });
}

/**
 * Click on the "เลือกอาชีพ" panel's button (see postClassSelectMessage) —
 * shows an ephemeral single-select dropdown of the admin-managed job class
 * list, each option's own emoji shown next to it, with the member's current
 * class pre-selected so the dropdown opens already showing where they are.
 * No typing, no emoji-reacting — replaces the old click-an-emoji flow.
 */
async function handleClassSelectButton(interaction: ButtonInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const member = await db.query.members.findFirst({ where: eq(members.discordId, interaction.user.id) });
  if (!member || member.status !== "ACTIVE") {
    await interaction.editReply({
      content: "ไม่พบข้อมูลสมาชิกของคุณในระบบ — ลองใหม่อีกครั้งหลังบอทซิงค์ข้อมูล หรือติดต่อแอดมิน",
    });
    return;
  }

  const classes = await listJobClasses();
  if (classes.length === 0) {
    await interaction.editReply({ content: "ยังไม่มีรายการอาชีพให้เลือก — ติดต่อแอดมิน" });
    return;
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(CLASS_SELECT_CHOOSE_ID)
    .setPlaceholder("เลือกอาชีพของคุณ")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      classes.slice(0, 25).map((c) =>
        withSafeEmoji(
          new StringSelectMenuOptionBuilder()
            .setLabel(c.name)
            .setValue(c.name)
            .setDefault(c.name === member.characterClass),
          c.emoji
        )
      )
    );

  await interaction.editReply({
    content: "**เลือกอาชีพของคุณ**",
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
  });
}

/** Member picked their class on the dropdown — updates members.characterClass, logs it, and confirms. */
async function handleClassSelectChoose(interaction: StringSelectMenuInteraction) {
  const member = await db.query.members.findFirst({ where: eq(members.discordId, interaction.user.id) });
  // Same ACTIVE check handleClassSelectButton makes before ever opening this
  // dropdown — re-checked here too, since Discord keeps an ephemeral menu
  // clickable for several minutes and an admin could deactivate the member
  // in between (e.g. mark them KICKED/benched) while it's still open.
  if (!member || member.status !== "ACTIVE") {
    await interaction.update({ content: "ไม่พบข้อมูลสมาชิกของคุณ หรือบัญชีนี้ไม่ได้ใช้งานอยู่แล้ว", components: [] });
    return;
  }

  const className = interaction.values[0];
  await db.update(members).set({ characterClass: className, updatedAt: new Date() }).where(eq(members.id, member.id));
  await db.insert(membershipEvents).values({
    memberId: member.id,
    type: "CLASS_CHANGE",
    detail: `เปลี่ยนอาชีพเป็น ${className} ผ่านเมนูเลือกอาชีพ`,
    actor: "bot:interactions",
  });

  await interaction.update({ content: `✅ เลือกอาชีพ: ${className}`, components: [] });
}

/** Routes every interaction the bot receives — /party, /leave, the /leave picker's two select menus, the "ห้องลา" panel button, and the "เลือกอาชีพ" panel button + dropdown. Extend this switch as more slash commands are added. */
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
    return;
  }

  if (interaction.isButton() && interaction.customId === LEAVE_PANEL_BUTTON_ID) {
    try {
      await handleLeavePanelButton(interaction);
    } catch (err) {
      console.error("[bot] leave-panel button failed", err);
      const content = "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง";
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content }).catch(() => {});
      } else {
        await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    }
    return;
  }

  if (interaction.isButton() && interaction.customId === CLASS_SELECT_BUTTON_ID) {
    try {
      await handleClassSelectButton(interaction);
    } catch (err) {
      console.error("[bot] class-select button failed", err);
      const content = "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง";
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content }).catch(() => {});
      } else {
        await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    }
    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === CLASS_SELECT_CHOOSE_ID) {
    try {
      await handleClassSelectChoose(interaction);
    } catch (err) {
      console.error("[bot] class-select choose failed", err);
      await interaction.update({ content: "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง", components: [] }).catch(() => {});
    }
  }
}
