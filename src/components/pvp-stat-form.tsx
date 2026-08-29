"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { submitPvpStat, type PvpStatInput } from "@/app/actions/pvp-stats";
import { PVP_STAT_FIELD_GROUPS, type PvpCustomFieldDef } from "@/lib/pvp-stat-fields";
import { PvpStatFieldsEditor } from "@/components/pvp-stat-fields-editor";
import type { PvpStatEntry } from "@/db/schema";

function toInputValue(n: number | null | undefined): string {
  return n === null || n === undefined ? "" : String(n);
}

function parseField(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function PvpStatForm({
  initial,
  customFieldDefs = [],
}: {
  initial: PvpStatEntry | null;
  customFieldDefs?: PvpCustomFieldDef[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<string>(initial?.role ?? "");
  const [bossCards, setBossCards] = useState(initial?.bossCards ?? "");
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const group of PVP_STAT_FIELD_GROUPS) {
      for (const f of group.fields) v[f.key] = toInputValue(initial?.[f.key] as number | null | undefined);
    }
    for (const f of customFieldDefs) v[f.key] = toInputValue(initial?.customValues?.[f.key]);
    return v;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const customValues: Record<string, number | null> = {};
    for (const f of customFieldDefs) customValues[f.key] = parseField(values[f.key] ?? "");

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
      customValues,
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

      <PvpStatFieldsEditor
        role={role}
        onRoleChange={setRole}
        values={values}
        onValueChange={(key, value) => setValues((v) => ({ ...v, [key]: value }))}
        bossCards={bossCards}
        onBossCardsChange={setBossCards}
        customFieldDefs={customFieldDefs}
      />

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
