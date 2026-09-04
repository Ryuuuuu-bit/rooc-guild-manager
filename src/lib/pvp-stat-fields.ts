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
  { title: "Base", fields: [{ key: "cp", label: "CP" }] },
  {
    title: "Defense",
    fields: [
      { key: "pDef", label: "P.DEF" },
      { key: "mDef", label: "M.DEF" },
      { key: "pvpReduction", label: "PVP Reduction" },
      { key: "pDmgReductionPct", label: "P.DMG Reduction %", isPercent: true },
      { key: "mDmgReductionPct", label: "M.DMG Reduction %", isPercent: true },
    ],
  },
  {
    title: "Attack",
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

// Admin-added stat columns (pvpStatFieldDefs in schema.ts) — client-safe
// shape mirrored from the DB row, used by the form, table, and card
// renderers the same way PvpStatFieldDef above is. `active: false` fields
// are still passed around (so old history can still resolve their label)
// but callers filter them out of anything a member currently fills in or
// sees as a live column — see the `active` filtering at each call site.
export interface PvpCustomFieldDef {
  id: string;
  key: string;
  label: string;
  groupTitle: string;
  isPercent: boolean;
  sortOrder: number;
  active: boolean;
}

/** Buckets custom fields by their groupTitle, preserving each field's own
 * sortOrder within the bucket and first-seen order across buckets — the
 * admin-defined equivalent of PVP_STAT_FIELD_GROUPS' fixed grouping. */
export function groupCustomFields(defs: PvpCustomFieldDef[]): { title: string; fields: PvpCustomFieldDef[] }[] {
  const sorted = [...defs].sort((a, b) => a.sortOrder - b.sortOrder);
  const order: string[] = [];
  const byTitle = new Map<string, PvpCustomFieldDef[]>();
  for (const def of sorted) {
    if (!byTitle.has(def.groupTitle)) {
      byTitle.set(def.groupTitle, []);
      order.push(def.groupTitle);
    }
    byTitle.get(def.groupTitle)!.push(def);
  }
  return order.map((title) => ({ title, fields: byTitle.get(title)! }));
}
