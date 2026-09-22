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
  cancelLeave,
  formatThaiDateLabel,
  listMemberOpenLeaves,
  listUpcomingLeaveOptions,
  requestLeave,
} from "../src/lib/leaves";
import { dmMemberLeaveFiled, notifyAdminsOfLeaves, type LeaveNotice } from "./leaves";

const LEAVE_ADD_SELECT_ID = "leave_add_select";
const LEAVE_CANCEL_SELECT_ID = "leave_cancel_select";
// "ลายาว": pick one END date and every event date from today through it
// gets scheduled in one go (see handleLeaveRangeSelect).
const LEAVE_RANGE_SELECT_ID = "leave_range_select";
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
      const filled = party.slots.filter((s) => s.member && !s.onLeave).length;
      const inline = party.slots
        .map((s) => (s.member ? (s.onLeave ? `~~${formatMemberInline(s.member)}~~` : formatMemberInline(s.member)) : "🔸 ว่าง"))
        .join(" · ");
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`**${party.label}** (${filled}/${party.slots.length})\n${inline}`)
      );
    }
  }

  if (board.busy.length > 0) {
    container.addSeparatorComponents(new SeparatorBuilder());
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`**ลา ${formatThaiDateLabel(board.occurrenceDate)} (${board.busy.length})**\n${formatNameList(board.busy)}`)
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
 * a multi-select of upcoming event dates they don't already have a leave
 * for, a "ลายาว" end-date select, and a multi-select to cancel any leave
 * whose round hasn't ended yet (today's included — cancelling before the
 * window closes means it never counts). Shared by every entry/re-entry
 * point so the member never has to type anything at any step.
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

  const [allOptions, mine] = await Promise.all([listUpcomingLeaveOptions(), listMemberOpenLeaves(member.id)]);
  const mineKeys = new Set(mine.map((m) => `${m.boardId}|${m.occurrenceDate}`));
  const addable = allOptions.filter((o) => !mineKeys.has(`${o.boardId}|${o.date}`)).slice(0, 25);

  const rows: ActionRowBuilder<StringSelectMenuBuilder>[] = [];
  const lines: string[] = ["**แจ้งลา / ลาล่วงหน้า**"];

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
            .setValue(`${o.boardId}|${o.date}`)
        )
      );
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(addSelect));
    lines.push("เลือกวันที่ด้านล่างเพื่อแจ้งลา — มีผลทันทีทั้งในเมนูจัดปาร์ตี้ เช็คออนไลน์ และปฏิทิน");

    // "ลายาว" — one pick covers every event (GL and WOE alike) from today
    // through the chosen end date, so a two-week trip is one click.
    const endDates = [...new Set(addable.map((o) => o.date))].sort().slice(0, 25);
    if (endDates.length > 1) {
      const rangeSelect = new StringSelectMenuBuilder()
        .setCustomId(LEAVE_RANGE_SELECT_ID)
        .setPlaceholder("ลายาว — เลือกวันสุดท้ายที่ลา (ลาทุกกิจกรรมจนถึงวันนั้น)")
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(
          endDates.map((d) => {
            const count = addable.filter((o) => o.date <= d).length;
            return new StringSelectMenuOptionBuilder()
              .setLabel(`ลาทุกกิจกรรมถึง ${formatThaiDateLabel(d)} (${count} ครั้ง)`)
              .setValue(d);
          })
        );
      rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(rangeSelect));
    }
  } else {
    lines.push("ไม่มีวันกิจกรรมที่ยังไม่ได้แจ้งลาในช่วงนี้");
  }

  if (mine.length > 0) {
    const cancelSelect = new StringSelectMenuBuilder()
      .setCustomId(LEAVE_CANCEL_SELECT_ID)
      .setPlaceholder("ยกเลิกวันที่แจ้งลาไว้")
      .setMinValues(1)
      .setMaxValues(Math.min(mine.length, 25))
      .addOptions(
        mine.slice(0, 25).map((m) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(`${formatThaiDateLabel(m.occurrenceDate)} — ${m.board.name}`)
            .setValue(`${m.boardId}|${m.occurrenceDate}`)
        )
      );
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(cancelSelect));
    lines.push(`คุณแจ้งลาไว้ ${mine.length} รายการ — เลือกด้านล่างเพื่อยกเลิก (ยกเลิกก่อนกิจกรรมจบ ไม่นับเป็นการลา)`);
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

