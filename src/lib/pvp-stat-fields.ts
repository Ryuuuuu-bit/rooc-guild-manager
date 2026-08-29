// Client-safe (no "@/db" import — see the Client Component gotcha noted in
// schema.ts/pvp-stats.ts) shared field list + formatters, used by the entry
// form, the desktop table, and the mobile card layout so all three read the
// same set of columns in the same order — adding a stat only means editing
// this file once.
export interface PvpStatFieldDef {
  key:
    | "cp"
    | "pDef"
    | "mDef"
    | "pvpBonus"
    | "pvpReduction"
    | "pDmgReductionPct"
    | "mDmgReductionPct"
    | "atk"
    | "matk"
    | "ignorePDef"
    | "ignoreMDef"
    | "pDmgBonusPct"
    | "mDmgBonusPct";
  label: string;
  /** Percent fields allow decimals; flat stats are whole numbers. */
  isPercent?: boolean;
}

// Grouped to mirror how the guild's own Google Sheet reads left-to-right —
// members switching over from filling that in should recognize this layout.
export const PVP_STAT_FIELD_GROUPS: { title: string; fields: PvpStatFieldDef[] }[] = [
  { title: "พื้นฐาน", fields: [{ key: "cp", label: "CP" }] },
  {
    title: "ป้องกัน",
    fields: [
      { key: "pDef", label: "P.DEF" },
      { key: "mDef", label: "M.DEF" },
      { key: "pvpReduction", label: "PVP Reduction" },
      { key: "pDmgReductionPct", label: "P.DMG Reduction %", isPercent: true },
      { key: "mDmgReductionPct", label: "M.DMG Reduction %", isPercent: true },
    ],
  },
  {
    title: "โจมตี",
    fields: [
      { key: "atk", label: "ATK" },
      { key: "matk", label: "MATK" },
      { key: "pvpBonus", label: "PVP Bonus" },
      { key: "ignorePDef", label: "Ignore P.DEF" },
      { key: "ignoreMDef", label: "Ignore M.DEF" },
      { key: "pDmgBonusPct", label: "P.DMG Bonus %", isPercent: true },
      { key: "mDmgBonusPct", label: "M.DMG Bonus %", isPercent: true },
    ],
  },
];

export function fmtInt(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : n.toLocaleString("th-TH");
}

export function fmtPct(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : `${n.toLocaleString("th-TH", { maximumFractionDigits: 2 })}%`;
}
