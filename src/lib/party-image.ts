import path from "node:path";
import { GlobalFonts, createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import { openSync as openFontSync } from "fontkit";
import type { PartyBoardDetail, PartyView } from "@/lib/party-data";

// The subsetted @fontsource/* Thai webfonts only cover the Thai unicode
// block (fine for a <link>, useless here) — member names and job classes
// mix Thai and Latin/symbols freely, so this bundles Google's full,
// non-subsetted Noto Sans Thai (variable font, Thai + Latin + more in one
// file) straight from the Noto/Google Fonts source repo. SIL OFL licensed,
// safe to vendor. Registered once per process under a private family name
// so it can never collide with (or accidentally fall back to) a same-named
// system font in some other container.
let fontRegistered = false;
function ensureFont() {
  if (fontRegistered) return;
  const fontPath = path.join(process.cwd(), "src/assets/fonts/NotoSansThai.ttf");
  GlobalFonts.registerFromPath(fontPath, "RoocPartyBoardFont");
  fontRegistered = true;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let glyphFont: any = null;
function ensureGlyphFont() {
  if (glyphFont) return glyphFont;
  const fontPath = path.join(process.cwd(), "src/assets/fonts/NotoSansThai.ttf");
  glyphFont = openFontSync(fontPath);
  return glyphFont;
}

const INVISIBLE_CHARS = /[\p{Cf}\p{Cc}]/gu;

/**
 * Discord nicknames lean hard on decorative Unicode tricks the canvas
 * font was never going to have every glyph for: "fancy text generator"
 * alphabets (mathematical bold/script/fraktur, fullwidth — 𝓢𝓮𝓷𝓞, ＺｅｎＯ)
 * and stray dingbats/stars/emoji copy-pasted around the name. The live
 * web page renders these fine because the browser has a huge system font
 * fallback stack behind it; this renderer only has the one bundled font,
 * so anything outside its coverage used to fall back to a tofu box.
 *
 * NFKD unwinds the "fancy alphabet" trick back to plain Latin (𝓢𝓮𝓷𝓞 -> SenO)
 * — it's a no-op on ordinary Thai text, which has no precomposed forms to
 * decompose. Zero-width/format/control characters are stripped outright.
 * Everything else is checked one codepoint at a time against the actual
 * font file (never guessed from a Unicode block) and only kept if the
 * font can really draw it — deliberately NOT a blanket strip of combining
 * marks, since Thai tone marks and vowel signs are combining marks too
 * and the font renders those correctly; only marks/symbols the font has
 * no glyph for (real decorative junk) get dropped instead of tofu.
 */
function sanitizeForCanvas(text: string): string {
  const font = ensureGlyphFont();
  const decomposed = text.normalize("NFKD").replace(INVISIBLE_CHARS, "");

  let out = "";
  for (const ch of decomposed) {
    if (ch === " ") {
      out += ch;
      continue;
    }
    const codePoint = ch.codePointAt(0);
    if (codePoint !== undefined && font.hasGlyphForCodePoint(codePoint)) {
      out += ch;
    }
  }

  const cleaned = out.replace(/\s{2,}/g, " ").trim();
  return cleaned || "(ชื่อพิเศษ)";
}

// Same dark zinc/amber palette as the live app's own UI, so the posted
// image reads as "part of the same product" rather than a generic chart.
const BG = "#09090b";
const PANEL = "#18181b";
const BORDER = "#27272a";
const TEXT = "#f4f4f5";
const MUTED = "#71717a";
const ACCENT = "#f59e0b";
const EMPTY = "#3f3f46";

const CANVAS_WIDTH = 1600;
const PADDING = 48;
const CARD_W = 300;
const CARD_GAP = 20;
const ROW_H = 30;
const CARD_HEADER_H = 40;
const CARD_PADDING = 14;
const GROUP_HEADER_H = 46;
const GROUP_GAP = 34;
const HEADER_H = 130;
const FOOTER_H = 46;
const SLOTS_PER_PARTY = 5;

function cardHeight(): number {
  return CARD_HEADER_H + SLOTS_PER_PARTY * ROW_H + CARD_PADDING * 2;
}

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function truncateToWidth(ctx: SKRSContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) {
    t = t.slice(0, -1);
  }
  return `${t}…`;
}

function drawPartyCard(ctx: SKRSContext2D, x: number, y: number, party: PartyView) {
  const h = cardHeight();
  roundRect(ctx, x, y, CARD_W, h, 14);
  ctx.fillStyle = PANEL;
  ctx.fill();
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = TEXT;
  ctx.font = "700 19px RoocPartyBoardFont";
  const partyLabel = sanitizeForCanvas(party.label);
  ctx.fillText(truncateToWidth(ctx, partyLabel, CARD_W - CARD_PADDING * 2), x + CARD_PADDING, y + CARD_PADDING + 16);

  for (const slot of party.slots) {
    const rowY = y + CARD_HEADER_H + CARD_PADDING + slot.slotIndex * ROW_H + 18;
    if (slot.member) {
      const displayName = sanitizeForCanvas(slot.member.displayName);
      const className = slot.member.className ? sanitizeForCanvas(slot.member.className) : "";
      const classSuffix = className ? `(${className})` : "";
      const label = `${slot.slotIndex + 1}. ${displayName}`;

      // Measure everything in the NAME's font (16px) before ever switching
      // ctx.font to the smaller suffix size — measureText always reads
      // whatever font is currently set, so measuring after the switch (an
      // earlier bug here) silently used the wrong metrics and made the
      // suffix overlap the name.
      ctx.font = "400 16px RoocPartyBoardFont";
      const suffixBudget = classSuffix ? ctx.measureText(classSuffix).width + 8 : 0;
      const truncatedLabel = truncateToWidth(ctx, label, CARD_W - CARD_PADDING * 2 - suffixBudget);
      const nameWidth = ctx.measureText(truncatedLabel).width;

      ctx.fillStyle = TEXT;
      ctx.fillText(truncatedLabel, x + CARD_PADDING, rowY);

      if (classSuffix) {
        ctx.fillStyle = MUTED;
        ctx.font = "400 14px RoocPartyBoardFont";
        ctx.fillText(classSuffix, x + CARD_PADDING + nameWidth + 8, rowY);
      }
    } else {
      ctx.fillStyle = EMPTY;
      ctx.font = "400 16px RoocPartyBoardFont";
      ctx.fillText(`${slot.slotIndex + 1}. ว่าง`, x + CARD_PADDING, rowY);
    }
  }
}

/**
 * Renders a full board — every group, every party, every slot — as one PNG
 * styled to match the live app, for posting to Discord as an actual picture
 * instead of a wall of text. Deliberately skips the busy/unassigned pools
 * (this is about "who's placed where", which the attendance/ลา system
 * already covers separately) and skips member avatars (would need a network
 * fetch per member plus decode — a lot of extra failure surface for a
 * nice-to-have visual touch); each row still names the member's class so
 * the image stays useful for spotting a lopsided party at a glance.
 */
export function renderPartyBoardImage(board: PartyBoardDetail): Buffer {
  ensureFont();

  const cardsPerRow = Math.max(1, Math.floor((CANVAS_WIDTH - PADDING * 2 + CARD_GAP) / (CARD_W + CARD_GAP)));
  const cH = cardHeight();

  const groupLayouts = board.groups.map((group) => {
    const rows = Math.max(1, Math.ceil(group.parties.length / cardsPerRow));
    const height = GROUP_HEADER_H + rows * cH + (rows - 1) * CARD_GAP;
    return { group, rows, height };
  });
  const contentHeight = groupLayouts.reduce((sum, g) => sum + g.height + GROUP_GAP, 0);
  const totalHeight = Math.max(HEADER_H + contentHeight + FOOTER_H, 320);

  const canvas = createCanvas(CANVAS_WIDTH, totalHeight);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = TEXT;
  ctx.font = "700 40px RoocPartyBoardFont";
  ctx.fillText(`Party Board — ${sanitizeForCanvas(board.name)}`, PADDING, 62);

  ctx.fillStyle = MUTED;
  ctx.font = "400 20px RoocPartyBoardFont";
  const dateStr = new Date().toLocaleString("th-TH", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  });
  ctx.fillText(dateStr, PADDING, 94);

  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(PADDING, HEADER_H - 20);
  ctx.lineTo(CANVAS_WIDTH - PADDING, HEADER_H - 20);
  ctx.stroke();

  if (groupLayouts.length === 0) {
    ctx.fillStyle = MUTED;
    ctx.font = "400 22px RoocPartyBoardFont";
    ctx.fillText("ยังไม่มีกลุ่ม/ปาร์ตี้ในกระดานนี้", PADDING, HEADER_H + 40);
  }

  let y = HEADER_H;
  for (const { group, rows } of groupLayouts) {
    ctx.fillStyle = ACCENT;
    ctx.font = "700 24px RoocPartyBoardFont";
    ctx.fillText(sanitizeForCanvas(group.name), PADDING, y + 30);
    y += GROUP_HEADER_H;

    group.parties.forEach((party, i) => {
      const col = i % cardsPerRow;
      const row = Math.floor(i / cardsPerRow);
      const x = PADDING + col * (CARD_W + CARD_GAP);
      const cardY = y + row * (cH + CARD_GAP);
      drawPartyCard(ctx, x, cardY, party);
    });

    y += rows * cH + (rows - 1) * CARD_GAP + GROUP_GAP;
  }

  ctx.fillStyle = MUTED;
  ctx.font = "400 15px RoocPartyBoardFont";
  ctx.fillText("Divine Guild Manager", PADDING, canvas.height - 18);

  return canvas.toBuffer("image/png");
}