/** Member picked one or more dates on the add-select — files each, then redraws the picker in place. */
async function handleLeaveAddSelect(interaction: StringSelectMenuInteraction) {
  const member = await requireEligibleLeaveMember(interaction);
  if (!member) return;

  const valid = new Set((await listUpcomingLeaveOptions()).map((o) => `${o.boardId}|${o.date}`));
  const picks = interaction.values
    .filter((v) => valid.has(v))
    .map((value) => {
      const [boardId, date] = value.split("|");
      return { boardId, date };
    });
  await fileLeavesAndReply(interaction, member.id, picks, "");
}

/**
 * Member picked an END date on the range-select ("ลายาว") — files every
 * upcoming event date (all boards) from today through that date. Recomputed
 * from listUpcomingLeaveOptions at click time rather than trusting a list
 * baked into the menu, so the set is exactly what the picker would offer now.
 */
async function handleLeaveRangeSelect(interaction: StringSelectMenuInteraction) {
  const member = await requireEligibleLeaveMember(interaction);
  if (!member) return;

  const endDate = interaction.values[0];
  const picks = (await listUpcomingLeaveOptions()).filter((o) => o.date <= endDate);
  await fileLeavesAndReply(interaction, member.id, picks, `ลายาวถึง ${formatThaiDateLabel(endDate)} — `);
}

/**
 * The selects' shared gate — same ACTIVE + not-benched check
 * renderLeavePicker makes before ever showing these menus, re-checked at
 * click time because Discord keeps an ephemeral menu clickable for minutes
 * and an admin can bench/deactivate the member in between. Also DEFERS the
 * interaction right away: N writes + DMs + a full picker re-render can take
 * over Discord's 3-second reply deadline. Returns null (already replied)
 * when the member isn't eligible.
 */
async function requireEligibleLeaveMember(interaction: StringSelectMenuInteraction) {
  await interaction.deferUpdate();
  const member = await db.query.members.findFirst({ where: eq(members.discordId, interaction.user.id) });
  if (!member || member.status !== "ACTIVE") {
    await interaction.editReply({ content: "ไม่พบข้อมูลสมาชิกของคุณ หรือบัญชีนี้ไม่ได้ใช้งานอยู่แล้ว", components: [] });
    return null;
  }
  if (member.benched) {
    await interaction.editReply({ content: "บัญชีของคุณถูกตั้งเป็น Benched อยู่ — ไม่ได้อยู่ในผังปาร์ตี้ จึงไม่ต้องแจ้งลา", components: [] });
    return null;
  }
  return member;
}

/**
 * Shared tail of the add-select and range-select handlers: files each pick
 * (requestLeave is idempotent, so only NEW ones are reported), DMs the
 * member once and posts one admin notice, then refreshes the same message
 * back into a live picker. Expects the interaction to already be deferred.
 */
async function fileLeavesAndReply(
  interaction: StringSelectMenuInteraction,
  memberId: string,
  picks: { boardId: string; date: string }[],
  prefix: string
) {
  const filed: LeaveNotice[] = [];
  for (const pick of picks) {
    const { outcome } = await requestLeave({
      memberId,
      boardId: pick.boardId,
      occurrenceDate: pick.date,
      source: "MEMBER",
      actor: interaction.user.id,
      detailSuffix: "ผ่านห้องลา",
    });
    if (outcome !== "unchanged") filed.push({ memberId, boardId: pick.boardId, date: pick.date });
  }

  // Both are side notifications — fire-and-forget so a slow DM never
  // delays the picker redraw past Discord's deadline.
  if (filed.length > 0) {
    void dmMemberLeaveFiled(memberId, filed);
    void notifyAdminsOfLeaves(filed);
  }

  const dates = [...new Set(filed.map((f) => f.date))].sort();
  const label =
    dates.length > 4
      ? `${dates.length} วัน (${formatThaiDateLabel(dates[0])} – ${formatThaiDateLabel(dates[dates.length - 1])})`
      : dates.map(formatThaiDateLabel).join(", ");
  const summary = dates.length ? `✅ ${prefix}แจ้งลาแล้ว: ${label}` : "ไม่มีวันใหม่ให้แจ้งลา (ทุกวันที่เลือกแจ้งไว้แล้ว)";
  const { content, rows } = await renderLeavePicker(interaction.user.id);
  await interaction.editReply({ content: `${summary}\n\n${content}`, components: rows });
}

