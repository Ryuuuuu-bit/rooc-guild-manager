"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  adminCreatePvpStatFor,
  adminEditPvpStatEntry,
  deletePvpStatEntry,
  type PvpStatInput,
} from "@/app/actions/pvp-stats";
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

function buildValuesState(entry: PvpStatEntry | null, customFieldDefs: PvpCustomFieldDef[]): Record<string, string> {
  const v: Record<string, string> = {};
  for (const group of PVP_STAT_FIELD_GROUPS) {
    for (const f of group.fields) v[f.key] = toInputValue(entry?.[f.key] as number | null | undefined);
  }
  for (const f of customFieldDefs) v[f.key] = toInputValue(entry?.customValues?.[f.key]);
  return v;
}

function buildInput(
  role: string,
  bossCards: string,
  values: Record<string, string>,
  customFieldDefs: PvpCustomFieldDef[]
): PvpStatInput {
  const customValues: Record<string, number | null> = {};
  for (const f of customFieldDefs) customValues[f.key] = parseField(values[f.key] ?? "");

  return {
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
}

/** Admin fills in a submission for a member who hasn't done it themselves (e.g. reported numbers in Discord instead). */
export function AdminAddEntryButton({
  members,
  customFieldDefs,
}: {
  members: { id: string; name: string }[];
  customFieldDefs: PvpCustomFieldDef[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [memberId, setMemberId] = useState(members[0]?.id ?? "");
  const [role, setRole] = useState("");
  const [bossCards, setBossCards] = useState("");
  const [values, setValues] = useState<Record<string, string>>(() => buildValuesState(null, customFieldDefs));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openModal() {
    setMemberId(members[0]?.id ?? "");
    setRole("");
    setBossCards("");
    setValues(buildValuesState(null, customFieldDefs));
    setError(null);
    setOpen(true);
  }

  async function handleSave() {
    if (!memberId) {
      setError("กรุณาเลือกสมาชิก");
      return;
    }
    setSaving(true);
    setError(null);
    const result = await adminCreatePvpStatFor(memberId, buildInput(role, bossCards, values, customFieldDefs));
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 transition hover:border-zinc-600 hover:text-zinc-100"
      >
        + เพิ่มสถิติให้สมาชิก
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4" onClick={() => setOpen(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex w-full max-w-2xl flex-col gap-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-5"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-zinc-100">เพิ่มสถิติให้สมาชิก</h3>
              <button type="button" onClick={() => setOpen(false)} className="rounded px-1.5 py-0.5 text-zinc-500 transition hover:text-zinc-300">
                ✕
              </button>
            </div>

            <label className="flex flex-col gap-1 text-xs text-zinc-400">
              สมาชิก
              <select
                value={memberId}
                onChange={(e) => setMemberId(e.target.value)}
                className="rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-sm text-zinc-100 focus:border-amber-500 focus:outline-none"
              >
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>

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

            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-4 py-1.5 text-sm text-zinc-400 transition hover:text-zinc-200">
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="rounded-lg bg-amber-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-amber-500 disabled:opacity-50"
              >
                {saving ? "กำลังบันทึก..." : "บันทึก"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Admin corrects the actual values of one existing submission — a data fix, not a new weekly entry. */
export function AdminEditEntryButton({ entry, customFieldDefs }: { entry: PvpStatEntry; customFieldDefs: PvpCustomFieldDef[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState(entry.role ?? "");
  const [bossCards, setBossCards] = useState(entry.bossCards ?? "");
  const [values, setValues] = useState<Record<string, string>>(() => buildValuesState(entry, customFieldDefs));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openModal() {
    setRole(entry.role ?? "");
    setBossCards(entry.bossCards ?? "");
    setValues(buildValuesState(entry, customFieldDefs));
    setError(null);
    setOpen(true);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    const result = await adminEditPvpStatEntry(entry.id, buildInput(role, bossCards, values, customFieldDefs));
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button type="button" onClick={openModal} className="rounded-md px-1.5 py-0.5 text-xs text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200">
        แก้ไข
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4" onClick={() => setOpen(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex w-full max-w-2xl flex-col gap-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-5"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-zinc-100">แก้ไขค่าที่กรอกผิด</h3>
              <button type="button" onClick={() => setOpen(false)} className="rounded px-1.5 py-0.5 text-zinc-500 transition hover:text-zinc-300">
                ✕
              </button>
            </div>
            <p className="text-xs text-zinc-500">แก้ไขค่าในรายการนี้โดยตรง (ไม่สร้างรายการใหม่) ใช้สำหรับแก้ตัวเลขที่กรอกผิด</p>

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

            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-4 py-1.5 text-sm text-zinc-400 transition hover:text-zinc-200">
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="rounded-lg bg-amber-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-amber-500 disabled:opacity-50"
              >
                {saving ? "กำลังบันทึก..." : "บันทึก"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Admin permanently deletes one submission — test entry, duplicate, entered for the wrong member. Confirms in a modal rather than a blocking browser dialog. */
export function AdminDeleteEntryButton({ entryId }: { entryId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    const result = await deletePvpStatEntry(entryId);
    setDeleting(false);
    if (!result.ok) {
      setError(result.error ?? "ลบไม่สำเร็จ ลองใหม่อีกครั้ง");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md px-1.5 py-0.5 text-xs text-rose-500/80 transition hover:bg-rose-500/10 hover:text-rose-400"
      >
        ลบ
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setOpen(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-5"
          >
            <h3 className="font-medium text-zinc-100">ลบรายการนี้?</h3>
            <p className="text-sm text-zinc-400">ลบแล้วกู้คืนไม่ได้ — ประวัติของรายการนี้จะหายไปถาวร</p>
            {error && <p className="text-sm text-rose-400">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-4 py-1.5 text-sm text-zinc-400 transition hover:text-zinc-200">
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="rounded-lg bg-rose-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-rose-500 disabled:opacity-50"
              >
                {deleting ? "กำลังลบ..." : "ลบ"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
