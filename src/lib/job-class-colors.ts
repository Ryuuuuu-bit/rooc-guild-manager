// Fixed palette of badge color styles an admin picks from when
// creating/editing a job class (src/app/actions/job-classes.ts). Deliberately
// NOT free-form: Tailwind's build-time scanner only includes utility classes
// that appear as literal text somewhere in source — a class string assembled
// at runtime from a DB value (e.g. `bg-${color}-400/15`) would silently not
// exist in the compiled CSS. Every option here is written out in full so the
// scanner picks it up, and only the short `colorKey` (e.g. "teal") is stored
// per class in the database.
//
// No "@/db" import here (unlike src/lib/job-classes.ts) — this file is safe
// to import from Client Components.
export const COLOR_PALETTE = {
  red: "bg-red-500/20 text-red-300 ring-1 ring-inset ring-red-500/40",
  orange: "bg-orange-400/15 text-orange-300 ring-1 ring-inset ring-orange-400/30",
  amber: "bg-amber-400/15 text-amber-300 ring-1 ring-inset ring-amber-400/30",
  yellow: "bg-yellow-400/15 text-yellow-300 ring-1 ring-inset ring-yellow-400/30",
  lime: "bg-lime-400/15 text-lime-300 ring-1 ring-inset ring-lime-400/30",
  emerald: "bg-emerald-400/15 text-emerald-300 ring-1 ring-inset ring-emerald-400/30",
  teal: "bg-teal-400/15 text-teal-300 ring-1 ring-inset ring-teal-400/30",
  sky: "bg-sky-400/15 text-sky-300 ring-1 ring-inset ring-sky-400/30",
  indigo: "bg-indigo-400/15 text-indigo-300 ring-1 ring-inset ring-indigo-400/30",
  violet: "bg-violet-400/15 text-violet-300 ring-1 ring-inset ring-violet-400/30",
  purple: "bg-purple-400/15 text-purple-300 ring-1 ring-inset ring-purple-400/30",
  fuchsia: "bg-fuchsia-400/15 text-fuchsia-300 ring-1 ring-inset ring-fuchsia-400/30",
  pink: "bg-pink-400/15 text-pink-300 ring-1 ring-inset ring-pink-400/30",
  rose: "bg-rose-500/20 text-rose-300 ring-1 ring-inset ring-rose-500/40",
  stone: "bg-stone-400/15 text-stone-300 ring-1 ring-inset ring-stone-400/30",
} as const;

export type ColorKey = keyof typeof COLOR_PALETTE;
export const COLOR_KEYS = Object.keys(COLOR_PALETTE) as ColorKey[];

export function colorClassFor(colorKey: string): string {
  return COLOR_PALETTE[colorKey as ColorKey] ?? COLOR_PALETTE.stone;
}

/** Translucent-to-solid two-stop gradient per key, for bar-style
 * visualizations (the dashboard's class-distribution panel) that want more
 * depth than a flat fill. Same "every option written out in full" reasoning
 * as SWATCH_CLASS below — Tailwind's build-time scanner needs the literal
 * class strings to appear somewhere in source. */
export const GRADIENT_CLASS: Record<ColorKey, string> = {
  red: "from-red-500/40 to-red-500",
  orange: "from-orange-400/40 to-orange-400",
  amber: "from-amber-400/40 to-amber-400",
  yellow: "from-yellow-400/40 to-yellow-400",
  lime: "from-lime-400/40 to-lime-400",
  emerald: "from-emerald-400/40 to-emerald-400",
  teal: "from-teal-400/40 to-teal-400",
  sky: "from-sky-400/40 to-sky-400",
  indigo: "from-indigo-400/40 to-indigo-400",
  violet: "from-violet-400/40 to-violet-400",
  purple: "from-purple-400/40 to-purple-400",
  fuchsia: "from-fuchsia-400/40 to-fuchsia-400",
  pink: "from-pink-400/40 to-pink-400",
  rose: "from-rose-500/40 to-rose-500",
  stone: "from-stone-400/40 to-stone-400",
};

/** Solid (full-opacity) swatch color per key — used only by the color-picker UI in /classes, where the translucent badge tints above would look washed out as small swatch dots. */
export const SWATCH_CLASS: Record<ColorKey, string> = {
  red: "bg-red-500",
  orange: "bg-orange-400",
  amber: "bg-amber-400",
  yellow: "bg-yellow-400",
  lime: "bg-lime-400",
  emerald: "bg-emerald-400",
  teal: "bg-teal-400",
  sky: "bg-sky-400",
  indigo: "bg-indigo-400",
  violet: "bg-violet-400",
  purple: "bg-purple-400",
  fuchsia: "bg-fuchsia-400",
  pink: "bg-pink-400",
  rose: "bg-rose-500",
  stone: "bg-stone-400",
};
