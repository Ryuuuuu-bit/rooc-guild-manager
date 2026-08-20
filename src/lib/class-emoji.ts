// Relative import (not the "@/" alias) — this file is also imported directly
// by the bot worker (bot/reactions.ts), which runs via `tsx` and doesn't
// resolve the Next.js tsconfig path alias.
import { CLASS_OPTIONS, type ClassOption } from "./classes";

// One emoji per class, reused conceptually from `class-icon.tsx`'s
// lucide-icon mapping (FlaskConical/Music2/PawPrint/Wand2/Swords/Cross/
// Flame/Snowflake/ShieldCheck/Zap) so the two stay recognizable as "the same
// class" between the web UI and Discord. Plain unicode emoji — Discord
// reactions don't need anything fancier, and it keeps the bot's REST calls
// simple (no custom-emoji IDs to look up per-guild).
export const CLASS_EMOJI: Record<ClassOption, string> = {
  Bio: "🧪",
  "B/D": "🎵",
  DoramSTR: "🐾",
  DoramINT: "🪄",
  Knight: "⚔️",
  Priest: "✝️",
  WizMeteo: "🔥",
  WizCC: "❄️",
  Paladin: "🛡️",
  Rouge: "⚡",
  Assassin: "🗡️",
  Sage: "📖",
  Champion: "👊",
  Sniper: "🏹",
  Blacksmith: "🔨",
};

export const EMOJI_TO_CLASS: Record<string, ClassOption> = Object.fromEntries(
  CLASS_OPTIONS.map((c) => [CLASS_EMOJI[c], c])
) as Record<string, ClassOption>;

/** Reaction emoji members use to mark themselves "ลา" (opting out of a board's roster this round). */
export const ATTENDANCE_EMOJI = "🙋";