/** Member picked one or more entries on the cancel-select — cancels each, then redraws the picker in place. */
async function handleLeaveCancelSelect(interaction: StringSelectMenuInteraction) {
  await interaction.deferUpdate();
  const member = await db.query.members.findFirst({ where: eq(members.discordId, interaction.user.id) });
  if (!member) {
    await interaction.editReply({ content: "ไม่พบข้อมูลสมาชิกของคุณ", components: [] });
    return;
  }

  // Only rounds that haven't ended can be cancelled — a stale menu can't
  // un-count a leave whose event already finished.
  const open = new Set((await listMemberOpenLeaves(member.id)).map((l) => `${l.boardId}|${l.occurrenceDate}`));
  let cancelled = 0;
  let tooLate = 0;
  for (const value of interaction.values) {
    if (!open.has(value)) {
      tooLate++;
      continue;
    }
    const [boardId, occurrenceDate] = value.split("|");
    if (await cancelLeave({ memberId: member.id, boardId, occurrenceDate, actor: interaction.user.id, detailSuffix: "ผ่านห้องลา" })) cancelled++;
  }

  const parts = [`✅ ยกเลิกการลาแล้ว ${cancelled} รายการ`];
  if (tooLate > 0) parts.push(`${tooLate} รายการยกเลิกไม่ได้แล้ว (กิจกรรมจบไปแล้ว จึงนับเป็นการลา)`);
  const { content, rows } = await renderLeavePicker(interaction.user.id);
  await interaction.editReply({ content: `${parts.join(" · ")}\n\n${content}`, components: rows });
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
  if (member.characterClass === className) {
    // Same class re-picked (a double-click, or reassurance) — nothing to
    // change, and logging a second identical CLASS_CHANGE just put
    // duplicate "Class changed" rows in the activity feed (seen live).
    await interaction.update({ content: `✅ อาชีพของคุณคือ ${className} อยู่แล้ว`, components: [] });
    return;
  }
  // Both writes commit together — same transaction-safety reasoning as the
  // legacy CLASS_SELECT reaction path in reactions.ts: two separate
  // statements here meant a crash between them (a routine Railway redeploy)
  // could change the member's class with no CLASS_CHANGE audit row for it.
  await db.transaction(async (tx) => {
    await tx.update(members).set({ characterClass: className, updatedAt: new Date() }).where(eq(members.id, member.id));
    await tx.insert(membershipEvents).values({
      memberId: member.id,
      type: "CLASS_CHANGE",
      detail: `เปลี่ยนอาชีพเป็น ${className} ผ่านเมนูเลือกอาชีพ`,
      actor: "bot:interactions",
    });
  });

  await interaction.update({ content: `✅ เลือกอาชีพ: ${className}`, components: [] });
}

/** Routes every interaction the bot receives — /party, /leave, the /leave picker's select menus, the "ห้องลา" panel button, and the "เลือกอาชีพ" panel button + dropdown. Extend this switch as more slash commands are added. */
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
      const content = "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง";
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content, components: [] }).catch(() => {});
      } else {
        await interaction.update({ content, components: [] }).catch(() => {});
      }
    }
    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === LEAVE_RANGE_SELECT_ID) {
    try {
      await handleLeaveRangeSelect(interaction);
    } catch (err) {
      console.error("[bot] /leave range-select failed", err);
      const content = "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง";
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content, components: [] }).catch(() => {});
      } else {
        await interaction.update({ content, components: [] }).catch(() => {});
      }
    }
    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === LEAVE_CANCEL_SELECT_ID) {
    try {
      await handleLeaveCancelSelect(interaction);
    } catch (err) {
      console.error("[bot] /leave cancel-select failed", err);
      const content = "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง";
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content, components: [] }).catch(() => {});
      } else {
        await interaction.update({ content, components: [] }).catch(() => {});
      }
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
