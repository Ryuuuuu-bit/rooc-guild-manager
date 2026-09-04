"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPvpStatField, deletePvpStatField, setPvpStatFieldActive } from "@/app/actions/pvp-stats";
import type { PvpCustomFieldDef } from "@/lib/pvp-stat-fields";

// How long the "ยืนยันการลบ" state stays armed before reverting — long enough
// to read the warning and click again, short enough that walking away
// doesn't leave a live "delete" button primed by accident.
const DELETE_CONFIRM_MS = 4000;

/** Admin adds/retires stat columns — the web-UI equivalent of what used to need a schema migration + deploy. */
export function PvpFieldManagerButton({ fields }: { fields: PvpCustomFieldDef[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [groupTitle, setGroupTitle] = useState("Other");
  const [isPercent, setIsPercent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    };
  }, []);

  const knownGroups = [...new Set(fields.map((f) => f.groupTitle))];

  async function handleAdd() {
    if (!label.trim()) {
      setError("Please enter a field name");
      return;
    }
    setSaving(true);
    setError(null);
    const result = await createPvpStatField({ label, groupTitle, isPercent });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Add failed, please try again");
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

  function armDelete(id: string) {
    setError(null);
    setConfirmDeleteId(id);
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    confirmTimerRef.current = setTimeout(() => setConfirmDeleteId((cur) => (cur === id ? null : cur)), DELETE_CONFIRM_MS);
  }

  async function handleDelete(id: string) {
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    setConfirmDeleteId(null);
    setDeletingId(id);
    const result = await deletePvpStatField(id);
    setDeletingId(null);
    if (!result.ok) {
      setError(result.error ?? "Delete failed, please try again");
      return;
    }
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 transition hover:border-zinc-600 hover:text-zinc-100"
      >
        + Add New Stat
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4" onClick={() => setOpen(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex w-full max-w-lg flex-col gap-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-5"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-zinc-100">Manage Stat Fields</h3>
              <button type="button" onClick={() => setOpen(false)} className="rounded px-1.5 py-0.5 text-zinc-500 transition hover:text-zinc-300">
                ✕
              </button>
            </div>
            <p className="text-xs text-zinc-500">
              Add a new stat field that everyone can fill in immediately, no code changes needed — disable an old field without deleting the data already submitted for it, or delete it permanently if you never need it again.
            </p>

            {fields.length > 0 && (
              <div className="flex flex-col gap-1.5 rounded-xl border border-zinc-800 p-2">
                {fields.map((f) => {
                  const confirming = confirmDeleteId === f.id;
                  return (
                    <div key={f.id} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-zinc-800/50">
                      <div className="min-w-0">
                        <p className={`truncate text-sm ${f.active ? "text-zinc-100" : "text-zinc-500 line-through"}`}>{f.label}</p>
                        <p className="text-[11px] text-zinc-500">
                          {f.groupTitle} {f.isPercent && "· %"}
                        </p>
                        {confirming && <p className="mt-0.5 text-[11px] text-rose-400">Permanent delete, cannot be undone — click again to confirm</p>}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {!confirming && (
                          <button
                            type="button"
                            onClick={() => handleToggle(f.id, !f.active)}
                            disabled={togglingId === f.id || deletingId === f.id}
                            className={`rounded-md px-2 py-1 text-xs font-medium transition disabled:opacity-50 ${
                              f.active
                                ? "text-zinc-400 hover:bg-zinc-800 hover:text-rose-400"
                                : "text-zinc-400 hover:bg-zinc-800 hover:text-emerald-400"
                            }`}
                          >
                            {f.active ? "Disable" : "Enable"}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => (confirming ? handleDelete(f.id) : armDelete(f.id))}
                          disabled={deletingId === f.id}
                          className={`rounded-md px-2 py-1 text-xs font-medium transition disabled:opacity-50 ${
                            confirming
                              ? "bg-rose-500/15 text-rose-300 hover:bg-rose-500/25"
                              : "text-zinc-500 hover:bg-zinc-800 hover:text-rose-400"
                          }`}
                        >
                          {deletingId === f.id ? "Deleting..." : confirming ? "Confirm Delete" : "Delete Permanently"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex flex-col gap-3 rounded-xl border border-zinc-800 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Add New Field</p>
              <label className="flex flex-col gap-1 text-xs text-zinc-400">
                Field name
                <input
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. Crit Rate %"
                  className="rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-sm text-zinc-100 focus:border-amber-500 focus:outline-none"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-zinc-400">
                Group
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
                Percentage value (allows decimals)
              </label>
              {error && <p className="text-sm text-rose-400">{error}</p>}
              <button
                type="button"
                onClick={handleAdd}
                disabled={saving}
                className="self-start rounded-lg bg-amber-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-amber-500 disabled:opacity-50"
              >
                {saving ? "Adding..." : "+ Add Field"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
