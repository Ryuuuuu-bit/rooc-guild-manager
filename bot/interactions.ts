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
  applyTodaysScheduledLeaves,
  cancelScheduledLeave,
  formatThaiDateLabel,
  listMemberActiveLeaves,
  listMemberScheduledLeaves,
  listUpcomingLeaveOptions,
  scheduleLeave,
} from "./leave-schedule";
import { cancelCurrentLeave } from "./reactions";

/** "YYYY-MM-DD" for now in Thailand's local time — local copy, same
 * cross-file-cycle reasoning as every other bot file's copy of this. */
function thaiDateString(d: Date = new Date()): string {
  const thai = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return thai.toISOString().slice(0, 10);
}

const LEAVE_ADD_SELECT_ID = "leave_add_select";
const LEAVE_CANCEL_SELECT_ID = "leave_cancel_select";
const LEAVE_RETURN_SELECT_ID = "leave_return_select";
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
 * scheduled a leave for (see listUpcomingLeaveOptions), a second dropdown to
 * cancel any not-yet-due requests, and a third to cancel any leave that's
 * ACTIVE right now (whether it came from a live reaction or an advance
 * request that already auto-applied — see listMemberActiveLeaves). Shared by
 * handleLeaveCommand (/leave), handleLeavePanelButton (the "ห้องลา" panel
 * button), and handleLeaveAddSelect/handleLeaveCancelSelect/
 * handleLeaveReturnSelect (to redraw a fresh picker in place after an
 * action) — every entry/re-entry point uses the same builder so the member
 * never has to type anything at any step.
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

  const [allOptions, mine, active] = await Promise.all([
    listUpcomingLeaveOptions(),
    listMemberScheduledLeaves(member.id),
    listMemberActiveLeaves(member.id),
  ]);
  const mineKeys = new Set(mine.map((m) => `${m.boardId}|${m.date}`));
  const addable = allOptions.filter((o) => !mineKeys.has(`${o.boardId}|${o.date}`)).slice(0, 25);

  const rows: ActionRowBuilder<StringSelectMenuBuilder>[] = [];
  const lines: string[] = ["**แจ้งลาล่วงหน้า**"];

  if (active.length > 0) {
    const returnSelect = new StringSelectMenuBuilder()
      .setCustomId(LEAVE_RETURN_SELECT_ID)
      .setPlaceholder("ยกเลิกลาที่มีผลอยู่ตอนนี้")
      .setMinValues(1)
      .setMaxValues(Math.min(active.length, 25))
      .addOptions(
        active.slice(0, 25).map((a) => new StringSelectMenuOptionBuilder().setLabel(a.boardName).setValue(a.boardId))
      );
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(returnSelect));
    lines.push(
      `คุณกำลังลาอยู่ตอนนี้ในกระดาน: ${active.map((a) => a.boardName).join(", ")} — เลือกด้านล่างเพื่อยกเลิกทันที ` +
        `(ถ้ากิจกรรมยังไม่จบ ยกเลิกได้ฟรี ไม่นับเป็นการลา)`
    );
  }

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
    lines.push("เลือกวันที่ด้านล่างเพื่อแจ้งลา — วันนี้มีผลทันที วันอื่นระบบจะลาให้อัตโนมัติเมื่อถึงวันนั้น");

    // "ลายาว" — one pick covers every event (GL and WOE alike) from today
    // through the chosen end date, so a two-week trip is one click instead
    // of six or seven. Options are the distinct upcoming dates; a date the
    // member already has scheduled is simply skipped when applied
    // (scheduleLeave's onConflictDoNothing), so it's safe to offer them all.
    const endDates = [...new Set(allOptions.map((o) => o.date))].sort().slice(0, 25);
    if (endDates.length > 1) {
      const rangeSelect = new StringSelectMenuBuilder()
        .setCustomId(LEAVE_RANGE_SELECT_ID)
        .setPlaceholder("ลายาว — เลือกวันสุดท้ายที่ลา (ลาทุกกิจกรรมจนถึงวันนั้น)")
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(
          endDates.map((d) => {
            const count = allOptions.filter((o) => o.date <= d).length;
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

  const picks = interaction.values.map((value) => {
    const [boardId, date, eventKey] = value.split("|");
    return { boardId, date, eventKey };
  });
  await scheduleLeavesAndReply(interaction, member.id, picks, "");
}

/**
 * Member picked an END date on the range-select ("ลายาว") — schedules every
 * upcoming event date (all boards) from today through that date, same
 * per-date mechanics as handleLeaveAddSelect above. Recomputed from
 * listUpcomingLeaveOptions at click time rather than trusting a list baked
 * into the menu, so the set is exactly what the picker would offer now.
 */
async function handleLeaveRangeSelect(interaction: StringSelectMenuInteraction) {
  const member = await db.query.members.findFirst({ where: eq(members.discordId, interaction.user.id) });
  if (!member) {
    await interaction.update({ content: "ไม่พบข้อมูลสมาชิกของคุณ", components: [] });
    return;
  }

  const endDate = interaction.values[0];
  const picks = (await listUpcomingLeaveOptions()).filter((o) => o.date <= endDate);
  await scheduleLeavesAndReply(interaction, member.id, picks, `ลายาวถึง ${formatThaiDateLabel(endDate)} — `);
}

/**
 * Shared tail of the add-select and range-select handlers: schedules each
 * pick, applies any that are for TODAY right away, then refreshes the same
 * message back into a live picker (not a dead-end confirmation) so
 * add/cancel/add-again all stay reachable by clicking, with no need to ever
 * type /leave again mid-flow.
 */
async function scheduleLeavesAndReply(
  interaction: StringSelectMenuInteraction,
  memberId: string,
  picks: { boardId: string; date: string; eventKey: string }[],
  prefix: string
) {
  const dates: string[] = [];
  for (const pick of picks) {
    await scheduleLeave(memberId, pick.boardId, pick.date, pick.eventKey);
    dates.push(pick.date);
  }

  // A leave picked for TODAY has to take effect right now, not at the next
  // midnight. Scheduling only ever inserts a scheduledLeaves row, and the
  // one thing that turns those rows into a real "ลา" (busy entry, party
  // slot cleared, ATTENDANCE_LEAVE log, member DM + admin notify) is
  // applyTodaysScheduledLeaves — which until this ran ONLY from the nightly
  // reset. So a member using /leave on the morning of an event stayed in
  // their party slot all day with nothing on the board to show it, and the
  // row was then applied a day late (as a bogus leave on the following
  // day). Running the apply pass here for same-day picks closes that gap;
  // it's idempotent and only touches rows dated today or earlier, so the
  // future dates just scheduled above are left alone for their own day.
  const today = thaiDateString();
  const todayDates = [...new Set(dates.filter((d) => d <= today))];
  if (todayDates.length > 0) {
    await applyTodaysScheduledLeaves();
  }

  const futureDates = [...new Set(dates.filter((d) => d > today))].sort();
  const lines: string[] = [];
  if (todayDates.length) {
    lines.push(`✅ ${prefix}แจ้งลาวันนี้แล้ว: ${todayDates.map(formatThaiDateLabel).join(", ")} (มีผลทันที — ย้ายออกจากปาร์ตี้ไปอยู่รายชื่อ ลา แล้ว)`);
  }
  if (futureDates.length) {
    const label = futureDates.length > 4 ? `${futureDates.length} วัน (${formatThaiDateLabel(futureDates[0])} – ${formatThaiDateLabel(futureDates[futureDates.length - 1])})` : futureDates.map(formatThaiDateLabel).join(", ");
    lines.push(`✅ ${todayDates.length ? "" : prefix}แจ้งลาล่วงหน้าแล้ว: ${label}`);
  }
  if (lines.length === 0) lines.push("ไม่มีวันใหม่ให้แจ้งลา (ทุกวันที่เลือกแจ้งไว้แล้ว)");
  const { content, rows } = await renderLeavePicker(interaction.user.id);
  await interaction.update({ content: `${lines.join("\n")}\n\n${content}`, components: rows });
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
 * Member picked one or more boards on the "ยกเลิกลาที่มีผลอยู่ตอนนี้"
 * select — cancels each via cancelCurrentLeave (shared with the live-reaction
 * un-react flow, see reactions.ts), then refreshes the same message back
 * into a live picker (see handleLeaveAddSelect). Reports the two outcomes
 * separately so the member knows whether it actually counted or not — the
 * event may have already ended for one board and not another.
 */
async function handleLeaveReturnSelect(interaction: StringSelectMenuInteraction) {
  const member = await db.query.members.findFirst({ where: eq(members.discordId, interaction.user.id) });
  if (!member) {
    await interaction.update({ content: "ไม่พบข้อมูลสมาชิกของคุณ", components: [] });
    return;
  }

  let discarded = 0;
  let returned = 0;
  for (const boardId of interaction.values) {
    const outcome = await cancelCurrentLeave(member.id, boardId, " ผ่าน /leave (ยกเลิกลาที่มีผลอยู่)");
    if (outcome === "discarded") discarded++;
    if (outcome === "returned") returned++;
  }

  const parts: string[] = [];
  if (discarded > 0) parts.push(`ยกเลิกแล้ว ${discarded} รายการ (ไม่นับเป็นการลา)`);
  if (returned > 0) parts.push(`กลับเข้าร่วมแล้ว ${returned} รายการ (กิจกรรมจบไปแล้ว จึงยังนับเป็นการลาในสถิติ)`);
  const summary = parts.length > 0 ? parts.join(" · ") : "ไม่มีรายการที่ยกเลิกได้แล้ว";

  const { content, rows } = await renderLeavePicker(interaction.user.id);
  await interaction.update({ content: `✅ ${summary}\n\n${content}`, components: rows });
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

/** Routes every interaction the bot receives — /party, /leave, the /leave picker's three select menus, the "ห้องลา" panel button, and the "เลือกอาชีพ" panel button + dropdown. Extend this switch as more slash commands are added. */
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

  if (interaction.isStringSelectMenu() && interaction.customId === LEAVE_RANGE_SELECT_ID) {
    try {
      await handleLeaveRangeSelect(interaction);
    } catch (err) {
      console.error("[bot] /leave range-select failed", err);
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

  if (interaction.isStringSelectMenu() && interaction.customId === LEAVE_RETURN_SELECT_ID) {
    try {
      await handleLeaveReturnSelect(interaction);
    } catch (err) {
      console.error("[bot] /leave return-select failed", err);
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
