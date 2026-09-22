// Pure helpers for a member's secondary classes — relative-import-free and
// DB-free so both the web app and the bot (tsx, no "@/" alias) can use it.

/** How many secondary classes a member can declare besides their main one. */
export const MAX_ALT_CLASSES = 2;

/** Dedupes, drops the main class (it's not "also" an alt) and caps the list. */
export function normalizeAltClasses(alts: readonly string[], mainClass: string | null): string[] {
  const out: string[] = [];
  for (const a of alts) {
    const name = a.trim();
    if (!name || name === mainClass || out.includes(name)) continue;
    out.push(name);
    if (out.length >= MAX_ALT_CLASSES) break;
  }
  return out;
}

/** "Wizard · รอง: Priest, Hunter" — one line for bot replies and logs. */
export function describeClasses(mainClass: string | null, alts: readonly string[]): string {
  const main = mainClass ?? "(ยังไม่เลือก)";
  return alts.length ? `${main} · รอง: ${alts.join(", ")}` : main;
}
