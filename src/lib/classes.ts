// Fixed list of in-game classes selectable for a party slot, matching the
// guild's existing Excel sheet. Kept as a constant (rather than editable
// data) since the admin asked for a fixed dropdown.
export const CLASS_OPTIONS = [
  "Bio",
  "B/D",
  "DoramSTR",
  "DoramINT",
  "Knight",
  "Priest",
  "WizMeteo",
  "WizCC",
  "Paladin",
  "Rouge",
  "Assassin",
  "Sage",
  "Champion",
  "Sniper",
  "Blacksmith",
] as const;

export type ClassOption = (typeof CLASS_OPTIONS)[number];

/** Badge colors per class, loosely matching the color-coding in the original sheet. */
export const classColors: Record<string, string> = {
  Bio: "bg-orange-400/15 text-orange-300 ring-1 ring-inset ring-orange-400/30",
  "B/D": "bg-amber-400/15 text-amber-300 ring-1 ring-inset ring-amber-400/30",
  DoramSTR: "bg-violet-400/15 text-violet-300 ring-1 ring-inset ring-violet-400/30",
  DoramINT: "bg-purple-400/15 text-purple-300 ring-1 ring-inset ring-purple-400/30",
  Knight: "bg-rose-500/20 text-rose-300 ring-1 ring-inset ring-rose-500/40",
  Priest: "bg-emerald-400/15 text-emerald-300 ring-1 ring-inset ring-emerald-400/30",
  WizMeteo: "bg-pink-400/15 text-pink-300 ring-1 ring-inset ring-pink-400/30",
  WizCC: "bg-sky-400/15 text-sky-300 ring-1 ring-inset ring-sky-400/30",
  Paladin: "bg-fuchsia-400/15 text-fuchsia-300 ring-1 ring-inset ring-fuchsia-400/30",
  Rouge: "bg-indigo-400/15 text-indigo-300 ring-1 ring-inset ring-indigo-400/30",
  Assassin: "bg-red-500/20 text-red-300 ring-1 ring-inset ring-red-500/40",
  Sage: "bg-teal-400/15 text-teal-300 ring-1 ring-inset ring-teal-400/30",
  Champion: "bg-yellow-400/15 text-yellow-300 ring-1 ring-inset ring-yellow-400/30",
  Sniper: "bg-lime-400/15 text-lime-300 ring-1 ring-inset ring-lime-400/30",
  Blacksmith: "bg-stone-400/15 text-stone-300 ring-1 ring-inset ring-stone-400/30",
};
