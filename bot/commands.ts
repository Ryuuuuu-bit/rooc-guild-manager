import { SlashCommandBuilder } from "discord.js";

/**
 * /party [board] — ephemeral snapshot of one board's current party layout,
 * so a member can check who's grouped with who without opening the web app.
 * The "board" option uses autocomplete (see handlePartyAutocomplete in
 * interactions.ts) instead of static choices, since boards are admin-managed
 * and can be renamed/added at any time — a fixed choice list would drift out
 * of sync with the app.
 */
const partyCommand = new SlashCommandBuilder()
  .setName("party")
  .setDescription("ดูผังปาร์ตี้ปัจจุบันของกระดานที่เลือก (เห็นเฉพาะคุณ)")
  .addStringOption((option) =>
    option
      .setName("board")
      .setDescription("กระดานที่ต้องการดู เช่น GL, WOE")
      .setAutocomplete(true)
      .setRequired(true)
  );

/**
 * /leave — pick one or more upcoming event dates to schedule an advance
 * leave for, click-only (a select menu shown in the reply, see
 * handleLeaveCommand in interactions.ts), instead of waiting until the day
 * to react "ลา" live on a party board. No options on the command itself —
 * the dropdown of available dates is built dynamically per member.
 */
const leaveCommand = new SlashCommandBuilder()
  .setName("leave")
  .setDescription("แจ้งลาล่วงหน้าสำหรับวันกิจกรรมที่จะถึง (เลือกได้หลายวัน)");

/** Registered as guild commands on startup (see bot/index.ts) — instant availability, no global-command propagation delay. */
export const commands = [partyCommand.toJSON(), leaveCommand.toJSON()];
