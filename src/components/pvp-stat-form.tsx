"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { submitPvpStat, type PvpStatInput } from "@/app/actions/pvp-stats";
import { PVP_ROLES } from "@/lib/pvp-roles";
import { PVP_STAT_FIELD_GROUPS as FIELD_GROUPS } from "@/lib/pvp-stat-fields";
import type { PvpStatEntry } from "@/db/schema";

function toInputValue(n: number | null | undefined): string {
  return n === null || n === undefined ? "" : String(n);
}

function parseField(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function PvpStatForm({ initial }: { initial: PvpStatEntry | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<string>(initial?.role ?? "");
  const [bossCards, setBossCards] = useState(initial?.bossCards ?? "");
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const group of FIELD_GROUPS) {
      for (const f of group.fields) v[f.key] = toInputValue(initial?.[f.key] as number | null | undefined);
    }
    return v;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const input: PvpStatInput = {
      role: (role || null) as PvpStatInput["role"],
      bossCards: bossCards.trim() || null,
      cp: parseField(values.cp),
      pDef: parseField(values.pDef),
      mDef: parseField(values.mDef),
      pvpBonus: parseField(values.pvpBonus),
      pvpReduction: parseField(values.pvpReduction),
      pDmgReductionPct: parseField(values.pDmgReductionPct),
      mDmgReductionPct: parseField(values.mDmgReductionPct),
      atk: parseField(values.atk),
      matk: parseField(values.matk),
      ignorePDef: parseField(values.ignorePDef),
      ignoreMDef: parseField(values.ignoreMDef),
      pDmgBonusPct: parseField(values.pDmgBonusPct),
      mDmgBonusPct: parseField(values.mDmgBonusPct),
    };

    const result = await submitPvpStat(input);
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-amber-500"
      >
        {initial ? "อัปเดตสถิติของฉัน" : "กรอกสถิติของฉัน"}
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-5 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5"
    >
      <div className="flex items-center justify-between">
        <h2 className="font-medium text-zinc-100">
          {initial ? "อัปเดตสถิติของฉัน" : "กรอกสถิติของฉัน"}
        </h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded px-1.5 py-0.5 text-zinc-500 transition hover:text-zinc-300"
        >
          ✕
        </button>
      </div>

      {initial && (
        <p className="text-xs text-zinc-500">
          ค่าด้านล่างเติมจากครั้งล่าสุดที่คุณกรอกไว้ ({new Date(initial.createdAt).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok" })}) — แก้เฉพาะที่เปลี่ยนแล้วบันทึกได้เลย ระบบจะเก็บเป็นรายการใหม่แยกไว้ ไม่ทับของเดิม
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs text-zinc-400">
          Role
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-sm text-zinc-100 focus:border-amber-500 focus:outline-none"
          >
            <option value="">— ไม่ระบุ —</option>
            {PVP_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
      </div>

      {FIELD_GROUPS.map((group) => (
        <div key={group.title} className="flex flex-col gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{group.title}</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {group.fields.map((f) => (
              <label key={f.key} className="flex flex-col gap-1 text-xs text-zinc-400">
                {f.label}
                <input
                  type="number"
                  inputMode="decimal"
                  step={f.isPercent ? "0.01" : "1"}
                  value={values[f.key]}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  className="rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-sm text-zinc-100 focus:border-amber-500 focus:outline-none"
                />
              </label>
            ))}
          </div>
        </div>
      ))}

      <label className="flex flex-col gap-1 text-xs text-zinc-400">
        การ์ดบอสที่มี
        <input
          type="text"
          value={bossCards}
          onChange={(e) => setBossCards(e.target.value)}
          placeholder="เช่น Moon/Orclord"
          className="rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-sm text-zinc-100 focus:border-amber-500 focus:outline-none"
        />
      </label>

      {error && <p className="text-sm text-rose-400">{error}</p>}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-amber-500 disabled:opacity-50"
        >
          {saving ? "กำลังบันทึก..." : "บันทึก"}
        </button>
        <span className="text-xs text-zinc-500">ทุกช่องไม่บังคับ เว้นว่างได้ถ้าไม่มีข้อมูล</span>
      </div>
    </form>
  );
}
