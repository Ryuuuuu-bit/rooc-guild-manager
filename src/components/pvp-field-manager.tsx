"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createPvpStatField, setPvpStatFieldActive } from "@/app/actions/pvp-stats";
import type { PvpCustomFieldDef } from "@/lib/pvp-stat-fields";

/** Admin adds/retires stat columns — the web-UI equivalent of what used to need a schema migration + deploy. */
export function PvpFieldManagerButton({ fields }: { fields: PvpCustomFieldDef[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [groupTitle, setGroupTitle] = useState("อื่นๆ");
  const [isPercent, setIsPercent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const knownGroups = [...new Set(fields.map((f) => f.groupTitle))];

  async function handleAdd() {
    if (!label.trim()) {
      setError("กรุณาใส่ชื่อฟิลด์");
      return;
    }
    setSaving(true);
    setError(null);
    const result = await createPvpStatField({ label, groupTitle, isPercent });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "เพิ่มไม่สำเร็จ ลองใหม่อีกครั้ง");
      return;
    }
    setLabel("");
    setIsPercent(false);
    router.refresh();
  }

  async function handleToggle(id: string, active: boolean) {
    setTogglingId(id);
    await setPvpStatFieldActive(id, active);
    setTogglingId(null);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 transition hover:border-zinc-600 hover:text-zinc-100"
      >
        จัดการฟิลด์สถิติ
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4" onClick={() => setOpen(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex w-full max-w-lg flex-col gap-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-5"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-zinc-100">จัดการฟิลด์สถิติ</h3>
              <button type="button" onClick={() => setOpen(false)} className="rounded px-1.5 py-0.5 text-zinc-500 transition hover:text-zinc-300">
                ✕
              </button>
            </div>
            <p className="text-xs text-zinc-500">
              เพิ่มช่องสถิติใหม่ให้ทุกคนกรอกได้ทันที ไม่ต้องแก้โค้ด — ปิดใช้งานฟิลด์เก่าได้โดยไม่ลบข้อมูลที่เคยกรอกไว้
            </p>

            {fields.length > 0 && (
              <div className="flex flex-col gap-1.5 rounded-xl border border-zinc-800 p-2">
                {fields.map((f) => (
                  <div key={f.id} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-zinc-800/50">
                    <div className="min-w-0">
                      <p className={`truncate text-sm ${f.active ? "text-zinc-100" : "text-zinc-500 line-through"}`}>{f.label}</p>
                      <p className="text-[11px] text-zinc-500">
                        {f.groupTitle} {f.isPercent && "· %"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleToggle(f.id, !f.active)}
                      disabled={togglingId === f.id}
                      className={`shrink-0 rounded-md px-2 py-1 text-xs font-medium transition disabled:opacity-50 ${
                        f.active
                          ? "text-zinc-400 hover:bg-zinc-800 hover:text-rose-400"
                          : "text-zinc-400 hover:bg-zinc-800 hover:text-emerald-400"
                      }`}
                    >
                      {f.active ? "ปิดใช้งาน" : "เปิดใช้งาน"}
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-col gap-3 rounded-xl border border-zinc-800 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">เพิ่มฟิลด์ใหม่</p>
              <label className="flex flex-col gap-1 text-xs text-zinc-400">
                ชื่อฟิลด์
                <input
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="เช่น Crit Rate %"
                  className="rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-sm text-zinc-100 focus:border-amber-500 focus:outline-none"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-zinc-400">
                กลุ่ม
                <input
                  type="text"
                  list="pvp-field-groups"
                  value={groupTitle}
                  onChange={(e) => setGroupTitle(e.target.value)}
                  className="rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-sm text-zinc-100 focus:border-amber-500 focus:outline-none"
                />
                <datalist id="pvp-field-groups">
                  {knownGroups.map((g) => (
                    <option key={g} value={g} />
                  ))}
                </datalist>
              </label>
              <label className="flex items-center gap-2 text-xs text-zinc-400">
                <input type="checkbox" checked={isPercent} onChange={(e) => setIsPercent(e.target.checked)} className="accent-amber-600" />
                เป็นค่าเปอร์เซ็นต์ (ใส่ทศนิยมได้)
              </label>
              {error && <p className="text-sm text-rose-400">{error}</p>}
              <button
                type="button"
                onClick={handleAdd}
                disabled={saving}
                className="self-start rounded-lg bg-amber-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-amber-500 disabled:opacity-50"
              >
                {saving ? "กำลังเพิ่ม..." : "+ เพิ่มฟิลด์"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
