import {
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type Interaction,
} from "discord.js";
import { getPartyBoardDetail, listPartyBoards, type PartyBoardMemberRef } from "./party-data";

// Matches the web app's amber accent (see Tailwind's amber-500) so the
// Components V2 card reads as the same product, not a generic bot embed.
const PARTY_ACCENT_COLOR = 0xf59e0b;

function formatMemberLine(member: PartyBoardMemberRef): string {
  const emoji = member.classEmoji ?? "❔";
  const className = member.className ?? "ไม่ระบุอาชีพ";
  return `${emoji} **${member.displayName}** — ${className}`;
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
      const lines = party.slots.map((s) => (s.member ? formatMemberLine(s.member) : "🔸 _ว่าง_"));
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`**${party.label}** (${filled}/${party.slots.length})\n${lines.join("\n")}`)
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

/** Routes every interaction the bot receives — currently just /party (command + its board autocomplete). Extend this switch as more slash commands are added. */
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
  }
}
