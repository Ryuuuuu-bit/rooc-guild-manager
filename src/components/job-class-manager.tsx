"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createJobClass, deleteJobClass, moveJobClass, updateJobClass } from "@/app/actions/job-classes";
import { HEX_CLASS, COLOR_KEYS, SWATCH_CLASS, type ColorKey } from "@/lib/job-class-colors";
import { AppIcon } from "@/components/shell/app-icon";
import { Kpi } from "@/components/ui/kit";
import { PVP_KEY_STAT_OPTIONS } from "@/lib/pvp-stat-fields";
import type { JobClassClient } from "@/components/job-classes-provider";
import { uiConfirm } from "@/components/feedback";

interface JobClassItem extends JobClassClient {
  id: string;
  colorKey: string;
}

function ColorPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {COLOR_KEYS.map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          title={key}
          className={`h-6 w-6 rounded-full ring-2 transition ${SWATCH_CLASS[key]} ${
            value === key ? "ring-zinc-100" : "ring-transparent hover:ring-zinc-600"
          }`}
        />
      ))}
    </div>
  );
}

function ClassForm({
  initial,
  onSubmit,
  onCancel,
  onSuccess,
  submitLabel,
}: {
  initial?: { name: string; emoji: string; colorKey: string; keyStat?: string | null };
  onSubmit: (formData: FormData) => Promise<{ ok: boolean; error?: string }>;
  onCancel: () => void;
  /** Called after a successful save (in addition to router.refresh() below)
   * so the caller can close/reset the form — without this, a successful add
   * or edit left the form sitting open with the just-saved values still in
   * it and no "saved" confirmation, so clicking "Add class"/"Save" again out
   * of uncertainty hit a confusing "already exists" error for something that
   * had, in fact, just worked. */
  onSuccess?: () => void;
  submitLabel: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [emoji, setEmoji] = useState(initial?.emoji ?? "");
  const [colorKey, setColorKey] = useState<string>(initial?.colorKey ?? (COLOR_KEYS[0] as ColorKey));
  const [keyStat, setKeyStat] = useState<string>(initial?.keyStat ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const fd = new FormData();
    fd.set("name", name);
    fd.set("emoji", emoji);
    fd.set("colorKey", colorKey);
    fd.set("keyStat", keyStat);
    startTransition(async () => {
      const res = await onSubmit(fd);
      if (!res.ok) {
        setError(res.error ?? "Save failed");
        return;
      }
      router.refresh();
      onSuccess?.();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
      {error && <p className="rounded-lg border border-rose-900/60 bg-rose-950/30 p-2 text-xs text-rose-300">{error}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_100px]">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-zinc-400">Class name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Sura, Guillotine Cross"
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-zinc-400">Emoji</span>
          <input
            value={emoji}
            onChange={(e) => setEmoji(e.target.value)}
            placeholder="🗡️"
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-center text-lg text-zinc-100 focus:border-amber-500 focus:outline-none"
          />
        </label>
      </div>
      <div className="flex flex-col gap-1 text-xs">
        <span className="text-zinc-400">Color</span>
        <ColorPicker value={colorKey} onChange={setColorKey} />
      </div>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-zinc-400">Key PVP stat</span>
        <select
          value={keyStat}
          onChange={(e) => setKeyStat(e.target.value)}
          className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500 focus:outline-none"
        >
          <option value="">— none —</option>
          {PVP_KEY_STAT_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
        <span className="text-[11px] text-zinc-500">
          The one number this class lives on (e.g. MATK for a Wizard, P.DEF for a Knight). /pvp-stats flags members far below their class&apos;s median on it.
        </span>
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition hover:bg-zinc-800">
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Saving..." : submitLabel}
        </button>
      </div>
    </form>
  );
}

export interface ClassUsage {
  main: number;
  alt: number;
}

/** Saves one field change straight from the card (key stat / colour) — updateJobClass needs the full record. */
function quickUpdate(c: JobClassItem, patch: Partial<{ colorKey: string; keyStat: string | null }>) {
  const fd = new FormData();
  fd.set("name", c.name);
  fd.set("emoji", c.emoji);
  fd.set("colorKey", patch.colorKey ?? c.colorKey);
  fd.set("keyStat", (patch.keyStat !== undefined ? patch.keyStat : c.keyStat) ?? "");
  return updateJobClass(c.id, fd);
}

export function JobClassManager({ classes, usage, roster }: { classes: JobClassItem[]; usage: Record<string, ClassUsage>; roster: number }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function run(id: string, p: Promise<{ ok: boolean; error?: string }>, fallback: string) {
    setBusyId(id);
    p.then((res) => {
      if (!res.ok) {
        setError(res.error ?? fallback);
        return;
      }
      setError(null);
      router.refresh();
    })
      .catch((err) => {
        console.error(fallback, err);
        setError(fallback);
      })
      .finally(() => setBusyId(null));
  }

  async function handleDelete(c: JobClassItem) {
    const u = usage[c.name] ?? { main: 0, alt: 0 };
    if (
      !(await uiConfirm({
        title: `Delete class "${c.name}"?`,
        message: `${u.main} member(s) have it as their main class and become unclassed; ${u.alt} lose it as a secondary class. This cannot be undone.`,
        confirmLabel: "Delete class",
        danger: true,
      }))
    )
      return;
    run(c.id, deleteJobClass(c.id), "Delete failed");
  }

  const withPlayers = classes.filter((c) => (usage[c.name]?.main ?? 0) > 0).length;
  const noKeyStat = classes.filter((c) => !c.keyStat).length;
  const unused = classes.filter((c) => !(usage[c.name]?.main ?? 0) && !(usage[c.name]?.alt ?? 0)).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Kpi label="Classes" value={classes.length} hint="Shown everywhere a class can be picked, and in Discord" />
        <Kpi label="With main players" value={withPlayers} hint={`Across ${roster} active members`} />
        <Kpi label="No key PVP stat" value={noKeyStat} tone={noKeyStat ? "warn" : "ok"} hint="Needed for the ⚠ flags on PVP Stats" alert={noKeyStat > 0} />
        <Kpi label="Unused" value={unused} tone="dim" hint="Nobody plays these (main or secondary)" />
      </div>

      {error && <p className="rounded-lg border border-rose-900/60 bg-rose-950/30 p-2 text-xs text-rose-300">{error}</p>}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(250px,100%),1fr))] items-stretch gap-2.5">
        {classes.map((c, i) => {
          const u = usage[c.name] ?? { main: 0, alt: 0 };
          const hex = HEX_CLASS[c.colorKey as ColorKey] ?? "#a8a29e";
          if (editingId === c.id) {
            return (
              <div key={c.id} className="col-span-full">
                <ClassForm initial={c} submitLabel="Save" onCancel={() => setEditingId(null)} onSuccess={() => setEditingId(null)} onSubmit={(fd) => updateJobClass(c.id, fd)} />
              </div>
            );
          }
          return (
            <div key={c.id} className={`flex h-full flex-col gap-2.5 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 transition hover:border-zinc-700 ${busyId === c.id ? "opacity-60" : ""}`}>
              <div className="flex items-center gap-2.5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xl" style={{ background: `${hex}22`, boxShadow: `inset 0 0 0 1px ${hex}55` }}>
                  {c.emoji}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-bold" style={{ color: hex }}>
                    {c.name}
                  </p>
                  <p className="text-[11.5px] text-zinc-500">
                    Main <b className="tabular-nums text-zinc-200">{u.main}</b> · Secondary <b className="tabular-nums text-zinc-200">{u.alt}</b>
                  </p>
                </div>
                <span className="flex shrink-0 flex-col">
                  <button type="button" disabled={i === 0 || busyId === c.id} onClick={() => run(c.id, moveJobClass(c.id, "up"), "Failed to reorder")} title="Move earlier" className="rounded p-0.5 text-zinc-500 hover:text-zinc-100 disabled:opacity-20">
                    <AppIcon name="chevl" size={14} className="rotate-90" />
                  </button>
                  <button
                    type="button"
                    disabled={i === classes.length - 1 || busyId === c.id}
                    onClick={() => run(c.id, moveJobClass(c.id, "down"), "Failed to reorder")}
                    title="Move later"
                    className="rounded p-0.5 text-zinc-500 hover:text-zinc-100 disabled:opacity-20"
                  >
                    <AppIcon name="chevr" size={14} className="rotate-90" />
                  </button>
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {COLOR_KEYS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    title={k}
                    disabled={busyId === c.id}
                    onClick={() => k !== c.colorKey && run(c.id, quickUpdate(c, { colorKey: k }), "Failed to change colour")}
                    className={`h-4 w-4 rounded-[5px] ${SWATCH_CLASS[k]} ${k === c.colorKey ? "ring-2 ring-zinc-100 ring-offset-1 ring-offset-zinc-900" : "opacity-70 hover:opacity-100"}`}
                  />
                ))}
              </div>
              <div className="mt-auto flex items-center gap-1.5 text-[11.5px] text-zinc-500">
                Key PVP stat
                <select
                  value={c.keyStat ?? ""}
                  disabled={busyId === c.id}
                  onChange={(e) => run(c.id, quickUpdate(c, { keyStat: e.target.value || null }), "Failed to save key stat")}
                  className={`min-w-0 flex-1 rounded-md border bg-zinc-950 px-1.5 py-1 text-[11.5px] focus:border-amber-500 focus:outline-none ${c.keyStat ? "border-zinc-800 text-zinc-200" : "border-amber-500/40 text-amber-200"}`}
                >
                  <option value="">— not set —</option>
                  {PVP_KEY_STAT_OPTIONS.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={() => setEditingId(c.id)} title="Edit name / emoji" className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-amber-300">
                  <AppIcon name="pencil" size={14} />
                </button>
                <button type="button" onClick={() => handleDelete(c)} title="Delete class" className="rounded p-1 text-zinc-500 hover:bg-rose-950/40 hover:text-rose-400">
                  <AppIcon name="trash" size={14} />
                </button>
              </div>
            </div>
          );
        })}
        {classes.length === 0 && <p className="col-span-full rounded-xl border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-500">No classes yet</p>}
      </div>

      {showAdd ? (
        <ClassForm submitLabel="Add class" onCancel={() => setShowAdd(false)} onSuccess={() => setShowAdd(false)} onSubmit={createJobClass} />
      ) : (
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-1.5 self-start rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-amber-500"
        >
          <AppIcon name="plus" size={16} /> Add class
        </button>
      )}
    </div>
  );
}
