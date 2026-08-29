"use client";

import { PVP_ROLES } from "@/lib/pvp-roles";
import { PVP_STAT_FIELD_GROUPS, groupCustomFields, type PvpCustomFieldDef } from "@/lib/pvp-stat-fields";

interface PvpStatFieldsEditorProps {
  role: string;
  onRoleChange: (value: string) => void;
  values: Record<string, string>;
  onValueChange: (key: string, value: string) => void;
  bossCards: string;
  onBossCardsChange: (value: string) => void;
  /** Only pass active field defs — retired ones don't belong on a live form. */
  customFieldDefs: PvpCustomFieldDef[];
}

const inputClass =
  "rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-sm text-zinc-100 focus:border-amber-500 focus:outline-none";
const labelClass = "flex flex-col gap-1 text-xs text-zinc-400";

/**
 * The stat input fields shared by every place a PVP stat entry gets
 * written: the member's own form, and the admin "add for member"/"edit
 * entry" modals. Pulling this out means the fixed field list (FIELD_GROUPS)
 * and any admin-added custom fields render identically everywhere,
 * including when a field is added or retired.
 */
export function PvpStatFieldsEditor({
  role,
  onRoleChange,
  values,
  onValueChange,
  bossCards,
  onBossCardsChange,
  customFieldDefs,
}: PvpStatFieldsEditorProps) {
  const customGroups = groupCustomFields(customFieldDefs);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <label className={labelClass}>
          Role
          <select value={role} onChange={(e) => onRoleChange(e.target.value)} className={inputClass}>
            <option value="">— ไม่ระบุ —</option>
            {PVP_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
      </div>

      {[...PVP_STAT_FIELD_GROUPS, ...customGroups].map((group) => (
        <div key={group.title} className="flex flex-col gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{group.title}</p>
          <div className="overflow-x-auto rounded-lg border border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-950/60">
                  {group.fields.map((f) => (
                    <th key={f.key} className="whitespace-nowrap px-2.5 py-1.5 text-left text-xs font-medium text-zinc-400">
                      {f.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {group.fields.map((f) => (
                    <td key={f.key} className="px-2 py-1.5">
                      <input
                        type="number"
                        inputMode="decimal"
                        step={f.isPercent ? "0.01" : "1"}
                        value={values[f.key] ?? ""}
                        onChange={(e) => onValueChange(f.key, e.target.value)}
                        className={`w-full min-w-[90px] ${inputClass}`}
                      />
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <label className={labelClass}>
        การ์ดบอสที่มี
        <input
          type="text"
          value={bossCards}
          onChange={(e) => onBossCardsChange(e.target.value)}
          placeholder="เช่น Moon/Orclord"
          className={inputClass}
        />
      </label>
    </>
  );
}
